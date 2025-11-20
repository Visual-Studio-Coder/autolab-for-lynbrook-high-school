const vscode = require('vscode');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream');
const { promisify } = require('util');
const unzipper = require('unzipper');
const FormData = require('form-data');
const archiver = require('archiver');

const streamPipeline = promisify(pipeline);

const AUTOLAB_URL = "https://cs.lhs.fuhsd.org";
const COURSE_URL = `${AUTOLAB_URL}/courses/APCS-A-25/assessments`;

function getPreferences() {
    const config = vscode.workspace.getConfiguration('autolab');
    let workspacePath = config.get('workspacePath');
    if (workspacePath.startsWith('~')) {
        workspacePath = path.join(os.homedir(), workspacePath.slice(1));
    }
    return {
        workspacePath,
        sessionCookie: config.get('sessionCookie'),
        authorName: config.get('authorName'),
        period: config.get('period'),
        collaborators: config.get('collaborators')
    };
}

function updateJavaFileHeaders(folderPath, prefs) {
    console.log(`Scanning folder for Java headers: ${folderPath}`);
    if (!fs.existsSync(folderPath)) {
        console.log(`Folder does not exist: ${folderPath}`);
        return;
    }

    const files = fs.readdirSync(folderPath);

    for (const file of files) {
        const fullPath = path.join(folderPath, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            updateJavaFileHeaders(fullPath, prefs);
        } else if (file.endsWith(".java")) {
            console.log(`Checking Java file: ${file}`);
            let content = fs.readFileSync(fullPath, "utf-8");
            let modified = false;

            if (prefs.authorName && content.includes("TODO Your Name")) {
                content = content.replace(/TODO Your Name/g, prefs.authorName);
                modified = true;
            }

            if (content.includes("TODO Date")) {
                const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
                content = content.replace(/TODO Date/g, dateStr);
                modified = true;
            }

            if (prefs.period && content.includes("TODO Your Period")) {
                content = content.replace(/TODO Your Period/g, prefs.period);
                modified = true;
            }

            const collaborators = prefs.collaborators || "Me, myself, and I";
            if (content.includes("TODO list collaborators")) {
                content = content.replace(/TODO list collaborators/g, collaborators);
                modified = true;
            }

            // Regex replacements
            if (prefs.authorName && /TODO\s+Your\s+Name/i.test(content)) {
                content = content.replace(/TODO\s+Your\s+Name/gi, prefs.authorName);
                modified = true;
            }
            if (/TODO\s+Date/i.test(content)) {
                const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
                content = content.replace(/TODO\s+Date/gi, dateStr);
                modified = true;
            }
            if (prefs.period && /TODO\s+Your\s+Period/i.test(content)) {
                content = content.replace(/TODO\s+Your\s+Period/gi, prefs.period);
                modified = true;
            }
            if (/TODO\s+list\s+collaborators/i.test(content)) {
                content = content.replace(/TODO\s+list\s+collaborators/gi, collaborators);
                modified = true;
            }

            if (modified) {
                console.log(`Writing modified content to ${file}`);
                fs.writeFileSync(fullPath, content, "utf-8");
            }
        }
    }
}

async function fetchAssignments() {
    const prefs = getPreferences();
    if (!prefs.sessionCookie) {
        throw new Error("Session cookie not set. Please configure it in settings.");
    }

    const response = await fetch(COURSE_URL, {
        headers: {
            Cookie: prefs.sessionCookie,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch assignments (status: ${response.status})`);
    }

    const body = await response.text();
    const $ = cheerio.load(body);
    const scrapedAssignments = [];

    const labsCollection = $(".collection.red.darken-4.date");
    labsCollection.find("a.collection-item").each((index, item) => {
        const $item = $(item);
        const href = $item.attr("href");
        const span = $item.find("span.new.badge");
        const p = $item.find("p.date");

        const name = $item.contents().filter((i, el) => el.type === "text").first().text().trim();
        const dueDate = p.text().trim();

        let writeupUrl = href;
        if (span.length > 0 && span.attr("data-url")) {
            writeupUrl = span.attr("data-url") || href;
        }

        if (name && href) {
            const dueMatch = dueDate.match(/Due:\s*(.+)/);
            const cleanDueDate = dueMatch ? dueMatch[1] : dueDate;
            scrapedAssignments.push({
                name,
                dueDate: cleanDueDate,
                writeupUrl: `${AUTOLAB_URL}${writeupUrl}`,
                downloadUrl: `${AUTOLAB_URL}/apcssnarf/${name}.zip`,
                score: "",
                isDownloaded: false,
            });
        }
    });

    // Fetch grades
    // Using a dummy ID (100) as the server seems to ignore it for the student gradebook view
    const gradebookUrl = `${AUTOLAB_URL}/courses/APCS-A-25/course_user_data/100/gradebook/student`;
    const gradeResponse = await fetch(gradebookUrl, {
        headers: {
            Cookie: prefs.sessionCookie,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
        },
    });

    if (gradeResponse.ok) {
        const gradeBody = await gradeResponse.text();
        const $grade = cheerio.load(gradeBody);
        const gradeMap = {};
        $grade(".category table.grades tr").each((i, row) => {
            const tds = $grade(row).find("td");
            if (tds.length >= 4) {
                const name = $grade(tds[0]).find("a").text().trim();
                const scoreCell = $grade(tds[3]);
                let score = "";
                if (scoreCell.find("i").length > 0) {
                    score = "Grading in progress";
                } else if (scoreCell.find(".not-yet-submitted").length > 0) {
                    score = "";
                } else {
                    score = scoreCell.text().trim().replace(/\.0/g, "");
                }
                if (name && score) gradeMap[name] = score;
            }
        });
        scrapedAssignments.forEach((assignment) => {
            assignment.score = gradeMap[assignment.name] || "No grade";
            assignment.isDownloaded = fs.existsSync(path.join(prefs.workspacePath, assignment.name));
        });
    }

    scrapedAssignments.reverse();
    return scrapedAssignments;
}

async function downloadAssignment(assignment) {
    const prefs = getPreferences();
    if (!fs.existsSync(prefs.workspacePath)) {
        fs.mkdirSync(prefs.workspacePath, { recursive: true });
    }

    // Note: This basic auth credential appears to be public/shared for the school's Autolab instance.
    // If this is private, it should be moved to configuration.
    const auth = "Basic " + Buffer.from("lhsuser:lhsuser").toString("base64");
    const response = await fetch(assignment.downloadUrl, {
        headers: {
            Authorization: auth,
            Cookie: prefs.sessionCookie,
        },
    });

    if (!response.ok) {
        throw new Error(`Download failed with status: ${response.status}`);
    }

    const zipFilePath = path.join(prefs.workspacePath, `${assignment.name}.zip`);
    const destDir = path.join(prefs.workspacePath, assignment.name);

    await streamPipeline(response.body, fs.createWriteStream(zipFilePath));

    await new Promise((resolve, reject) => {
        fs.createReadStream(zipFilePath)
            .pipe(unzipper.Extract({ path: destDir }))
            .on('close', resolve)
            .on('error', reject);
    });

    fs.unlinkSync(zipFilePath);
    updateJavaFileHeaders(destDir, prefs);
    
    // Open the folder in VS Code
    // We can't easily "open" a folder in the current workspace without reloading, 
    // but we can add it to workspace folders or just reveal it.
    // For now, let's just reveal it in finder/explorer via command or just notify.
    // Ideally, the user might want to add this folder to the workspace.
    
    return destDir;
}

async function submitAssignment(assignment) {
    const prefs = getPreferences();
    const folderPath = path.join(prefs.workspacePath, assignment.name);
    const zipPath = path.join(prefs.workspacePath, `${assignment.name}.zip`);

    if (!fs.existsSync(folderPath)) {
        throw new Error(`Assignment folder not found at ${folderPath}`);
    }

    updateJavaFileHeaders(folderPath, prefs);

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(folderPath, assignment.name);
    await archive.finalize();

    await new Promise((resolve, reject) => {
        output.on("close", resolve);
        output.on("error", reject);
    });

    // Get authenticity token
    const assessmentUrl = `${AUTOLAB_URL}/courses/APCS-A-25/assessments/${assignment.name}`;
    const pageResponse = await fetch(assessmentUrl, {
        headers: { Cookie: prefs.sessionCookie }
    });
    
    if (!pageResponse.ok) throw new Error("Failed to fetch assessment page");
    
    const pageBody = await pageResponse.text();
    const $ = cheerio.load(pageBody);
    const token = $('input[name="authenticity_token"]').attr("value");
    
    if (!token) throw new Error("Could not find authenticity token");

    const form = new FormData();
    form.append("utf8", "✓");
    form.append("authenticity_token", token);
    form.append("integrity_checkbox", "1");
    form.append("submission[file]", fs.readFileSync(zipPath), `${assignment.name}.zip`);

    const submitUrl = `${AUTOLAB_URL}/courses/APCS-A-25/assessments/${assignment.name}/handin`;
    const submitResponse = await fetch(submitUrl, {
        method: "POST",
        headers: {
            Cookie: prefs.sessionCookie,
            ...form.getHeaders(),
        },
        body: form,
    });

    if (!submitResponse.ok) throw new Error(`Submission failed: ${submitResponse.status}`);
    
    fs.unlinkSync(zipPath);
    return true;
}

async function pollFeedback(assignmentName, callback) {
    const prefs = getPreferences();
    let attempts = 0;
    
    while (attempts < 20) {
        try {
            const assessmentUrl = `${AUTOLAB_URL}/courses/APCS-A-25/assessments/${assignmentName}`;
            const resp = await fetch(assessmentUrl, {
                headers: { Cookie: prefs.sessionCookie, Accept: "text/html" },
            });
            const body = await resp.text();
            const $ = cheerio.load(body);
            const foundSubmissionLink = $("tbody tr").first().find('td a[href*="viewFeedback"]').attr("href");

            if (foundSubmissionLink) {
                const feedbackUrl = `${AUTOLAB_URL}${foundSubmissionLink}`;
                const viewResp = await fetch(feedbackUrl, {
                    headers: { Cookie: prefs.sessionCookie, Accept: "text/html" },
                });
                const viewBody = await viewResp.text();
                const $v = cheerio.load(viewBody);

                const isInProgress = $v(".feedback-status__inprogress").length > 0 || $v(".feedback-status__queued").length > 0;
                const hasResultTable = $v(".result-summary table").length > 0;
                const isCompleted = $v(".feedback-status__completed").length > 0;

                if (!isInProgress && (isCompleted || hasResultTable)) {
                    let md = `# ${assignmentName} - Feedback\n\n`;
                    const pre = $v("pre").first().text();
                    if (pre && pre.trim().length > 0) {
                        md += "```\n" + pre + "\n```\n\n";
                    }

                    const rows = $v(".result-summary table tbody tr");
                    if (rows.length > 0) {
                        md += "## Results\n";
                        rows.each((i, r) => {
                            const tds = $v(r).find("td");
                            const k = $v(tds[0]).text().trim().replace(/:$/, "");
                            const v = $v(tds[1]).text().trim();
                            md += "- **" + k + "**: " + v + "\n";
                        });
                        md += "\n";
                    }

                    if (md.trim() === `# ${assignmentName} - Feedback`) {
                        md += "\n_No detailed feedback found._\n";
                    }
                    
                    return md;
                }
            }
        } catch (e) {
            console.error("Polling error", e);
        }
        
        attempts++;
        if (callback) callback(`Waiting for feedback... Attempt ${attempts}/20`);
        await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("Grading timed out");
}

module.exports = {
    fetchAssignments,
    downloadAssignment,
    submitAssignment,
    updateJavaFileHeaders,
    pollFeedback,
    getPreferences
};

const vscode = require('vscode');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline, Transform } = require('stream');
const { promisify } = require('util');
const unzipper = require('unzipper');
const FormData = require('form-data');
const archiver = require('archiver');
const {
    cleanScore,
    getAssignmentFolderName,
    getErrorMessage,
    getPortableArchiveSegments,
    normalizeSessionCookie,
    resolveAutolabUrl,
    toPortableName,
} = require('./autolabUtils');

const streamPipeline = promisify(pipeline);
const AUTOLAB_URL = 'https://cs.lhs.fuhsd.org';
const SESSION_SECRET_KEY = 'autolab.sessionCookie';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 5_000;
const MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;
const HANDOUT_AUTHORIZATION = `Basic ${Buffer.from('lhsuser:lhsuser').toString('base64')}`;

/** @type {vscode.SecretStorage | undefined} */
let secretStorage;

/** @param {vscode.SecretStorage} storage */
function initialize(storage) {
    secretStorage = storage;
}

function getDefaultUserAgent() {
    const chromeVersion = process.versions.chrome || '142.0.0.0';
    let platform = 'X11; Linux x86_64';
    if (process.platform === 'win32') {
        platform = 'Windows NT 10.0; Win64; x64';
    } else if (process.platform === 'darwin') {
        platform = 'Macintosh; Intel Mac OS X 10_15_7';
    }
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function getPreferences() {
    const config = vscode.workspace.getConfiguration('autolab');
    let workspacePath = String(config.get('workspacePath') || '~/Documents/Autolab').trim();
    if (/^~(?:[\\/]|$)/.test(workspacePath)) {
        workspacePath = path.join(os.homedir(), workspacePath.slice(1).replace(/^[\\/]/, ''));
    }

    const courseName = String(config.get('courseName') || 'APCS-A-25').trim();
    if (!courseName || /[\\/]/.test(courseName)) {
        throw new Error('Autolab course name is invalid.');
    }

    return {
        workspacePath: path.resolve(workspacePath),
        courseName,
        authorName: String(config.get('authorName') || '').trim(),
        period: String(config.get('period') || '').trim(),
        collaborators: String(config.get('collaborators') || '').trim(),
        userAgent: String(config.get('userAgent') || '').trim() || getDefaultUserAgent(),
    };
}

async function getSessionCookie() {
    const secureValue = await secretStorage?.get(SESSION_SECRET_KEY);
    const legacyValue = vscode.workspace.getConfiguration('autolab').get('sessionCookie');
    const value = secureValue || legacyValue;
    if (!value) {
        throw new Error('Session cookie is not set. Run "Autolab: Set Session Cookie".');
    }
    return normalizeSessionCookie(value);
}

/** @param {string} value */
async function setSessionCookie(value) {
    if (!secretStorage) {
        throw new Error('Secure storage is not available.');
    }
    const normalized = normalizeSessionCookie(value);
    await secretStorage.store(SESSION_SECRET_KEY, normalized);
    await vscode.workspace.getConfiguration('autolab').update(
        'sessionCookie',
        undefined,
        vscode.ConfigurationTarget.Global
    );
}

async function clearSessionCookie() {
    await secretStorage?.delete(SESSION_SECRET_KEY);
    await vscode.workspace.getConfiguration('autolab').update(
        'sessionCookie',
        undefined,
        vscode.ConfigurationTarget.Global
    );
}

/** @param {ReturnType<typeof getPreferences>} prefs */
function getCourseUrl(prefs) {
    return `${AUTOLAB_URL}/courses/${encodeURIComponent(prefs.courseName)}`;
}

/**
 * @param {ReturnType<typeof getPreferences>} prefs
 * @param {{ name: string, assessmentUrl?: string }} assignment
 */
function getAssessmentUrl(prefs, assignment) {
    if (assignment.assessmentUrl) {
        return resolveAutolabUrl(assignment.assessmentUrl, AUTOLAB_URL);
    }
    return `${getCourseUrl(prefs)}/assessments/${encodeURIComponent(assignment.name)}`;
}

/**
 * Return the portable path, or an existing legacy path on macOS or Linux.
 *
 * @param {ReturnType<typeof getPreferences>} prefs
 * @param {{ name: string, folderName?: string }} assignment
 */
function getAssignmentDirectory(prefs, assignment) {
    const safePath = path.join(prefs.workspacePath, getAssignmentFolderName(assignment));
    if (fs.existsSync(safePath)) {
        return safePath;
    }

    const legacyPath = path.resolve(prefs.workspacePath, assignment.name);
    if (path.dirname(legacyPath) === prefs.workspacePath && fs.existsSync(legacyPath)) {
        return legacyPath;
    }
    return safePath;
}

/** @param {vscode.CancellationToken | undefined} token */
function throwIfCancelled(token) {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
}

/**
 * Keep the request timeout active until its response body is consumed.
 *
 * @template T
 * @param {string} url
 * @param {import('node-fetch').RequestInit} options
 * @param {vscode.CancellationToken | undefined} token
 * @param {(response: import('node-fetch').Response) => Promise<T>} consume
 * @returns {Promise<T>}
 */
async function withFetch(url, options, token, consume) {
    throwIfCancelled(token);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const cancellation = token?.onCancellationRequested(() => controller.abort());

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return await consume(response);
    } catch (error) {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        if (timedOut) {
            throw new Error('The Autolab request timed out.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
        cancellation?.dispose();
    }
}

/**
 * @param {import('node-fetch').Response} response
 * @param {string} action
 */
function assertResponseStatus(response, action) {
    const responsePath = new URL(response.url).pathname;
    if (response.redirected && /(?:sign[_-]?in|login)/i.test(responsePath)) {
        throw new Error('Autolab rejected the session cookie. Set a new cookie and try again.');
    }
    if (!response.ok) {
        throw new Error(`${action} failed with HTTP ${response.status}.`);
    }
}

/** @param {ReturnType<typeof cheerio.load>} $ */
function isLoginPage($) {
    return $('input[type="password"]').length > 0 && $('form').filter((index, form) => {
        return /(?:sign[_-]?in|login|session)/i.test($(form).attr('action') || '');
    }).length > 0;
}

/**
 * @param {string} url
 * @param {import('node-fetch').RequestInit} options
 * @param {vscode.CancellationToken | undefined} token
 * @param {string} action
 */
async function fetchText(url, options, token, action) {
    return withFetch(url, options, token, async (response) => {
        assertResponseStatus(response, action);
        const body = await response.text();
        const $ = cheerio.load(body);
        if (isLoginPage($)) {
            throw new Error('Autolab rejected the session cookie. Set a new cookie and try again.');
        }
        return { body, $, responseUrl: response.url };
    });
}

/**
 * @param {ReturnType<typeof getPreferences>} prefs
 * @param {string} cookie
 * @param {Record<string, string>} [extra]
 */
function getHeaders(prefs, cookie, extra = {}) {
    return {
        Accept: 'text/html',
        Cookie: cookie,
        'User-Agent': prefs.userAgent,
        ...extra,
    };
}

/**
 * @param {string} folderPath
 * @param {{ authorName?: string, period?: string, collaborators?: string }} prefs
 * @returns {number}
 */
function updateJavaFileHeaders(folderPath, prefs) {
    if (!fs.existsSync(folderPath)) {
        throw new Error(`Assignment folder does not exist: ${folderPath}`);
    }

    let changedFiles = 0;
    for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
        const fullPath = path.join(folderPath, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            changedFiles += updateJavaFileHeaders(fullPath, prefs);
            continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.java')) {
            continue;
        }

        let content = fs.readFileSync(fullPath, 'utf8');
        const original = content;
        if (prefs.authorName) {
            content = content.replace(/TODO\s+Your\s+Name/gi, prefs.authorName);
        }
        content = content.replace(
            /TODO\s+Date/gi,
            new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        );
        if (prefs.period) {
            content = content.replace(/TODO\s+Your\s+Period/gi, prefs.period);
        }
        if (prefs.collaborators) {
            content = content.replace(/TODO\s+list\s+collaborators/gi, prefs.collaborators);
        }

        if (content !== original) {
            fs.writeFileSync(fullPath, content, 'utf8');
            changedFiles++;
        }
    }
    return changedFiles;
}

/** @param {vscode.CancellationToken} [token] */
async function fetchAssignments(token) {
    const prefs = getPreferences();
    const cookie = await getSessionCookie();
    const courseUrl = getCourseUrl(prefs);
    const assessmentsUrl = `${courseUrl}/assessments`;
    const { $ } = await fetchText(
        assessmentsUrl,
        { headers: getHeaders(prefs, cookie) },
        token,
        'Fetching assignments'
    );

    let items = $('.collection.red.darken-4.date a.collection-item');
    if (items.length === 0) {
        items = $('a.collection-item[href*="/assessments/"]');
    }

    const assignments = [];
    items.each((index, item) => {
        const $item = $(item);
        const href = $item.attr('href');
        if (!href) {
            return;
        }

        const directText = $item.contents()
            .filter((textIndex, element) => element.type === 'text')
            .map((textIndex, element) => $(element).text())
            .get()
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        const fallbackName = decodeURIComponent(new URL(href, AUTOLAB_URL).pathname.split('/').filter(Boolean).pop() || '');
        const name = directText || fallbackName;
        if (!name) {
            return;
        }

        const dueText = $item.find('p.date').text().trim();
        const dueMatch = dueText.match(/Due:\s*(.+)/i);
        const badgeUrl = $item.find('span.new.badge[data-url]').attr('data-url');

        try {
            assignments.push({
                name,
                folderName: getAssignmentFolderName({ name }),
                dueDate: dueMatch ? dueMatch[1] : dueText,
                assessmentUrl: resolveAutolabUrl(href, AUTOLAB_URL),
                writeupUrl: resolveAutolabUrl(badgeUrl || href, AUTOLAB_URL, false),
                score: 'No grade',
                isDownloaded: false,
            });
        } catch (error) {
            console.warn(`Skipped an invalid assignment link: ${getErrorMessage(error)}`);
        }
    });

    for (const assignment of assignments) {
        assignment.isDownloaded = fs.existsSync(getAssignmentDirectory(prefs, assignment));
    }

    const gradebookHref = $('a[href*="/gradebook/student"]').first().attr('href');
    if (gradebookHref) {
        try {
            const gradebookUrl = resolveAutolabUrl(gradebookHref, AUTOLAB_URL);
            const { $: $grade } = await fetchText(
                gradebookUrl,
                { headers: getHeaders(prefs, cookie) },
                token,
                'Fetching grades'
            );
            const gradeMap = new Map();
            $grade('.category table.grades tr').each((index, row) => {
                const cells = $grade(row).find('td');
                if (cells.length < 4) {
                    return;
                }
                const name = $grade(cells[0]).find('a').text().trim();
                const scoreCell = $grade(cells[3]);
                let score = '';
                if (scoreCell.find('i').length > 0) {
                    score = 'Grading in progress';
                } else if (scoreCell.find('.not-yet-submitted').length === 0) {
                    score = cleanScore(scoreCell.text().trim());
                }
                if (name && score) {
                    gradeMap.set(name, score);
                }
            });
            for (const assignment of assignments) {
                assignment.score = gradeMap.get(assignment.name) || 'No grade';
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            console.warn(`Could not fetch Autolab grades: ${getErrorMessage(error)}`);
        }
    }

    assignments.reverse();
    return assignments;
}

/**
 * @param {number} maximum
 * @param {{ bytes: number }} counter
 */
function createSizeLimiter(maximum, counter, token) {
    return new Transform({
        transform(chunk, encoding, callback) {
            if (token?.isCancellationRequested) {
                callback(new vscode.CancellationError());
                return;
            }
            counter.bytes += chunk.length;
            if (counter.bytes > maximum) {
                callback(new Error('The Autolab archive is larger than the allowed limit.'));
                return;
            }
            callback(null, chunk);
        },
    });
}

/**
 * @param {string} zipPath
 * @param {string} destination
 * @param {vscode.CancellationToken | undefined} token
 */
async function extractZipSafely(zipPath, destination, token) {
    const archive = await unzipper.Open.file(zipPath);
    if (archive.files.length > MAX_ARCHIVE_FILES) {
        throw new Error('The Autolab archive has too many files.');
    }

    const declaredSize = archive.files.reduce((total, file) => {
        const size = Number(file.uncompressedSize || 0);
        return total + (Number.isSafeInteger(size) && size > 0 ? size : 0);
    }, 0);
    if (declaredSize > MAX_EXTRACTED_BYTES) {
        throw new Error('The extracted Autolab archive is larger than the allowed limit.');
    }

    const seenPaths = new Map();
    const extracted = { bytes: 0 };
    await fs.promises.mkdir(destination, { recursive: true });

    for (const entry of archive.files) {
        throwIfCancelled(token);
        const segments = getPortableArchiveSegments(entry.path);
        if (segments.length === 0) {
            continue;
        }
        const target = path.join(destination, ...segments);
        const relative = path.relative(destination, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`Unsafe archive path: ${entry.path}`);
        }

        const collisionKey = segments.join('/').toLowerCase();
        const existingPath = seenPaths.get(collisionKey);
        if (existingPath && existingPath !== segments.join('/')) {
            throw new Error(`The archive has file names that differ only by letter case: ${entry.path}`);
        }
        seenPaths.set(collisionKey, segments.join('/'));

        const unixMode = entry.versionMadeBy >> 8 === 3 ? entry.externalFileAttributes >>> 16 : 0;
        if ((unixMode & 0o170000) === 0o120000) {
            throw new Error(`The archive contains a symbolic link: ${entry.path}`);
        }

        if (entry.type === 'Directory') {
            await fs.promises.mkdir(target, { recursive: true });
            continue;
        }
        if (entry.type !== 'File') {
            throw new Error(`Unsupported archive entry: ${entry.path}`);
        }

        if (existingPath) {
            throw new Error(`The archive contains duplicate file names: ${entry.path}`);
        }
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await streamPipeline(
            entry.stream(),
            createSizeLimiter(MAX_EXTRACTED_BYTES, extracted, token),
            fs.createWriteStream(target, { flags: 'wx' })
        );
    }
}

/**
 * @param {string} extractedPath
 * @param {{ name: string, folderName?: string }} assignment
 */
async function findExtractedRoot(extractedPath, assignment) {
    const entries = await fs.promises.readdir(extractedPath, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory()) {
        return extractedPath;
    }

    const possibleRootNames = new Set([
        getAssignmentFolderName(assignment),
        toPortableName(assignment.name, { maxLength: 120, preserveExtension: true }),
    ]);
    return possibleRootNames.has(entries[0].name)
        ? path.join(extractedPath, entries[0].name)
        : extractedPath;
}

/** @param {string} temporaryRoot */
async function removeTemporaryDirectory(temporaryRoot) {
    try {
        await fs.promises.rm(temporaryRoot, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100,
        });
    } catch (error) {
        console.warn(`Could not remove temporary Autolab files: ${getErrorMessage(error)}`);
    }
}

/**
 * @param {{ name: string, folderName?: string, assessmentUrl?: string }} assignment
 * @param {vscode.CancellationToken} [token]
 */
async function downloadAssignment(assignment, token) {
    const prefs = getPreferences();
    const cookie = await getSessionCookie();
    await fs.promises.mkdir(prefs.workspacePath, { recursive: true });

    const destination = getAssignmentDirectory(prefs, assignment);
    if (fs.existsSync(destination)) {
        throw new Error(`Assignment folder already exists: ${destination}`);
    }

    const assessmentUrl = getAssessmentUrl(prefs, assignment);
    const { $ } = await fetchText(
        assessmentUrl,
        { headers: getHeaders(prefs, cookie) },
        token,
        'Fetching the assessment page'
    );

    let downloadLink = '';
    $('a').each((index, element) => {
        const href = $(element).attr('href') || '';
        if (!downloadLink && (/download handout/i.test($(element).text()) || /\/handout(?:[?#]|$)/i.test(href))) {
            downloadLink = href;
        }
    });
    if (!downloadLink) {
        downloadLink = `${assessmentUrl.replace(/\/$/, '')}/handout`;
    }
    const downloadUrl = resolveAutolabUrl(downloadLink, AUTOLAB_URL);

    const temporaryRoot = await fs.promises.mkdtemp(path.join(prefs.workspacePath, '.autolab-download-'));
    const zipPath = path.join(temporaryRoot, 'handout.zip');
    const extractedPath = path.join(temporaryRoot, 'extracted');

    try {
        await withFetch(downloadUrl, {
            headers: getHeaders(prefs, cookie, { Authorization: HANDOUT_AUTHORIZATION }),
        }, token, async (response) => {
            assertResponseStatus(response, 'Downloading the handout');
            const contentLength = Number(response.headers.get('content-length') || 0);
            if (contentLength > MAX_DOWNLOAD_BYTES) {
                throw new Error('The Autolab handout is larger than the allowed limit.');
            }
            if (!response.body) {
                throw new Error('Autolab returned an empty handout.');
            }
            const contentType = response.headers.get('content-type') || '';
            if (/text\/html/i.test(contentType)) {
                throw new Error('Autolab returned an HTML page instead of a ZIP handout. Check the session cookie.');
            }
            await streamPipeline(
                response.body,
                createSizeLimiter(MAX_DOWNLOAD_BYTES, { bytes: 0 }, token),
                fs.createWriteStream(zipPath, { flags: 'wx' })
            );
        });

        await extractZipSafely(zipPath, extractedPath, token);
        const extractedRoot = await findExtractedRoot(extractedPath, assignment);
        updateJavaFileHeaders(extractedRoot, prefs);
        throwIfCancelled(token);

        if (fs.existsSync(destination)) {
            throw new Error(`Assignment folder was created during the download: ${destination}`);
        }
        await fs.promises.rename(extractedRoot, destination);
        return destination;
    } finally {
        await removeTemporaryDirectory(temporaryRoot);
    }
}

/**
 * @param {string} folderPath
 * @param {string} zipPath
 * @param {string} rootName
 * @param {vscode.CancellationToken | undefined} token
 */
async function createSubmissionArchive(folderPath, zipPath, rootName, token) {
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath, { flags: 'wx' });
        const archive = archiver('zip', { zlib: { level: 9 } });
        let settled = false;
        const finish = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            cancellation?.dispose();
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };
        const cancellation = token?.onCancellationRequested(() => {
            archive.abort();
            finish(new vscode.CancellationError());
        });

        output.once('close', () => finish());
        output.once('error', finish);
        archive.once('error', finish);
        archive.on('warning', (error) => {
            if (error.code !== 'ENOENT') {
                finish(error);
            }
        });
        archive.pipe(output);
        archive.directory(folderPath, rootName);
        archive.finalize().catch(finish);
    });
}

/**
 * @param {{ name: string, folderName?: string, assessmentUrl?: string }} assignment
 * @param {vscode.CancellationToken} [token]
 */
async function submitAssignment(assignment, token) {
    const prefs = getPreferences();
    const cookie = await getSessionCookie();
    const folderPath = getAssignmentDirectory(prefs, assignment);
    if (!fs.existsSync(folderPath)) {
        throw new Error(`Assignment folder does not exist: ${folderPath}`);
    }

    updateJavaFileHeaders(folderPath, prefs);
    const temporaryRoot = await fs.promises.mkdtemp(path.join(prefs.workspacePath, '.autolab-submit-'));
    const archiveName = `${getAssignmentFolderName(assignment)}.zip`;
    const zipPath = path.join(temporaryRoot, archiveName);
    /** @type {fs.ReadStream | undefined} */
    let submissionStream;

    try {
        await createSubmissionArchive(
            folderPath,
            zipPath,
            toPortableName(path.basename(folderPath), { maxLength: 100 }),
            token
        );
        throwIfCancelled(token);

        const assessmentUrl = getAssessmentUrl(prefs, assignment);
        const { $ } = await fetchText(
            assessmentUrl,
            { headers: getHeaders(prefs, cookie) },
            token,
            'Fetching the submission form'
        );
        const authenticityToken = $('input[name="authenticity_token"]').attr('value');
        if (!authenticityToken) {
            throw new Error('Autolab did not return a submission authenticity token.');
        }

        const form = new FormData();
        form.append('utf8', '✓');
        form.append('authenticity_token', authenticityToken);
        form.append('integrity_checkbox', '1');
        submissionStream = fs.createReadStream(zipPath);
        form.append('submission[file]', submissionStream, {
            filename: archiveName,
            knownLength: (await fs.promises.stat(zipPath)).size,
        });

        const submitUrl = `${assessmentUrl.replace(/\/$/, '')}/handin`;
        await withFetch(submitUrl, {
            method: 'POST',
            headers: getHeaders(prefs, cookie, form.getHeaders()),
            body: form,
        }, token, async (response) => {
            assertResponseStatus(response, 'Submitting the assignment');
            await response.arrayBuffer();
        });
        return true;
    } finally {
        submissionStream?.destroy();
        await removeTemporaryDirectory(temporaryRoot);
    }
}

/** @param {number} milliseconds @param {vscode.CancellationToken | undefined} token */
async function delay(milliseconds, token) {
    throwIfCancelled(token);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cancellation?.dispose();
            resolve();
        }, milliseconds);
        const cancellation = token?.onCancellationRequested(() => {
            clearTimeout(timeout);
            cancellation.dispose();
            reject(new vscode.CancellationError());
        });
    });
}

/** @param {string} value */
function toMarkdownCodeBlock(value) {
    const fence = value.includes('```') ? '````' : '```';
    return `${fence}\n${value}\n${fence}\n\n`;
}

/**
 * @param {string | { name: string, assessmentUrl?: string }} assignment
 * @param {(message: string) => void} [callback]
 * @param {vscode.CancellationToken} [token]
 */
async function pollFeedback(assignment, callback, token) {
    const prefs = getPreferences();
    const cookie = await getSessionCookie();
    const assignmentObject = typeof assignment === 'string' ? { name: assignment } : assignment;
    const assessmentUrl = getAssessmentUrl(prefs, assignmentObject);

    for (let attempt = 1; attempt <= 20; attempt++) {
        const { $ } = await fetchText(
            assessmentUrl,
            { headers: getHeaders(prefs, cookie) },
            token,
            'Fetching submission status'
        );
        const feedbackHref = $('a[href*="viewFeedback"]').first().attr('href');

        if (feedbackHref) {
            const feedbackUrl = resolveAutolabUrl(feedbackHref, AUTOLAB_URL);
            const { $: $feedback } = await fetchText(
                feedbackUrl,
                { headers: getHeaders(prefs, cookie) },
                token,
                'Fetching feedback'
            );
            const isInProgress = $feedback('.feedback-status__inprogress, .feedback-status__queued').length > 0;
            const hasResults = $feedback('.result-summary table').length > 0;
            const isComplete = $feedback('.feedback-status__completed').length > 0;

            if (!isInProgress && (isComplete || hasResults)) {
                let markdown = `# ${assignmentObject.name} - Feedback\n\n`;
                const output = $feedback('pre').first().text().trim();
                if (output) {
                    markdown += toMarkdownCodeBlock(output);
                }

                const rows = $feedback('.result-summary table tbody tr');
                if (rows.length > 0) {
                    markdown += '## Results\n\n';
                    rows.each((index, row) => {
                        const cells = $feedback(row).find('td');
                        if (cells.length >= 2) {
                            const key = $feedback(cells[0]).text().trim().replace(/:$/, '');
                            const value = $feedback(cells[1]).text().trim();
                            markdown += `- **${key}**: ${value}\n`;
                        }
                    });
                }

                if (!output && rows.length === 0) {
                    markdown += '_No detailed feedback was found._\n';
                }
                return markdown;
            }
        }

        callback?.(`Waiting for feedback, attempt ${attempt}/20`);
        if (attempt < 20) {
            await delay(3_000, token);
        }
    }
    throw new Error('Autolab grading did not finish within one minute.');
}

module.exports = {
    clearSessionCookie,
    downloadAssignment,
    fetchAssignments,
    getAssignmentDirectory,
    getPreferences,
    initialize,
    pollFeedback,
    setSessionCookie,
    submitAssignment,
    updateJavaFileHeaders,
};

const vscode = require('vscode');
const autolab = require('./autolab');
const { AssignmentsProvider } = require('./assignmentsProvider');
const { getErrorMessage, normalizeSessionCookie } = require('./autolabUtils');
const fs = require('fs');

/**
 * @typedef {object} Assignment
 * @property {string} name
 * @property {string} [folderName]
 * @property {string} [assessmentUrl]
 * @property {string} [writeupUrl]
 */

/** @param {unknown} node @returns {Assignment | undefined} */
function getAssignment(node) {
    if (!node || typeof node !== 'object') {
        return undefined;
    }
    const assignment = 'assignment' in node ? node.assignment : node;
    if (!assignment || typeof assignment !== 'object' || !('name' in assignment) || typeof assignment.name !== 'string') {
        return undefined;
    }
    return /** @type {Assignment} */ (assignment);
}

/** @param {unknown} error */
function showCommandError(error, prefix) {
    if (!(error instanceof vscode.CancellationError)) {
        vscode.window.showErrorMessage(`${prefix}: ${getErrorMessage(error)}`);
    }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    autolab.initialize(context.secrets);

    const assignmentsProvider = new AssignmentsProvider();
    const treeView = vscode.window.createTreeView('autolabAssignments', {
        treeDataProvider: assignmentsProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(assignmentsProvider, treeView);

    context.subscriptions.push(
        vscode.commands.registerCommand('autolab.refreshAssignments', () => assignmentsProvider.refresh()),

        vscode.commands.registerCommand('autolab.searchAssignments', async () => {
            const assignments = assignmentsProvider.assignments;
            if (!assignments.length) {
                vscode.window.showInformationMessage('No assignments are available to search.');
                return;
            }

            const items = assignments.map((assignment) => {
                const isGraded = assignment.score && assignment.score !== 'No grade';
                return {
                    label: assignment.name,
                    description: isGraded ? `${assignment.score} • ${assignment.dueDate}` : assignment.dueDate,
                    detail: assignment.isDownloaded ? '$(check) Downloaded' : '$(cloud-download) Not downloaded',
                    assignment,
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Search assignments by name',
                matchOnDescription: true,
                matchOnDetail: true,
            });
            if (selected) {
                await treeView.reveal(selected.assignment, { select: true, focus: true });
            }
        }),

        vscode.commands.registerCommand('autolab.downloadAssignment', async (node) => {
            const assignment = getAssignment(node);
            if (!assignment) {
                return;
            }

            try {
                const destination = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Downloading ${assignment.name}`,
                    cancellable: true,
                }, (progress, token) => autolab.downloadAssignment(assignment, token));

                assignmentsProvider.refresh();
                const selection = await vscode.window.showInformationMessage(
                    `Downloaded ${assignment.name}. Open it now?`,
                    'Open',
                    'Not now'
                );
                if (selection === 'Open') {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(destination), {
                        forceNewWindow: false,
                    });
                }
            } catch (error) {
                showCommandError(error, 'Download failed');
            }
        }),

        vscode.commands.registerCommand('autolab.openAssignmentFolder', async (node) => {
            const assignment = getAssignment(node);
            if (!assignment) {
                return;
            }
            try {
                const folderPath = autolab.getAssignmentDirectory(autolab.getPreferences(), assignment);
                if (!fs.existsSync(folderPath)) {
                    throw new Error(`Assignment folder does not exist: ${folderPath}`);
                }
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath), {
                    forceNewWindow: false,
                });
            } catch (error) {
                showCommandError(error, 'Could not open the assignment');
            }
        }),

        vscode.commands.registerCommand('autolab.openRootFolder', async () => {
            try {
                const { workspacePath } = autolab.getPreferences();
                await fs.promises.mkdir(workspacePath, { recursive: true });
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), {
                    forceNewWindow: false,
                });
            } catch (error) {
                showCommandError(error, 'Could not open the Autolab folder');
            }
        }),

        vscode.commands.registerCommand('autolab.submitAssignment', async (node) => {
            const assignment = getAssignment(node);
            if (!assignment) {
                return;
            }

            let submitted = false;
            try {
                const feedback = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Submitting ${assignment.name}`,
                    cancellable: true,
                }, async (progress, token) => {
                    progress.report({ message: 'Creating and uploading the ZIP file' });
                    await autolab.submitAssignment(assignment, token);
                    submitted = true;
                    progress.report({ message: 'Waiting for grading' });
                    return autolab.pollFeedback(
                        assignment,
                        (message) => progress.report({ message }),
                        token
                    );
                });

                await showFeedbackDocument(feedback);
                assignmentsProvider.refresh();
            } catch (error) {
                if (submitted && !(error instanceof vscode.CancellationError)) {
                    vscode.window.showWarningMessage(
                        `The submission succeeded, but feedback could not be loaded: ${getErrorMessage(error)}`
                    );
                    assignmentsProvider.refresh();
                } else {
                    showCommandError(error, 'Submission failed');
                }
            }
        }),

        vscode.commands.registerCommand('autolab.viewFeedback', async (node) => {
            const assignment = getAssignment(node);
            if (!assignment) {
                return;
            }

            try {
                const feedback = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Fetching feedback for ${assignment.name}`,
                    cancellable: true,
                }, (progress, token) => autolab.pollFeedback(
                    assignment,
                    (message) => progress.report({ message }),
                    token
                ));
                await showFeedbackDocument(feedback);
            } catch (error) {
                showCommandError(error, 'Could not load feedback');
            }
        }),

        vscode.commands.registerCommand('autolab.openWriteup', async (node) => {
            const assignment = getAssignment(node);
            if (!assignment?.writeupUrl) {
                return;
            }
            try {
                const opened = await vscode.env.openExternal(vscode.Uri.parse(assignment.writeupUrl, true));
                if (!opened) {
                    throw new Error('The operating system did not open the link.');
                }
            } catch (error) {
                showCommandError(error, 'Could not open the write-up');
            }
        }),

        vscode.commands.registerCommand('autolab.updateHeaders', (node) => {
            const assignment = getAssignment(node);
            if (!assignment) {
                return;
            }
            try {
                const prefs = autolab.getPreferences();
                const folderPath = autolab.getAssignmentDirectory(prefs, assignment);
                const changedFiles = autolab.updateJavaFileHeaders(folderPath, prefs);
                vscode.window.showInformationMessage(
                    changedFiles === 1 ? 'Updated one Java file.' : `Updated ${changedFiles} Java files.`
                );
            } catch (error) {
                showCommandError(error, 'Could not update Java headers');
            }
        }),

        vscode.commands.registerCommand('autolab.setDownloadFolder', async () => {
            const folderUris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Download Folder',
            });
            if (!folderUris?.[0]) {
                return;
            }

            try {
                await vscode.workspace.getConfiguration('autolab').update(
                    'workspacePath',
                    folderUris[0].fsPath,
                    vscode.ConfigurationTarget.Global
                );
                vscode.window.showInformationMessage(`Autolab download folder: ${folderUris[0].fsPath}`);
                assignmentsProvider.refresh();
            } catch (error) {
                showCommandError(error, 'Could not save the download folder');
            }
        }),

        vscode.commands.registerCommand('autolab.setSessionCookie', async () => {
            const value = await vscode.window.showInputBox({
                title: 'Set Autolab Session Cookie',
                prompt: 'Paste the session value or the full Cookie header.',
                password: true,
                ignoreFocusOut: true,
                validateInput: (input) => {
                    try {
                        normalizeSessionCookie(input);
                        return undefined;
                    } catch (error) {
                        return getErrorMessage(error);
                    }
                },
            });
            if (value === undefined) {
                return;
            }
            try {
                await autolab.setSessionCookie(value);
                vscode.window.showInformationMessage('The Autolab session cookie was saved in secure storage.');
                assignmentsProvider.refresh();
            } catch (error) {
                showCommandError(error, 'Could not save the session cookie');
            }
        }),

        vscode.commands.registerCommand('autolab.clearSessionCookie', async () => {
            try {
                await autolab.clearSessionCookie();
                vscode.window.showInformationMessage('The Autolab session cookie was removed.');
                assignmentsProvider.refresh();
            } catch (error) {
                showCommandError(error, 'Could not remove the session cookie');
            }
        })
    );
}

/** @param {string} markdown */
async function showFeedbackDocument(markdown) {
    const document = await vscode.workspace.openTextDocument({
        content: markdown,
        language: 'markdown',
    });
    await vscode.window.showTextDocument(document, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
    });
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
};

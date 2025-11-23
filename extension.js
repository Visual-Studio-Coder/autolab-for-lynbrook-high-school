// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const autolab = require('./autolab');
const { AssignmentsProvider } = require('./assignmentsProvider');
const path = require('path');
const fs = require('fs');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Autolab extension is active!');

	const assignmentsProvider = new AssignmentsProvider();
	const treeView = vscode.window.createTreeView('autolabAssignments', { 
		treeDataProvider: assignmentsProvider,
		showCollapseAll: true 
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.refreshAssignments', () => {
			assignmentsProvider.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.searchAssignments', async () => {
			const assignments = assignmentsProvider.assignments;
			if (!assignments || assignments.length === 0) {
				vscode.window.showInformationMessage("No assignments to search.");
				return;
			}

			const items = assignments.map(a => {
				const isGraded = a.score && a.score !== "No grade";
				return {
					label: a.name,
					description: isGraded ? `${a.score} • ${a.dueDate}` : a.dueDate,
					detail: a.isDownloaded ? "$(check) Downloaded" : "$(cloud-download) Not Downloaded",
					assignment: a
				};
			});

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: "Search assignments by name...",
				matchOnDescription: true,
				matchOnDetail: true
			});

			if (selected) {
				treeView.reveal(selected.assignment, { select: true, focus: true, expand: true });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.downloadAssignment', async (node) => {
			// Handle both TreeItem (node.assignment) and direct assignment object (node)
			let assignment = node ? (node.assignment || node) : null;
			
			if (!assignment) return;
			
			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: `Downloading ${assignment.name}...`,
					cancellable: false
				}, async () => {
					await autolab.downloadAssignment(assignment);
				});
				
				vscode.window.showInformationMessage(`Downloaded ${assignment.name}`);
				assignmentsProvider.refresh();

				const selection = await vscode.window.showInformationMessage(
					`Downloaded ${assignment.name}. Would you like to open it?`,
					'Yes', 'No'
				);
				if (selection === 'Yes') {
					const prefs = autolab.getPreferences();
					const destDir = path.join(prefs.workspacePath, assignment.name);
					const uri = vscode.Uri.file(destDir);
					vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Download failed: ${error.message}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.openAssignmentFolder', (node) => {
			let assignment = node ? (node.assignment || node) : null;
			if (!assignment) return;
			
			const prefs = autolab.getPreferences();
			const destDir = path.join(prefs.workspacePath, assignment.name);
			
			if (!fs.existsSync(destDir)) {
				vscode.window.showErrorMessage(`Assignment folder not found at: ${destDir}. Please download the assignment first.`);
				return;
			}

			const uri = vscode.Uri.file(destDir);
			vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.openRootFolder', () => {
			const prefs = autolab.getPreferences();
			const uri = vscode.Uri.file(prefs.workspacePath);
			vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.submitAssignment', async (node) => {
			let assignment = node ? (node.assignment || node) : null;
			if (!assignment) return;

			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: `Submitting ${assignment.name}...`,
					cancellable: false
				}, async (progress) => {
					progress.report({ message: "Zipping and uploading..." });
					await autolab.submitAssignment(assignment);
					
					progress.report({ message: "Waiting for grading..." });
					const feedback = await autolab.pollFeedback(assignment.name, (msg) => {
						progress.report({ message: msg });
					});
					
					showFeedbackDocument(assignment.name, feedback);
				});
			} catch (error) {
				vscode.window.showErrorMessage(`Submission failed: ${error.message}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.viewFeedback', async (node) => {
			let assignment = node ? (node.assignment || node) : null;
			if (!assignment) return;
			
			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: `Fetching feedback for ${assignment.name}...`,
					cancellable: false
				}, async () => {
					const feedback = await autolab.pollFeedback(assignment.name);
					showFeedbackDocument(assignment.name, feedback);
				});
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to get feedback: ${error.message}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.openWriteup', (node) => {
			let assignment = node ? (node.assignment || node) : null;
			if (assignment && assignment.writeupUrl) {
				vscode.env.openExternal(vscode.Uri.parse(assignment.writeupUrl));
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.updateHeaders', (node) => {
			let assignment = node ? (node.assignment || node) : null;
			if (!assignment) return;
			
			const prefs = autolab.getPreferences();
			const folderPath = path.join(prefs.workspacePath, assignment.name);
			
			try {
				autolab.updateJavaFileHeaders(folderPath, prefs);
				vscode.window.showInformationMessage("Java headers updated!");
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to update headers: ${error.message}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.setDownloadFolder', async () => {
			const folderUri = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: 'Select Download Folder'
			});

			if (folderUri && folderUri[0]) {
				const config = vscode.workspace.getConfiguration('autolab');
				await config.update('workspacePath', folderUri[0].fsPath, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage(`Autolab download folder set to: ${folderUri[0].fsPath}`);
				assignmentsProvider.refresh();
			}
		})
	);
}

async function showFeedbackDocument(title, markdown) {
	const doc = await vscode.workspace.openTextDocument({ 
		content: markdown, 
		language: 'markdown' 
	});
	await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}

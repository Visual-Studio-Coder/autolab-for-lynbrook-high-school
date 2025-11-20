// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const autolab = require('./autolab');
const { AssignmentsProvider } = require('./assignmentsProvider');
const path = require('path');

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
			// Handle both TreeItem (node) and direct assignment object (from search if we wanted to pass it directly, but here we reveal)
			// Actually, the command is invoked on the TreeItem usually.
			// If invoked from command palette without context, node is undefined.
			let assignment = node ? node.assignment : null;
			
			if (!assignment) return;
			
			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: `Downloading ${node.assignment.name}...`,
					cancellable: false
				}, async () => {
					await autolab.downloadAssignment(node.assignment);
				});
				
				vscode.window.showInformationMessage(`Downloaded ${node.assignment.name}`);
				assignmentsProvider.refresh();

				const selection = await vscode.window.showInformationMessage(
					`Downloaded ${node.assignment.name}. Would you like to open it?`,
					'Yes', 'No'
				);
				if (selection === 'Yes') {
					const prefs = autolab.getPreferences();
					const destDir = path.join(prefs.workspacePath, node.assignment.name);
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
			if (!node || !node.assignment) return;
			
			const prefs = autolab.getPreferences();
			const destDir = path.join(prefs.workspacePath, node.assignment.name);
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
			if (!node || !node.assignment) return;

			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: `Submitting ${node.assignment.name}...`,
					cancellable: false
				}, async (progress) => {
					progress.report({ message: "Zipping and uploading..." });
					await autolab.submitAssignment(node.assignment);
					
					progress.report({ message: "Waiting for grading..." });
					const feedback = await autolab.pollFeedback(node.assignment.name, (msg) => {
						progress.report({ message: msg });
					});
					
					showFeedbackDocument(node.assignment.name, feedback);
				});
			} catch (error) {
				vscode.window.showErrorMessage(`Submission failed: ${error.message}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.viewFeedback', async (node) => {
			if (!node || !node.assignment) return;
			
			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: `Fetching feedback for ${node.assignment.name}...`,
					cancellable: false
				}, async () => {
					const feedback = await autolab.pollFeedback(node.assignment.name);
					showFeedbackDocument(node.assignment.name, feedback);
				});
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to get feedback: ${error.message}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.openWriteup', (node) => {
			if (node && node.assignment && node.assignment.writeupUrl) {
				vscode.env.openExternal(vscode.Uri.parse(node.assignment.writeupUrl));
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autolab.updateHeaders', (node) => {
			if (!node || !node.assignment) return;
			
			const prefs = autolab.getPreferences();
			const folderPath = path.join(prefs.workspacePath, node.assignment.name);
			
			try {
				autolab.updateJavaFileHeaders(folderPath, prefs);
				vscode.window.showInformationMessage("Java headers updated!");
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to update headers: ${error.message}`);
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

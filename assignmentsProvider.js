const vscode = require('vscode');
const autolab = require('./autolab');
const { getErrorMessage } = require('./autolabUtils');

class AssignmentsProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.assignments = [];
        this._generation = 0;
        this._loadPromise = undefined;
        this._cancellation = undefined;
    }

    refresh() {
        this._generation++;
        this._cancellation?.cancel();
        this._loadPromise = undefined;
        this._onDidChangeTreeData.fire(undefined);
    }

    dispose() {
        this._cancellation?.cancel();
        this._cancellation?.dispose();
        this._onDidChangeTreeData.dispose();
    }

    getTreeItem(element) {
        if (element instanceof vscode.TreeItem) {
            return element;
        }
        return new AssignmentTreeItem(element);
    }

    async getChildren(element) {
        if (element) {
            return []; // No children for assignments (flat list)
        }

        if (!this._loadPromise) {
            const generation = this._generation;
            const cancellation = new vscode.CancellationTokenSource();
            this._cancellation = cancellation;
            this._loadPromise = autolab.fetchAssignments(cancellation.token)
                .then((assignments) => {
                    if (generation === this._generation) {
                        this.assignments = assignments;
                    }
                    return assignments;
                })
                .finally(() => {
                    cancellation.dispose();
                    if (generation === this._generation) {
                        this._loadPromise = undefined;
                        this._cancellation = undefined;
                    }
                });
        }

        try {
            const assignments = await this._loadPromise;
            if (assignments.length === 0) {
                return [new vscode.TreeItem('No assignments found', vscode.TreeItemCollapsibleState.None)];
            }
            return assignments;
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                return [];
            }
            const item = new vscode.TreeItem('Could not load assignments', vscode.TreeItemCollapsibleState.None);
            item.description = getErrorMessage(error);
            item.tooltip = getErrorMessage(error);
            return [item];
        }
    }
}

class AssignmentTreeItem extends vscode.TreeItem {
    constructor(assignment) {
        super(assignment.name, vscode.TreeItemCollapsibleState.None);
        this.assignment = assignment;
        
        // Shorten date for better visibility
        // e.g. "Wed, Dec 10 at 11:59pm" -> "Dec 10"
        let shortDate = assignment.dueDate || 'No due date';
        const dateMatch = shortDate.match(/([A-Z][a-z]{2})\s+(\d+)/);
        if (dateMatch) {
            shortDate = `${dateMatch[1]} ${dateMatch[2]}`;
        }

        const isGraded = assignment.score && assignment.score !== "No grade";
        
        if (isGraded) {
            // Put score first for visibility
            this.description = `${assignment.score} • ${shortDate}`;
        } else {
            this.description = shortDate;
        }

        this.tooltip = `${assignment.name}\nDue: ${assignment.dueDate}\nScore: ${assignment.score || 'N/A'}`;
        
        const downloadStatus = assignment.isDownloaded ? 'downloaded' : 'notDownloaded';
        const gradeStatus = isGraded ? 'Graded' : 'Ungraded';
        this.contextValue = `${downloadStatus}${gradeStatus}`;
        
        if (assignment.isDownloaded) {
            this.iconPath = new vscode.ThemeIcon('check');
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
        }
    }
}

module.exports = {
    AssignmentsProvider,
    AssignmentTreeItem
};

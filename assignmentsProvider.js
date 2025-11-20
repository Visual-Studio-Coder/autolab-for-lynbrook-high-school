const vscode = require('vscode');
const autolab = require('./autolab');
const path = require('path');

class AssignmentsProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.assignments = [];
    }

    refresh() {
        this._onDidChangeTreeData.fire();
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

        try {
            this.assignments = await autolab.fetchAssignments();
            if (this.assignments.length === 0) {
                return [new vscode.TreeItem("No assignments found", vscode.TreeItemCollapsibleState.None)];
            }
            return this.assignments;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fetch assignments: ${error.message}`);
            return [];
        }
    }
}

class AssignmentTreeItem extends vscode.TreeItem {
    constructor(assignment) {
        super(assignment.name, vscode.TreeItemCollapsibleState.None);
        this.assignment = assignment;
        
        // Shorten date for better visibility
        // e.g. "Wed, Dec 10 at 11:59pm" -> "Dec 10"
        let shortDate = assignment.dueDate;
        const dateMatch = assignment.dueDate.match(/([A-Z][a-z]{2})\s+(\d+)/);
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

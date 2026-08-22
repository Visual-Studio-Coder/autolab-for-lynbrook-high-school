const assert = require('assert');
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const autolab = require('../autolab');

suite('Extension Test Suite', () => {
	test('extension activates and registers its commands', async () => {
		const extension = vscode.extensions.getExtension(
			'Visual-Studio-Coder.autolab-for-lynbrook-high-school'
		);
		assert.ok(extension, 'Extension was not found in the test host.');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('autolab.downloadAssignment'));
		assert.ok(commands.includes('autolab.setSessionCookie'));
	});

	test('Java header updates are recursive and do not invent collaborators', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autolab-header-test-'));
		const sourceFolder = path.join(root, 'src');
		const sourcePath = path.join(sourceFolder, 'Example.JAVA');
		fs.mkdirSync(sourceFolder);
		fs.writeFileSync(sourcePath, [
			'// TODO Your Name',
			'// TODO Date',
			'// TODO Your Period',
			'// TODO list collaborators',
		].join('\n'));

		try {
			const changed = autolab.updateJavaFileHeaders(root, {
				authorName: 'Student Name',
				period: '2',
				collaborators: '',
			});
			const result = fs.readFileSync(sourcePath, 'utf8');

			assert.strictEqual(changed, 1);
			assert.match(result, /Student Name/);
			assert.match(result, /\/\/ 2/);
			assert.doesNotMatch(result, /TODO Date/);
			assert.match(result, /TODO list collaborators/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

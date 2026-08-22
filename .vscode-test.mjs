import { defineConfig } from '@vscode/test-cli';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDataRoot = join(tmpdir(), 'autolab-vscode-test');

export default defineConfig({
	files: 'test/**/*.test.js',
	launchArgs: [
		`--user-data-dir=${join(testDataRoot, 'user-data')}`,
		`--extensions-dir=${join(testDataRoot, 'extensions')}`,
	],
});

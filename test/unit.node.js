const assert = require('node:assert/strict');
const test = require('node:test');
const {
    cleanScore,
    getPortableArchiveSegments,
    normalizeSessionCookie,
    resolveAutolabUrl,
    resolveWorkspacePath,
    toPortableName,
} = require('../autolabUtils');

test('portable names keep normal assignment names unchanged', () => {
    assert.equal(toPortableName('Lab 12'), 'Lab 12');
});

test('portable names replace Windows-invalid and reserved names', () => {
    const invalid = toPortableName('Lab: Arrays?');
    assert.doesNotMatch(invalid, /[<>:"/\\|?*]/);
    assert.match(invalid, /^Lab_ Arrays_/);
    assert.match(invalid, /-[a-f0-9]{8}$/);
    assert.match(toPortableName('CON'), /^_CON-/);
    assert.doesNotMatch(toPortableName('Trailing. '), /[. ]$/);
});

test('portable archive names keep the file extension', () => {
    const [fileName] = getPortableArchiveSegments('Main?.java');
    assert.match(fileName, /^Main_-[a-f0-9]{8}\.java$/);
});

test('portable names are deterministic and have a length limit', () => {
    const value = 'x'.repeat(300);
    assert.equal(toPortableName(value), toPortableName(value));
    assert.equal(toPortableName(value).length, 100);
    assert.equal(
        toPortableName(`file.${'x'.repeat(300)}`, { maxLength: 120, preserveExtension: true }).length,
        120
    );
});

test('session cookie accepts a raw value or a full Cookie header', () => {
    assert.equal(normalizeSessionCookie('abc123'), '_autolab3_session=abc123');
    assert.equal(
        normalizeSessionCookie('Cookie: browser.timezone=America/Los_Angeles;  _autolab3_session=abc'),
        'browser.timezone=America/Los_Angeles; _autolab3_session=abc'
    );
    assert.throws(() => normalizeSessionCookie('abc\r\nInjected: value'), /control character/);
});

test('Windows drive roots resolve to absolute root paths', () => {
    /** @type {{ platform: NodeJS.Platform, homeDirectory: string, currentDirectory: string }} */
    const options = {
        platform: 'win32',
        homeDirectory: 'C:\\Users\\Student',
        currentDirectory: 'C:\\Users\\Student\\project',
    };
    assert.equal(resolveWorkspacePath('G:', options), 'G:\\');
    assert.equal(resolveWorkspacePath('G:\\', options), 'G:\\');
    assert.equal(resolveWorkspacePath('G:/', options), 'G:\\');
    assert.equal(resolveWorkspacePath('~/Autolab', options), 'C:\\Users\\Student\\Autolab');
    assert.throws(() => resolveWorkspacePath('G:Autolab', options), /absolute Windows path/);
});

test('authenticated URLs stay on the Autolab server', () => {
    const base = 'https://cs.lhs.fuhsd.org';
    assert.equal(
        resolveAutolabUrl('/courses/APCS/assessments/Lab', base),
        'https://cs.lhs.fuhsd.org/courses/APCS/assessments/Lab'
    );
    assert.throws(() => resolveAutolabUrl('https://example.com/file.zip', base), /different server/);
    assert.equal(
        resolveAutolabUrl('https://example.com/writeup', base, false),
        'https://example.com/writeup'
    );
});

test('archive paths reject traversal and Windows absolute paths', () => {
    assert.throws(() => getPortableArchiveSegments('../secret.txt'), /Unsafe archive path/);
    assert.throws(() => getPortableArchiveSegments('folder\\..\\secret.txt'), /Unsafe archive path/);
    assert.throws(() => getPortableArchiveSegments('C:\\secret.txt'), /Unsafe archive path/);
});

test('score cleanup removes only an integer decimal suffix', () => {
    assert.equal(cleanScore('10.0 / 12.0'), '10 / 12');
    assert.equal(cleanScore('10.05 / 12.0'), '10.05 / 12');
});

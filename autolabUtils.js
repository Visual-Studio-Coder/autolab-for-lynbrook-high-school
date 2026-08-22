const crypto = require('crypto');
const os = require('os');
const path = require('path');

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const INVALID_WINDOWS_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

function shortHash(value) {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/**
 * Make one path segment safe on Windows, macOS, and Linux.
 *
 * @param {string} value
 * @param {{ maxLength?: number, preserveExtension?: boolean }} [options]
 */
function toPortableName(value, options = {}) {
    const maxLength = options.maxLength ?? 100;
    const preserveExtension = options.preserveExtension ?? false;
    const original = String(value || '').normalize('NFC');
    let result = original
        .replace(INVALID_WINDOWS_CHARACTERS, '_')
        .replace(/[. ]+$/g, '')
        .trimStart();

    if (!result || result === '.' || result === '..') {
        result = 'unnamed';
    }

    if (WINDOWS_RESERVED_NAME.test(result)) {
        result = `_${result}`;
    }

    const needsSuffix = result !== original || result.length > maxLength;
    const suffix = needsSuffix ? `-${shortHash(original)}` : '';
    const extensionIndex = preserveExtension ? result.lastIndexOf('.') : -1;
    const hasExtension = extensionIndex > 0;
    let extension = hasExtension ? result.slice(extensionIndex) : '';
    const stem = hasExtension ? result.slice(0, extensionIndex) : result;
    const maximumExtensionLength = Math.max(0, maxLength - suffix.length - 1);
    extension = extension.slice(0, maximumExtensionLength);
    const stemLength = Math.max(1, maxLength - suffix.length - extension.length);

    return `${stem.slice(0, stemLength).replace(/[. ]+$/g, '')}${suffix}${extension}`;
}

/** @param {{ name: string, folderName?: string }} assignment */
function getAssignmentFolderName(assignment) {
    return toPortableName(assignment.folderName || assignment.name, { maxLength: 100 });
}

/**
 * Accept a full Cookie header or only the Autolab session value.
 *
 * @param {unknown} value
 */
function normalizeSessionCookie(value) {
    let cookie = typeof value === 'string' ? value.trim() : '';
    cookie = cookie.replace(/^cookie\s*:\s*/i, '');

    if (!cookie) {
        throw new Error('Session cookie is empty.');
    }
    if (/[\r\n\u0000]/.test(cookie)) {
        throw new Error('Session cookie contains an invalid control character.');
    }

    if (!cookie.includes('=')) {
        cookie = `_autolab3_session=${cookie}`;
    }

    const pairs = cookie.split(';').map((part) => part.trim()).filter(Boolean);
    if (pairs.some((part) => !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+=[^;]*$/.test(part))) {
        throw new Error('Session cookie has an invalid name or value.');
    }

    return pairs.join('; ');
}

/**
 * Resolve the configured download folder without treating a Windows drive root
 * such as `G:` as a drive-relative path.
 *
 * @param {unknown} value
 * @param {{ platform?: NodeJS.Platform, homeDirectory?: string, currentDirectory?: string }} [options]
 */
function resolveWorkspacePath(value, options = {}) {
    const platform = options.platform ?? process.platform;
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const homeDirectory = options.homeDirectory ?? os.homedir();
    const currentDirectory = options.currentDirectory ?? process.cwd();
    let workspacePath = String(value || '').trim();

    if (!workspacePath) {
        throw new Error('Autolab download folder is empty.');
    }

    if (/^~(?:[\\/]|$)/.test(workspacePath)) {
        workspacePath = pathApi.join(
            homeDirectory,
            workspacePath.slice(1).replace(/^[\\/]/, '')
        );
    }

    if (platform === 'win32') {
        if (/^[A-Za-z]:$/.test(workspacePath)) {
            workspacePath += '\\';
        } else if (/^[A-Za-z]:[^\\/]/.test(workspacePath)) {
            throw new Error('Use an absolute Windows path such as G:\\Autolab, not G:Autolab.');
        }
    }

    return pathApi.resolve(currentDirectory, workspacePath);
}

/**
 * Resolve a scraped URL. Do not let an authenticated request leave the server.
 *
 * @param {string} candidate
 * @param {string} baseUrl
 * @param {boolean} [requireSameOrigin]
 */
function resolveAutolabUrl(candidate, baseUrl, requireSameOrigin = true) {
    const resolved = new URL(candidate, baseUrl);
    const base = new URL(baseUrl);

    if (!['http:', 'https:'].includes(resolved.protocol)) {
        throw new Error(`Unsupported URL protocol: ${resolved.protocol}`);
    }
    if (requireSameOrigin && resolved.origin !== base.origin) {
        throw new Error('Autolab returned a link to a different server.');
    }

    return resolved.toString();
}

/** @param {string} score */
function cleanScore(score) {
    return score.replace(/\b(\d+)\.0\b/g, '$1');
}

/**
 * Validate and convert one ZIP entry path to portable path segments.
 *
 * @param {string} entryPath
 */
function getPortableArchiveSegments(entryPath) {
    const normalized = String(entryPath).replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
        throw new Error(`Unsafe archive path: ${entryPath}`);
    }

    const rawSegments = normalized.split('/').filter(Boolean);
    if (rawSegments.some((segment) => segment === '.' || segment === '..')) {
        throw new Error(`Unsafe archive path: ${entryPath}`);
    }

    return rawSegments.map((segment) => toPortableName(segment, {
        maxLength: 120,
        preserveExtension: true,
    }));
}

/** @param {unknown} error */
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

module.exports = {
    cleanScore,
    getAssignmentFolderName,
    getErrorMessage,
    getPortableArchiveSegments,
    normalizeSessionCookie,
    resolveAutolabUrl,
    resolveWorkspacePath,
    toPortableName,
};

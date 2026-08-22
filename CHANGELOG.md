# Change Log

All notable changes to the "autolab-for-lynbrook-high-school" extension will be documented in this file.

## [0.0.10] - 2026-08-21

- **Windows Drive Roots**: Treats a download folder such as `G:` as the absolute drive root `G:\` instead of passing an invalid drive-relative path to `mkdir`.

## [0.0.9] - 2026-08-21

- **Windows Support**: Uses portable file names and paths, handles drive roots such as `G:`, and uses a platform-correct browser User-Agent.
- **Reliable File Operations**: Uses unique temporary folders, complete cleanup, safe ZIP extraction, and correct archive event handling.
- **Reliable Requests**: Adds timeouts, cancellation, login detection, consistent headers, and safer URL handling.
- **Secure Cookie Storage**: Adds commands that use VS Code secure storage and accepts a raw session value or a full Cookie header.
- **Course Setting**: Replaces most hard-coded course paths with the `autolab.courseName` setting.
- **Submission Safety**: Streams uploads, validates responses, and keeps a successful submission successful if later feedback retrieval fails.
- **Tests**: Adds lint, type, path, cookie, URL, archive path, score, and VS Code integration checks.

## [0.0.8] - 2025-11-24

- **Dynamic Download Links**: Now scrapes the assessment page to find the correct download link, fixing 404 errors.
- **Folder Flattening**: Automatically detects and fixes nested folders (e.g., `Lab1/Lab1`) after downloading.
- **Improved Java Headers**: Better detection and replacement of TODOs in Java files (case-insensitive, handles multiple spaces).

## [0.0.6] - 2025-11-23

- Fixed "Open Assignment" command to check if folder exists.
- Improved error handling for missing assignment folders.

## [0.0.5] - 2025-11-23

- Fixed buttons (Download, Submit, etc.) not working due to command argument issues.

## [0.0.4] - 2025-11-23

- Added a "Select Folder..." link in Settings to easily pick the download directory.

## [0.0.3] - 2025-11-20

- Fixed Activity Bar icon visibility in different themes (switched to SVG).

## [0.0.2] - 2025-11-19

- Fixed extension icon in the Marketplace.

## [0.0.1] - 2025-11-19

- Initial release
- View, download, and submit assignments
- View feedback and grades
- Update Java file headers

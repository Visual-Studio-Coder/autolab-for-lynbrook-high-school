# Autolab for Lynbrook High School

This VS Code extension allows Lynbrook High School students to manage their APCS-A Autolab assignments directly from VS Code.

## Features

*   **View Assignments**: See a list of all your assignments, due dates, and scores.
*   **Download**: Download assignment starter code and automatically unzip it.
*   **Submit**: Zip and submit your code directly to Autolab.
*   **Feedback**: View autograder feedback and scores instantly within VS Code.
*   **Java Headers**: Automatically update `@author` and `@version` tags in your Java files.
*   **Search**: Quickly find assignments by name.

## Setup

1.  Install the extension.
2.  Open the Command Palette with `Ctrl+Shift+P` on Windows or `Cmd+Shift+P` on macOS.
3.  Run **Autolab: Set Session Cookie**. VS Code saves the cookie in secure storage.
    *   Log in to [Autolab](https://cs.lhs.fuhsd.org).
    *   Open Developer Tools (F12 or Right Click -> Inspect).
    *   Go to the **Application** tab (Chrome) or **Storage** tab (Firefox).
    *   Expand **Cookies** and select `https://cs.lhs.fuhsd.org`.
    *   Copy the value of `_autolab3_session`. Some server versions use `_autolab_session`.
    *   Paste the value into the command input. You can also paste the full Cookie header.
4.  **Workspace Path**: Set the folder where you want your assignments to be downloaded. You can type the path manually or click the **Select Folder...** link in the settings description.
5.  **Course Name**: The default is `APCS-A-25`. Change this setting when the course URL changes.
6.  **Personal Info**: Set your **Author Name**, **Period**, and **Collaborators** for Java file header updates.

## Usage

*   Click the **Autolab** icon in the Activity Bar (left side).
*   Click the **Download** icon on an assignment to download it.
*   Right-click a downloaded assignment to **Submit** or **Open** it.
*   Use the **Search** icon to filter assignments.

## Requirements

*   An account on the Lynbrook High School Autolab server.
*   Enrolled in the APCS-A course.

## Extension Settings

*   `autolab.workspacePath`: Directory to save assignments.
*   `autolab.courseName`: Course name from the Autolab URL.
*   `autolab.authorName`: Name to use in Java comments.
*   `autolab.period`: Class period to use in Java comments.
*   `autolab.collaborators`: Collaborators to use in Java comments.
*   `autolab.userAgent`: Optional browser User-Agent value. Use this only if Cloudflare rejects the default value.

## Known Issues

*   The extension reads the current Autolab HTML. A server page change can require a parser update.
*   If the session cookie expires, run **Autolab: Set Session Cookie** again.

## Release Notes

### 0.0.8

Added portable Windows paths, safe ZIP extraction, reliable submission archives, request cancellation and timeouts, secure cookie storage, configurable course names, and real unit tests.

### 0.0.6

Fixed issues with opening assignment folders and button responsiveness.

### 0.0.4

Added a folder picker in Settings for easier configuration.

### 0.0.3

Fixed sidebar icon visibility.

### 0.0.1

Initial release of Autolab for Lynbrook High School.

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
2.  Open VS Code Settings (`Cmd+,`) and search for **Autolab**.
3.  **Session Cookie**: You need to get your session cookie from your browser.
    *   Log in to [Autolab](https://cs.lhs.fuhsd.org).
    *   Open Developer Tools (F12 or Right Click -> Inspect).
    *   Go to the **Application** tab (Chrome) or **Storage** tab (Firefox).
    *   Expand **Cookies** and select `https://cs.lhs.fuhsd.org`.
    *   Copy the value of `_autolab_session`.
    *   Paste it into the **Autolab: Session Cookie** setting in VS Code.
4.  **Workspace Path**: Set the folder where you want your assignments to be downloaded (default is `~/Documents/Autolab`).
5.  **Personal Info**: Set your **Author Name** and **Period** for the Java file header updates.

## Usage

*   Click the **Autolab** icon in the Activity Bar (left side).
*   Click the **Download** icon on an assignment to download it.
*   Right-click a downloaded assignment to **Submit** or **Open** it.
*   Use the **Search** icon to filter assignments.

## Requirements

*   An account on the Lynbrook High School Autolab server.
*   Enrolled in the APCS-A course.

## Extension Settings

*   `autolab.sessionCookie`: Your Autolab session cookie.
*   `autolab.workspacePath`: Directory to save assignments.
*   `autolab.authorName`: Name to use in Java comments.
*   `autolab.period`: Class period to use in Java comments.

## Known Issues

*   If your session cookie expires, you will need to update it in settings.

## Release Notes

### 0.0.1

Initial release of Autolab for Lynbrook High School.

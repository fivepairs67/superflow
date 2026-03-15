# Privacy Policy

Last updated: 2026-03-15

This Privacy Policy explains how **SuperFLOW** handles data when used as a Chrome extension.

SuperFLOW is a SQL flow and lineage visualizer for web-based SQL editors, with the deepest integration currently provided for Apache Superset SQL Lab.

SuperFLOW is designed around the current tab and site-based access. Users can enable a site once and keep SuperFLOW available there without granting blanket always-on access to every site by default.

## 1. Data SuperFLOW May Process

To provide its core functionality, SuperFLOW may process:

- SQL text available in supported or enabled web-based SQL editors
- selected SQL text and cursor/selection ranges
- query structure and analysis results derived from SQL text
- query execution metadata when available from the host application, such as status, row count, duration, and query identifiers
- page URL, title, and host information needed to identify the current editor context
- clipboard text only when the user explicitly triggers clipboard-based features
- local extension settings and session state stored in Chrome storage

SuperFLOW is designed to process only the data required to detect SQL editor context, analyze SQL, and render graphs and focus state.

## 2. How Data Is Used

SuperFLOW uses processed data to:

- detect the current tab and determine whether site access has been enabled
- collect SQL snapshots from the current page when available after the user has enabled access for that site
- analyze SQL structure, dependencies, and lineage
- render logical graphs, script graphs, and column lineage views
- synchronize focus between SQL text and graph nodes
- provide clipboard or pasted SQL fallback workflows
- remember local UI state and preferences

## 3. Local Processing

SuperFLOW performs its SQL analysis and UI rendering locally in the user's browser.

- SQL analysis runs inside the extension
- local session and preference data may be stored in Chrome storage
- clipboard input is processed locally when explicitly invoked by the user

## 4. Data Sharing and External Transmission

SuperFLOW does **not** send SQL text, clipboard contents, or user data to the developer's servers.

SuperFLOW does not:

- sell user data
- use user data for advertising
- use user data for profiling unrelated to the extension's core functionality

When integrated with a website such as Superset SQL Lab, SuperFLOW may observe the page's own editor state or page-origin network activity to understand the current SQL context. This is part of the extension's local functionality and is not a transfer to the developer.

## 5. Permissions and Why They Are Used

- `sidePanel`
  Used to display the SuperFLOW UI in Chrome's side panel.
- `storage`
  Used to store local preferences and session state.
- `tabs`
  Used to identify and interact with the current browser tab.
- `scripting`
  Used to inject or coordinate extension logic with the active page when needed.
- `clipboardRead`
  Used only when the user explicitly requests clipboard-based SQL analysis.
- `optional host permissions`
  Used only after the user enables a specific site. This allows SuperFLOW to read SQL context from that site's pages and render analysis there.

## 6. Data Retention

- session data stored in `chrome.storage.session` may be cleared when the browser session ends
- local preference data stored in `chrome.storage.local` remains until the user clears it or removes the extension
- pasted or captured SQL is retained only as needed for local analysis state unless the user clears it or replaces it

## 7. User Control

Users can control their data by:

- clearing extension state by removing the extension or clearing browser extension storage
- choosing which sites to enable for SuperFLOW access
- disabling access for the current site from the SuperFLOW header toggle or from Chrome's extension site access controls
- avoiding clipboard features if they do not wish clipboard text to be processed
- using only the pages and SQL editors they choose to analyze

## 8. Security

SuperFLOW is designed to keep processing local to the browser wherever possible. However, users should avoid loading highly sensitive SQL or confidential data into browser tools unless permitted by their organization's security policies.

## 9. Changes to This Policy

This Privacy Policy may be updated if the extension's functionality, permissions, or data practices change. The latest version will be published in this document.

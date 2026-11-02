# Privacy Policy

Last updated: 2026-11-02

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

SuperFLOW does **not** send SQL text, clipboard contents, or user data to the developer's servers or to AI services. It includes no analytics or advertising SDKs. It does not execute SQL or connect directly to databases.

SuperFLOW does not:

- sell user data
- use user data for advertising
- use user data for profiling unrelated to the extension's core functionality

When integrated with a website such as Superset SQL Lab, SuperFLOW may observe the page's own editor state or page-origin network activity to understand the current SQL context. This is part of the extension's local functionality and is not a transfer to the developer.

For supported Bitbucket file views, SuperFLOW may request the raw SQL file from the same website using the user's existing signed-in browser session. This retrieves the complete file rather than only visible editor lines. The request goes to that website, not to the developer or an AI service; the website's own privacy policy still applies. Local analysis does not mean that the host website makes no network requests.

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

- per-tab SQL, analysis, page context, and available execution metadata are kept in `chrome.storage.session`; closing the tab removes its session, and Chrome clears session storage when the browser restarts or the extension is reloaded, disabled, or updated
- local preference data stored in `chrome.storage.local` remains until the user clears it or removes the extension
- replacing captured SQL replaces that captured input; returning to page SQL clears the captured input from the tab session
- disabling site access clears page-derived SQL and analysis from matching open-tab sessions, but deliberately preserves manually captured SQL

Closing the side panel alone does not clear the tab session. Local preferences include the Superset schema-panel visibility setting for an origin, not a permanent SQL history. The chosen SQL dialect is part of the per-tab session. SuperFLOW does not use Chrome sync storage for SQL or preferences.

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

## 10. Contact

Privacy questions: [fivepairs67@gmail.com](mailto:fivepairs67@gmail.com). Please do not send confidential SQL or credentials in support requests.

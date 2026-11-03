# Chrome Web Store Submission

## Package and Listing

- Version: `0.1.4`
- Upload: `dist/release/superflow-chrome-store-v0.1.4.zip`
- Do not upload the GitHub ZIP: it has an enclosing installation folder.
- English listing: [LISTING.en.md](./LISTING.en.md)
- Korean localized listing: [LISTING.ko.md](./LISTING.ko.md)
- Release notes: [v0.1.4](../releases/v0.1.4.md)
- Support URL: `https://github.com/fivepairs67/superflow/issues`
- Privacy URL: `https://github.com/fivepairs67/superflow/blob/main/PRIVACY.md`
- Website: `https://github.com/fivepairs67/superflow`
- Category: Developer Tools
- UI language: English. Adding a Korean listing does not translate the extension UI.

## Single Purpose

Help users understand SQL by analyzing SQL text locally and visualizing query flow, statement dependencies, and column lineage beside their web-based SQL editor.

## Permission Justifications

| Permission | Explanation for the dashboard |
| --- | --- |
| sidePanel | Display the SQL graph and analysis controls beside the tab the user chooses. |
| storage | Keep per-tab SQL, dialect choice, and analysis in session storage, and origin-specific Superset schema-panel visibility preferences in local storage. SQL is not saved to sync storage. |
| tabs | Identify each panel's tab, read its URL/title to detect supported editor context, and clear or refresh sessions on navigation and tab closure. |
| scripting | Inject bundled capture and focus code into websites the user has explicitly enabled, including the page-world editor bridge. |
| clipboardRead | Read SQL text only when the user clicks Clipboard to analyze it locally. |
| Optional HTTP/HTTPS hosts | Support user-chosen hosted or self-hosted SQL editors. Access is requested for the current site through Enable Site, not all sites at installation. Read editor SQL and selections and apply graph-linked focus; supported Bitbucket views may fetch the raw file from the same site. |

Remote code: **No**. The parser, editor adapters, React UI, and other executable code are bundled. Retrieved SQL is analyzed as data, not executed as JavaScript or SQL.

## Privacy Disclosure Review

Do not mark the extension as processing no user data merely because analysis is local. Check the dashboard's current definitions against the implementation and privacy policy before submission.

- Website content: SQL and available host query execution metadata.
- Web history: current enabled-tab URL/title used to identify editor context; no browsing-history database is read.
- User activity: editor cursor/selection used for bidirectional focus; not unrelated activity tracking.
- Clipboard text: only on explicit Clipboard action, processed locally as SQL.
- No advertising, sale of data, developer-server collection, or AI-service transmission.
- Same-site raw file retrieval is distinct from sending SQL to the developer.

Only the account owner should confirm the dashboard's legal/data-use certifications after reviewing them. Do not change privacy declarations to improve appearance rather than accurately reflect behavior.

## Reviewer Instructions

No private account, database, or SQL execution is required for the paste workflow.

1. Open a normal HTTP/HTTPS tab and click the extension toolbar button.
2. Leave site access disabled. Click Paste SQL.
3. Paste [sample.sql](./sample.sql), then click Analyze paste.
4. Inspect the six CTEs in Logical Graph. Select a CTE or its nested JOIN to inspect its SQL highlight and inputs.
5. Select the `net_revenue` result column to trace the sales and refund branches, or `region_rank` for a window-derived column.
6. For Script View, prepend [script-prefix.sql](./script-prefix.sql) to the sample, analyze the combined text, and inspect dependencies between writes and later reads. Do not execute this fictional SQL.
7. Open another Chrome window. The extension must not automatically open there.

Page integration requires a supported editor and explicit Enable Site permission. Superset SQL Lab is the reference integration. Bitbucket and OneCompiler are best-effort. For actual page integration, test using your own non-confidential SQL; the local screenshot demo does not verify browser permissions or website integration.

## Screenshots

Use actual current UI and only fictional data. Never capture internal SQL, hostnames, account names, tokens, or company tables for a public listing.

`npm run dev:store-demo` serves the actual React panel and SQL analyzer on loopback, with a synthetic captured-input session. Its browser API shim is for local screenshot preparation only and is not included in the extension build. The preview does not impersonate Superset or claim a live website integration.

The default preview uses six CTEs for a fictional customer-ranking report: order filtering, revenue aggregation with HAVING, latest-visit selection with ROW_NUMBER, refund aggregation, INNER/LEFT JOINs, and regional DENSE_RANK. Both window results and multi-input `net_revenue` have explicit output columns for lineage exploration.

- Logical Graph preview: `http://127.0.0.1:4178/?tabId=1`
- Script View sample: `http://127.0.0.1:4178/?tabId=1&sample=script`

Capture 1-5 images at 1280 x 800 or 640 x 400. Suggested views: Logical Graph, JOIN detail, column lineage, and Script View. Screenshots must be visually inspected after capture and before upload.

Prepared 1280 x 800 JPEG images (refreshed for v0.1.3 and retained for v0.1.4):

- [Logical Graph](./screenshots/01-logical-graph.jpg)
- [Nested JOIN inputs and CTE dependencies](./screenshots/02-join-focus.jpg)
- [Column lineage](./screenshots/03-column-lineage.jpg)
- [Script View](./screenshots/04-script-view.jpg)

These are captures of the actual panel components using the fictional sample, not evidence of a live third-party editor connection. The demo and screenshots are documentation assets and are excluded from both extension ZIPs.

## Final Submission

1. Run typecheck, runtime, parser-fixture, and release-packaging tests, then `npm run build:release`.
2. Inspect the store ZIP: `manifest.json` at root, version 0.1.4, no demo/test/design source files.
3. Push reviewed source and privacy documentation. Check the public privacy URL.
4. In the existing item's developer console, upload the new store ZIP.
5. Update English/Korean listing copy, support links, screenshots, and permission explanations.
6. Review privacy declarations and any required certifications yourself, then submit for review.
7. Confirm the console shows the new package version and review status. Publication happens only after approval and the selected publishing flow.

If a browser automation tool blocks the extensions gallery, do not use another automation route to bypass it. Upload and submission must then be completed by the account owner.

References: [package requirements](https://developer.chrome.com/docs/webstore/prepare), [update workflow](https://developer.chrome.com/docs/webstore/update), [listing assets](https://developer.chrome.com/docs/webstore/best-listing), [privacy disclosures](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

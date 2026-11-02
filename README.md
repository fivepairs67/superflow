# SuperFLOW

Understand complex SQL through flow.

SuperFLOW is a SQL flow and lineage visualizer for web-based SQL editors. It helps analysts, analytics engineers, and SQL practitioners understand legacy queries faster, trace dependencies visually, and make changes to complex SQL with confidence.

Language:
- English: `README.md`
- Korean: [README.ko.md](./README.ko.md)

## Product Identity

SuperFLOW is not just a Superset add-on.

It is a visual SQL understanding tool with:
- deep integration in Superset SQL Lab
- read-first support for other web-based SQL editors
- clipboard and paste fallback for environments where direct editor access is limited

Best experienced in Superset SQL Lab.

## Install and Start

Install [SuperFLOW from the Chrome Web Store](https://chromewebstore.google.com/detail/superflow/jndkmgobfdidhgcmkakkdjdgamchgbij). Developer mode is not required for the store version. Pin SuperFLOW to the Chrome toolbar for easy access.

1. Open your SQL editor and click the SuperFLOW toolbar button.
2. Click `Enable Site` to allow access to that site, then select a graph node to explore its SQL and columns.
3. If capture is unavailable, use `Paste SQL` and `Analyze paste`. Site access is not required for pasted SQL.

SQL analysis runs locally in your browser, without sending SQL to a developer or AI service. SuperFLOW does not execute SQL or connect to your database. See the [privacy policy](./PRIVACY.md).

## Why It Helps

- Turn long, tangled SQL into an understandable flow of sources, CTEs, joins, filters, subqueries, and outputs.
- Understand legacy SQL in minutes instead of reading it line by line.
- Trace upstream and downstream dependencies before changing a query.
- Inspect column-level lineage and move between SQL text and graph focus.
- Review multi-statement worksheets as both a logical query graph and a script dependency graph.

## Feature Highlights

- Logical graph for sources, CTEs, joins, filters, aggregates, subqueries, outputs, and write targets
- Script view for multi-statement worksheets and statement dependency tracing
- Column-level lineage with upstream references and graph-linked focus
- Bidirectional focus in Superset SQL Lab between SQL text and graph nodes
- Current-selection follow from the editor into graph focus
- Clipboard and paste fallback for environments where direct editor access is limited
- Trino, Hive, and PostgreSQL-oriented parsing with heuristic fallback paths

## Where It Works Best

- `Superset SQL Lab`
  The strongest mode. SuperFLOW can follow editor focus, push graph focus back into the editor, react to worksheet structure, and control SQL Lab-specific layout like the schema panel.
- `Other web-based SQL editors`
  Bitbucket SQL file views and OneCompiler are supported on a best-effort basis. Behavior depends on how the site exposes its editor state; capture and focus capabilities can differ by site or editor version.
- `Clipboard / Paste`
  The universal fallback. If a site does not expose editor state cleanly, you can still analyze SQL by clipboard or direct paste.

## How Site Access Works

SuperFLOW is designed around the current tab.

1. Click the SuperFLOW toolbar button on the SQL editor tab you want to inspect.
2. If the site has not been enabled yet, click `Enable Site` once.
3. After that, SuperFLOW keeps working on that site without asking again, and the header shows `Site Access On`.
4. You can click `Site Access On` later to disable access for the current site.
5. If the site does not expose editor state in a usable way, switch to `Clipboard` or `Paste SQL`.

The panel belongs to the tab where you opened it. Other tabs and Chrome windows do not open it automatically; click the toolbar button there when needed. Site access is shared by origin, but each tab keeps its own SQL session.

This means SuperFLOW does **not** guarantee the same depth of integration on every web-based SQL editor. Superset SQL Lab is the reference experience. Other sites are intentionally supported as a read-first, best-effort layer.

## Why Superset SQL Lab Feels Better

In Superset SQL Lab, SuperFLOW can do more than static visualization:

- bidirectional focus between graph nodes and the editor
- selection-follow from the current cursor or range
- stronger statement awareness for multi-statement worksheets
- SQL Lab-specific layout help such as schema panel toggling
- richer SQL snapshot and page-context detection

If you are working in Superset SQL Lab, SuperFLOW should feel like an integrated analysis companion rather than just a passive viewer.

## Current Modes

- `Superset mode`
  Deep integration with SQL Lab, bidirectional focus, schema panel controls, and richer editor awareness.
- `Web editor mode`
  Read-first graph rendering for generic web-based SQL editors.
- `Clipboard / Paste mode`
  Universal fallback for any environment.

## Current Status

SuperFLOW is in a strong beta-stage MVP.

Current strengths include:
- logical graph and script view
- CTE, JOIN, subquery, and write-target graph modeling
- column lineage MVP
- Trino, Hive, and PostgreSQL-oriented parsing paths
- parser fixture regression coverage
- compact exploration UI optimized for side panel workflows

## Local Development

```bash
npm install
npm run typecheck
npm run test:runtime
npm run test:parser-fixtures
npm run test:release
npm run build:extension
```

Build output:
- `dist/extension/`

Notes:
- `dist/extension/` is generated locally and is not committed to GitHub.
- If you cloned the repository from GitHub, run the build command first.
- Then load `dist/extension/` in Chrome Extensions developer mode.

## Install from GitHub Release

1. Download the latest `superflow-extension-vX.Y.Z.zip` asset from the repository's Releases page.
2. Extract the archive.
3. Open `chrome://extensions` in Chrome.
4. Turn on `Developer mode`.
5. Click `Load unpacked`.
6. Select the extracted `superflow-extension-vX.Y.Z/` folder.

## Create a Release Archive

```bash
npm install
npm run build:release
```

Release output:
- `dist/release/superflow-extension-vX.Y.Z.zip`
- `dist/release/superflow-chrome-store-vX.Y.Z.zip`

Use the first ZIP as a GitHub Release asset. Upload the second ZIP to the Chrome Web Store; it places `manifest.json` at the archive root. Generated extension bundles and release ZIPs are not committed.

## Support and Limitations

This is a beta SQL understanding aid, not an execution plan or a guarantee of query correctness. Unsupported syntax may use heuristic analysis, and column lineage without schema metadata can be incomplete. Check the SQL before making changes.

Report problems through [GitHub Issues](https://github.com/fivepairs67/superflow/issues). Include the extension version, Chrome version, site/editor type, dialect, and a minimal synthetic SQL example. Do not include credentials, company table names, private URLs, or confidential SQL.

## Docs

- [Task Checklist](./TASKS.md)
- [GitHub Release Checklist](./docs/GITHUB_RELEASE_CHECKLIST.md)
- [Chrome Web Store Submission](./docs/store/SUBMISSION.md)
- [Design Doc](./docs/DESIGN.md)
- [React Redesign](./docs/REACT_REDESIGN.md)
- [Column Lineage Plan](./docs/COLUMN_LINEAGE_PLAN.md)
- [SQL Fixtures](./fixtures/README.md)
- [Privacy Policy](./PRIVACY.md)

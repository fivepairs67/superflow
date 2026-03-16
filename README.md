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
  Supported on a best-effort basis. If the site exposes readable editor state, SuperFLOW can often render a read-first graph. Behavior depends on how that site renders its editor and whether its DOM or runtime state can be observed safely.
- `Clipboard / Paste`
  The universal fallback. If a site does not expose editor state cleanly, you can still analyze SQL by clipboard or direct paste.

## How Site Access Works

SuperFLOW is designed around the current tab.

1. Open the extension side panel on the SQL editor tab you want to inspect.
2. If the site has not been enabled yet, click `Enable Site` once.
3. After that, SuperFLOW keeps working on that site without asking again, and the header shows `Site Access On`.
4. You can click `Site Access On` later to disable access for the current site.
5. If the site does not expose editor state in a usable way, switch to `Clipboard` or `Paste SQL`.

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

Use this zip as a GitHub Release asset. The repository itself keeps source code only.

## Docs

- [Task Checklist](./TASKS.md)
- [GitHub Release Checklist](./docs/GITHUB_RELEASE_CHECKLIST.md)
- [Design Doc](./docs/DESIGN.md)
- [React Redesign](./docs/REACT_REDESIGN.md)
- [Column Lineage Plan](./docs/COLUMN_LINEAGE_PLAN.md)
- [SQL Fixtures](./fixtures/README.md)
- [Privacy Policy](./PRIVACY.md)

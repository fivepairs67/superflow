# SuperFLOW

## Summary

Understand complex SQL through flow and column lineage. Explore CTEs and JOINs beside your web-based SQL editor.

## Detailed Description

Inherited a SQL maze? See the flow.

SuperFLOW turns complex SQL into an interactive graph in Chrome's side panel. Explore sources, CTEs, JOINs, filters, subqueries, and outputs without losing your place in a long legacy query.

- Logical Graph: visualize query structure and data flow.
- Script View: follow read/write dependencies across multi-statement scripts.
- Column lineage: inspect where output columns come from and how they are transformed.
- SQL focus: move between graph selections and SQL text in supported editors.
- Clipboard / Paste: analyze SQL when direct page capture is unavailable.
- Trino, Hive, and PostgreSQL-oriented analysis.

Get started:
1. Click SuperFLOW on your SQL editor tab.
2. Click Enable Site to allow access to that website.
3. Select a graph node to inspect SQL and columns. Use Paste SQL if direct capture is unavailable.

Superset SQL Lab is the reference experience. Bitbucket SQL file views and OneCompiler are supported on a best-effort basis; capture and focus depend on the site's editor implementation. The panel belongs to the tab where you opened it.

SQL analysis runs locally in your browser. SQL is not sent to developer servers or AI services. SuperFLOW does not execute SQL or connect to databases. Website access is enabled per site, and clipboard text is read only when you click Clipboard. On Bitbucket, the extension may request the raw file from that same website to capture the complete SQL.

This is a beta release, not a query-correctness validator. Unsupported syntax and missing schema metadata can limit graph and lineage accuracy. Always check the source SQL. The extension interface is in English.

Help: https://github.com/fivepairs67/superflow
Support: https://github.com/fivepairs67/superflow/issues
Privacy: https://github.com/fivepairs67/superflow/blob/main/PRIVACY.md

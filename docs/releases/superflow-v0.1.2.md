SuperFLOW v0.1.2 improves site capture stability, Trino parsing accuracy, and CTE/join rendering consistency.

Highlights:

- Better bridge injection for web-based editors using Chrome MAIN-world execution
- Better fallback extraction from structured code views and open shadow roots
- Better Bitbucket source capture for SQL file views via raw-source fallback
- Better parsing for quoted identifiers such as `"11ST".BASE_11ST_AUTO_CLIENT_LOG`
- Better auto-detection for Trino-like SQL using functions such as `TRY(...)` and `date_parse(...)`
- More accurate join labeling to avoid false `MULTI JOIN` results in auto mode
- Better CTE node rendering for long names in the Logical Graph
- Better CTE flow/details rendering with specific join labels such as `LEFT JOIN`
- Removed hardcoded local absolute paths from test and spike scripts
- Added parser regression fixtures for Trino auto-join detection and quoted schema sources

Included in this release:

- Stronger support for Trino, Hive, and PostgreSQL-oriented SQL analysis
- Logical Graph
- Script View
- Column lineage
- Superset SQL Lab bidirectional focus
- Clipboard / Paste fallback

Installation:

1. Download `superflow-extension-v0.1.2.zip` from this release.
2. Extract the archive.
3. Open `chrome://extensions`
4. Enable Developer mode
5. Click Load unpacked
6. Select the extracted `superflow-extension-v0.1.2/` folder

Notes:

- This is still a beta release.
- Superset SQL Lab remains the best-supported environment.
- Generic web editor support is best-effort and depends on site/editor exposure.
- The existing `dt-sql-parser-shim` build warning is still present and was not introduced in this release.

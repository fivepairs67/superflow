# GitHub Release Checklist

Use this checklist before publishing SuperFLOW as a public GitHub repository.

Recommended release posture:
- `Public beta`
- Not a `1.0` claim yet
- Position Superset SQL Lab as the reference experience
- Position other web-based SQL editors as `best-effort` support

## 1. Product Positioning

- [ ] Repository title and short description use `SuperFLOW`
- [ ] README starts with the current product message
  - `Understand complex SQL through flow.`
- [ ] README clearly explains:
  - Superset-first deep integration
  - generic web editor support is best-effort
  - Clipboard / Paste are universal fallback modes
- [ ] Public wording uses `beta` or `preview`, not `fully supported everywhere`

## 2. Documentation

- [ ] `README.md` is up to date in English
- [ ] `README.ko.md` is up to date in Korean
- [ ] `PRIVACY.md` matches the current permission model
- [ ] `TASKS.md` reflects actual project status
- [ ] Key docs are linked from the README
- [ ] Screenshots or demo captures are ready for GitHub and future store listing

## 3. Permission Model and Privacy

- [ ] Manifest description matches actual behavior
- [ ] `optional_host_permissions` is used instead of blanket always-on host access
- [ ] README explains the `Enable Site` flow
- [ ] Privacy policy explains:
  - current-tab centered usage
  - per-site enable model
  - local processing
  - clipboard usage only on explicit user action
- [ ] It is clear that users can disable site access later

## 4. Product Reality Check

- [ ] Superset SQL Lab works as the strongest supported mode
- [ ] Generic web editor support is described as best-effort, not guaranteed
- [ ] Clipboard / Paste fallback works without site access
- [ ] Known limitations are documented instead of hidden

## 5. Build and Verification

- [ ] `npm install`
- [ ] `npm run typecheck`
- [ ] `npm run build:extension`
- [ ] `npm run test:parser-fixtures`
- [ ] `dist/extension` loads cleanly in Chrome developer mode
- [ ] Extension icon and manifest metadata render correctly in Chrome

## 6. Quality Gate

- [ ] Superset SQL Lab manual smoke test passed
  - side panel opens
  - `Enable Site` works
  - SQL snapshot is captured
  - logical graph renders
  - Script View works on multi-statement worksheets
  - bidirectional focus works
  - schema panel toggle works
- [ ] Clipboard mode works
- [ ] Paste mode works
- [ ] At least 5 real-world SQL samples were checked manually

## 7. Repository Hygiene

- [ ] No unrelated local project files are referenced
- [ ] No accidental edits from other repos remain
- [ ] No secrets, tokens, or private URLs are committed
- [ ] `.gitignore` covers local build noise if needed
- [ ] License choice is decided and added if the repo will be public

## 8. Release Messaging

- [ ] Short repo description is ready
- [ ] Beta disclaimer is ready
- [ ] Feature bullets are ready
- [ ] Limitations section is ready

Suggested short description:
- `SQL flow and lineage visualizer for web-based SQL editors. Best experienced in Superset SQL Lab.`

Suggested beta note:
- `SuperFLOW is currently released as a public beta. Superset SQL Lab is the reference experience, while other web-based SQL editors are supported on a best-effort basis.`

## 9. Before Web Store Submission

These are not required for GitHub publishing, but should be tracked separately.

- [ ] Finalize Chrome Web Store screenshots and listing copy
- [ ] Verify privacy policy public URL
- [ ] Re-check permissions justification
- [ ] Review optional host permission UX one more time
- [ ] Decide whether to resolve the `dt-sql-parser-shim` warning before broader release

## Recommended Outcome

If the checklist above is mostly green, publish as:
- `SuperFLOW`
- `Public beta`
- `Superset SQL Lab reference experience`
- `Generic web editor best-effort support`

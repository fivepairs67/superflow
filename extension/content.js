if (globalThis.__SQV_CONTENT_SCRIPT_ACTIVE__) {
  console.debug("Superset Query Visualizer content script already active");
} else {
globalThis.__SQV_CONTENT_SCRIPT_ACTIVE__ = true;

const PAGE_SOURCE = "superset-query-visualizer";
const STATUS_DEBOUNCE_MS = 200;
const URL_POLL_MS = 1500;
const SQL_LAB_PATH_HINTS = ["sqllab", "sql_lab", "sql-lab", "/superset/sql"];
const SQL_EDITOR_SELECTORS = [
  ".ace_editor",
  ".ace_content",
  ".monaco-editor textarea",
  ".monaco-editor .view-lines",
  "[data-test='sql-editor'] textarea",
  ".monaco-editor",
  "[data-test='sql-editor']",
  "[data-test='code-editor']",
  ".CodeMirror",
  ".CodeMirror-code",
  ".cm-editor",
  ".cm-content",
  "[contenteditable='plaintext-only']",
  "[contenteditable='true'][role='textbox']",
  "[contenteditable='true']",
  "[role='code']",
  "pre code",
  "textarea.sql-editor",
  "textarea",
];
const STRUCTURED_CODE_CONTAINER_SELECTORS = [
  "[data-testid*='code-view']",
  "[data-testid*='source-view']",
  "[data-testid*='file-content']",
  "[data-testid*='diff-view']",
  "[data-qa*='code-view']",
  "[data-qa*='source-view']",
  "[data-qa*='file-content']",
  "[data-qa*='diff-view']",
  "[class*='code-view']",
  "[class*='CodeView']",
  "[class*='source-view']",
  "[class*='SourceView']",
  "[class*='file-content']",
  "[class*='FileContent']",
  "[class*='react-code']",
  "[class*='blob-code']",
  "[class*='diff-view']",
  "[class*='DiffView']",
];
const STRUCTURED_CODE_LINE_SELECTORS = [
  "[data-testid*='code-line']",
  "[data-qa*='code-line']",
  "[data-testid*='source-line']",
  "[data-qa*='source-line']",
  ".react-code-text",
  ".blob-code-inner",
  ".diff-line-pre",
];
const SQL_KEYWORD_REGEX = /\b(with|select|insert|update|delete|create|merge)\b/i;
const MAX_SQL_PREVIEW_LENGTH = 1200;
const RESULT_COUNT_REGEX = /^(\d[\d,]*)\s+rows?$/i;

let lastUrl = window.location.href;
let statusTimer = null;
let bridgeReady = false;
let bridgeSnapshot = null;
let sqlLabSidebarHidden = false;
let sidebarApplyFrame = null;
let networkSnapshotCache = {
  pageKey: "",
  snapshot: null,
  inflight: null,
};
let stableSnapshotState = {
  pageKey: "",
  snapshot: null,
};

injectPageBridge();
scheduleStatusSync();
observeDomChanges();
observeNavigation();

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.source !== PAGE_SOURCE) {
    return;
  }

  if (event.data.type === "BRIDGE_READY") {
    bridgeReady = true;
    bridgeSnapshot = normalizeIncomingSnapshot(event.data.payload?.sqlSnapshot);
    scheduleStatusSync();
  }

  if (event.data.type === "LOCATION_CHANGED") {
    lastUrl = window.location.href;
    bridgeSnapshot = null;
    resetSnapshotStateForLocation();
    scheduleStatusSync();
  }

  if (event.data.type === "SQL_SNAPSHOT") {
    bridgeSnapshot = normalizeIncomingSnapshot(event.data.payload);
    scheduleStatusSync();
  }

  if (event.data.type === "SUPERSET_NETWORK_EVENT") {
    void chrome.runtime.sendMessage({
      type: "SUPERSET_NETWORK_EVENT",
      event: event.data.payload,
    });
    scheduleStatusSync();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SET_SQLLAB_SCHEMA_PANEL_HIDDEN") {
    try {
      sqlLabSidebarHidden = Boolean(message.hidden);
      document.documentElement.dataset.sqvSqlLabSidebarHidden = sqlLabSidebarHidden ? "true" : "false";
      scheduleSidebarApply();
      scheduleStatusSync();
      sendResponse?.({ ok: true, hidden: sqlLabSidebarHidden });
    } catch (error) {
      sendResponse?.({ ok: false, error: String(error) });
    }

    return false;
  }

  if (message?.type !== "APPLY_EDITOR_HIGHLIGHT") {
    return false;
  }

  try {
    injectPageBridge();
    window.postMessage(
      {
        target: `${PAGE_SOURCE}:page-bridge`,
        type: "APPLY_EDITOR_HIGHLIGHT",
        payload: {
          ranges: Array.isArray(message.ranges) ? message.ranges : [],
        },
      },
      "*",
    );
    sendResponse?.({ ok: true });
  } catch (error) {
    sendResponse?.({ ok: false, error: String(error) });
  }

  return false;
});

function injectPageBridge() {
  // The bridge is injected by the background service worker into the page's MAIN world.
}

function observeDomChanges() {
  const observer = new MutationObserver(() => {
    if (sqlLabSidebarHidden) {
      scheduleSidebarApply();
    }

    scheduleStatusSync();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function observeNavigation() {
  window.setInterval(() => {
    if (window.location.href === lastUrl) {
      return;
    }

    lastUrl = window.location.href;
    scheduleStatusSync();
  }, URL_POLL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleStatusSync();
    }
  });
}

function scheduleStatusSync() {
  if (statusTimer !== null) {
    window.clearTimeout(statusTimer);
  }

  statusTimer = window.setTimeout(() => {
    statusTimer = null;
    void sendPageStatus();
  }, STATUS_DEBOUNCE_MS);
}

async function sendPageStatus() {
  const detection = detectSupersetSqlLab();
  const networkSnapshot = await collectNetworkSqlSnapshot(window.location.href);
  const sqlSnapshot = stabilizeSqlSnapshot(
    window.location.href,
    pickBestSnapshot([networkSnapshot, bridgeSnapshot, collectDomSqlSnapshot()]),
  );
  const resultRowCount = collectDomResultCount();

  try {
    await chrome.runtime.sendMessage({
      type: "PAGE_STATUS_UPDATED",
      url: window.location.href,
      title: document.title,
      bridgeReady,
      hasSqlSnapshot: Boolean(sqlSnapshot?.sql),
      sql: sqlSnapshot?.sql ?? "",
      sqlPreview: createSqlPreview(sqlSnapshot?.sql ?? ""),
      sqlSource: sqlSnapshot?.source ?? null,
      sqlLength: sqlSnapshot?.sql?.length ?? 0,
      sqlSelectionText: sqlSnapshot?.selectedText ?? "",
      sqlSelectionSource: sqlSnapshot?.source ?? null,
      sqlSelectionStart:
        typeof sqlSnapshot?.selectionStart === "number" ? sqlSnapshot.selectionStart : null,
      sqlSelectionEnd:
        typeof sqlSnapshot?.selectionEnd === "number" ? sqlSnapshot.selectionEnd : null,
      resultRowCount,
      sqlLabSidebarHidden,
      ...detection,
    });
  } catch (error) {
    console.debug("Unable to send page status update", error);
  }
}

function resetSnapshotStateForLocation() {
  const pageKey = buildPageKey(window.location.href);

  if (networkSnapshotCache.pageKey !== pageKey) {
    networkSnapshotCache = {
      pageKey,
      snapshot: null,
      inflight: null,
    };
  }

  if (stableSnapshotState.pageKey !== pageKey) {
    stableSnapshotState = {
      pageKey,
      snapshot: null,
    };
  }
}

function buildPageKey(url) {
  try {
    const parsed = new URL(String(url || ""));
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch (_error) {
    return String(url || "");
  }
}

async function collectNetworkSqlSnapshot(url) {
  if (!isBitbucketSourcePage(url)) {
    return null;
  }

  const pageKey = buildPageKey(url);

  if (networkSnapshotCache.pageKey === pageKey && networkSnapshotCache.snapshot) {
    return networkSnapshotCache.snapshot;
  }

  if (networkSnapshotCache.pageKey === pageKey && networkSnapshotCache.inflight) {
    return networkSnapshotCache.inflight;
  }

  const inflight = fetchBitbucketRawSqlSnapshot(url)
    .then((snapshot) => {
      networkSnapshotCache = {
        pageKey,
        snapshot,
        inflight: null,
      };
      return snapshot;
    })
    .catch(() => {
      networkSnapshotCache = {
        pageKey,
        snapshot: null,
        inflight: null,
      };
      return null;
    });

  networkSnapshotCache = {
    pageKey,
    snapshot: null,
    inflight,
  };

  return inflight;
}

function isBitbucketSourcePage(url) {
  try {
    const parsed = new URL(String(url || ""));
    return (
      parsed.hostname === "bitbucket.org" &&
      /^\/[^/]+\/[^/]+\/src\/[^/]+\/.+/.test(parsed.pathname) &&
      isLikelySqlFilePath(parsed.pathname)
    );
  } catch (_error) {
    return false;
  }
}

function isLikelySqlFilePath(pathname) {
  return /\.(sql|hql|ddl|dml|psql|pgsql|trino|dbt)$/i.test(String(pathname || ""));
}

function buildBitbucketRawUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/src\/([^/]+)\/(.+)$/);

    if (!match) {
      return "";
    }

    const [, workspace, repo, revision, filePath] = match;

    if (!filePath || !isLikelySqlFilePath(filePath)) {
      return "";
    }

    return `${parsed.origin}/${workspace}/${repo}/raw/${revision}/${filePath}`;
  } catch (_error) {
    return "";
  }
}

async function fetchBitbucketRawSqlSnapshot(url) {
  const rawUrl = buildBitbucketRawUrl(url);

  if (!rawUrl) {
    return null;
  }

  try {
    const response = await fetch(rawUrl, {
      credentials: "include",
    });

    if (!response.ok) {
      return null;
    }

    const sql = normalizeSql(await response.text());

    if (!sql || !SQL_KEYWORD_REGEX.test(sql)) {
      return null;
    }

    return {
      sql,
      source: "network:bitbucket:raw",
      isVisible: true,
      isFocused: true,
    };
  } catch (_error) {
    return null;
  }
}

function stabilizeSqlSnapshot(url, snapshot) {
  const pageKey = buildPageKey(url);
  const previous = stableSnapshotState.pageKey === pageKey ? stableSnapshotState.snapshot : null;
  let next = snapshot;

  if (previous) {
    if (
      previous.source === "network:bitbucket:raw" &&
      snapshot?.source !== "network:bitbucket:raw"
    ) {
      next = previous;
    } else if (
      isStructuredSnapshotSource(previous.source) &&
      isStructuredSnapshotSource(snapshot?.source) &&
      previous.sql.length >= (snapshot?.sql?.length || 0)
    ) {
      next = previous;
    }
  }

  stableSnapshotState = {
    pageKey,
    snapshot: next || null,
  };

  return next;
}

function isStructuredSnapshotSource(source) {
  const normalizedSource = String(source || "");
  return (
    normalizedSource.startsWith("dom:structured-code") ||
    normalizedSource.startsWith("bridge:structured-code")
  );
}

function detectSupersetSqlLab() {
  const href = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  const bodyText = (document.body?.innerText || "").slice(0, 2000).toLowerCase();
  const signals = [];
  const domSnapshot = collectDomSqlSnapshot();
  const sqlSnapshot = pickBestSnapshot([bridgeSnapshot, domSnapshot]);

  const hasSupersetUrl = href.includes("superset");
  const hasSqlLabPathHint = SQL_LAB_PATH_HINTS.some((hint) => href.includes(hint));
  const hasSqlLabTitle = title.includes("sql lab");
  const hasSqlLabText = bodyText.includes("sql lab");
  const hasSqlEditor =
    SQL_EDITOR_SELECTORS.some((selector) => queryAllBySelector(selector).length) ||
    Boolean(sqlSnapshot?.sql);

  if (hasSupersetUrl) {
    signals.push("url:superset");
  }
  if (hasSqlLabPathHint) {
    signals.push("url:sql-lab");
  }
  if (hasSqlLabTitle) {
    signals.push("title:sql-lab");
  }
  if (hasSqlLabText) {
    signals.push("text:sql-lab");
  }
  if (hasSqlEditor) {
    signals.push("dom:sql-editor");
  }
  if (bridgeReady) {
    signals.push("bridge:ready");
  }
  if (sqlSnapshot?.source) {
    signals.push(`sql:${sqlSnapshot.source}`);
  }
  if (typeof collectDomResultCount() === "number") {
    signals.push("dom:row-count");
  }

  const isSupersetLike = hasSupersetUrl || (hasSqlLabText && hasSqlEditor);
  const isSqlLab = hasSqlLabPathHint || hasSqlLabTitle || (hasSqlLabText && hasSqlEditor);

  return {
    isSupersetLike,
    isSqlLab,
    signals,
  };
}

function applySqlLabSidebarVisibility() {
  if (sqlLabSidebarHidden) {
    const sidebars = findAllSqlLabSidebarRoots();

    if (!sidebars.length) {
      return;
    }

    for (const sidebar of sidebars) {
      sidebar.dataset.sqvSidebarTarget = "true";
      sidebar.dataset.sqvSidebarHidden = "true";
      preserveInlineStyle(sidebar, "display");
      preserveInlineStyle(sidebar, "width");
      preserveInlineStyle(sidebar, "min-width");
      preserveInlineStyle(sidebar, "max-width");
      preserveInlineStyle(sidebar, "flex");
      preserveInlineStyle(sidebar, "overflow");
      preserveInlineStyle(sidebar, "padding");
      preserveInlineStyle(sidebar, "margin");
      sidebar.style.setProperty("display", "none", "important");
      sidebar.style.setProperty("width", "0", "important");
      sidebar.style.setProperty("min-width", "0", "important");
      sidebar.style.setProperty("max-width", "0", "important");
      sidebar.style.setProperty("flex", "0 0 0", "important");
      sidebar.style.setProperty("overflow", "hidden", "important");
      sidebar.style.setProperty("padding", "0", "important");
      sidebar.style.setProperty("margin", "0", "important");
    }
  } else {
    restoreHiddenSqlLabSidebarTargets();
  }
}

function scheduleSidebarApply() {
  if (sidebarApplyFrame !== null) {
    window.cancelAnimationFrame(sidebarApplyFrame);
  }

  sidebarApplyFrame = window.requestAnimationFrame(() => {
    sidebarApplyFrame = null;
    applySqlLabSidebarVisibility();
  });
}

function findSqlLabSidebarRoot() {
  return findAllSqlLabSidebarRoots()[0] || null;
}

function findAllSqlLabSidebarRoots() {
  const paneCandidates = [];
  const candidateSeen = new Set();

  const existingTargets = document.querySelectorAll("[data-sqv-sidebar-target='true']");

  for (const element of existingTargets) {
    if (element instanceof HTMLElement) {
      pushUnique(paneCandidates, candidateSeen, element);
    }
  }

  const labelBasedPanel = findSqlLabSidebarByLabelAncestry();

  if (labelBasedPanel) {
    pushUnique(paneCandidates, candidateSeen, labelBasedPanel);
  }

  const directSelectors = [
    "[data-test='sql-lab-left-sidebar']",
    "[data-test='sql-lab-side-panel']",
    "[data-test='left-sidebar']",
    ".sql-lab-sidebar",
    ".SqlLab .TableSelector",
  ];

  for (const selector of directSelectors) {
    const element = document.querySelector(selector);

    if (element instanceof HTMLElement) {
      pushUnique(paneCandidates, candidateSeen, findSidebarContainer(element));
    }
  }

  const anchors = Array.from(
    document.querySelectorAll("label, span, div, p, h2, h3, h4"),
  ).filter((element) => {
    const text = normalizeLabelText(element.textContent || "");
    return (
      text === "database" ||
      text === "schema" ||
      text === "see table schema" ||
      text === "select schema or type to search schemas" ||
      text === "select table or type to search"
    );
  });

  if (!anchors.length) {
    return results;
  }

  const candidates = new Map();

  for (const anchor of anchors) {
    let current = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
    let depth = 0;

    while (current && current !== document.body && depth < 8) {
      const rect = current.getBoundingClientRect();
      const text = normalizeLabelText(current.textContent || "");
      const controlCount = current.querySelectorAll("input, textarea, select, [role='combobox']").length;
      const matchScore =
        Number(text.includes("database")) +
        Number(text.includes("schema")) +
        Number(text.includes("see table schema"));

      if (
        rect.width >= 220 &&
        rect.width <= Math.min(window.innerWidth * 0.42, 520) &&
        rect.height >= 240 &&
        rect.left <= window.innerWidth * 0.35 &&
        controlCount >= 2
      ) {
        const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
        const existing = candidates.get(key);
        const score = matchScore * 10 + controlCount - depth;

        if (!existing || score > existing.score) {
          candidates.set(key, {
            element: current,
            score,
          });
        }
      }

      current = current.parentElement;
      depth += 1;
    }
  }

  const best = Array.from(candidates.values()).sort((left, right) => right.score - left.score)[0];
  if (best?.element instanceof HTMLElement) {
    pushUnique(paneCandidates, candidateSeen, findSidebarContainer(best.element));
  }

  const results = [];
  const seen = new Set();

  for (const candidate of paneCandidates) {
    for (const target of expandSidebarTargets(candidate)) {
      pushUnique(results, seen, target);
    }
  }

  return results;
}

function findSqlLabSidebarByLabelAncestry() {
  const databaseLabel = Array.from(document.querySelectorAll("label")).find((element) => {
    return normalizeLabelText(element.textContent || "") === "database";
  });

  if (!(databaseLabel instanceof HTMLElement)) {
    return null;
  }

  let node = databaseLabel;
  let best = null;

  while (node && node !== document.body) {
    const rect = node.getBoundingClientRect();
    const text = normalizeLabelText(node.innerText || "");

    if (
      rect.left < 80 &&
      rect.width > 220 &&
      rect.width < 720 &&
      text.includes("database") &&
      text.includes("schema")
    ) {
      best = node;
    }

    node = node.parentElement;
  }

  return best ? findSidebarContainer(best) : null;
}

function findSidebarContainer(element) {
  let current = element;
  let depth = 0;
  let candidate = findLayoutPane(element)?.pane || promoteToLayoutColumn(element) || element;

  while (current && current !== document.body && depth < 6) {
    const rect = current.getBoundingClientRect();
    const text = normalizeLabelText(current.innerText || "");
    const parent = current.parentElement;
    const hasEditorSibling = parent ? findEditorSibling(parent, current) : false;

    if (
      rect.width >= 220 &&
      rect.width <= Math.min(window.innerWidth * 0.48, 700) &&
      rect.height >= 240 &&
      rect.left <= window.innerWidth * 0.35 &&
      (text.includes("database") && text.includes("schema")) &&
      (hasEditorSibling || depth === 0)
    ) {
      candidate = findLayoutPane(current)?.pane || promoteToLayoutColumn(current) || current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return candidate;
}

function promoteToLayoutColumn(element) {
  let current = element;
  let depth = 0;
  let best = null;

  while (current && current !== document.body && depth < 8) {
    const parent = current.parentElement;

    if (!parent) {
      break;
    }

    const siblings = Array.from(parent.children).filter(
      (child) => child !== current && child instanceof HTMLElement,
    );
    const hasEditorSibling = siblings.some((sibling) => containsEditorSurface(sibling));
    const rect = current.getBoundingClientRect();

    if (
      hasEditorSibling &&
      rect.left <= window.innerWidth * 0.35 &&
      rect.width >= 220 &&
      rect.width <= Math.min(window.innerWidth * 0.48, 720)
    ) {
      best = current;
    }

    current = parent;
    depth += 1;
  }

  return best;
}

function expandSidebarTargets(element) {
  const layoutPane = findLayoutPane(element);

  if (!layoutPane) {
    return [element];
  }

  return [layoutPane.pane, ...layoutPane.splitters];
}

function findLayoutPane(element) {
  let current = element;
  let depth = 0;
  let best = null;

  while (current && current !== document.body && depth < 12) {
    const parent = current.parentElement;

    if (!parent) {
      break;
    }

    const children = Array.from(parent.children).filter(
      (child) => child instanceof HTMLElement,
    );

    if (children.length >= 2) {
      const editorSibling = children.find(
        (child) => child !== current && containsEditorSurface(child),
      );
      const currentRect = current.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();

      if (
        editorSibling &&
        currentRect.left <= window.innerWidth * 0.42 &&
        currentRect.width >= 180 &&
        currentRect.width <= Math.min(window.innerWidth * 0.55, 760) &&
        currentRect.height >= 220 &&
        parentRect.width >= currentRect.width + 360
      ) {
        best = {
          pane: current,
          splitters: findSplittersBetween(parent, current, editorSibling),
        };
      }
    }

    current = parent;
    depth += 1;
  }

  return best;
}

function findSplittersBetween(parent, leftPane, rightPane) {
  const children = Array.from(parent.children).filter(
    (child) => child instanceof HTMLElement,
  );
  const leftIndex = children.indexOf(leftPane);
  const rightIndex = children.indexOf(rightPane);

  if (leftIndex === -1 || rightIndex === -1 || leftIndex === rightIndex) {
    return [];
  }

  const start = Math.min(leftIndex, rightIndex) + 1;
  const end = Math.max(leftIndex, rightIndex);
  const between = children.slice(start, end);
  const splitters = between.filter((child) => isLikelySplitter(child));

  if (splitters.length) {
    return splitters;
  }

  const adjacent = [];
  const neighborCandidates = [
    children[leftIndex - 1],
    children[leftIndex + 1],
  ];

  for (const candidate of neighborCandidates) {
    if (candidate instanceof HTMLElement && isLikelySplitter(candidate)) {
      adjacent.push(candidate);
    }
  }

  return adjacent;
}

function isLikelySplitter(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const className = String(element.className || "").toLowerCase();
  const style = window.getComputedStyle(element);
  const text = normalizeLabelText(element.innerText || "");

  if (rect.height < 160) {
    return false;
  }

  if (rect.width > 40) {
    return false;
  }

  return (
    className.includes("resize") ||
    className.includes("resizer") ||
    className.includes("splitter") ||
    className.includes("gutter") ||
    style.cursor.includes("resize") ||
    style.cursor.includes("col-resize") ||
    text.length === 0
  );
}

function normalizeLabelText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findEditorSibling(parent, current) {
  const siblings = Array.from(parent.children).filter(
    (element) => element !== current && element instanceof HTMLElement,
  );

  return siblings.some((sibling) => containsEditorSurface(sibling));
}

function containsEditorSurface(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  if (rect.width < 320 || rect.height < 220) {
    return false;
  }

  if (SQL_EDITOR_SELECTORS.some((selector) => element.matches?.(selector) || element.querySelector(selector))) {
    return true;
  }

  const text = normalizeLabelText(element.innerText || "");
  return (
    text.includes("run") ||
    text.includes("results") ||
    text.includes("query history") ||
    text.includes("limit")
  );
}

function preserveInlineStyle(element, propertyName) {
  const key = `sqvOriginal${toDatasetSuffix(propertyName)}`;

  if (!(key in element.dataset)) {
    element.dataset[key] = element.style.getPropertyValue(propertyName) || "";
  }
}

function restoreHiddenSqlLabSidebarTargets() {
  const targets = document.querySelectorAll("[data-sqv-sidebar-target='true']");

  for (const target of targets) {
    if (!(target instanceof HTMLElement)) {
      continue;
    }

    restoreInlineStyle(target, "display");
    restoreInlineStyle(target, "width");
    restoreInlineStyle(target, "min-width");
    restoreInlineStyle(target, "max-width");
    restoreInlineStyle(target, "flex");
    restoreInlineStyle(target, "overflow");
    restoreInlineStyle(target, "padding");
    restoreInlineStyle(target, "margin");
    delete target.dataset.sqvSidebarHidden;
    delete target.dataset.sqvSidebarTarget;
  }
}

function restoreInlineStyle(element, propertyName) {
  const key = `sqvOriginal${toDatasetSuffix(propertyName)}`;
  const value = element.dataset[key];

  if (typeof value !== "string") {
    element.style.removeProperty(propertyName);
    return;
  }

  if (value) {
    element.style.setProperty(propertyName, value);
  } else {
    element.style.removeProperty(propertyName);
  }

  delete element.dataset[key];
}

function toDatasetSuffix(propertyName) {
  return propertyName
    .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function pushUnique(list, seen, element) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const key = buildElementKey(element);

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  list.push(element);
}

function buildElementKey(element) {
  const rect = element.getBoundingClientRect();
  return `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
}

function queryAllBySelector(selector) {
  const directMatches = Array.from(document.querySelectorAll(selector));

  if (directMatches.length) {
    return directMatches;
  }

  const shadowRoots = collectOpenShadowRoots();

  if (!shadowRoots.length) {
    return [];
  }

  return queryAllBySelectorInRoots(shadowRoots, selector);
}

function collectOpenShadowRoots() {
  const roots = [];
  const seen = new Set();
  const stack = [];

  if (document.documentElement) {
    stack.push(document.documentElement);
  }

  while (stack.length) {
    const current = stack.pop();

    if (!(current instanceof Element)) {
      continue;
    }

    if (current.shadowRoot && !seen.has(current.shadowRoot)) {
      seen.add(current.shadowRoot);
      roots.push(current.shadowRoot);

      for (const nestedElement of current.shadowRoot.querySelectorAll("*")) {
        stack.push(nestedElement);
      }
    }

    for (const child of current.children || []) {
      stack.push(child);
    }
  }

  return roots;
}

function queryAllBySelectorInRoots(roots, selector) {
  const matches = [];
  const seen = new Set();

  for (const root of roots) {
    for (const element of root.querySelectorAll(selector)) {
      pushUniqueElement(matches, seen, element);
    }
  }

  return matches;
}

function pushUniqueElement(list, seen, element) {
  if (!(element instanceof Element) || seen.has(element)) {
    return;
  }

  seen.add(element);
  list.push(element);
}

function collectDomSqlSnapshot() {
  const candidates = [];
  const seen = new Set();

  for (const selector of SQL_EDITOR_SELECTORS) {
    for (const element of queryAllBySelector(selector)) {
      if (seen.has(element)) {
        continue;
      }

      seen.add(element);
      const sql = normalizeSql(extractElementText(element));

      if (!sql) {
        continue;
      }

      candidates.push({
        sql,
        source: describeDomSnapshotSource(element, selector),
        isVisible: isElementVisible(element),
        isFocused: isElementFocused(element),
      });
    }
  }

  if (!candidates.some((candidate) => SQL_KEYWORD_REGEX.test(candidate.sql))) {
    candidates.push(...collectStructuredCodeSnapshots());
  }

  return pickBestSnapshot(candidates);
}

function collectStructuredCodeSnapshots() {
  const containers = [];
  const seen = new Set();

  for (const selector of STRUCTURED_CODE_CONTAINER_SELECTORS) {
    for (const element of queryAllBySelector(selector)) {
      pushUniqueElement(containers, seen, element);
    }
  }

  if (!containers.length) {
    for (const selector of ["table", "[role='table']", "ol"]) {
      for (const element of queryAllBySelector(selector)) {
        if (looksLikeStructuredCodeContainer(element)) {
          pushUniqueElement(containers, seen, element);
        }
      }
    }
  }

  return containers
    .map((container) => {
      const sql = normalizeSql(extractStructuredCodeText(container));

      if (!isLikelyStructuredSql(sql)) {
        return null;
      }

      return {
        sql,
        source: describeStructuredCodeSource(container),
        isVisible: isElementVisible(container),
        isFocused: isElementFocused(container),
      };
    })
    .filter(Boolean);
}

function looksLikeStructuredCodeContainer(element) {
  if (!(element instanceof Element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  if (rect.width < 180 || rect.height < 60) {
    return false;
  }

  const descriptor = [
    element.id,
    element.className,
    element.getAttribute("data-testid"),
    element.getAttribute("data-qa"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    /code|source|diff|file/.test(descriptor) ||
    Boolean(element.querySelector("code, pre, .react-code-text, .blob-code-inner, .diff-line-pre"))
  );
}

function extractStructuredCodeText(container) {
  const preferredLines = collectStructuredLineTexts(container, STRUCTURED_CODE_LINE_SELECTORS);

  if (preferredLines.length >= 3) {
    return preferredLines.join("\n");
  }

  const rowLines = collectStructuredRowTexts(container);

  if (rowLines.length >= 3) {
    return rowLines.join("\n");
  }

  return "";
}

function collectStructuredLineTexts(container, selectors) {
  const lines = [];
  const seen = new Set();

  for (const selector of selectors) {
    for (const element of container.querySelectorAll(selector)) {
      if (seen.has(element)) {
        continue;
      }

      seen.add(element);
      const text = normalizeStructuredLineText(element.textContent || "");

      if (text) {
        lines.push(text);
      }
    }
  }

  return lines;
}

function collectStructuredRowTexts(container) {
  const lines = [];

  for (const row of container.querySelectorAll("tr, [role='row'], li")) {
    const codeCell =
      row.querySelector(
        ".react-code-text, .blob-code-inner, .diff-line-pre, code, pre, td:last-child, [role='cell']:last-child",
      ) || row;
    const text = normalizeStructuredLineText(codeCell.textContent || "");

    if (text) {
      lines.push(text);
    }
  }

  return lines;
}

function normalizeStructuredLineText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .trim();
}

function isLikelyStructuredSql(sql) {
  if (!sql || sql.length < 24) {
    return false;
  }

  const lineCount = sql.split("\n").filter(Boolean).length;
  return lineCount >= 3 && SQL_KEYWORD_REGEX.test(sql);
}

function describeDomSnapshotSource(element, fallbackSelector) {
  if (element.matches?.(".CodeMirror, .CodeMirror-code")) {
    return "dom:codemirror";
  }

  if (element.matches?.(".cm-editor, .cm-content")) {
    return "dom:codemirror6";
  }

  if (element.matches?.(".monaco-editor textarea, .monaco-editor .view-lines")) {
    return "dom:monaco";
  }

  if (element.matches?.("pre code")) {
    return "dom:pre-code";
  }

  return `dom:${fallbackSelector}`;
}

function describeStructuredCodeSource(element) {
  const descriptor = [
    element.getAttribute("data-testid"),
    element.getAttribute("data-qa"),
    element.className,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (descriptor.includes("diff")) {
    return "dom:structured-code:diff";
  }

  if (descriptor.includes("source")) {
    return "dom:structured-code:source";
  }

  if (descriptor.includes("file")) {
    return "dom:structured-code:file";
  }

  return "dom:structured-code";
}

function extractElementText(element) {
  if (!element) {
    return "";
  }

  if (typeof element.value === "string") {
    return element.value;
  }

  if (element.matches?.(".CodeMirror")) {
    return element.CodeMirror?.getValue?.() || element.textContent || "";
  }

  if (element.matches?.("pre code")) {
    return element.textContent || "";
  }

  return element.textContent || "";
}

function normalizeIncomingSnapshot(payload) {
  if (!payload || typeof payload.sql !== "string") {
    return null;
  }

  const sql = normalizeSql(payload.sql);

  if (!sql) {
    return null;
  }

  return {
    sql,
    source: payload.source || "bridge",
    selectedText: normalizeSql(payload.selectedText || ""),
    selectionStart:
      typeof payload.selectionStart === "number" ? payload.selectionStart : null,
    selectionEnd: typeof payload.selectionEnd === "number" ? payload.selectionEnd : null,
  };
}

function normalizeSql(sql) {
  if (typeof sql !== "string") {
    return "";
  }

  return sql.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function pickBestSnapshot(candidates) {
  const valid = candidates
    .filter((candidate) => candidate && typeof candidate.sql === "string" && candidate.sql.trim())
    .map((candidate) => ({
      sql: normalizeSql(candidate.sql),
      source: candidate.source || "unknown",
      selectedText: normalizeSql(candidate.selectedText || ""),
      selectionStart:
        typeof candidate.selectionStart === "number" ? candidate.selectionStart : null,
      selectionEnd: typeof candidate.selectionEnd === "number" ? candidate.selectionEnd : null,
      isVisible: Boolean(candidate.isVisible),
      isFocused: Boolean(candidate.isFocused),
      score: scoreSnapshot(candidate),
    }))
    .filter((candidate) => candidate.sql);

  if (!valid.length) {
    return null;
  }

  valid.sort((left, right) => right.score - left.score);
  const selectedCandidate = valid.find((candidate) => candidate.selectedText);

  return {
    sql: valid[0].sql,
    source: valid[0].source,
    selectedText: selectedCandidate?.selectedText || valid[0].selectedText,
    selectionStart: selectedCandidate?.selectionStart ?? valid[0].selectionStart ?? null,
    selectionEnd: selectedCandidate?.selectionEnd ?? valid[0].selectionEnd ?? null,
  };
}

function scoreSnapshot(candidate, fallbackSource) {
  const sql = typeof candidate === "object" ? candidate.sql || "" : candidate || "";
  let score = Math.min(sql.length, 4000);
  const source = typeof candidate === "object" ? candidate.source || "unknown" : fallbackSource || "unknown";
  const isVisible = typeof candidate === "object" ? Boolean(candidate.isVisible) : false;
  const isFocused = typeof candidate === "object" ? Boolean(candidate.isFocused) : false;

  if (SQL_KEYWORD_REGEX.test(sql)) {
    score += 5000;
  }
  if (sql.includes("\n")) {
    score += 250;
  }
  if (source.startsWith("bridge:monaco")) {
    score += 1500;
  }
  if (source.startsWith("bridge:ace")) {
    score += 1800;
  }
  if (source.startsWith("bridge:")) {
    score += 1000;
  }
  if (source.startsWith("network:bitbucket:raw")) {
    score += 9000;
  }
  if (source.startsWith("dom:structured-code")) {
    score += 1100;
  }
  if (source.startsWith("dom:[data-test='sql-editor']")) {
    score += 800;
  }
  if (isVisible) {
    score += 1600;
  }
  if (isFocused) {
    score += 2400;
  }

  return score;
}

function isElementVisible(element) {
  if (!element || !element.getBoundingClientRect) {
    return false;
  }

  const style = window.getComputedStyle?.(element);
  if (!style || style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isElementFocused(element) {
  if (!element) {
    return false;
  }

  const active = document.activeElement;
  return Boolean(active && (active === element || element.contains?.(active)));
}

function createSqlPreview(sql) {
  if (!sql) {
    return "";
  }

  if (sql.length <= MAX_SQL_PREVIEW_LENGTH) {
    return sql;
  }

  return `${sql.slice(0, MAX_SQL_PREVIEW_LENGTH)}\n...`;
}

function collectDomResultCount() {
  if (!document.body) {
    return null;
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();

  while (current) {
    const text = normalizeSql(current.textContent || "");
    const match = text.match(RESULT_COUNT_REGEX);

    if (match && isVisibleElement(current.parentElement)) {
      const value = Number(match[1].replace(/,/g, ""));

      if (Number.isFinite(value)) {
        return value;
      }
    }

    current = walker.nextNode();
  }

  return null;
}

function isVisibleElement(element) {
  if (!element) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

}

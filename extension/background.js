import { analyzeSql } from "./sql-analysis.js";

const PANEL_PATH = "sidepanel.html";
const SESSION_PREFIX = "tab:";
const ORIGIN_PREF_PREFIX = "origin-pref:";
const EXECUTION_EVENT_LIMIT = 12;
const SESSION_WAIT_TIMEOUT_MS = 1200;
const SESSION_WAIT_STEP_MS = 120;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await refreshSidePanelAvailability();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshSidePanelAvailability();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void syncSidePanelForTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof changeInfo.url === "string") {
    void clearTabSession(tabId);
  }

  if (typeof changeInfo.url === "string" || changeInfo.status === "loading" || changeInfo.status === "complete") {
    void syncSidePanelForTab(tabId, tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabSession(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PAGE_STATUS_UPDATED") {
    void handlePageStatusUpdated(message, sender).then(
      (session) => sendResponse({ ok: true, session }),
      (error) => {
        console.error("Failed to update page status", error);
        sendResponse({ ok: false, error: String(error) });
      },
    );

    return true;
  }

  if (message?.type === "GET_TAB_SESSION") {
    void getTabSessionForSidePanel(message.tabId).then(
      (session) => sendResponse({ ok: true, session }),
      (error) => {
        console.error("Failed to fetch tab session", error);
        sendResponse({ ok: false, error: String(error) });
      },
    );

    return true;
  }

  if (message?.type === "SUPERSET_NETWORK_EVENT") {
    void handleNetworkEvent(message, sender).then(
      (session) => sendResponse({ ok: true, session }),
      (error) => {
        console.error("Failed to handle network event", error);
        sendResponse({ ok: false, error: String(error) });
      },
    );

    return true;
  }

  if (message?.type === "SET_ANALYSIS_DIALECT") {
    void handleSetAnalysisDialect(message).then(
      (session) => sendResponse({ ok: true, session }),
      (error) => {
        console.error("Failed to update analysis dialect", error);
        sendResponse({ ok: false, error: String(error) });
      },
    );

    return true;
  }

  if (message?.type === "CAPTURE_SELECTION_SQL") {
    void handleCaptureSelectionSql(message, sender).then(
      (session) => sendResponse({ ok: true, session }),
      (error) => {
        console.error("Failed to capture selection SQL", error);
        sendResponse({ ok: false, error: String(error) });
      },
    );

    return true;
  }

  if (message?.type === "CLEAR_CAPTURED_SQL") {
    void handleClearCapturedSql(message).then(
      (session) => sendResponse({ ok: true, session }),
      (error) => {
        console.error("Failed to clear captured SQL", error);
        sendResponse({ ok: false, error: String(error) });
      },
    );

    return true;
  }

  if (message?.type === "SET_SQLLAB_SCHEMA_PANEL_HIDDEN") {
    void handleSetSqlLabSchemaPanelHidden(message).then(
      (session) => sendResponse({ ok: true, session }),
      (error) => {
        console.error("Failed to toggle SQL Lab schema panel", error);
        sendResponse({ ok: false, error: String(error) });
      },
    );

    return true;
  }

  if (message?.type === "ENABLE_SITE_ACCESS") {
    void handleEnableSiteAccess(message).then(
      (session) => sendResponse({ ok: true, session }),
      (error) => {
        console.error("Failed to enable site access", error);
        sendResponse({ ok: false, error: String(error) });
      },
    );

    return true;
  }

  if (message?.type === "DISABLE_SITE_ACCESS") {
    void handleDisableSiteAccess(message).then(
      (session) => sendResponse({ ok: true, session }),
      (error) => {
        console.error("Failed to disable site access", error);
        sendResponse({ ok: false, error: String(error) });
      },
    );

    return true;
  }

  return false;
});

async function handlePageStatusUpdated(message, sender) {
  const tabId = sender.tab?.id ?? message.tabId;

  if (typeof tabId !== "number") {
    throw new Error("Missing tab id");
  }

  const previous = await getTabSession(tabId);
  const resolvedUrl = sender.tab?.url ?? message.url ?? previous?.url ?? "";
  const sqlLabSidebarHidden = await getSqlLabSidebarHiddenPreference(resolvedUrl);
  const next = {
    ...previous,
    tabId,
    url: resolvedUrl,
    title: sender.tab?.title ?? message.title ?? previous?.title ?? "",
    isSupersetLike: Boolean(message.isSupersetLike),
    isSqlLab: Boolean(message.isSqlLab),
    signals: Array.isArray(message.signals) ? message.signals : [],
    bridgeReady: Boolean(message.bridgeReady),
    hasSqlSnapshot: Boolean(message.hasSqlSnapshot),
    sql: typeof message.sql === "string" ? message.sql : previous?.sql ?? "",
    sqlPreview:
      typeof message.sqlPreview === "string" ? message.sqlPreview : previous?.sqlPreview ?? "",
    sqlSource:
      typeof message.sqlSource === "string" ? message.sqlSource : previous?.sqlSource ?? "",
    sqlLength:
      typeof message.sqlLength === "number" ? message.sqlLength : previous?.sqlLength ?? 0,
    sqlUpdatedAt: typeof message.sql === "string" ? Date.now() : previous?.sqlUpdatedAt ?? null,
    sqlSelectionText:
      typeof message.sqlSelectionText === "string"
        ? message.sqlSelectionText
        : previous?.sqlSelectionText ?? "",
    sqlSelectionSource:
      typeof message.sqlSelectionSource === "string"
        ? message.sqlSelectionSource
        : previous?.sqlSelectionSource ?? "",
    sqlSelectionUpdatedAt:
      typeof message.sqlSelectionText === "string"
        ? Date.now()
        : previous?.sqlSelectionUpdatedAt ?? null,
    sqlSelectionStart:
      typeof message.sqlSelectionStart === "number"
        ? message.sqlSelectionStart
        : message.sqlSelectionStart === null
          ? null
          : previous?.sqlSelectionStart ?? null,
    sqlSelectionEnd:
      typeof message.sqlSelectionEnd === "number"
        ? message.sqlSelectionEnd
        : message.sqlSelectionEnd === null
          ? null
          : previous?.sqlSelectionEnd ?? null,
    resultRowCount:
      typeof message.resultRowCount === "number"
        ? message.resultRowCount
        : previous?.resultRowCount ?? null,
    analysisDialectPreference:
      typeof previous?.analysisDialectPreference === "string"
        ? previous.analysisDialectPreference
        : "auto",
    capturedSql: previous?.capturedSql || "",
    capturedSqlPreview: previous?.capturedSqlPreview || "",
    capturedSqlSource: previous?.capturedSqlSource || "",
    capturedSqlLength: previous?.capturedSqlLength || 0,
    capturedSqlUpdatedAt: previous?.capturedSqlUpdatedAt || null,
    sqlLabSidebarHidden,
    updatedAt: Date.now(),
  };

  await applySiteAccessState(next, resolvedUrl);

  if (!next.siteAccessGranted && !normalizeSql(next.capturedSql)) {
    const tab = sender.tab || (await chrome.tabs.get(tabId).catch(() => null));
    const fallback = buildTabAccessSession(tab, next, false);
    await chrome.storage.session.set({ [sessionKey(tabId)]: fallback });
    await updateSidePanelForTab(tabId, shouldEnableSidePanel(fallback));
    notifySessionUpdated(fallback);
    return fallback;
  }

  applyAnalysisInputState(next);

  if (typeof next.resultRowCount === "number") {
    next.execution = mergeExecution(previous?.execution, {
      source: "dom",
      phase: "snapshot",
      kind: "results",
      url: next.url,
      method: "GET",
      timestamp: Date.now(),
      request: null,
      response: {
        httpStatus: null,
        ok: true,
        queryId: null,
        status: null,
        rowCount: next.resultRowCount,
        errorMessage: null,
      },
      errorMessage: null,
    });
  }

  next.analysis = await buildAnalysis(
    resolveAnalysisInputSql(next),
    previous?.analysis,
    next.sqlUpdatedAt,
    next.analysisDialectPreference,
  );

  await chrome.storage.session.set({ [sessionKey(tabId)]: next });
  await updateSidePanelForTab(tabId, shouldEnableSidePanel(next));
  if (Boolean(message.sqlLabSidebarHidden) !== sqlLabSidebarHidden) {
    await sendSqlLabSidebarHiddenToTab(tabId, sqlLabSidebarHidden);
  }
  notifySessionUpdated(next);

  return next;
}

async function handleNetworkEvent(message, sender) {
  const tabId = sender.tab?.id ?? message.tabId;

  if (typeof tabId !== "number") {
    throw new Error("Missing tab id");
  }

  const previous = await getTabSession(tabId);
  const event = normalizeNetworkEvent(message.event);
  const resolvedUrl = sender.tab?.url ?? previous?.url ?? "";
  const sqlLabSidebarHidden = await getSqlLabSidebarHiddenPreference(resolvedUrl);
  const next = {
    ...previous,
    tabId,
    url: resolvedUrl,
    title: sender.tab?.title ?? previous?.title ?? "",
    execution: mergeExecution(previous?.execution, event),
    executionEvents: mergeExecutionEvents(previous?.executionEvents, event),
    analysisDialectPreference:
      typeof previous?.analysisDialectPreference === "string"
        ? previous.analysisDialectPreference
        : "auto",
    capturedSql: previous?.capturedSql || "",
    capturedSqlPreview: previous?.capturedSqlPreview || "",
    capturedSqlSource: previous?.capturedSqlSource || "",
    capturedSqlLength: previous?.capturedSqlLength || 0,
    capturedSqlUpdatedAt: previous?.capturedSqlUpdatedAt || null,
    sqlLabSidebarHidden,
    updatedAt: Date.now(),
  };

  await applySiteAccessState(next, resolvedUrl);

  if (!next.siteAccessGranted && !normalizeSql(next.capturedSql)) {
    const tab = sender.tab || (await chrome.tabs.get(tabId).catch(() => null));
    const fallback = buildTabAccessSession(tab, next, false);
    await chrome.storage.session.set({ [sessionKey(tabId)]: fallback });
    await updateSidePanelForTab(tabId, shouldEnableSidePanel(fallback));
    notifySessionUpdated(fallback);
    return fallback;
  }

  const sqlFromEvent = normalizeSql(event.request?.sql);

  if (sqlFromEvent) {
    next.sql = sqlFromEvent;
    next.sqlPreview = createSqlPreview(sqlFromEvent);
    next.sqlSource = previous?.sqlSource || `network:${event.kind}`;
    next.sqlLength = sqlFromEvent.length;
    next.sqlUpdatedAt = Date.now();
  }

  applyAnalysisInputState(next);

  next.analysis = await buildAnalysis(
    resolveAnalysisInputSql(next),
    previous?.analysis,
    next.sqlUpdatedAt,
    next.analysisDialectPreference,
  );

  await chrome.storage.session.set({ [sessionKey(tabId)]: next });
  await updateSidePanelForTab(tabId, shouldEnableSidePanel(next));
  notifySessionUpdated(next);

  return next;
}

async function getTabSession(tabId) {
  if (typeof tabId !== "number") {
    return null;
  }

  const key = sessionKey(tabId);
  const data = await chrome.storage.session.get(key);
  const session = data[key] ?? null;

  if (!session) {
    return null;
  }

  const next = applyAnalysisInputState(session);
  next.sqlLabSidebarHidden = await getSqlLabSidebarHiddenPreference(next?.url);
  await applySiteAccessState(next, next?.url);

  if (!next.siteAccessGranted && !normalizeSql(next.capturedSql)) {
    next.bridgeReady = false;
    next.hasSqlSnapshot = false;
    next.sql = "";
    next.sqlPreview = "";
    next.sqlSource = "";
    next.sqlLength = 0;
    next.sqlUpdatedAt = null;
    next.sqlSelectionText = "";
    next.sqlSelectionSource = "";
    next.sqlSelectionUpdatedAt = null;
    next.sqlSelectionStart = null;
    next.sqlSelectionEnd = null;
    next.resultRowCount = null;
    next.execution = null;
    next.executionEvents = [];
    next.analysis = null;
    applyAnalysisInputState(next);
  }

  return next;
}

async function getTabSessionForSidePanel(tabId) {
  if (typeof tabId !== "number") {
    return null;
  }

  const tab = await chrome.tabs.get(tabId);
  const existing = await getTabSession(tabId);
  const accessGranted = await hasSiteAccessForUrl(tab?.url);

  if (!accessGranted) {
    const next = buildTabAccessSession(tab, existing, false);
    await updateSidePanelForTab(tabId, shouldEnableSidePanel(next));
    return next;
  }

  if (existing) {
    if (existing.isSqlLab) {
      await sendSqlLabSidebarHiddenToTab(tabId, Boolean(existing.sqlLabSidebarHidden));
    }
    return existing;
  }

  await ensureTabObserverInjected(tabId);
  const session = await waitForTabSession(tabId, SESSION_WAIT_TIMEOUT_MS);

  if (session) {
    if (session.isSqlLab) {
      await sendSqlLabSidebarHiddenToTab(tabId, Boolean(session.sqlLabSidebarHidden));
    }
    return session;
  }

  const fallback = buildTabAccessSession(tab, null, true);
  notifySessionUpdated(fallback);
  return fallback;
}

async function ensureTabObserverInjected(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);

    if (!isSupportedPageUrl(tab?.url || "")) {
      return;
    }

    if (!(await hasSiteAccessForUrl(tab?.url))) {
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (error) {
    console.debug("Unable to inject content script into tab", error);
  }
}

async function waitForTabSession(tabId, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const session = await getTabSession(tabId);

    if (session) {
      return session;
    }

    await sleep(SESSION_WAIT_STEP_MS);
  }

  return getTabSession(tabId);
}

async function updateSidePanelForTab(tabId, enabled) {
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: PANEL_PATH,
      enabled,
    });
  } catch (error) {
    console.warn("Failed to update side panel state", error);
  }
}

function shouldEnableSidePanel(session) {
  return Boolean(isSupportedPageUrl(session?.url) || normalizeSql(session?.activeSql));
}

function isSupportedPageUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

async function handleEnableSiteAccess(message) {
  const tabId = message?.tabId;

  if (typeof tabId !== "number") {
    throw new Error("Missing tab id");
  }

  await syncSidePanelForTab(tabId);
  await ensureTabObserverInjected(tabId);

  const session = await waitForTabSession(tabId, SESSION_WAIT_TIMEOUT_MS);
  if (session) {
    notifySessionUpdated(session);
    return session;
  }

  const tab = await chrome.tabs.get(tabId);
  const fallback = buildTabAccessSession(tab, null, true);
  notifySessionUpdated(fallback);
  return fallback;
}

async function handleDisableSiteAccess(message) {
  const tabId = message?.tabId;

  if (typeof tabId !== "number") {
    throw new Error("Missing tab id");
  }

  const tab = await chrome.tabs.get(tabId);
  const pattern = getSitePermissionPattern(tab?.url);

  if (!pattern) {
    throw new Error("Missing site permission pattern");
  }

  await chrome.permissions.remove({
    origins: [pattern],
  });

  const origin = getOriginFromUrl(tab?.url);
  const tabs = await chrome.tabs.query({});
  const matchingTabs = tabs.filter((candidate) => getOriginFromUrl(candidate.url) === origin);

  for (const matchingTab of matchingTabs) {
    if (typeof matchingTab.id !== "number") {
      continue;
    }

    const session = await getTabSession(matchingTab.id);
    const next = buildTabAccessSession(matchingTab, session, false);
    await chrome.storage.session.set({ [sessionKey(matchingTab.id)]: next });
    notifySessionUpdated(next);
  }

  const current = await getTabSession(tabId);
  if (current) {
    return current;
  }

  const fallback = buildTabAccessSession(tab, null, false);
  notifySessionUpdated(fallback);
  return fallback;
}

async function handleSetAnalysisDialect(message) {
  const tabId = message?.tabId;

  if (typeof tabId !== "number") {
    throw new Error("Missing tab id");
  }

  const previous = await getTabSession(tabId);

  if (!previous) {
    return null;
  }

  const next = {
    ...previous,
    analysisDialectPreference: normalizeDialectPreference(message?.dialectPreference),
    updatedAt: Date.now(),
  };

  applyAnalysisInputState(next);

  next.analysis = await buildAnalysis(
    resolveAnalysisInputSql(next),
    previous?.analysis,
    Date.now(),
    next.analysisDialectPreference,
  );

  await chrome.storage.session.set({ [sessionKey(tabId)]: next });
  notifySessionUpdated(next);

  return next;
}

async function handleCaptureSelectionSql(message, sender) {
  const tabId = sender?.tab?.id ?? message?.tabId;

  if (typeof tabId !== "number") {
    throw new Error("Missing tab id");
  }

  const capturedSql = normalizeSql(message?.sql);

  if (!capturedSql) {
    throw new Error("Missing captured SQL");
  }

  const previous = await getTabSession(tabId);
  const tab = await chrome.tabs.get(tabId);
  const timestamp = Date.now();
  const source = typeof message?.source === "string" ? message.source : "capture:selection";
  const sqlLabSidebarHidden = await getSqlLabSidebarHiddenPreference(tab?.url ?? previous?.url ?? "");
  const next = {
    ...previous,
    tabId,
    url: tab?.url ?? previous?.url ?? "",
    title: tab?.title ?? previous?.title ?? "",
    isSupersetLike: previous?.isSupersetLike ?? false,
    isSqlLab: previous?.isSqlLab ?? false,
    signals: Array.from(new Set([...(previous?.signals || []), source])),
    capturedSql,
    capturedSqlPreview: createSqlPreview(capturedSql),
    capturedSqlSource: source,
    capturedSqlLength: capturedSql.length,
    capturedSqlUpdatedAt: timestamp,
    sqlLabSidebarHidden,
    analysisDialectPreference:
      typeof previous?.analysisDialectPreference === "string"
        ? previous.analysisDialectPreference
        : "auto",
    updatedAt: timestamp,
  };

  await applySiteAccessState(next, next.url);

  applyAnalysisInputState(next);

  next.analysis = await buildAnalysis(
    resolveAnalysisInputSql(next),
    null,
    timestamp,
    next.analysisDialectPreference,
  );

  await chrome.storage.session.set({ [sessionKey(tabId)]: next });
  await updateSidePanelForTab(tabId, shouldEnableSidePanel(next));
  notifySessionUpdated(next);

  return next;
}

async function handleClearCapturedSql(message) {
  const tabId = message?.tabId;

  if (typeof tabId !== "number") {
    throw new Error("Missing tab id");
  }

  const previous = await getTabSession(tabId);

  if (!previous) {
    return null;
  }

  const next = {
    ...previous,
    capturedSql: "",
    capturedSqlPreview: "",
    capturedSqlSource: "",
    capturedSqlLength: 0,
    capturedSqlUpdatedAt: null,
    updatedAt: Date.now(),
  };

  await applySiteAccessState(next, next.url);

  applyAnalysisInputState(next);

  next.analysis = await buildAnalysis(
    resolveAnalysisInputSql(next),
    null,
    Date.now(),
    next.analysisDialectPreference,
  );

  await chrome.storage.session.set({ [sessionKey(tabId)]: next });
  await updateSidePanelForTab(tabId, shouldEnableSidePanel(next));
  notifySessionUpdated(next);

  return next;
}

async function handleSetSqlLabSchemaPanelHidden(message) {
  const tabId = message?.tabId;

  if (typeof tabId !== "number") {
    throw new Error("Missing tab id");
  }

  const tab = await chrome.tabs.get(tabId);
  const origin = getOriginFromUrl(tab?.url);

  if (!origin) {
    throw new Error("Missing origin");
  }

  const hidden = Boolean(message?.hidden);

  await chrome.storage.local.set({
    [originPreferenceKey(origin)]: hidden,
  });

  const tabs = await chrome.tabs.query({});
  const matchingTabs = tabs.filter((candidate) => getOriginFromUrl(candidate.url) === origin);

  for (const matchingTab of matchingTabs) {
    if (typeof matchingTab.id !== "number") {
      continue;
    }

    await sendSqlLabSidebarHiddenToTab(matchingTab.id, hidden);

    const session = await getTabSession(matchingTab.id);

    if (!session) {
      continue;
    }

    const next = {
      ...session,
      sqlLabSidebarHidden: hidden,
      updatedAt: Date.now(),
    };

    await chrome.storage.session.set({ [sessionKey(matchingTab.id)]: next });
    notifySessionUpdated(next);
  }

  return getTabSession(tabId);
}

async function syncSidePanelForTab(tabId, providedTab = null) {
  try {
    const tab = providedTab || (await chrome.tabs.get(tabId));
    await updateSidePanelForTab(tabId, isSupportedPageUrl(tab?.url || ""));
  } catch (error) {
    console.debug("Unable to sync side panel state", error);
  }
}

async function refreshSidePanelAvailability() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab) => typeof tab.id === "number")
        .map((tab) => updateSidePanelForTab(tab.id, isSupportedPageUrl(tab.url || ""))),
    );
  } catch (error) {
    console.debug("Unable to refresh side panel availability", error);
  }
}

async function clearTabSession(tabId) {
  if (typeof tabId !== "number") {
    return;
  }

  try {
    await chrome.storage.session.remove(sessionKey(tabId));
  } catch (_error) {
    // noop
  }
}

function sessionKey(tabId) {
  return `${SESSION_PREFIX}${tabId}`;
}

function notifySessionUpdated(session) {
  chrome.runtime.sendMessage({
    type: "TAB_SESSION_UPDATED",
    session,
  }).catch(() => {
    // No listeners is expected when the side panel is closed.
  });
}

async function sendSqlLabSidebarHiddenToTab(tabId, hidden) {
  await ensureTabObserverInjected(tabId);

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "SET_SQLLAB_SCHEMA_PANEL_HIDDEN",
      hidden,
    });
  } catch (_error) {
    // The content script may not be ready on every matched tab.
  }
}

function applyAnalysisInputState(session) {
  const capturedSql = normalizeSql(session?.capturedSql);
  const pageSql = normalizeSql(session?.sql);

  if (capturedSql) {
    session.analysisInputMode = "captured";
    session.activeSql = capturedSql;
    session.activeSqlPreview = session?.capturedSqlPreview || createSqlPreview(capturedSql);
    session.activeSqlSource = session?.capturedSqlSource || "capture:selection";
    session.activeSqlLength = session?.capturedSqlLength || capturedSql.length;
  } else {
    session.analysisInputMode = "page";
    session.activeSql = pageSql;
    session.activeSqlPreview = session?.sqlPreview || createSqlPreview(pageSql);
    session.activeSqlSource = session?.sqlSource || "";
    session.activeSqlLength = session?.sqlLength || pageSql.length;
  }

  session.hasSqlSnapshot = Boolean(session.activeSql);
  return session;
}

function resolveAnalysisInputSql(session) {
  return normalizeSql(session?.capturedSql || session?.sql || "");
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function buildAnalysis(sql, previousAnalysis, sqlUpdatedAt, dialectPreference = "auto") {
  const normalizedSql = normalizeSql(sql);

  if (!normalizedSql) {
    return null;
  }

  if (
    previousAnalysis?.normalizedSql === normalizedSql &&
    previousAnalysis?.generatedAt &&
    previousAnalysis?.dialectPreference === dialectPreference
  ) {
    return previousAnalysis;
  }

  try {
    const analysis = analyzeSql(normalizedSql, {
      dialectPreference,
    });
    return {
      ...analysis,
      generatedAt: sqlUpdatedAt || Date.now(),
    };
  } catch (error) {
    console.error("Failed to analyze SQL", error);
    return {
      mode: "error",
      normalizedSql,
      generatedAt: sqlUpdatedAt || Date.now(),
      errorMessage: String(error),
    };
  }
}

function normalizeNetworkEvent(event) {
  return {
    source: event?.source || "unknown",
    phase: event?.phase || "request",
    kind: event?.kind || "unknown",
    url: event?.url || "",
    method: event?.method || "GET",
    timestamp: typeof event?.timestamp === "number" ? event.timestamp : Date.now(),
    request: {
      queryId: event?.request?.queryId || null,
      databaseId: event?.request?.databaseId || null,
      schema: event?.request?.schema || null,
      sql: normalizeSql(event?.request?.sql || ""),
      sqlLength: event?.request?.sqlLength || 0,
      keys: Array.isArray(event?.request?.keys) ? event.request.keys : [],
    },
    response: event?.response
      ? {
          httpStatus: event.response.httpStatus ?? null,
          ok: typeof event.response.ok === "boolean" ? event.response.ok : null,
          queryId: event.response.queryId || null,
          status: event.response.status || null,
          rowCount:
            typeof event.response.rowCount === "number" ? event.response.rowCount : null,
          errorMessage: event.response.errorMessage || null,
        }
      : null,
    errorMessage: event?.errorMessage || null,
  };
}

function mergeExecution(previous, event) {
  const next = {
    status: previous?.status || "idle",
    queryId: previous?.queryId || null,
    databaseId: previous?.databaseId || null,
    schema: previous?.schema || null,
    startedAt: previous?.startedAt || null,
    finishedAt: previous?.finishedAt || null,
    durationMs: previous?.durationMs || null,
    rowCount: previous?.rowCount ?? null,
    lastKind: event.kind,
    lastPhase: event.phase,
    lastUrl: event.url,
    lastHttpStatus: event.response?.httpStatus ?? previous?.lastHttpStatus ?? null,
    errorMessage: previous?.errorMessage || null,
    updatedAt: event.timestamp,
  };

  next.queryId = event.response?.queryId || event.request?.queryId || next.queryId;
  next.databaseId = event.request?.databaseId || next.databaseId;
  next.schema = event.request?.schema || next.schema;
  next.rowCount = event.response?.rowCount ?? next.rowCount;

  if (event.phase === "request" && event.kind === "execute") {
    next.status = "running";
    next.startedAt = event.timestamp;
    next.finishedAt = null;
    next.durationMs = null;
    next.errorMessage = null;
  } else if (event.phase === "request" && event.kind === "cancel") {
    next.status = "canceled";
    next.finishedAt = event.timestamp;
  } else if (event.phase === "snapshot" && typeof event.response?.rowCount === "number") {
    next.rowCount = event.response.rowCount;
  } else if (event.phase === "error") {
    next.status = "failed";
    next.finishedAt = event.timestamp;
    next.errorMessage = event.errorMessage || "Network error";
  } else if (event.phase === "response") {
    const normalizedStatus = normalizeExecutionStatus(event.kind, event.response);

    if (normalizedStatus) {
      next.status = normalizedStatus;
    }

    if (normalizedStatus === "success" || normalizedStatus === "failed" || normalizedStatus === "canceled") {
      next.finishedAt = event.timestamp;
      next.durationMs = next.startedAt ? event.timestamp - next.startedAt : next.durationMs;
    }

    if (event.response?.errorMessage) {
      next.errorMessage = event.response.errorMessage;
    }
  }

  return next;
}

function normalizeExecutionStatus(kind, response) {
  const raw = String(response?.status || "").toLowerCase();

  if (!raw) {
    if (kind === "results" && response?.ok) {
      return "success";
    }
    return null;
  }

  if (["success", "done", "finished"].includes(raw)) {
    return "success";
  }
  if (["failed", "error", "timed_out", "timeout"].includes(raw)) {
    return "failed";
  }
  if (["cancelled", "canceled", "stopped", "canceling"].includes(raw)) {
    return "canceled";
  }
  if (["running", "pending", "scheduled", "initializing", "initialised", "fetching"].includes(raw)) {
    return "running";
  }

  return null;
}

function mergeExecutionEvents(previousEvents, event) {
  const nextEvent = {
    source: event.source,
    phase: event.phase,
    kind: event.kind,
    at: event.timestamp,
    method: event.method,
    httpStatus: event.response?.httpStatus ?? null,
    queryId: event.response?.queryId || event.request?.queryId || null,
    status: event.response?.status || null,
    rowCount: event.response?.rowCount ?? null,
    errorMessage: event.response?.errorMessage || event.errorMessage || null,
  };

  return [nextEvent, ...(previousEvents || [])].slice(0, EXECUTION_EVENT_LIMIT);
}

function normalizeSql(sql) {
  if (typeof sql !== "string") {
    return "";
  }

  return sql.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function normalizeDialectPreference(value) {
  const normalized = String(value || "auto").toLowerCase();
  return ["auto", "postgresql", "hive", "trino", "oracle"].includes(normalized)
    ? normalized
    : "auto";
}

async function applySiteAccessState(session, url) {
  const resolvedUrl = String(url || session?.url || "");
  session.siteOrigin = getOriginFromUrl(resolvedUrl);
  session.sitePermissionPattern = getSitePermissionPattern(resolvedUrl);
  session.siteAccessSupported = isSupportedPageUrl(resolvedUrl);
  session.siteAccessGranted = await hasSiteAccessForUrl(resolvedUrl);
  return session;
}

async function getSqlLabSidebarHiddenPreference(url) {
  const origin = getOriginFromUrl(url);

  if (!origin) {
    return false;
  }

  const data = await chrome.storage.local.get(originPreferenceKey(origin));
  return Boolean(data[originPreferenceKey(origin)]);
}

function originPreferenceKey(origin) {
  return `${ORIGIN_PREF_PREFIX}${origin}:sqlLabSidebarHidden`;
}

function getOriginFromUrl(url) {
  try {
    return new URL(String(url || "")).origin;
  } catch (_error) {
    return "";
  }
}

function getSitePermissionPattern(url) {
  const origin = getOriginFromUrl(url);
  return origin && isSupportedPageUrl(url) ? `${origin}/*` : "";
}

async function hasSiteAccessForUrl(url) {
  const pattern = getSitePermissionPattern(url);

  if (!pattern) {
    return false;
  }

  try {
    return await chrome.permissions.contains({
      origins: [pattern],
    });
  } catch (_error) {
    return false;
  }
}

function buildTabAccessSession(tab, existingSession = null, grantedOverride = null) {
  const url = tab?.url ?? existingSession?.url ?? "";
  const accessGranted =
    typeof grantedOverride === "boolean"
      ? grantedOverride
      : Boolean(existingSession?.siteAccessGranted);
  const next = {
    ...(existingSession || {}),
    tabId: tab?.id ?? existingSession?.tabId ?? 0,
    url,
    title: tab?.title ?? existingSession?.title ?? "",
    siteOrigin: getOriginFromUrl(url),
    sitePermissionPattern: getSitePermissionPattern(url),
    siteAccessSupported: isSupportedPageUrl(url),
    siteAccessGranted: accessGranted,
    updatedAt: Date.now(),
  };

  if (!accessGranted && !normalizeSql(next.capturedSql)) {
    next.bridgeReady = false;
    next.hasSqlSnapshot = false;
    next.sql = "";
    next.sqlPreview = "";
    next.sqlSource = "";
    next.sqlLength = 0;
    next.sqlUpdatedAt = null;
    next.sqlSelectionText = "";
    next.sqlSelectionSource = "";
    next.sqlSelectionUpdatedAt = null;
    next.sqlSelectionStart = null;
    next.sqlSelectionEnd = null;
    next.resultRowCount = null;
    next.execution = null;
    next.executionEvents = [];
    next.analysis = null;
  }

  applyAnalysisInputState(next);
  return next;
}

function createSqlPreview(sql) {
  if (!sql) {
    return "";
  }

  return sql.length <= 1200 ? sql : `${sql.slice(0, 1200)}\n...`;
}

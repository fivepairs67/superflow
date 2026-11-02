import type { GetTabSessionResponse, TabSessionUpdatedMessage } from "../../shared/types";
import type { TabSessionState } from "./session-store";

export function getPanelTabId(search: string): number | null {
  const value = new URLSearchParams(search).get("tabId");
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function subscribeToTabSession(
  tabId: number | null,
  onChange: (state: TabSessionState) => void,
) {
  let disposed = false;
  let requestId = 0;
  let updateId = 0;

  if (tabId === null) {
    onChange({ status: "error", tabId: null, session: null, error: "Open SuperFLOW from the toolbar on the tab you want to analyze." });
    return () => {};
  }

  const handleMessage = (message: unknown) => {
    const payload = message as TabSessionUpdatedMessage;
    if (disposed || payload?.type !== "TAB_SESSION_UPDATED" || payload.session?.tabId !== tabId) {
      return;
    }
    updateId += 1;
    onChange({ status: "ready", tabId, session: payload.session, error: null });
  };

  const refresh = async () => {
    const currentRequest = ++requestId;
    const currentUpdate = updateId;
    onChange({ status: "loading", tabId, session: null, error: null });
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_TAB_SESSION", tabId }) as GetTabSessionResponse;
      if (disposed || currentRequest !== requestId || currentUpdate !== updateId) {
        return;
      }
      if (!response?.ok || (response.session && response.session.tabId !== tabId)) {
        throw new Error(response?.error || "Could not load this tab's session.");
      }
      onChange({ status: response.session ? "ready" : "empty", tabId, session: response.session, error: null });
    } catch (error) {
      if (!disposed && currentRequest === requestId && currentUpdate === updateId) {
        onChange({ status: "error", tabId, session: null, error: String(error) });
      }
    }
  };

  const handleUpdated = (updatedTabId: number, change: { url?: string; status?: string }) => {
    if (updatedTabId === tabId && (typeof change.url === "string" || change.status)) {
      void refresh();
    }
  };
  const handleRemoved = (removedTabId: number) => {
    if (removedTabId === tabId) {
      dispose();
      onChange({ status: "empty", tabId: null, session: null, error: null });
    }
  };

  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.tabs.onUpdated.addListener(handleUpdated);
  chrome.tabs.onRemoved.addListener(handleRemoved);
  void refresh();

  function dispose() {
    disposed = true;
    chrome.runtime.onMessage.removeListener(handleMessage);
    chrome.tabs.onUpdated.removeListener(handleUpdated);
    chrome.tabs.onRemoved.removeListener(handleRemoved);
  }
  return dispose;
}

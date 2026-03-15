import { startTransition, useEffect, useRef, useState } from "react";

import type {
  GetTabSessionResponse,
  TabSession,
  TabSessionUpdatedMessage,
} from "../../shared/types";
import {
  initialTabSessionState,
  type TabSessionState,
} from "../state/session-store";

export function useTabSession() {
  const [state, setState] = useState<TabSessionState>(initialTabSessionState);
  const activeTabIdRef = useRef<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    const handleRuntimeMessage = (message: unknown) => {
      const payload = message as TabSessionUpdatedMessage;

      if (payload?.type !== "TAB_SESSION_UPDATED") {
        return;
      }

      startTransition(() => {
        setState((current) => {
          if (current.tabId !== null && payload.session?.tabId !== current.tabId) {
            return current;
          }

          return {
            status: "ready",
            tabId: payload.session?.tabId ?? current.tabId,
            session: payload.session ?? current.session,
            error: null,
          };
        });
      });
    };

    const handleTabActivated = () => {
      void bootstrap();
    };

    const handleTabUpdated = (
      tabId: number,
      changeInfo: { status?: string; url?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (!tab.active) {
        return;
      }

      if (typeof changeInfo.url === "string" || changeInfo.status === "loading" || changeInfo.status === "complete") {
        if (activeTabIdRef.current === tabId || typeof changeInfo.url === "string") {
          void bootstrap();
        }
      }
    };

    void bootstrap();
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

    return () => {
      isMounted = false;
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
    };

    async function bootstrap() {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        if (!isMounted) {
          return;
        }

        if (typeof tab?.id !== "number") {
          setState({
            status: "error",
            tabId: null,
            session: null,
            error: "Could not find the active tab.",
          });
          return;
        }

        const response = (await chrome.runtime.sendMessage({
          type: "GET_TAB_SESSION",
          tabId: tab.id,
        })) as GetTabSessionResponse;

        if (!isMounted) {
          return;
        }

        if (!response?.ok) {
          setState({
            status: "error",
            tabId: tab.id,
            session: null,
            error: response?.error || "Could not load the current session.",
          });
          return;
        }

        activeTabIdRef.current = tab.id;

        setState({
          status: response.session ? "ready" : "empty",
          tabId: tab.id,
          session: response.session,
          error: null,
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setState({
          status: "error",
          tabId: null,
          session: null,
          error: String(error),
        });
      }
    }
  }, []);

  return state;
}

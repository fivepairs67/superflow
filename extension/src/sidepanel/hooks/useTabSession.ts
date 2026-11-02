import { startTransition, useEffect, useState } from "react";

import { initialTabSessionState, type TabSessionState } from "../state/session-store";
import { getPanelTabId, subscribeToTabSession } from "../state/tab-session-subscription";

export function useTabSession() {
  const [state, setState] = useState<TabSessionState>(initialTabSessionState);

  useEffect(() => subscribeToTabSession(getPanelTabId(window.location.search), (next) => {
    startTransition(() => setState(next));
  }), []);

  return state;
}

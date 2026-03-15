import type { TabSession } from "../../shared/types";

export type TabSessionStatus = "loading" | "ready" | "empty" | "error";

export interface TabSessionState {
  status: TabSessionStatus;
  tabId: number | null;
  session: TabSession | null;
  error: string | null;
}

export const initialTabSessionState: TabSessionState = {
  status: "loading",
  tabId: null,
  session: null,
  error: null,
};

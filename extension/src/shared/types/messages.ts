import type {
  AnalysisDialectPreference,
  AnalysisRange,
  TabSession,
} from "./session";

export interface GetTabSessionMessage {
  type: "GET_TAB_SESSION";
  tabId: number;
}

export interface GetTabSessionResponse {
  ok: boolean;
  session: TabSession | null;
  error?: string;
}

export interface TabSessionUpdatedMessage {
  type: "TAB_SESSION_UPDATED";
  session: TabSession;
}

export interface ApplyEditorHighlightMessage {
  type: "APPLY_EDITOR_HIGHLIGHT";
  ranges: AnalysisRange[];
}

export interface SetAnalysisDialectMessage {
  type: "SET_ANALYSIS_DIALECT";
  tabId: number;
  dialectPreference: AnalysisDialectPreference;
}

export interface SetAnalysisDialectResponse {
  ok: boolean;
  session: TabSession | null;
  error?: string;
}

export interface CaptureSelectionSqlMessage {
  type: "CAPTURE_SELECTION_SQL";
  tabId?: number;
  sql: string;
  source?: string;
}

export interface ClearCapturedSqlMessage {
  type: "CLEAR_CAPTURED_SQL";
  tabId: number;
}

export interface SetSqlLabSidebarHiddenMessage {
  type: "SET_SQLLAB_SCHEMA_PANEL_HIDDEN";
  tabId: number;
  hidden: boolean;
}

export interface EnableSiteAccessMessage {
  type: "ENABLE_SITE_ACCESS";
  tabId: number;
}

export interface DisableSiteAccessMessage {
  type: "DISABLE_SITE_ACCESS";
  tabId: number;
}

export type RuntimeMessage =
  | GetTabSessionMessage
  | TabSessionUpdatedMessage
  | ApplyEditorHighlightMessage
  | SetAnalysisDialectMessage
  | CaptureSelectionSqlMessage
  | ClearCapturedSqlMessage
  | SetSqlLabSidebarHiddenMessage
  | EnableSiteAccessMessage
  | DisableSiteAccessMessage;

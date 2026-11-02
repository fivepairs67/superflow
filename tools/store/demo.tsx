import { createRoot } from "react-dom/client";
import { App } from "../../extension/src/sidepanel/App";
import { analyzeSql } from "../../extension/sql-analysis.js";
import sampleSql from "../../docs/store/sample.sql";
import "../../extension/src/sidepanel/styles/index.css";

// This synthetic Chrome boundary is never imported by the extension build.
function createEvent() {
  const listeners = new Set<(message: unknown) => void>();
  return {
    addListener: (listener: (message: unknown) => void) => listeners.add(listener),
    removeListener: (listener: (message: unknown) => void) => listeners.delete(listener),
    emit: (message: unknown) => listeners.forEach((listener) => listener(message)),
  };
}
const onMessage = createEvent();
let sql = sampleSql;
let dialect = "postgresql";
function getSession() {
  return {
    tabId: 1,
    title: "Fictional SQL demo",
    analysisInputMode: "captured",
    capturedSql: sql,
    capturedSqlSource: "capture:manual",
    activeSql: sql,
    activeSqlSource: "capture:manual",
    activeSqlLength: sql.length,
    hasSqlSnapshot: true,
    analysisDialectPreference: dialect,
    analysis: analyzeSql(sql, { dialectPreference: dialect }),
  };
}
Object.defineProperty(window, "chrome", {
  configurable: true,
  value: {
    runtime: {
      onMessage,
      async sendMessage(message: { type: string; sql?: string; dialectPreference?: string }) {
        if (message.type === "GET_TAB_SESSION") return { ok: true, session: getSession() };
        if (message.type === "CAPTURE_SELECTION_SQL") sql = message.sql || "";
        else if (message.type === "CLEAR_CAPTURED_SQL") sql = sampleSql;
        else if (message.type === "SET_ANALYSIS_DIALECT") dialect = message.dialectPreference || "auto";
        else return { ok: false, error: "Not available in the screenshot preview" };
        const session = getSession();
        onMessage.emit({ type: "TAB_SESSION_UPDATED", session });
        return { ok: true, session };
      },
    },
    tabs: { onUpdated: createEvent(), onRemoved: createEvent(), sendMessage: async () => ({ ok: true }) },
  },
});
createRoot(document.getElementById("root")!).render(<App />);

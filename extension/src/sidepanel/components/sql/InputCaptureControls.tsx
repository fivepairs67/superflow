import { useEffect, useMemo, useState } from "react";

import type { TabSession } from "../../../shared/types";

const SQL_INPUT_HINT = /\b(with|select|insert|update|delete|create|merge|drop|alter)\b/i;

interface InputCaptureControlsProps {
  tabId: number | null;
  session: TabSession | null | undefined;
}

export function InputCaptureControls({ tabId, session }: InputCaptureControlsProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSql, setManualSql] = useState("");
  const [feedback, setFeedback] = useState("");
  const capturedSource = session?.analysisInputMode === "captured" ? session?.capturedSqlSource || "" : "";
  const feedbackLabel = useMemo(() => buildFeedbackLabel(feedback, capturedSource), [feedback, capturedSource]);
  const sourceToggleLabel = useMemo(() => buildSourceToggleLabel(capturedSource), [capturedSource]);

  useEffect(() => {
    setManualOpen(false);
    setManualSql("");
    setFeedback("");
  }, [tabId]);

  return (
    <div className={`capture-tools ${manualOpen ? "is-expanded" : ""}`}>
      <div className="utility-inline-row">
        <span className="utility-inline-label">Input</span>
        <div className="utility-inline-actions capture-tool-row">
          <button type="button" className="capture-button" onClick={() => void handleClipboard()}>
            Clipboard
          </button>
          <button
            type="button"
            className={`capture-button ${manualOpen ? "is-active" : ""}`}
            onClick={() => {
              setManualOpen((current) => !current);
              setFeedback("");
            }}
          >
            {manualOpen ? "Hide paste" : "Paste SQL"}
          </button>
          {manualOpen ? (
            <button type="button" className="capture-button" onClick={() => void handleManualSubmit()}>
              Analyze paste
            </button>
          ) : null}
          {manualOpen || manualSql ? (
            <button
              type="button"
              className="capture-button capture-button--secondary"
              onClick={() => {
                setManualSql("");
                setFeedback("");
              }}
            >
              Clear
            </button>
          ) : null}
          {sourceToggleLabel && typeof tabId === "number" ? (
            <button
              type="button"
              className="capture-button capture-button--secondary capture-button--source-toggle"
              title="Return to page SQL"
              aria-label="Return to page SQL"
              onClick={() => void handleClearCaptured()}
            >
              {sourceToggleLabel}
            </button>
          ) : null}
        </div>
        {feedbackLabel ? <span className="dialect-chip utility-inline-chip">{feedbackLabel}</span> : null}
      </div>
      {manualOpen ? (
        <div className="capture-manual">
          <textarea
            className="capture-textarea"
            value={manualSql}
            onChange={(event) => setManualSql(event.target.value)}
            placeholder="Paste SQL here to analyze it in SuperFLOW"
            spellCheck={false}
          />
        </div>
      ) : null}
    </div>
  );

  async function handleClipboard() {
    if (typeof tabId !== "number") {
      setFeedback("No active tab");
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      const sql = normalizeSql(text);

      if (!isLikelySql(sql)) {
        setFeedback("Clipboard has no SQL");
        return;
      }

      await captureSql(sql, "capture:clipboard");
      setFeedback("");
    } catch (_error) {
      setFeedback("Clipboard unavailable");
    }
  }

  async function handleManualSubmit() {
    if (typeof tabId !== "number") {
      setFeedback("No active tab");
      return;
    }

    const sql = normalizeSql(manualSql);

    if (!isLikelySql(sql)) {
      setFeedback("Paste SQL first");
      return;
    }

    await captureSql(sql, "capture:manual");
    setManualOpen(false);
    setManualSql("");
    setFeedback("");
  }

  async function captureSql(sql: string, source: string) {
    await chrome.runtime.sendMessage({
      type: "CAPTURE_SELECTION_SQL",
      tabId,
      sql,
      source,
    });
  }

  async function handleClearCaptured() {
    if (typeof tabId !== "number") {
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: "CLEAR_CAPTURED_SQL",
        tabId,
      });
      setFeedback("");
    } catch (_error) {
      // noop
    }
  }
}

function normalizeSql(value: string) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function isLikelySql(sql: string) {
  if (!sql || sql.length < 8) {
    return false;
  }

  return SQL_INPUT_HINT.test(sql);
}

function buildFeedbackLabel(feedback: string, capturedSource: string) {
  if (feedback) {
    return feedback;
  }

  return "";
}

function buildSourceToggleLabel(capturedSource: string) {
  if (capturedSource === "capture:clipboard") {
    return "Clipboard SQL";
  }

  if (capturedSource === "capture:manual") {
    return "Pasted SQL";
  }

  if (
    capturedSource === "capture:selection" ||
    capturedSource === "capture:editor-selection" ||
    capturedSource === "capture:input-selection"
  ) {
    return "Selected SQL";
  }

  return "";
}

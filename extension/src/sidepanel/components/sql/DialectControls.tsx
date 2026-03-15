import { useEffect, useState } from "react";

import type {
  AnalysisDialectPreference,
  AnalysisResult,
  TabSession,
} from "../../../shared/types";

const DIALECT_OPTIONS: Array<{
  value: AnalysisDialectPreference;
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "trino", label: "Trino" },
  { value: "hive", label: "Hive" },
  { value: "postgresql", label: "Postgres" },
];

interface DialectControlsProps {
  session: TabSession | null | undefined;
}

export function DialectControls({ session }: DialectControlsProps) {
  const [pendingPreference, setPendingPreference] = useState<AnalysisDialectPreference>(
    resolveDialectPreference(session),
  );

  useEffect(() => {
    setPendingPreference(resolveDialectPreference(session));
  }, [session?.analysis?.dialectPreference, session?.analysisDialectPreference, session?.tabId]);

  if (!session?.isSqlLab && !session?.activeSql) {
    return null;
  }

  const analysis = session?.analysis || null;
  const detectedLabel = buildDetectedLabel(analysis);
  const parserLabel = buildParserLabel(analysis);

  return (
    <div className="dialect-strip">
      <div className="utility-inline-row">
        <span className="utility-inline-label">Dialect</span>
        <div className="utility-inline-actions dialect-pill-row">
          {DIALECT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`dialect-pill ${pendingPreference === option.value ? "is-active" : ""}`}
              onClick={() => void handleSelect(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="dialect-strip-meta utility-inline-meta">
          {detectedLabel ? <span className="dialect-chip">{detectedLabel}</span> : null}
          <span className="dialect-chip">{parserLabel}</span>
        </div>
      </div>
    </div>
  );

  async function handleSelect(nextPreference: AnalysisDialectPreference) {
    if (typeof session?.tabId !== "number") {
      return;
    }

    setPendingPreference(nextPreference);

    try {
      await chrome.runtime.sendMessage({
        type: "SET_ANALYSIS_DIALECT",
        tabId: session.tabId,
        dialectPreference: nextPreference,
      });
    } catch (_error) {
      setPendingPreference(resolveDialectPreference(session));
    }
  }
}

function resolveDialectPreference(session: TabSession | null | undefined): AnalysisDialectPreference {
  return (
    session?.analysisDialectPreference ||
    session?.analysis?.dialectPreference ||
    "auto"
  );
}

function buildDetectedLabel(analysis: AnalysisResult | null) {
  if (!analysis?.detectedDialect) {
    return "";
  }

  const confidence =
    typeof analysis.dialectConfidence === "number"
      ? ` ${Math.round(analysis.dialectConfidence * 100)}%`
      : "";

  return `SQL ${analysis.detectedDialect}${confidence}`;
}

function buildParserLabel(analysis: AnalysisResult | null) {
  if (!analysis?.parserDialect) {
    return "AST off";
  }

  if (analysis?.parserEngine) {
    return `AST via ${analysis.parserEngine}/${analysis.parserDialect}`;
  }

  return `AST via ${analysis.parserDialect}`;
}

import type { AnalysisResult } from "../../../shared/types";
import { useGraphStore } from "../../state/graph-store";

interface StatementOutlineProps {
  analysis: AnalysisResult | null | undefined;
  sqlSelectionText?: string;
  sqlSelectionStart?: number | null;
  sqlSelectionEnd?: number | null;
}

export function StatementOutline({
  analysis,
  sqlSelectionText,
  sqlSelectionStart,
  sqlSelectionEnd,
}: StatementOutlineProps) {
  const { selectedStatementIndex, selectStatementIndex } = useGraphStore();
  const statements = analysis?.statements || [];
  const selectionSignature = buildSelectionSignature(
    sqlSelectionText,
    sqlSelectionStart,
    sqlSelectionEnd,
  );

  if (statements.length <= 1) {
    return null;
  }

  const activeIndex =
    typeof selectedStatementIndex === "number"
      ? selectedStatementIndex
      : (analysis?.activeStatementIndex ?? statements.length - 1);

  return (
    <div className="statement-outline">
      <div className="statement-outline-head">
        <div>
          <p className="section-eyebrow">Worksheet</p>
          <h3>Statements</h3>
        </div>
        <span className="section-pill">{statements.length} statements</span>
      </div>
      <div className="statement-pill-row">
        {statements.map((statement) => (
          <button
            key={statement.id}
            type="button"
            className={`statement-pill ${activeIndex === statement.index ? "is-active" : ""}`}
            onClick={() => selectStatementIndex(statement.index, selectionSignature)}
            title={statement.title || `Statement ${statement.index + 1}`}
          >
            #{statement.index + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

function buildSelectionSignature(
  selectionText: string | undefined,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
) {
  if (
    typeof selectionStart !== "number" &&
    typeof selectionEnd !== "number" &&
    !selectionText
  ) {
    return "";
  }

  return `${selectionStart ?? ""}:${selectionEnd ?? ""}:${selectionText ?? ""}`;
}

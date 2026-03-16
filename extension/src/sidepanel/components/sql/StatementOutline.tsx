import type { AnalysisResult } from "../../../shared/types";
import { buildStatementDisplayGroups } from "../../features/sql/statement-groups";
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
  const displayGroups = buildStatementDisplayGroups(statements);
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
        <span className="section-pill">
          {displayGroups.length} cards / {statements.length} statements
        </span>
      </div>
      <div className="statement-pill-row">
        {displayGroups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`statement-pill ${group.statementIndexes.includes(activeIndex) ? "is-active" : ""}`}
            onClick={() => selectStatementIndex(group.primaryIndex, selectionSignature)}
            title={group.title}
          >
            {group.shortLabel}
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

import type { ExecutionState, TabSession } from "../../../shared/types";

interface StatusChipsProps {
  session: TabSession | null;
}

export function StatusChips({ session }: StatusChipsProps) {
  const execution = session?.execution as ExecutionState | null | undefined;
  const analysisMode = session?.analysis?.mode || (session?.isSqlLab ? "sql-lab" : "waiting");

  return (
    <div className="chip-row">
      <span className="chip">{execution?.status || "idle"}</span>
      <span className="chip">
        rows {typeof execution?.rowCount === "number" ? execution.rowCount : "-"}
      </span>
      <span className="chip">
        {typeof execution?.durationMs === "number" ? `${execution.durationMs} ms` : "duration -"}
      </span>
      <span className="chip">{analysisMode}</span>
    </div>
  );
}

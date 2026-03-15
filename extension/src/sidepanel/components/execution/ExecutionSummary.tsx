import type { ExecutionState } from "../../../shared/types";

interface ExecutionSummaryProps {
  execution: ExecutionState | null | undefined;
}

export function ExecutionSummary({ execution }: ExecutionSummaryProps) {
  const items = [
    {
      label: "Status",
      value: execution?.status || "idle",
    },
    {
      label: "Rows",
      value: typeof execution?.rowCount === "number" ? String(execution.rowCount) : "-",
    },
    {
      label: "Duration",
      value: typeof execution?.durationMs === "number" ? `${execution.durationMs} ms` : "-",
    },
    {
      label: "Query ID",
      value: execution?.queryId != null ? String(execution.queryId) : "-",
    },
  ];
  const eventLabel = execution?.lastKind
    ? `${execution.lastKind} / ${execution.lastPhase || "-"}`
    : "event -";

  return (
    <div className="runtime-panel">
      <div className="runtime-grid">
        {items.map((item) => (
          <div key={item.label} className="runtime-card">
            <span className="runtime-label">{item.label}</span>
            <strong className="runtime-value">{item.value}</strong>
          </div>
        ))}
      </div>
      <div className="runtime-meta-row">
        <span className="runtime-meta-chip">{eventLabel}</span>
        {execution?.errorMessage ? (
          <span className="runtime-meta-chip is-alert" title={execution.errorMessage}>
            {truncate(execution.errorMessage, 56)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

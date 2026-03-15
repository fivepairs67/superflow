import type { GraphFocusState } from "../../features/graph/model";

interface FocusPanelProps {
  focusState: GraphFocusState;
}

export function FocusPanel({ focusState }: FocusPanelProps) {
  if (!focusState.selectedNode) {
    return (
      <div className="graph-focus-panel is-empty">
        Click a node to inspect its upstream and downstream flow here.
      </div>
    );
  }

  return (
    <div className="graph-focus-panel">
      <div className="graph-focus-head">
        <div>
          <p className="graph-focus-title">
            {focusState.selectedNode.label || focusState.selectedNode.id}
          </p>
          <p className="graph-focus-copy">
            Up {focusState.upstreamNodes.length} / Down {focusState.downstreamNodes.length}
          </p>
        </div>
      </div>
      <div className="graph-focus-grid">
        <FocusColumn
          title="Upstream"
          toneClassName="is-upstream"
          emptyMessage="No upstream sources"
          labels={focusState.upstreamNodes.map((node) => node.label || node.id)}
        />
        <FocusColumn
          title="Downstream"
          toneClassName="is-downstream"
          emptyMessage="No downstream flow"
          labels={focusState.downstreamNodes.map((node) => node.label || node.id)}
        />
      </div>
    </div>
  );
}

interface FocusColumnProps {
  title: string;
  toneClassName: string;
  emptyMessage: string;
  labels: string[];
}

function FocusColumn({ title, toneClassName, emptyMessage, labels }: FocusColumnProps) {
  return (
    <section className="graph-focus-column">
      <h3>{title}</h3>
      {labels.length ? (
        <div className="graph-focus-list">
          {labels.slice(0, 10).map((label) => (
            <span key={`${title}:${label}`} className={`graph-focus-pill ${toneClassName}`}>
              {label}
            </span>
          ))}
          {labels.length > 10 ? (
            <span className={`graph-focus-pill ${toneClassName}`}>+{labels.length - 10} more</span>
          ) : null}
        </div>
      ) : (
        <p className="muted">{emptyMessage}</p>
      )}
    </section>
  );
}

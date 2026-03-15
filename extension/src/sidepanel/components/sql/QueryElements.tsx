import type { AnalysisStatement } from "../../../shared/types";

interface QueryElementsProps {
  statement: AnalysisStatement | null | undefined;
}

export function QueryElements({ statement }: QueryElementsProps) {
  const ctes = statement?.ctes || [];
  const sources = statement?.sources || [];

  return (
    <div className="query-elements">
      <ElementGroup
        title="CTEs"
        count={ctes.length}
        emptyLabel="No CTEs"
        items={ctes.slice(0, 12).map((cte) => ({
          key: cte.name,
          name: cte.name,
          meta: cte.dependencies?.length
            ? `${cte.dependencies.length} dep`
            : `${cte.sourceCount || 0} src`,
        }))}
      />
      <ElementGroup
        title="Sources"
        count={sources.length}
        emptyLabel="No sources"
        items={sources.slice(0, 12).map((source) => ({
          key: `${source.name}:${source.type || "source"}`,
          name: compactSourceName(source.name),
          meta: source.type || "source",
          title: source.name,
        }))}
      />
    </div>
  );
}

interface ElementGroupProps {
  title: string;
  count: number;
  emptyLabel: string;
  items: Array<{
    key: string;
    name: string;
    meta: string;
    title?: string;
  }>;
}

function ElementGroup({ title, count, emptyLabel, items }: ElementGroupProps) {
  return (
    <section className="query-element-group">
      <div className="query-element-head">
        <h3>{title}</h3>
        <span className="query-element-count">{count}</span>
      </div>
      {items.length ? (
        <div className="query-element-grid">
          {items.map((item) => (
            <div key={item.key} className="query-element-card" title={item.title || item.name}>
              <strong>{item.name}</strong>
              <span>{item.meta}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">{emptyLabel}</p>
      )}
    </section>
  );
}

function compactSourceName(value: string) {
  const parts = String(value || "").split(".");

  if (parts.length <= 2) {
    return value;
  }

  return parts.slice(-2).join(".");
}

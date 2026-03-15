const EDGE_LEGEND_ITEMS = {
  flow: {
    label: "source flow",
    className: "graph-legend-stroke--flow",
  },
  dependency: {
    label: "statement dependency",
    className: "graph-legend-stroke--dependency",
  },
  script: {
    label: "statement flow",
    className: "graph-legend-stroke--flow",
  },
  subquery: {
    label: "nested query",
    className: "graph-legend-stroke--subquery",
  },
  write: {
    label: "write target",
    className: "graph-legend-stroke--write",
  },
} as const;

export type EdgeLegendItemKey = keyof typeof EDGE_LEGEND_ITEMS;

interface EdgeLegendProps {
  items?: EdgeLegendItemKey[];
}

export function EdgeLegend({ items = ["flow", "dependency", "subquery", "write"] }: EdgeLegendProps) {
  return (
    <div className="graph-legend-row" aria-label="Graph line style legend">
      {items.map((item) => {
        const config = EDGE_LEGEND_ITEMS[item];

        return (
          <span key={item} className="graph-legend-item">
            <svg
              className="graph-legend-icon"
              viewBox="0 0 28 10"
              width="28"
              height="10"
              aria-hidden="true"
            >
              <line className={`graph-legend-stroke ${config.className}`} x1="1" y1="5" x2="27" y2="5" />
            </svg>
            <span>{config.label}</span>
          </span>
        );
      })}
    </div>
  );
}

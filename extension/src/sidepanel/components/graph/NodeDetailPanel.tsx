import type { CSSProperties } from "react";

import type { GraphColumn, GraphNode } from "../../../shared/types";
import { graphMetaText, type GraphFocusState, type NodeVisual } from "../../features/graph/model";

interface NodeDetailPanelProps {
  focusState: GraphFocusState;
  columns?: GraphColumn[];
  nodeVisuals?: Map<string, NodeVisual>;
  onSelectNode: (nodeId: string) => void;
  selectedColumnId?: string | null;
  onSelectColumn: (columnId: string) => void;
}

export function NodeDetailPanel({
  focusState,
  columns = [],
  nodeVisuals,
  onSelectNode,
  selectedColumnId,
  onSelectColumn,
}: NodeDetailPanelProps) {
  const node = focusState.selectedNode;

  if (!node) {
    return null;
  }

  return (
    <div className="graph-focus-panel">
      <div className="graph-focus-summary">
        <div className="graph-focus-node">
          <span className="graph-focus-type">{formatNodeType(node)}</span>
          <p className="graph-focus-title">{node.label || node.id}</p>
        </div>
        <div className="graph-focus-stats">
          <span className="graph-focus-stat">{graphMetaText(node)}</span>
          <span className="graph-focus-stat">
            Up {focusState.upstreamNodes.length} · direct {focusState.directUpstreamNodes.length}
          </span>
          <span className="graph-focus-stat">
            Down {focusState.downstreamNodes.length} · direct {focusState.directDownstreamNodes.length}
          </span>
        </div>
      </div>

      {focusState.upstreamNodes.length || focusState.downstreamNodes.length ? (
        <div className="graph-lineage-row">
          {focusState.directUpstreamNodes.length ? (
            <LineageCluster
              label="Direct Upstream"
              toneClassName="is-upstream-direct"
              items={buildLineageItems(
                node,
                focusState.directUpstreamNodes,
                "upstream",
                focusState.directUpstreamRoles,
              )}
              onSelectNode={onSelectNode}
            />
          ) : null}
          {focusState.upstreamChainNodes.length ? (
            <LineageCluster
              label="Upstream Chain"
              toneClassName="is-upstream-chain"
              items={buildLineageItems(node, focusState.upstreamChainNodes, "upstream")}
              onSelectNode={onSelectNode}
            />
          ) : null}
          {focusState.directDownstreamNodes.length ? (
            <LineageCluster
              label="Direct Downstream"
              toneClassName="is-downstream-direct"
              items={buildLineageItems(
                node,
                focusState.directDownstreamNodes,
                "downstream",
                focusState.directDownstreamRoles,
              )}
              onSelectNode={onSelectNode}
            />
          ) : null}
          {focusState.downstreamChainNodes.length ? (
            <LineageCluster
              label="Downstream Chain"
              toneClassName="is-downstream-chain"
              items={buildLineageItems(node, focusState.downstreamChainNodes, "downstream")}
              onSelectNode={onSelectNode}
            />
          ) : null}
        </div>
      ) : null}

      <FoldedSummarySection node={node} />
      <CteFlowSection node={node} />

      <ColumnSection
        node={node}
        columns={columns}
        nodeVisuals={nodeVisuals}
        selectedColumnId={selectedColumnId}
        onSelectColumn={onSelectColumn}
      />
    </div>
  );
}

interface LineageClusterProps {
  label: string;
  toneClassName: string;
  items: LineageItem[];
  onSelectNode: (nodeId: string) => void;
}

interface LineageItem {
  key: string;
  label: string;
  title?: string;
  nodeId?: string;
  role?: string;
}

function LineageCluster({
  label,
  toneClassName,
  items,
  onSelectNode,
}: LineageClusterProps) {
  return (
    <section className="graph-lineage-cluster">
      <div className="graph-lineage-head">
        <h3>{label}</h3>
        <span className="graph-lineage-count">{items.length}</span>
      </div>
      <div className="graph-lineage-list">
        {items.slice(0, 6).map((item) =>
          item.nodeId ? (
            <button
              key={`${label}:${item.key}`}
              type="button"
              className={`graph-lineage-chip ${toneClassName}${item.role ? ` role-${item.role}` : ""}`}
              onClick={() => onSelectNode(item.nodeId || "")}
              title={item.title || item.label}
            >
              {item.role ? <span className="graph-lineage-chip-role">{item.role.toUpperCase()}</span> : null}
              {item.label}
            </button>
          ) : (
            <span
              key={`${label}:${item.key}`}
              className={`graph-lineage-chip ${toneClassName} is-summary`}
              title={item.title || item.label}
            >
              {item.label}
            </span>
          ),
        )}
        {items.length > 6 ? (
          <span className={`graph-lineage-chip ${toneClassName}`}>+{items.length - 6}</span>
        ) : null}
      </div>
    </section>
  );
}

function buildLineageItems(
  selectedNode: GraphNode,
  nodes: GraphNode[],
  direction: "upstream" | "downstream",
  roleMap: Map<string, string> = new Map(),
): LineageItem[] {
  const items: LineageItem[] = [];
  let collapsedPipelineCount = 0;

  for (const node of nodes) {
    if (shouldCollapsePipelineNode(selectedNode, direction, node)) {
      collapsedPipelineCount += 1;
      continue;
    }

    items.push({
      key: node.id,
      label: node.label || node.id,
      title: node.label || node.id,
      nodeId: node.id,
      role: roleMap.get(node.id) || "",
    });
  }

  if (collapsedPipelineCount) {
    items.push({
      key: `summary:${direction}:query-path`,
      label: `Main query path (${collapsedPipelineCount})`,
      title: "Collapsed query pipeline nodes",
    });
  }

  return items;
}

function shouldCollapsePipelineNode(
  selectedNode: GraphNode,
  direction: "upstream" | "downstream",
  node: GraphNode,
) {
  if (direction !== "downstream") {
    return false;
  }

  if (!["source_table", "source_cluster", "cte", "cte_cluster"].includes(String(selectedNode.type || ""))) {
    return false;
  }

  return [
    "statement",
    "join",
    "filter",
    "aggregate",
    "having",
    "qualify",
    "window",
    "orderBy",
    "limit",
    "offset",
    "distinct",
    "union",
    "result",
    "write_target",
  ].includes(String(node.type || ""));
}

function formatNodeType(node: GraphNode) {
  switch (node.type) {
    case "cte":
      return "CTE";
    case "cte_cluster":
      return "CTE GROUP";
    case "source_table":
      return "DB TABLE";
    case "source_cluster":
      return "SOURCE GROUP";
    case "unnest_source":
      return "UNNEST";
    case "lateral_view":
      return "LATERAL VIEW";
    case "statement":
      return "QUERY";
    case "result":
      return "RESULT";
    case "write_target":
      return "WRITE TARGET";
    case "clause_stack":
      return "CLAUSE GROUP";
    case "aggregate":
      return "AGG";
    case "filter":
      return "FILTER";
    case "join":
      return "JOIN";
    case "merge_match":
      return "MATCH ON";
    case "values":
      return "VALUES";
    case "returning":
      return "RETURNING";
    case "conflict":
      return "ON CONFLICT";
    case "conflict_action":
      return "CONFLICT ACTION";
    case "offset":
      return "OFFSET";
    default:
      return String(node.type || "NODE").replace(/_/g, " ").toUpperCase();
  }
}

function FoldedSummarySection({ node }: { node: GraphNode }) {
  const isFoldedGroup = ["clause_stack", "source_cluster", "cte_cluster"].includes(
    String(node.type || ""),
  );

  if (!isFoldedGroup) {
    return null;
  }

  const targetLabel = String(node.meta?.targetLabel || "").trim();
  const memberLabels = Array.isArray(node.meta?.memberLabels)
    ? node.meta.memberLabels.map((value) => String(value || "")).filter(Boolean)
    : [];
  const clauseLabels = Array.isArray(node.meta?.clauseLabels)
    ? node.meta.clauseLabels.map((value) => String(value || "")).filter(Boolean)
    : [];
  const labels = memberLabels.length ? memberLabels : clauseLabels;

  if (!labels.length) {
    return null;
  }

  return (
    <section className="graph-lineage-cluster">
      <div className="graph-lineage-head">
        <h3>{targetLabel ? `Folded for ${targetLabel}` : "Folded Items"}</h3>
        <span className="graph-lineage-count">{labels.length}</span>
      </div>
      <div className="graph-lineage-list">
        {labels.slice(0, 10).map((label) => (
          <span key={`${node.id}:${label}`} className="graph-lineage-chip">
            {label}
          </span>
        ))}
        {labels.length > 10 ? <span className="graph-lineage-chip">+{labels.length - 10}</span> : null}
      </div>
    </section>
  );
}

function CteFlowSection({ node }: { node: GraphNode }) {
  if (node.type !== "cte") {
    return null;
  }

  const flowSequence = Array.isArray(node.meta?.flowSequence)
    ? node.meta.flowSequence.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  if (!flowSequence.length) {
    return null;
  }

  return (
    <section className="graph-lineage-cluster">
      <div className="graph-lineage-head">
        <h3>CTE Flow</h3>
        <span className="graph-lineage-count">{flowSequence.length}</span>
      </div>
      <div className="graph-lineage-list">
        {flowSequence.map((step) => (
          <span key={`${node.id}:flow:${step}`} className="graph-lineage-chip is-flow">
            {step}
          </span>
        ))}
      </div>
    </section>
  );
}

interface ColumnSectionProps {
  node: GraphNode;
  columns: GraphColumn[];
  nodeVisuals?: Map<string, NodeVisual>;
  selectedColumnId?: string | null;
  onSelectColumn: (columnId: string) => void;
}

function ColumnSection({
  node,
  columns,
  nodeVisuals,
  selectedColumnId,
  onSelectColumn,
}: ColumnSectionProps) {
  const nodeColumns = getNodeColumns(node, columns);
  const columnGroups = buildColumnGroups(node, nodeColumns);

  if (!nodeColumns.length) {
    return null;
  }

  return (
    <section className="graph-column-section">
      <div className="graph-column-head">
        <h3>Columns</h3>
        <span className="graph-column-count">{nodeColumns.length}</span>
      </div>

      <div className="graph-column-groups">
        {columnGroups.map((group) => {
          const groupVisual = group.sourceNodeId ? nodeVisuals?.get(group.sourceNodeId) : undefined;
          const groupStyle = buildGroupStyle(groupVisual);

          return (
            <section key={group.key} className="graph-column-group" style={groupStyle}>
              <div className="graph-column-group-head">
                <h4>{group.label}</h4>
                <span className="graph-column-group-count">{group.columns.length}</span>
              </div>
              <div className="graph-column-chip-grid">
                {group.columns.map((column) => (
                  <ColumnChip
                    key={column.id}
                    column={column}
                    node={node}
                    sharedSourceName={group.sourceName || ""}
                    isSelected={selectedColumnId === column.id}
                    onSelectColumn={onSelectColumn}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function getNodeColumns(node: GraphNode, columns: GraphColumn[]) {
  if (!columns.length) {
    return [];
  }

  if (node.type === "source_table") {
    const usageMap = new Map<
      string,
      GraphColumn & {
        _targetNames?: string[];
      }
    >();

    for (const column of columns) {
      for (const ref of column.upstream || []) {
        if (ref.sourceNodeId !== node.id) {
          continue;
        }

        const columnName = ref.columnName || "*";
        const key = `${ref.qualifier || ""}:${columnName}`;

        if (!usageMap.has(key)) {
          usageMap.set(key, {
            id: `${node.id}:ref:${key}`,
            nodeId: node.id,
            name: columnName,
            label: columnName,
            role: "source",
            upstream: [],
            _targetNames: [],
          });
        }

        const current = usageMap.get(key);

        if (current) {
          current._targetNames?.push(column.label || column.name);
        }
      }
    }

    return Array.from(usageMap.values())
      .map((column) => ({
        ...column,
        expressionType: column._targetNames?.length
          ? `${column._targetNames.length} target${column._targetNames.length > 1 ? "s" : ""}`
          : undefined,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  const effectiveNodeId = node.type === "statement" ? "result:main" : node.id;
  return columns.filter((column) => column.nodeId === effectiveNodeId);
}

interface ColumnChipProps {
  column: GraphColumn;
  node: GraphNode;
  sharedSourceName: string;
  isSelected: boolean;
  onSelectColumn: (columnId: string) => void;
}

function ColumnChip({
  column,
  node,
  sharedSourceName,
  isSelected,
  onSelectColumn,
}: ColumnChipProps) {
  const meta = describeCompactColumn(column, node, sharedSourceName);

  return (
    <button
      type="button"
      className={`graph-column-chip ${isSelected ? "is-selected" : ""}`}
      onClick={() => onSelectColumn(column.id)}
      title={column.expressionSql || column.label || column.name}
    >
      <span className="graph-column-chip-name">{column.label || column.name}</span>
      {meta ? <span className="graph-column-chip-meta">{meta}</span> : null}
    </button>
  );
}

function describeCompactColumn(
  column: GraphColumn,
  node: GraphNode,
  singleSharedSource: string,
) {
  if (node.type === "source_table") {
    return column.expressionType || "";
  }

  const refs = dedupeColumnRefs(column.upstream || []);
  const sourceNames = uniqueStrings(
    refs.map((ref) => ref.sourceName || ref.qualifier || "").filter(Boolean),
  );

  if (sourceNames.length > 1) {
    return `${sourceNames.length} src`;
  }

  if (sourceNames.length === 1 && sourceNames[0] !== singleSharedSource) {
    return compactSourceName(sourceNames[0]);
  }

  if (column.role && column.role !== "source") {
    return formatColumnRole(column.role);
  }

  return "";
}

function buildColumnGroups(node: GraphNode, columns: GraphColumn[]) {
  if (node.type === "source_table") {
    return [
      {
        key: "group:source_table",
        label: compactSourceName(node.label || node.id),
        sourceName: node.label || node.id,
        sourceNodeId: node.id,
        columns,
      },
    ];
  }

  const groups = new Map<
    string,
    {
      key: string;
      label: string;
      sourceName?: string;
      sourceNodeId?: string;
      priority: number;
      columns: GraphColumn[];
    }
  >();

  for (const column of columns) {
    const sourceRefs = dedupeColumnRefs(column.upstream || []);
    const sourceNames = uniqueStrings(
      sourceRefs.map((ref) => ref.sourceName || ref.qualifier || "").filter(Boolean),
    );

    let groupKey = "group:derived";
    let label = "Derived";
    let sourceName = "";
    let sourceNodeId = "";
    let priority = 3;

    if (sourceNames.length === 1) {
      sourceName = sourceNames[0];
      sourceNodeId =
        sourceRefs.find((ref) => (ref.sourceName || ref.qualifier || "") === sourceName)?.sourceNodeId ||
        "";
      groupKey = `group:source:${sourceName.toLowerCase()}`;
      label = compactSourceName(sourceName);
      priority = 1;
    } else if (sourceNames.length > 1) {
      groupKey = "group:mixed";
      label = "Mixed Sources";
      priority = 2;
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        label,
        sourceName: sourceName || undefined,
        sourceNodeId: sourceNodeId || undefined,
        priority,
        columns: [],
      });
    }

    groups.get(groupKey)?.columns.push(column);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      columns: group.columns.sort((left, right) =>
        (left.label || left.name).localeCompare(right.label || right.name),
      ),
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        right.columns.length - left.columns.length ||
        left.label.localeCompare(right.label),
    );
}

function dedupeColumnRefs(refs: GraphColumn["upstream"] = []) {
  const seen = new Set<string>();
  const result = [];

  for (const ref of refs) {
    const key = [ref.sourceName || ref.qualifier || "", ref.columnName || "*"].join(":");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(ref);
  }

  return result;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function compactSourceName(value: string) {
  const parts = String(value || "").split(".");

  if (parts.length <= 2) {
    return value;
  }

  return parts.slice(-2).join(".");
}

function buildGroupStyle(visual?: NodeVisual): CSSProperties | undefined {
  if (!visual) {
    return undefined;
  }

  return {
    ["--column-group-accent" as string]: visual.accent,
    ["--column-group-soft" as string]: visual.fill,
  };
}

function formatColumnRole(role: GraphColumn["role"]) {
  switch (role) {
    case "aggregate":
      return "agg";
    case "window":
      return "window";
    case "function":
      return "fx";
    case "derived":
      return "derived";
    case "wildcard":
      return "*";
    default:
      return "";
  }
}

import {
  useEffect,
  useMemo,
  type CSSProperties,
  type PointerEventHandler,
  type RefObject,
} from "react";

import type { AnalysisResult, AnalysisStatement, GraphEdge, GraphNode } from "../../../shared/types";
import {
  buildGraphFocusState,
  computeGraphLayout,
  createEdgePath,
  edgeClassName,
  nodeClassName,
  paletteRolesForMode,
  truncate,
} from "../../features/graph/model";
import {
  buildDirectiveGroupTitle,
  buildStatementDisplayGroups,
} from "../../features/sql/statement-groups";
import { useGraphStore, type GraphColorMode } from "../../state/graph-store";
import { EdgeLegend } from "./EdgeLegend";

interface ScriptViewProps {
  analysis: AnalysisResult | null | undefined;
  zoom: number;
  viewportRef: RefObject<HTMLDivElement>;
  onViewportPointerDown: PointerEventHandler<HTMLDivElement>;
  onViewportPointerMove: PointerEventHandler<HTMLDivElement>;
  onViewportPointerUp: PointerEventHandler<HTMLDivElement>;
  focusedNodeId: string | null;
  onFocusNode: (nodeId: string | null) => void;
  onOpenLogicalFromNode: (nodeId: string, statementIndex: number) => void;
  onBackgroundClick: () => void;
}

interface ScriptBandSummary {
  key: "directive" | "setup" | "flow" | "cleanup";
  title: string;
  count: number;
}

function clearNativeTextSelection() {
  try {
    window.getSelection()?.removeAllRanges();
  } catch (_error) {
    // Ignore selection APIs that are unavailable in the current surface.
  }
}

interface ScriptViewLayout {
  positions: Map<
    string,
    {
      x: number;
      y: number;
      width: number;
      height: number;
    }
  >;
  width: number;
  height: number;
  bands: Array<{
    key: string;
    title: string;
    y: number;
    count: number;
  }>;
}

export function ScriptView({
  analysis,
  zoom,
  viewportRef,
  onViewportPointerDown,
  onViewportPointerMove,
  onViewportPointerUp,
  focusedNodeId,
  onFocusNode,
  onOpenLogicalFromNode,
  onBackgroundClick,
}: ScriptViewProps) {
  const { colorMode } = useGraphStore();
  const statements = analysis?.statements || [];
  const dependencies = analysis?.scriptDependencies || [];
  const graph = useMemo(
    () => buildScriptDependencyGraph(statements, dependencies),
    [dependencies, statements],
  );
  const laneSummary = useMemo(
    () => summarizeScriptBands(graph.nodes, graph.edges),
    [graph.edges, graph.nodes],
  );
  const layout = useMemo(() => computeScriptViewLayout(graph.nodes, graph.edges), [graph.edges, graph.nodes]);
  const focusState = useMemo(
    () => buildGraphFocusState(graph.nodes, graph.edges, focusedNodeId),
    [focusedNodeId, graph.edges, graph.nodes],
  );

  useEffect(() => {
    if (focusedNodeId && !graph.nodes.some((node) => node.id === focusedNodeId)) {
      onFocusNode(null);
    }
  }, [focusedNodeId, graph.nodes, onFocusNode]);

  if (statements.length <= 1) {
    return (
      <div className="graph-empty-state">
        Script View is only available for multi-statement SQL and shows the dependency DAG between statements.
      </div>
    );
  }

  return (
    <div className="graph-stage">
      <div className="graph-meta-row">
        <div className="graph-badge-row">
          <span className="graph-badge">script view</span>
          <span className="graph-badge">
            {graph.nodes.length} cards / {statements.length} statements
          </span>
          {graph.nodes.length < statements.length ? (
            <span className="graph-badge">{statements.length - graph.nodes.length} statements grouped</span>
          ) : null}
          {dependencies.length === 0 ? (
            <span className="graph-badge">independent worksheet</span>
          ) : null}
          <span className="graph-badge">click once to focus</span>
          <span className="graph-badge">click again to open logical graph</span>
          {laneSummary.map((band) => (
            <span key={band.key} className="graph-badge">
              {band.count} {band.title.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      <EdgeLegend items={["script"]} />

      <div
        ref={viewportRef}
        className="graph-canvas-shell"
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest(".graph-node")) {
            return;
          }

          onBackgroundClick();
        }}
      >
        <div
          className="graph-zoom-layer"
          style={buildZoomLayerStyle(layout.width, layout.height, zoom)}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest(".graph-node")) {
              return;
            }

            onBackgroundClick();
          }}
        >
          <svg
            className="graph-svg-stage"
            width={layout.width * zoom}
            height={layout.height * zoom}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label="SQL script dependency graph"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                onBackgroundClick();
              }
            }}
          >
            <defs>
              <marker
                id="react-script-arrow"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(108, 96, 84, 0.3)" />
              </marker>
            </defs>

            {layout.bands.map((band) => (
              <text
                key={band.key}
                className="graph-eyebrow"
                x={16}
                y={band.y}
                style={{ opacity: 0.58 }}
              >
                {band.title}
              </text>
            ))}

            {graph.edges.map((edge) => {
              const source = layout.positions.get(edge.source);
              const target = layout.positions.get(edge.target);

              if (!source || !target) {
                return null;
              }

              return (
                <path
                  key={edge.id}
                  className={`${edgeClassName(edge.type, focusState.edgeState.get(edge.id))} graph-edge--script${edge.source === edge.target ? " graph-edge--self" : ""}`}
                  d={createEdgePath(source, target)}
                  markerEnd="url(#react-script-arrow)"
                  style={
                    {
                      ["--edge-stroke" as string]: "rgba(108, 96, 84, 0.22)",
                    } as CSSProperties
                  }
                />
              );
            })}

            {graph.nodes.map((node) => {
              const position = layout.positions.get(node.id);

              if (!position) {
                return null;
              }

              const statementIndex = getScriptNodeStatementIndex(node);
              const statement =
                typeof statementIndex === "number"
                  ? statements.find((candidate) => candidate.index === statementIndex) || null
                  : null;
              return (
                <ScriptStatementNode
                  key={node.id}
                  node={node}
                  statement={statement}
                  position={position}
                  colorMode={colorMode}
                  focusClassName={focusState.nodeState.get(node.id)}
                  onSelect={() => {
                    if (focusedNodeId === node.id) {
                      if (typeof statementIndex === "number") {
                        onOpenLogicalFromNode(node.id, statementIndex);
                      }
                      return;
                    }

                    onFocusNode(node.id);
                  }}
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

function summarizeScriptBands(nodes: GraphNode[], edges: GraphEdge[]): ScriptBandSummary[] {
  const bands = partitionScriptNodes(nodes, edges);
  const summaries: ScriptBandSummary[] = [
    { key: "directive", title: "Prelude", count: bands.directive.length },
    { key: "setup", title: "Setup", count: bands.setup.length },
    { key: "flow", title: "Flow", count: bands.flow.length },
    { key: "cleanup", title: "Cleanup", count: bands.cleanup.length },
  ];

  return summaries.filter((band) => band.count > 0);
}

export function computeScriptViewLayout(nodes: GraphNode[], edges: GraphEdge[]): ScriptViewLayout {
  const nodeWidth = 192;
  const nodeHeight = 80;
  const columnGap = 18;
  const rowGap = 14;
  const bandGap = 42;
  const bandLabelHeight = 20;
  const outerPaddingX = 16;
  const outerPaddingY = 16;
  const secondaryBandColumns = 3;
  const bands = partitionScriptNodes(nodes, edges);
  const flowEdges = edges.filter(
    (edge) => bands.flow.some((node) => node.id === edge.source) && bands.flow.some((node) => node.id === edge.target),
  );
  const bandLayouts = [
    {
      key: "directive",
      title: "Prelude",
      nodes: bands.directive,
      layout: computeScriptBandGridLayout(bands.directive, secondaryBandColumns, nodeWidth, nodeHeight, columnGap, rowGap),
    },
    {
      key: "setup",
      title: "Setup",
      nodes: bands.setup,
      layout: computeScriptBandGridLayout(bands.setup, secondaryBandColumns, nodeWidth, nodeHeight, columnGap, rowGap),
    },
    {
      key: "flow",
      title: "Data Flow",
      nodes: bands.flow,
      layout: bands.flow.length ? computeGraphLayout(bands.flow, flowEdges) : createEmptyBandLayout(),
    },
    {
      key: "cleanup",
      title: "Cleanup",
      nodes: bands.cleanup,
      layout: computeScriptBandGridLayout(bands.cleanup, secondaryBandColumns, nodeWidth, nodeHeight, columnGap, rowGap),
    },
  ].filter((band) => band.nodes.length);
  const contentWidth = Math.max(...bandLayouts.map((band) => band.layout.width), nodeWidth + outerPaddingX * 2);
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const renderedBands: ScriptViewLayout["bands"] = [];
  let currentY = outerPaddingY;

  for (const band of bandLayouts) {
    const horizontalOffset = outerPaddingX + Math.max(0, (contentWidth - band.layout.width) / 2);
    renderedBands.push({
      key: band.key,
      title: band.title,
      y: currentY + 12,
      count: band.nodes.length,
    });
    currentY += bandLabelHeight;

    for (const [nodeId, position] of band.layout.positions.entries()) {
      positions.set(nodeId, {
        x: position.x + horizontalOffset,
        y: position.y + currentY,
        width: position.width,
        height: position.height,
      });
    }

    currentY += band.layout.height + bandGap;
  }

  return {
    positions,
    width: contentWidth + outerPaddingX * 2,
    height: Math.max(currentY - bandGap + outerPaddingY, outerPaddingY * 2 + nodeHeight),
    bands: renderedBands,
  };
}

function createEmptyBandLayout() {
  return {
    positions: new Map<string, { x: number; y: number; width: number; height: number }>(),
    width: 0,
    height: 0,
  };
}

function computeScriptBandGridLayout(
  nodes: GraphNode[],
  maxColumns: number,
  nodeWidth: number,
  nodeHeight: number,
  columnGap: number,
  rowGap: number,
) {
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const orderedNodes = [...nodes].sort(compareScriptNodes);
  const columns = Math.max(1, maxColumns);
  const groups = chunkScriptNodes(orderedNodes, columns);
  const widestRowCount = Math.max(...groups.map((group) => group.length), 1);
  const width = widestRowCount * nodeWidth + Math.max(widestRowCount - 1, 0) * columnGap;

  groups.forEach((group, rowIndex) => {
    const rowWidth = group.length * nodeWidth + Math.max(group.length - 1, 0) * columnGap;
    const startX = Math.max(0, (width - rowWidth) / 2);
    const y = rowIndex * (nodeHeight + rowGap);

    group.forEach((node, index) => {
      positions.set(node.id, {
        x: startX + index * (nodeWidth + columnGap),
        y,
        width: nodeWidth,
        height: nodeHeight,
      });
    });
  });

  return {
    positions,
    width,
    height: groups.length * nodeHeight + Math.max(groups.length - 1, 0) * rowGap,
  };
}

function partitionScriptNodes(nodes: GraphNode[], edges: GraphEdge[]) {
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  const outgoingCount = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1);
    outgoingCount.set(edge.source, (outgoingCount.get(edge.source) || 0) + 1);
  }

  const bands = {
    directive: [] as GraphNode[],
    setup: [] as GraphNode[],
    flow: [] as GraphNode[],
    cleanup: [] as GraphNode[],
  };

  for (const node of nodes) {
    const displayType = String(node.meta?.displayStatementType || "").trim().toUpperCase();
    const sourceCount = Number(node.meta?.sourceCount ?? 0);
    const clauseCount = Number(node.meta?.clauseCount ?? 0);
    const writeCount = Number(node.meta?.writeCount ?? 0);
    const hasDependencies = (incomingCount.get(node.id) || 0) > 0;
    const hasDependents = (outgoingCount.get(node.id) || 0) > 0;
    const hasFlowSignal =
      hasDependencies ||
      hasDependents ||
      sourceCount > 0 ||
      clauseCount > 0 ||
      displayType === "INSERT" ||
      displayType === "REBUILD";

    if (Boolean(node.meta?.directiveGroup) || displayType === "DIRECTIVE") {
      bands.directive.push(node);
      continue;
    }

    if (["DROP", "ALTER"].includes(displayType) && !hasFlowSignal) {
      bands.cleanup.push(node);
      continue;
    }

    if (hasFlowSignal) {
      bands.flow.push(node);
      continue;
    }

    if (displayType === "CREATE" || writeCount > 0) {
      bands.setup.push(node);
      continue;
    }

    bands.flow.push(node);
  }

  return bands;
}

function compareScriptNodes(left: GraphNode, right: GraphNode) {
  const leftIndex = Number(left.meta?.statementIndex ?? Number.NaN);
  const rightIndex = Number(right.meta?.statementIndex ?? Number.NaN);

  if (Number.isFinite(leftIndex) && Number.isFinite(rightIndex) && leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return String(left.label || left.id).localeCompare(String(right.label || right.id));
}

function chunkScriptNodes<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks.length ? chunks : [[]];
}

interface ScriptStatementNodeProps {
  node: GraphNode;
  statement: AnalysisStatement | null;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  colorMode: GraphColorMode;
  focusClassName?: string;
  onSelect: () => void;
}

function ScriptStatementNode({
  node,
  statement,
  position,
  colorMode,
  focusClassName,
  onSelect,
}: ScriptStatementNodeProps) {
  const isSelected = focusClassName === "is-selected";
  const visual = createScriptNodeVisual(node, statement, colorMode);
  const style = {
    ["--node-fill" as string]: visual.fill,
    ["--node-stroke" as string]: visual.stroke,
    ["--node-accent" as string]: visual.accent,
    ["--node-text" as string]: visual.text,
  } as CSSProperties;

  return (
    <g
      className={nodeClassName({ id: node.id, type: "script_statement" }, focusClassName)}
      role="button"
      tabIndex={0}
      style={style}
      onMouseDown={(event) => {
        event.preventDefault();
        clearNativeTextSelection();
      }}
      onClick={(event) => {
        event.stopPropagation();
        (event.currentTarget as Element & { blur?: () => void }).blur?.();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
        }
      }}
    >
      {isSelected ? (
        <rect
          className="graph-node-halo"
          x={position.x - 6}
          y={position.y - 6}
          width={position.width + 12}
          height={position.height + 12}
          rx={21}
          ry={21}
        />
      ) : null}
      <rect
        className="graph-node-body"
        x={position.x}
        y={position.y}
        width={position.width}
        height={position.height}
        rx={15}
        ry={15}
      />
      <text className="graph-eyebrow" x={position.x + 14} y={position.y + 20}>
        {getScriptNodeEyebrow(node, statement)}
      </text>
      <text className="graph-label" x={position.x + 14} y={position.y + 38}>
        {truncate(getScriptNodeLabel(node, statement), 24)}
      </text>
      <text className="graph-meta" x={position.x + 14} y={position.y + 56}>
        {buildStatementMeta(node, statement)}
      </text>
      <title>{`${getScriptNodeLabel(node, statement)} · ${buildStatementMeta(node, statement)}`}</title>
    </g>
  );
}

type ScriptDisplayNode = GraphNode & {
  meta?: Record<string, unknown>;
};

function getScriptNodeStatementIndex(node: GraphNode) {
  const index = Number(node.meta?.statementIndex);
  return Number.isFinite(index) ? index : null;
}

function getScriptNodeLabel(node: GraphNode, statement: AnalysisStatement | null) {
  return String(node.label || statement?.title || node.id);
}

function getScriptNodeEyebrow(node: GraphNode, statement: AnalysisStatement | null) {
  if (Boolean(node.meta?.directiveGroup)) {
    return "DIRECTIVE";
  }

  return String(node.meta?.displayStatementType || statement?.statementType || "STATEMENT");
}

export function buildScriptDependencyGraph(
  statements: AnalysisStatement[],
  dependencies: AnalysisResult["scriptDependencies"],
) {
  const displayNodes: ScriptDisplayNode[] = [];
  const statementIndexToNodeId = new Map<number, string>();
  const displayGroups = buildStatementDisplayGroups(statements);

  for (const group of displayGroups) {
    const primaryStatement = group.statements[0];
    const representativeStatement = group.statements[group.statements.length - 1];

    if (group.kind !== "single") {
      displayNodes.push({
        id: group.id,
        type: "script_statement",
        label:
          group.kind === "directive"
            ? buildDirectiveGroupTitle(group.statements)
            : group.title,
        meta: {
          statementIndex: group.primaryIndex,
          statementIndexes: group.statementIndexes,
          directiveGroup: group.kind === "directive",
          groupedStatementCount: group.statements.length,
          directiveCount: group.kind === "directive" ? group.statements.length : 0,
          displayStatementType: group.kind === "directive" ? "DIRECTIVE" : "REBUILD",
          sourceCount: representativeStatement.summary?.sourceCount ?? 0,
          clauseCount: representativeStatement.summary?.clauseCount ?? 0,
          dependencyCount: representativeStatement.dependencies?.length ?? 0,
          writeCount: representativeStatement.writes?.length ?? 0,
        },
      });

      for (const entry of group.statements) {
        statementIndexToNodeId.set(entry.index, group.id);
      }

      continue;
    }

    displayNodes.push({
      id: primaryStatement.id,
      type: "script_statement",
      label: primaryStatement.title || `Statement ${primaryStatement.index + 1}`,
      meta: {
        statementIndex: primaryStatement.index,
        sourceCount: primaryStatement.summary?.sourceCount ?? 0,
        clauseCount: primaryStatement.summary?.clauseCount ?? 0,
        dependencyCount: primaryStatement.dependencies?.length ?? 0,
        writeCount: primaryStatement.writes?.length ?? 0,
        displayStatementType: primaryStatement.statementType || "STATEMENT",
      },
    });
    statementIndexToNodeId.set(primaryStatement.index, primaryStatement.id);
  }

  const edgeSeen = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const dependency of dependencies || []) {
    const sourceNodeId = statementIndexToNodeId.get(dependency.sourceIndex);
    const targetNodeId = statementIndexToNodeId.get(dependency.targetIndex);

    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
      continue;
    }

    const edgeKey = `${sourceNodeId}->${targetNodeId}:${dependency.type || "depends_on"}`;

    if (edgeSeen.has(edgeKey)) {
      continue;
    }

    edgeSeen.add(edgeKey);
    edges.push({
      id: `script:${edgeKey}`,
      source: sourceNodeId,
      target: targetNodeId,
      type: dependency.type || "depends_on",
    });
  }

  return {
    nodes: displayNodes,
    edges,
  };
}

function buildStatementMeta(node: GraphNode, statement: AnalysisStatement | null) {
  if (Boolean(node.meta?.directiveGroup)) {
    const directiveCount = Number(node.meta?.directiveCount ?? 0);
    return `${directiveCount} session directives`;
  }

  const groupedCount = Number(node.meta?.groupedStatementCount ?? 0);

  if (groupedCount > 1) {
    const sourceCount = Number(node.meta?.sourceCount ?? 0);
    const clauseCount = Number(node.meta?.clauseCount ?? 0);
    const writeCount = Number(node.meta?.writeCount ?? 0);
    return `${groupedCount} statements · ${sourceCount} source · ${clauseCount} clauses · ${writeCount} writes`;
  }

  if (["SET", "USE", "CONFIG"].includes(String(statement?.statementType || "").toUpperCase())) {
    return "session directive";
  }

  const sourceCount = statement?.summary?.sourceCount ?? 0;
  const clauseCount = statement?.summary?.clauseCount ?? 0;
  const writeCount = statement?.writes?.length ?? 0;
  return `${sourceCount} source · ${clauseCount} clauses · ${writeCount} writes`;
}

function createScriptNodeVisual(node: GraphNode, statement: AnalysisStatement | null, colorMode: GraphColorMode) {
  const directiveGroup = Boolean(node.meta?.directiveGroup);
  const groupedCount = Number(node.meta?.groupedStatementCount ?? 0);
  const writes =
    Number(node.meta?.writeCount ?? Number.NaN) || statement?.writes?.length || 0;
  const dependencies =
    Number(node.meta?.dependencyCount ?? Number.NaN) || statement?.dependencies?.length || 0;
  const dependents = statement?.dependents?.length ?? 0;
  const roles = paletteRolesForMode(colorMode);
  const accent =
    directiveGroup || ["SET", "USE", "CONFIG"].includes(String(statement?.statementType || "").toUpperCase())
      ? blendRgb(roles.soft, roles.light, 0.4)
      : groupedCount > 1
        ? blendRgb(roles.main, roles.soft, 0.35)
      : writes > 0
        ? roles.deep
        : dependents > 0
          ? roles.main
          : dependencies > 0
            ? roles.soft
            : blendRgb(roles.main, roles.light, 0.5);

  return {
    fill: rgbaString(blendRgb({ r: 255, g: 255, b: 255 }, accent, directiveGroup ? 0.12 : 0.18), 0.96),
    stroke: rgbaString(blendRgb(accent, roles.soft, directiveGroup ? 0.4 : 0.22), directiveGroup ? 0.3 : 0.24),
    accent: rgbToHex(accent),
    text: rgbToHex(roles.deep),
  };
}

function buildZoomLayerStyle(width: number, height: number, zoom: number) {
  return {
    width: width * zoom,
    minWidth: "100%",
    height: height * zoom,
    ["--graph-eyebrow-size" as string]: `${computeFontSize(9, 8.2, zoom)}px`,
    ["--graph-label-size" as string]: `${computeFontSize(12, 10.5, zoom)}px`,
    ["--graph-meta-size" as string]: `${computeFontSize(10, 9.2, zoom)}px`,
  } as CSSProperties;
}

function computeFontSize(baseSize: number, minRenderedSize: number, zoom: number) {
  if (zoom >= 1) {
    return baseSize;
  }

  return Number(Math.max(baseSize, minRenderedSize / zoom).toFixed(2));
}

function blendRgb(
  base: { r: number; g: number; b: number },
  accent: { r: number; g: number; b: number },
  ratio: number,
) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return {
    r: Math.round(base.r + (accent.r - base.r) * clamped),
    g: Math.round(base.g + (accent.g - base.g) * clamped),
    b: Math.round(base.b + (accent.b - base.b) * clamped),
  };
}

function rgbaString(rgb: { r: number; g: number; b: number }, alpha: number) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function rgbToHex(rgb: { r: number; g: number; b: number }) {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

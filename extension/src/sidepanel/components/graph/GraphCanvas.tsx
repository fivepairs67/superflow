import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type {
  AnalysisResult,
  AnalysisStatement,
  ExecutionState,
  GraphColumn,
  GraphNode,
  QueryGraph,
} from "../../../shared/types";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { GraphToolbar } from "./GraphToolbar";
import { ScriptView, buildScriptDependencyGraph } from "./ScriptView";
import { EdgeLegend } from "./EdgeLegend";
import { useGraphStore } from "../../state/graph-store";
import {
  buildGraphFocusState,
  computeFlowVisualContext,
  computeGraphLayout,
  createEdgePath,
  edgeClassName,
  graphEyebrowText,
  graphMetaText,
  nodeClassName,
  truncate,
} from "../../features/graph/model";
import {
  findNarrowestNodeByRange,
  getNodeSpans,
  normalizeGraphSpans,
} from "../../features/graph/spans";

interface GraphCanvasProps {
  analysis: AnalysisResult | null | undefined;
  statement: AnalysisStatement | null | undefined;
  execution?: ExecutionState | null;
  isSqlLab?: boolean;
  sqlSelectionText?: string;
  sqlSelectionStart?: number | null;
  sqlSelectionEnd?: number | null;
  controlsCollapsed?: boolean;
}

const MIN_ZOOM = 0.58;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.14;

export function GraphCanvas({
  analysis,
  statement,
  execution,
  isSqlLab = false,
  sqlSelectionText,
  sqlSelectionStart,
  sqlSelectionEnd,
  controlsCollapsed = false,
}: GraphCanvasProps) {
  const {
    selectedNodeId,
    selectedColumnId,
    selectedStatementIndex,
    ignoredEditorSelectionSignature,
    selectNode,
    selectColumn,
    clearSelection,
    selectStatementIndex,
    setIgnoredEditorSelectionSignature,
    viewMode,
    setViewMode,
    colorMode,
    setColorMode,
  } = useGraphStore();
  const [zoom, setZoom] = useState(1);
  const [compactMode, setCompactMode] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastSqlSelectionRef = useRef("");
  const ignoredSelectionSignatureRef = useRef("");
  const pendingNodeSelectionRef = useRef<string | null>(null);
  const suppressBackgroundResetRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    moved: boolean;
  } | null>(null);
  const logicalGraph = useMemo(
    () => buildLogicalDisplayGraph(statement?.graph, compactMode, selectedNodeId),
    [compactMode, selectedNodeId, statement?.graph],
  );
  const logicalNodes = logicalGraph.nodes;
  const logicalEdges = logicalGraph.edges;
  const scriptGraph = useMemo(
    () => buildScriptDependencyGraph(analysis?.statements || [], analysis?.scriptDependencies || []),
    [analysis?.scriptDependencies, analysis?.statements],
  );
  const logicalLayout = useMemo(
    () => computeGraphLayout(logicalNodes, logicalEdges),
    [logicalEdges, logicalNodes],
  );
  const scriptLayout = useMemo(
    () => computeGraphLayout(scriptGraph.nodes, scriptGraph.edges),
    [scriptGraph.edges, scriptGraph.nodes],
  );
  const selectedColumn = useMemo<GraphColumn | null>(
    () =>
      selectedColumnId && statement?.graph?.columns?.length
        ? statement.graph.columns.find((column) => column.id === selectedColumnId) || null
        : null,
    [selectedColumnId, statement?.graph?.columns],
  );
  const focusState = useMemo(
    () =>
      buildGraphFocusState(
        logicalNodes,
        logicalEdges,
        viewMode === "logical" ? selectedNodeId : null,
        viewMode === "logical" ? selectedColumn : null,
        statement?.graph?.columns || [],
      ),
    [logicalEdges, logicalNodes, selectedColumn, selectedNodeId, statement?.graph?.columns, viewMode],
  );
  const flowContext = useMemo(
    () => computeFlowVisualContext(logicalNodes, logicalEdges, colorMode),
    [colorMode, logicalEdges, logicalNodes],
  );
  const activeLayout = viewMode === "script" ? scriptLayout : logicalLayout;
  const hasScriptView = (analysis?.statements?.length || 0) > 1;
  const canCompact = hasFoldableClauses(statement?.graph);
  const editorSelectionSignature = buildSelectionSignature(
    sqlSelectionText,
    sqlSelectionStart,
    sqlSelectionEnd,
  );

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }

    if (!logicalNodes.some((node) => node.id === selectedNodeId)) {
      clearSelection();
    }
  }, [clearSelection, logicalNodes, selectedNodeId]);

  useEffect(() => {
    if (!selectedColumnId) {
      return;
    }

    if (!statement?.graph?.columns?.some((column) => column.id === selectedColumnId)) {
      selectColumn(selectedColumnId);
    }
  }, [selectColumn, selectedColumnId, statement?.graph?.columns]);

  useEffect(() => {
    if (viewMode === "script" && !hasScriptView) {
      setViewMode("logical");
    }
  }, [hasScriptView, setViewMode, viewMode]);

  useEffect(() => {
    const selectionSignature = buildSelectionSignature(
      sqlSelectionText,
      sqlSelectionStart,
      sqlSelectionEnd,
    );

    if (
      ignoredSelectionSignatureRef.current &&
      selectionSignature !== ignoredSelectionSignatureRef.current
    ) {
      ignoredSelectionSignatureRef.current = "";
    }

    if (
      ignoredEditorSelectionSignature &&
      selectionSignature &&
      selectionSignature === ignoredEditorSelectionSignature
    ) {
      return;
    }

    if (
      ignoredEditorSelectionSignature &&
      selectionSignature !== ignoredEditorSelectionSignature
    ) {
      setIgnoredEditorSelectionSignature("");
    }

    if (
      selectionSignature &&
      selectionSignature === ignoredSelectionSignatureRef.current
    ) {
      return;
    }

    const statementForToken =
      typeof sqlSelectionStart === "number"
        ? findStatementBySelectionRange(analysis?.statements || [], sqlSelectionStart, sqlSelectionEnd)
        : statement || null;
    const normalizedSelection = resolveSelectionToken(
      statementForToken,
      sqlSelectionText,
      sqlSelectionStart,
    );
    const statementFromRange =
      typeof sqlSelectionStart === "number"
        ? findStatementBySelectionRange(analysis?.statements || [], sqlSelectionStart, sqlSelectionEnd)
        : null;

    if (!normalizedSelection && !statementFromRange) {
      return;
    }

    if (
      normalizedSelection &&
      normalizedSelection === lastSqlSelectionRef.current &&
      (!statementFromRange || statementFromRange.index === selectedStatementIndex)
    ) {
      return;
    }

    if (normalizedSelection) {
      lastSqlSelectionRef.current = normalizedSelection;
    }

    if (!analysis?.statements?.length && !statement?.graph?.nodes?.length) {
      return;
    }

    if (statementFromRange && statementFromRange.index !== selectedStatementIndex) {
      const rangeMatchNode = findBestSelectionNode(
        statementFromRange,
        normalizedSelection,
        sqlSelectionStart,
        sqlSelectionEnd,
      );

      pendingNodeSelectionRef.current = rangeMatchNode?.id || null;
      setViewMode("logical");
      selectStatementIndex(statementFromRange.index);
      return;
    }

    const currentMatch =
      statement?.graph?.nodes?.length && viewMode === "logical"
        ? findBestSelectionNode(statement, normalizedSelection, sqlSelectionStart, sqlSelectionEnd)
        : null;

    if (currentMatch) {
      if (currentMatch.id !== selectedNodeId) {
        selectNode(currentMatch.id, "editor");
      }
      return;
    }

    const fallbackMatchedStatement = (analysis?.statements || []).find((candidate) =>
      findBestSelectionNode(candidate, normalizedSelection, sqlSelectionStart, sqlSelectionEnd),
    );

    if (!fallbackMatchedStatement) {
      return;
    }

    const matchedNode = findBestSelectionNode(
      fallbackMatchedStatement,
      normalizedSelection,
      sqlSelectionStart,
      sqlSelectionEnd,
    );

    if (!matchedNode) {
      return;
    }

    if (fallbackMatchedStatement.index !== selectedStatementIndex) {
      pendingNodeSelectionRef.current = matchedNode.id;
      setViewMode("logical");
      selectStatementIndex(fallbackMatchedStatement.index);
      return;
    }

    if (matchedNode.id !== selectedNodeId) {
      selectNode(matchedNode.id, "editor");
    }
  }, [
    analysis?.statements,
    selectNode,
    selectStatementIndex,
    selectedNodeId,
    selectedStatementIndex,
    setViewMode,
    sqlSelectionEnd,
    sqlSelectionStart,
    sqlSelectionText,
    ignoredEditorSelectionSignature,
    setIgnoredEditorSelectionSignature,
    statement?.ctes,
    statement?.graph?.nodes,
    statement?.rangeStart,
    viewMode,
  ]);

  useEffect(() => {
    const pendingNodeId = pendingNodeSelectionRef.current;

    if (!pendingNodeId || !statement?.graph?.nodes?.some((node) => node.id === pendingNodeId)) {
      return;
    }

    pendingNodeSelectionRef.current = null;

    if (pendingNodeId !== selectedNodeId) {
      selectNode(pendingNodeId, "editor");
    }
  }, [selectNode, selectedNodeId, statement?.graph?.nodes]);

  return (
    <div className="graph-stage">
      {!controlsCollapsed ? (
        <GraphToolbar
          hasScriptView={hasScriptView}
          viewMode={viewMode}
          colorMode={colorMode}
          zoom={zoom}
          zoomLevel={Math.max(0, Math.min(1, (zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)))}
          compactMode={compactMode}
          canCompact={viewMode === "logical" && canCompact}
          onSetViewMode={setViewMode}
          onSetColorMode={setColorMode}
          onZoomOut={() => setZoom((current) => clampZoom(current - ZOOM_STEP))}
          onZoomIn={() => setZoom((current) => clampZoom(current + ZOOM_STEP))}
          onFit={() => fitViewport(viewportRef.current, activeLayout.width, setZoom)}
          onResetView={() => resetViewport(viewportRef.current, setZoom)}
          onToggleCompact={() => setCompactMode((current) => !current)}
        />
      ) : null}

      {viewMode === "script" ? (
        <ScriptView
          analysis={analysis}
          zoom={zoom}
          editorSelectionSignature={editorSelectionSignature}
          viewportRef={viewportRef}
          onViewportPointerDown={handleViewportPointerDown}
          onViewportPointerMove={handleViewportPointerMove}
          onViewportPointerUp={handleViewportPointerUp}
        />
      ) : logicalNodes.length ? (
        <>
          <div className="graph-meta-row">
            <div className="graph-badge-row">
              <span className="graph-badge">{statement?.mode || "empty"}</span>
              <span className="graph-badge">
                {logicalNodes.length} nodes / {logicalEdges.length} edges
              </span>
              {statement?.title ? <span className="graph-badge">{statement.title}</span> : null}
              {compactMode ? <span className="graph-badge">folded clauses</span> : null}
              {buildExecutionBadges(execution, isSqlLab).map((badge) => (
                <span
                  key={badge.key}
                  className={`graph-badge ${badge.kind === "secondary" ? "graph-badge--secondary" : ""}${badge.kind === "alert" ? " graph-badge--alert" : ""}`}
                  title={badge.title}
                >
                  {badge.label}
                </span>
              ))}
            </div>
            <div className="graph-action-row">
              {controlsCollapsed && hasScriptView ? (
                <button className="graph-reset-button" type="button" onClick={() => setViewMode("script")}>
                  Script View
                </button>
              ) : null}
              {selectedNodeId ? (
                <button className="graph-reset-button" type="button" onClick={handleManualFocusReset}>
                  Focus Reset
                </button>
              ) : null}
            </div>
          </div>

          {statement?.mode !== "ast" && statement?.parserErrorMessage ? (
            <div className="graph-parser-note">
              <span className="graph-parser-note-label">Fallback</span>
              <span>{statement.parserErrorMessage}</span>
            </div>
          ) : null}

          <EdgeLegend items={["flow", "subquery", "write"]} />

          <div
            ref={viewportRef}
            className="graph-canvas-shell"
            onPointerDown={handleViewportPointerDown}
            onPointerMove={handleViewportPointerMove}
            onPointerUp={handleViewportPointerUp}
            onPointerCancel={handleViewportPointerUp}
            onClick={handleBackgroundClick}
          >
          <div
              className="graph-zoom-layer"
              style={buildZoomLayerStyle(logicalLayout.width, logicalLayout.height, zoom)}
              onClick={handleBackgroundClick}
            >
              <svg
                className="graph-svg-stage"
                width={logicalLayout.width * zoom}
                height={logicalLayout.height * zoom}
                viewBox={`0 0 ${logicalLayout.width} ${logicalLayout.height}`}
                role="img"
                aria-label="SQL logical graph"
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    clearSelection();
                  }
                }}
              >
                <defs>
                  <ArrowMarker />
                  {Array.from(flowContext.nodeVisuals.values())
                    .filter((visual) => visual.gradientStops.length > 1 && visual.gradientId)
                    .map((visual) => (
                      <linearGradient
                        key={visual.gradientId}
                        id={visual.gradientId || undefined}
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        {visual.gradientStops.map((stop) => (
                          <stop
                            key={`${visual.gradientId}:${stop.offset}`}
                            offset={stop.offset}
                            stopColor={stop.color}
                            stopOpacity={stop.opacity}
                          />
                        ))}
                      </linearGradient>
                    ))}
                </defs>

                {logicalEdges.map((edge) => {
                  const source = logicalLayout.positions.get(edge.source);
                  const target = logicalLayout.positions.get(edge.target);

                  if (!source || !target) {
                    return null;
                  }

                  const edgeStyle = {
                    ["--edge-stroke" as string]:
                      flowContext.edgeVisuals.get(edge.id)?.stroke || "rgba(45, 38, 31, 0.22)",
                  } as CSSProperties;

                  return (
                    <path
                      key={edge.id}
                      className={`${edgeClassName(edge.type, focusState.edgeState.get(edge.id))}${edge.source === edge.target ? " graph-edge--self" : ""}`}
                      markerEnd="url(#react-graph-arrow)"
                      d={createEdgePath(source, target)}
                      style={edgeStyle}
                    />
                  );
                })}

                {logicalNodes.map((node) => {
                  const position = logicalLayout.positions.get(node.id);

                  if (!position) {
                    return null;
                  }

                  const visual = flowContext.nodeVisuals.get(node.id);

                  return (
                    <GraphNodeGroup
                      key={node.id}
                      node={node}
                      position={position}
                      visual={visual}
                      focusClassName={focusState.nodeState.get(node.id)}
                      onSelect={handlePanelNodeSelect}
                    />
                  );
                })}
              </svg>
            </div>
          </div>

          <NodeDetailPanel
            focusState={focusState}
            columns={statement?.graph?.columns || []}
            nodeVisuals={flowContext.nodeVisuals}
            onSelectNode={handlePanelNodeSelect}
            selectedColumnId={selectedColumnId}
            onSelectColumn={handlePanelColumnSelect}
          />

          <div className="flow-row">
            {(statement?.flowSequence || []).length ? (
              (statement?.flowSequence || []).map((step) => (
                <span key={step} className="flow-chip">
                  {step}
                </span>
              ))
            ) : (
              <span className="muted">No flow sequence</span>
            )}
          </div>
        </>
      ) : (
      <div className="graph-empty-state">
        No analysis graph is available yet. The React canvas is waiting for the current session.
      </div>
      )}
    </div>
  );

  function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    if ((event.target as HTMLElement).closest(".graph-node")) {
      return;
    }

    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: viewport.scrollLeft,
      startTop: viewport.scrollTop,
      moved: false,
    };
    viewport.setPointerCapture?.(event.pointerId);
    viewport.classList.add("is-dragging");
  }

  function handleViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragRef.current;
    const viewport = viewportRef.current;

    if (!dragState || !viewport || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (
      !dragState.moved &&
      (Math.abs(event.clientX - dragState.startX) > 4 || Math.abs(event.clientY - dragState.startY) > 4)
    ) {
      dragState.moved = true;
    }

    viewport.scrollLeft = dragState.startLeft - (event.clientX - dragState.startX);
    viewport.scrollTop = dragState.startTop - (event.clientY - dragState.startY);
  }

  function handleViewportPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const dragState = dragRef.current;

    if (!viewport || !dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (dragState.moved) {
      suppressBackgroundResetRef.current = true;
      window.setTimeout(() => {
        suppressBackgroundResetRef.current = false;
      }, 0);
    }

    dragRef.current = null;
    viewport.releasePointerCapture?.(event.pointerId);
    viewport.classList.remove("is-dragging");
  }

  function handleBackgroundClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (suppressBackgroundResetRef.current) {
      return;
    }

    if ((event.target as HTMLElement).closest(".graph-node")) {
      return;
    }

    handleManualFocusReset();
  }

  function handleManualFocusReset() {
    ignoredSelectionSignatureRef.current = buildSelectionSignature(
      sqlSelectionText,
      sqlSelectionStart,
      sqlSelectionEnd,
    );
    clearSelection();
  }

  function handlePanelNodeSelect(nodeId: string) {
    ignoredSelectionSignatureRef.current = buildSelectionSignature(
      sqlSelectionText,
      sqlSelectionStart,
      sqlSelectionEnd,
    );
    selectNode(nodeId, "panel");
  }

  function handlePanelColumnSelect(columnId: string) {
    ignoredSelectionSignatureRef.current = buildSelectionSignature(
      sqlSelectionText,
      sqlSelectionStart,
      sqlSelectionEnd,
    );
    selectColumn(columnId, "panel");
  }
}

interface GraphNodeGroupProps {
  node: GraphNode;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  visual?: {
    fill: string;
    bandFill: string;
    stroke: string;
    accent: string;
    text: string;
    swatchColors?: string[];
  };
  focusClassName?: string;
  onSelect: (nodeId: string) => void;
}

function GraphNodeGroup({
  node,
  position,
  visual,
  focusClassName,
  onSelect,
}: GraphNodeGroupProps) {
  const isSelected = focusClassName === "is-selected";
  const display = buildNodeDisplay(node);
  const nodeVisual = visual || {
    fill: "rgba(249, 247, 243, 0.96)",
    bandFill: "#7d6c5a",
    stroke: "rgba(149, 136, 122, 0.24)",
    accent: "#7d6c5a",
    text: "#2f2923",
    swatchColors: ["#7d6c5a"],
  };
  const style = {
    ["--node-fill" as string]: nodeVisual.fill,
    ["--node-stroke" as string]: nodeVisual.stroke,
    ["--node-accent" as string]: nodeVisual.accent,
    ["--node-text" as string]: nodeVisual.text,
  } as CSSProperties;

  return (
    <g
      className={nodeClassName(node, focusClassName)}
      role="button"
      tabIndex={0}
      aria-label={`Select ${node.label || node.id}`}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          event.stopPropagation();
          onSelect(node.id);
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
      {nodeVisual.swatchColors?.length ? (
        <g aria-hidden="true">
          {buildStripeSegments(position, nodeVisual.swatchColors).map((segment, index) => (
            <rect
              key={`${node.id}:stripe:${index}`}
              className="graph-node-stripe"
              x={segment.x}
              y={segment.y}
              width={segment.width}
              height={segment.height}
              rx={segment.rx}
              ry={segment.ry}
              fill={segment.fill}
            />
          ))}
        </g>
      ) : null}
      <text className="graph-eyebrow" x={position.x + 14} y={position.y + 20}>
        {graphEyebrowText(node)}
      </text>
      <text className="graph-label" x={position.x + 14} y={position.y + 38}>
        {display.labelLines.map((line, index) => (
          <tspan key={`${node.id}:label:${index}`} x={position.x + 14} dy={index === 0 ? 0 : 13}>
            {line}
          </tspan>
        ))}
      </text>
      <text
        className="graph-meta"
        x={position.x + 14}
        y={position.y + (display.labelLines.length > 1 ? 68 : 56)}
      >
        {display.meta}
      </text>
      <title>{`${node.label || node.id} · ${display.meta}`}</title>
    </g>
  );
}

function buildStripeSegments(
  position: { x: number; y: number; width: number; height: number },
  swatchColors: string[],
) {
  const colors = swatchColors.slice(0, 4);
  const insetX = position.x + 5;
  const insetY = position.y + 7;
  const stripeWidth = 7;
  const availableHeight = position.height - 14;
  const segmentGap = 2;
  const segmentHeight =
    (availableHeight - segmentGap * Math.max(colors.length - 1, 0)) / Math.max(colors.length, 1);

  return colors.map((color, index) => ({
    x: insetX,
    y: insetY + index * (segmentHeight + segmentGap),
    width: stripeWidth,
    height: segmentHeight,
    rx: 4,
    ry: 4,
    fill: color,
  }));
}

function ArrowMarker() {
  return (
    <marker
      id="react-graph-arrow"
      viewBox="0 0 10 10"
      refX="7"
      refY="5"
      markerWidth="5"
      markerHeight="5"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(108, 96, 84, 0.28)" />
    </marker>
  );
}

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));
}

function buildExecutionBadges(execution: ExecutionState | null | undefined, isSqlLab: boolean) {
  if (!execution) {
    return [];
  }

  const badges: Array<{
    key: string;
    label: string;
    title?: string;
    kind?: "secondary" | "alert";
  }> = [];

  if (typeof execution.rowCount === "number") {
    badges.push({
      key: "rows",
      label: `${execution.rowCount} rows`,
    });
  }

  if (typeof execution.durationMs === "number") {
    badges.push({
      key: "duration",
      label: `${execution.durationMs} ms`,
    });
  }

  const status = String(execution.status || "").toLowerCase();

  if (status && status !== "idle" && (!isSqlLab || !["success"].includes(status))) {
    badges.push({
      key: "status",
      label: status,
      kind: status === "failed" || status === "canceled" ? "alert" : "secondary",
    });
  }

  if (execution.errorMessage) {
    badges.push({
      key: "error",
      label: truncate(execution.errorMessage, 32),
      title: execution.errorMessage,
      kind: "alert",
    });
  }

  return badges;
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

function buildNodeDisplay(node: GraphNode) {
  if (node.type === "source_table") {
    const qualified = splitQualifiedLabel(node.label || node.id);
    return {
      labelLines: wrapNodeLabel(qualified.objectName, 18, 2),
      meta: qualified.namespace || graphMetaText(node),
    };
  }

  return {
    labelLines: wrapNodeLabel(node.label || node.id, 18, 2),
    meta: graphMetaText(node),
  };
}

function splitQualifiedLabel(value: string) {
  const parts = String(value || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return {
      namespace: "",
      objectName: value,
    };
  }

  return {
    namespace: truncateMiddle(parts.slice(0, -1).join("."), 24),
    objectName: parts[parts.length - 1],
  };
}

function wrapNodeLabel(value: string, maxLineLength: number, maxLines: number) {
  const raw = String(value || "").trim();

  if (!raw) {
    return ["-"];
  }

  const tokens = raw
    .split(/(?<=[._-])/)
    .filter(Boolean)
    .flatMap((token) => splitOversizedToken(token, maxLineLength));
  const lines: string[] = [];
  let currentLine = "";

  for (const token of tokens.length ? tokens : [raw]) {
    if (!currentLine) {
      currentLine = token;
      continue;
    }

    if ((currentLine + token).length <= maxLineLength) {
      currentLine += token;
      continue;
    }

    lines.push(currentLine);
    currentLine = token;

    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (lines.length < maxLines && currentLine) {
    lines.push(currentLine);
  }

  if (!lines.length) {
    lines.push(raw);
  }

  const normalized = lines.slice(0, maxLines).map((line) => line.trim()).filter(Boolean);
  const consumed = normalized.join("");
  const compactRaw = raw.replace(/\s+/g, "");
  const compactConsumed = consumed.replace(/\s+/g, "");

  if (compactConsumed.length < compactRaw.length) {
    const lastLine = normalized[normalized.length - 1] || "";
    normalized[normalized.length - 1] = truncate(lastLine, Math.max(8, maxLineLength - 1));
  } else {
    normalized[normalized.length - 1] = truncate(normalized[normalized.length - 1], maxLineLength);
  }

  return normalized;
}

function splitOversizedToken(token: string, maxLength: number) {
  if (token.length <= maxLength) {
    return [token];
  }

  const chunks = [];
  let cursor = 0;

  while (cursor < token.length) {
    chunks.push(token.slice(cursor, cursor + maxLength));
    cursor += maxLength;
  }

  return chunks;
}

function truncateMiddle(value: string, maxLength: number) {
  const input = String(value || "");

  if (input.length <= maxLength) {
    return input;
  }

  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${input.slice(0, head)}…${input.slice(input.length - tail)}`;
}

function fitViewport(
  viewport: HTMLDivElement | null,
  contentWidth: number,
  setZoom: (next: number) => void,
) {
  if (!viewport || !contentWidth) {
    return;
  }

  const computedStyle = window.getComputedStyle(viewport);
  const paddingLeft = Number.parseFloat(computedStyle.paddingLeft || "0") || 0;
  const paddingRight = Number.parseFloat(computedStyle.paddingRight || "0") || 0;
  const available = Math.max(viewport.clientWidth - paddingLeft - paddingRight - 8, 240);
  const nextZoom = clampZoom(available / contentWidth);
  setZoom(nextZoom);
  viewport.scrollTo({ left: 0, top: 0, behavior: "smooth" });
}

function resetViewport(viewport: HTMLDivElement | null, setZoom: (next: number) => void) {
  setZoom(1);
  viewport?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
}

function hasFoldableClauses(graph: QueryGraph | null | undefined) {
  if (!graph?.nodes?.length) {
    return false;
  }

  return graph.nodes.filter((node) => isClauseNode(node.type)).length >= 2;
}

function buildLogicalDisplayGraph(
  graph: QueryGraph | null | undefined,
  compactMode: boolean,
  preservedNodeId: string | null = null,
): QueryGraph {
  if (!graph?.nodes?.length || !compactMode) {
    return graph || { nodes: [], edges: [], columns: [] };
  }

  const preservedNodeIds = new Set<string>(preservedNodeId ? [preservedNodeId] : []);
  let nextGraph = graph;

  const clauseNodes = nextGraph.nodes.filter((node) => isClauseNode(node.type));

  if (clauseNodes.length < 2) {
    nextGraph = nextGraph;
  } else {
    const clauseIds = new Set(clauseNodes.map((node) => node.id));
    const statementNode = nextGraph.nodes.find((node) => node.type === "statement");
    const resultNode = nextGraph.nodes.find((node) => node.type === "result");

    if (statementNode && resultNode) {
      nextGraph = {
        nodes: [
          ...nextGraph.nodes.filter((node) => !clauseIds.has(node.id)),
          {
            id: "clause:stack",
            type: "clause_stack",
            label: `${clauseNodes.length} clauses`,
            meta: {
              clauseCount: clauseNodes.length,
              clauseLabels: clauseNodes.map((node) => node.label || node.id),
              ranges: mergeGraphSpans(clauseNodes.flatMap((node) => getNodeSpans(node))),
            },
          },
        ],
        edges: [
          ...nextGraph.edges.filter((edge) => !clauseIds.has(edge.source) && !clauseIds.has(edge.target)),
          {
            id: "edge:statement->clause:stack",
            source: statementNode.id,
            target: "clause:stack",
            type: "transforms_to",
          },
          {
            id: "edge:clause:stack->result",
            source: "clause:stack",
            target: resultNode.id,
            type: "transforms_to",
          },
        ],
        columns: nextGraph.columns || [],
      };
    }
  }

  nextGraph = foldSiblingCteNodes(nextGraph, preservedNodeIds);
  nextGraph = foldSiblingSourceNodes(nextGraph, preservedNodeIds);

  return nextGraph;
}

function isClauseNode(type: string | undefined) {
  return [
    "join",
    "filter",
    "aggregate",
    "having",
    "qualify",
    "set",
    "distinct",
    "window",
    "union",
    "orderBy",
    "limit",
  ].includes(String(type || ""));
}

function foldSiblingCteNodes(graph: QueryGraph, preservedNodeIds: Set<string>): QueryGraph {
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = buildEdgeIndex(graph.edges, "source");
  const incoming = buildEdgeIndex(graph.edges, "target");
  const groups = new Map<string, GraphNode[]>();

  for (const node of graph.nodes) {
    if (node.type !== "cte" || preservedNodeIds.has(node.id)) {
      continue;
    }

    const nextEdges = outgoing.get(node.id) || [];
    const prevEdges = incoming.get(node.id) || [];

    if (nextEdges.length !== 1) {
      continue;
    }

    const onlyReadsFromSourceLike = prevEdges.every((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      return isSourceLikeNode(sourceNode?.type);
    });

    if (!onlyReadsFromSourceLike) {
      continue;
    }

    const dependencyCount = Number(node.meta?.dependencyCount ?? 0);
    if (dependencyCount > 0) {
      continue;
    }

    const targetId = nextEdges[0].target;
    if (!groups.has(targetId)) {
      groups.set(targetId, []);
    }
    groups.get(targetId)?.push(node);
  }

  return foldNodeGroups(graph, groups, {
    minimumSize: 3,
    clusterType: "cte_cluster",
    clusterIdPrefix: "cluster:cte",
    buildLabel: (size) => `${size} CTE inputs`,
    buildMeta: (nodes, _targetId, targetNode) => ({
      cteCount: nodes.length,
      targetLabel: targetNode?.label || targetNode?.id || "",
      memberLabels: nodes.map((node) => node.label || node.id),
      ranges: mergeGraphSpans(nodes.flatMap((node) => getNodeSpans(node))),
    }),
  });
}

function foldSiblingSourceNodes(graph: QueryGraph, preservedNodeIds: Set<string>): QueryGraph {
  const outgoing = buildEdgeIndex(graph.edges, "source");
  const groups = new Map<string, GraphNode[]>();

  for (const node of graph.nodes) {
    if (!isSourceLikeNode(node.type) || preservedNodeIds.has(node.id)) {
      continue;
    }

    const nextEdges = outgoing.get(node.id) || [];

    if (nextEdges.length !== 1) {
      continue;
    }

    const targetId = nextEdges[0].target;
    if (!groups.has(targetId)) {
      groups.set(targetId, []);
    }
    groups.get(targetId)?.push(node);
  }

  return foldNodeGroups(graph, groups, {
    minimumSize: 3,
    clusterType: "source_cluster",
    clusterIdPrefix: "cluster:source",
    buildLabel: (size) => `${size} sources`,
    buildMeta: (nodes, _targetId, targetNode) => ({
      sourceCount: nodes.length,
      targetLabel: targetNode?.label || targetNode?.id || "",
      memberLabels: nodes.map((node) => node.label || node.id),
      ranges: mergeGraphSpans(nodes.flatMap((node) => getNodeSpans(node))),
    }),
  });
}

function foldNodeGroups(
  graph: QueryGraph,
  groups: Map<string, GraphNode[]>,
  options: {
    minimumSize: number;
    clusterType: string;
    clusterIdPrefix: string;
    buildLabel: (size: number, targetId: string) => string;
    buildMeta: (
      nodes: GraphNode[],
      targetId: string,
      targetNode: GraphNode | null,
    ) => Record<string, unknown>;
  },
): QueryGraph {
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodesToRemove = new Set<string>();
  const extraNodes: GraphNode[] = [];
  const redirectedEdges: Array<{
    source: string;
    target: string;
    type?: string;
    sourceRole?: string;
  }> = [];

  for (const [targetId, members] of groups.entries()) {
    if (members.length < options.minimumSize) {
      continue;
    }

    const clusterId = `${options.clusterIdPrefix}:${targetId}`;
    const groupNodeIds = new Set<string>();
    for (const node of members) {
      groupNodeIds.add(node.id);
      nodesToRemove.add(node.id);
    }

    extraNodes.push({
      id: clusterId,
      type: options.clusterType,
      label: options.buildLabel(members.length, targetId),
      meta: options.buildMeta(members, targetId, nodeMap.get(targetId) || null),
    });

    for (const edge of graph.edges) {
      if (!groupNodeIds.has(edge.source) && !groupNodeIds.has(edge.target)) {
        continue;
      }

      if (groupNodeIds.has(edge.source) && edge.target === targetId) {
        redirectedEdges.push({
          source: clusterId,
          target: targetId,
          type: edge.type,
          sourceRole: edge.sourceRole,
        });
      } else if (groupNodeIds.has(edge.target) && !groupNodeIds.has(edge.source)) {
        redirectedEdges.push({
          source: edge.source,
          target: clusterId,
          type: edge.type,
          sourceRole: edge.sourceRole,
        });
      }
    }
  }

  if (!nodesToRemove.size) {
    return graph;
  }

  const edges = [
    ...graph.edges
      .filter((edge) => !nodesToRemove.has(edge.source) && !nodesToRemove.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        sourceRole: edge.sourceRole,
      })),
    ...redirectedEdges,
  ];

  return {
    nodes: [
      ...graph.nodes.filter((node) => !nodesToRemove.has(node.id)),
      ...extraNodes,
    ],
    edges: dedupeEdges(edges),
    columns: graph.columns || [],
  };
}

function buildEdgeIndex(edges: QueryGraph["edges"], key: "source" | "target") {
  const index = new Map<string, QueryGraph["edges"]>();

  for (const edge of edges || []) {
    const edgeKey = key === "source" ? edge.source : edge.target;
    if (!index.has(edgeKey)) {
      index.set(edgeKey, []);
    }
    index.get(edgeKey)?.push(edge);
  }

  return index;
}

function isSourceLikeNode(type: string | undefined) {
  return ["source_table", "unnest_source", "lateral_view"].includes(String(type || ""));
}

function dedupeEdges(
  edges: Array<{ id?: string; source: string; target: string; type?: string; sourceRole?: string }>,
) {
  const seen = new Set<string>();
  const deduped = [];

  for (const edge of edges) {
    const key = `${edge.source}:${edge.target}:${edge.type || ""}:${edge.sourceRole || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      id: edge.id || `edge:${edge.source}->${edge.target}:${edge.type || "flow"}`,
      source: edge.source,
      target: edge.target,
      type: edge.type,
    });
  }

  return deduped;
}

function normalizeMatchToken(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/["'`[\]]/g, "")
    .trim();
}

function resolveSelectionToken(
  statement: AnalysisStatement | null | undefined,
  selectionText: string | undefined,
  selectionStart: number | null | undefined,
) {
  const explicit = normalizeMatchToken(selectionText || "");

  if (explicit) {
    return explicit;
  }

  if (!statement?.sql || typeof selectionStart !== "number" || typeof statement.rangeStart !== "number") {
    return "";
  }

  const localOffset = Math.max(0, selectionStart - statement.rangeStart);
  const primaryToken = normalizeMatchToken(extractIdentifierAtOffset(statement.sql, localOffset));

  if (primaryToken && !isContextKeywordToken(primaryToken)) {
    return primaryToken;
  }

  return (
    normalizeMatchToken(extractRelevantIdentifierNearOffset(statement.sql, localOffset)) ||
    primaryToken
  );
}

function extractIdentifierAtOffset(sql: string, offset: number) {
  if (!sql) {
    return "";
  }

  let start = Math.max(0, Math.min(offset, sql.length));
  let end = start;
  const validChar = /[a-zA-Z0-9_.$"]/;

  if (start > 0 && !validChar.test(sql[start] || "") && validChar.test(sql[start - 1] || "")) {
    start -= 1;
    end = start;
  }

  while (start > 0 && validChar.test(sql[start - 1])) {
    start -= 1;
  }

  while (end < sql.length && validChar.test(sql[end])) {
    end += 1;
  }

  return sql.slice(start, end);
}

function extractRelevantIdentifierNearOffset(sql: string, offset: number) {
  if (!sql) {
    return "";
  }

  const normalizedOffset = Math.max(0, Math.min(offset, sql.length));
  let cursor = normalizedOffset;

  while (cursor < sql.length && /[a-zA-Z_]/.test(sql[cursor] || "")) {
    cursor += 1;
  }

  while (cursor < sql.length) {
    const identifier = readIdentifierAtOrAfter(sql, cursor);

    if (!identifier) {
      return "";
    }

    const token = normalizeMatchToken(identifier.value);

    if (!token) {
      cursor = identifier.nextIndex;
      continue;
    }

    if (isContextKeywordToken(token)) {
      cursor = identifier.nextIndex;
      continue;
    }

    return identifier.value;
  }

  return "";
}

function readIdentifierAtOrAfter(sql: string, offset: number) {
  const start = Math.max(0, Math.min(offset, sql.length));
  const match = /["`[]?[a-zA-Z_][a-zA-Z0-9_.$-]*["`\]]?/.exec(sql.slice(start));

  if (!match || typeof match.index !== "number") {
    return null;
  }

  return {
    value: match[0],
    nextIndex: start + match.index + match[0].length,
  };
}

function isContextKeywordToken(token: string) {
  return [
    "with",
    "recursive",
    "from",
    "join",
    "using",
    "left",
    "right",
    "inner",
    "outer",
    "full",
    "cross",
  ].includes(token);
}

function findBestSelectionNode(
  statement: AnalysisStatement | null | undefined,
  token: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
) {
  const nodes = statement?.graph?.nodes || [];
  const localSelection = resolveLocalSelectionRange(statement, selectionStart, selectionEnd);

  if (!nodes.length) {
    return null;
  }

  const exact = findNodeByExactToken(nodes, token);

  if (exact && exact.type !== "statement" && exact.type !== "result") {
    return exact;
  }

  if (localSelection) {
    const rangedMatch = findNarrowestNodeByRange(nodes, localSelection.start, localSelection.end);

    if (rangedMatch) {
      return rangedMatch;
    }
  }

  if (exact) {
    return exact;
  }

  const qualifier = token.includes(".") ? normalizeMatchToken(token.split(".")[0]) : "";
  const qualifierMatch = qualifier ? findNodeByExactToken(nodes, qualifier) : null;

  if (qualifierMatch) {
    return qualifierMatch;
  }

  const scopeNode = findContainingScopeNode(statement, nodes, selectionStart, selectionEnd);

  if (scopeNode) {
    return scopeNode;
  }

  return nodes.find((node) => node.type === "statement") || null;
}

function findNodeByExactToken(nodes: GraphNode[], token: string) {
  if (!token) {
    return null;
  }

  return (
    nodes.find((node) => {
      const candidates = [
        normalizeMatchToken(node.label || ""),
        normalizeMatchToken(node.id || ""),
        normalizeMatchToken((node.label || "").split(".").pop() || ""),
      ].filter(Boolean);

      return candidates.includes(token);
    }) || null
  );
}

function findContainingScopeNode(
  statement: AnalysisStatement | null | undefined,
  nodes: GraphNode[],
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
) {
  const localSelection = resolveLocalSelectionRange(statement, selectionStart, selectionEnd);

  if (!statement || !localSelection) {
    return null;
  }

  const localStart = localSelection.start;
  const localEnd = localSelection.end;
  const firstCte = statement.ctes?.[0];

  if (
    firstCte &&
    typeof firstCte.rangeStart === "number" &&
    localEnd <= firstCte.rangeStart
  ) {
    return (
      nodes.find(
        (node) =>
          node.type === "cte" &&
          normalizeMatchToken(node.label || "") === normalizeMatchToken(firstCte.name),
      ) || null
    );
  }

  const cte = (statement.ctes || []).find((candidate) => {
    const rangeStart =
      typeof candidate.rangeStart === "number"
        ? candidate.rangeStart
        : typeof candidate.bodyRangeStart === "number"
          ? candidate.bodyRangeStart
          : null;
    const rangeEnd =
      typeof candidate.rangeEnd === "number"
        ? candidate.rangeEnd
        : typeof candidate.bodyRangeEnd === "number"
          ? candidate.bodyRangeEnd
          : null;

    if (rangeStart === null || rangeEnd === null) {
      return false;
    }

    return localStart >= rangeStart && localEnd <= rangeEnd + 1;
  });

  if (cte) {
    return nodes.find((node) => node.type === "cte" && normalizeMatchToken(node.label || "") === normalizeMatchToken(cte.name)) || null;
  }

  return nodes.find((node) => node.type === "statement") || null;
}

function resolveLocalSelectionRange(
  statement: AnalysisStatement | null | undefined,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
) {
  if (
    !statement ||
    typeof selectionStart !== "number" ||
    typeof statement.rangeStart !== "number" ||
    typeof statement.rangeEnd !== "number"
  ) {
    return null;
  }

  const statementStart = statement.rangeStart;
  const statementEnd = statement.rangeEnd + 1;
  const resolvedEnd =
    typeof selectionEnd === "number" ? Math.max(selectionStart, selectionEnd) : selectionStart;
  const overlapStart = Math.max(selectionStart, statementStart);
  const overlapEnd = Math.min(resolvedEnd, statementEnd);

  if (overlapEnd < statementStart || overlapStart > statementEnd || overlapEnd < overlapStart) {
    return null;
  }

  return {
    start: Math.max(0, overlapStart - statementStart),
    end: Math.max(0, overlapEnd - statementStart),
  };
}

function mergeGraphSpans(spans: Array<{ start: number; end: number }>) {
  return normalizeGraphSpans(spans);
}

function findStatementBySelectionRange(
  statements: AnalysisStatement[],
  selectionStart: number,
  selectionEnd: number | null | undefined,
) {
  const start = Math.max(0, selectionStart);
  const end = typeof selectionEnd === "number" ? Math.max(start, selectionEnd) : start;

  const exactMatch =
    statements.find((candidate) => {
      const rangeStart = typeof candidate.rangeStart === "number" ? candidate.rangeStart : null;
      const rangeEnd = typeof candidate.rangeEnd === "number" ? candidate.rangeEnd : null;

      if (rangeStart === null || rangeEnd === null) {
        return false;
      }

      return start >= rangeStart && end <= rangeEnd + 1;
    }) || null;

  if (exactMatch) {
    return exactMatch;
  }

  const overlapMatches = statements
    .map((candidate) => {
      const rangeStart = typeof candidate.rangeStart === "number" ? candidate.rangeStart : null;
      const rangeEnd =
        typeof candidate.rangeEnd === "number" ? candidate.rangeEnd + 1 : null;

      if (rangeStart === null || rangeEnd === null) {
        return null;
      }

      const overlap = Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));

      if (overlap <= 0 && !(start === end && start >= rangeStart && start <= rangeEnd)) {
        return null;
      }

      return {
        candidate,
        overlap: overlap || 1,
        width: rangeEnd - rangeStart,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (!left || !right) {
        return 0;
      }

      const overlapDelta = right.overlap - left.overlap;

      if (overlapDelta !== 0) {
        return overlapDelta;
      }

      return left.width - right.width;
    });

  return overlapMatches[0]?.candidate || null;
}

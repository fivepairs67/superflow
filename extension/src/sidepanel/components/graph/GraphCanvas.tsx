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
import { ScriptView, buildScriptDependencyGraph, computeScriptViewLayout } from "./ScriptView";
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

function clearNativeTextSelection() {
  try {
    window.getSelection()?.removeAllRanges();
  } catch (_error) {
    // Ignore selection APIs that are unavailable in the current surface.
  }
}

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
  const [scriptFocusedNodeId, setScriptFocusedNodeId] = useState<string | null>(null);
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
    () => computeScriptViewLayout(scriptGraph.nodes, scriptGraph.edges),
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
    if (viewMode !== "logical" || !scriptFocusedNodeId) {
      return;
    }

    function handleMouseBackButton(event: MouseEvent) {
      if (event.button !== 3) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleReturnToScript();
    }

    window.addEventListener("mouseup", handleMouseBackButton, true);
    window.addEventListener("auxclick", handleMouseBackButton, true);

    return () => {
      window.removeEventListener("mouseup", handleMouseBackButton, true);
      window.removeEventListener("auxclick", handleMouseBackButton, true);
    };
  }, [scriptFocusedNodeId, viewMode]);

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
          viewportRef={viewportRef}
          onViewportPointerDown={handleViewportPointerDown}
          onViewportPointerMove={handleViewportPointerMove}
          onViewportPointerUp={handleViewportPointerUp}
          focusedNodeId={scriptFocusedNodeId}
          onFocusNode={setScriptFocusedNodeId}
          onOpenLogicalFromNode={handleScriptNodeOpenLogical}
          onBackgroundClick={handleScriptBackgroundClick}
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
              {scriptFocusedNodeId ? (
                <button className="graph-reset-button" type="button" onClick={handleReturnToScript}>
                  Back to Script
                </button>
              ) : null}
              {controlsCollapsed && hasScriptView && !scriptFocusedNodeId ? (
                <button className="graph-reset-button" type="button" onClick={() => setViewMode("script")}>
                  Script View
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
                  const sourceNode = logicalNodes.find((node) => node.id === edge.source) || null;
                  const targetNode = logicalNodes.find((node) => node.id === edge.target) || null;

                  if (!source || !target || !sourceNode || !targetNode) {
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
                      d={createEdgePath(source, target, edge, sourceNode, targetNode)}
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

  function handleScriptBackgroundClick() {
    if (suppressBackgroundResetRef.current) {
      return;
    }

    clearNativeTextSelection();
    setScriptFocusedNodeId(null);
  }

  function handleManualFocusReset() {
    clearNativeTextSelection();
    ignoredSelectionSignatureRef.current = buildSelectionSignature(
      sqlSelectionText,
      sqlSelectionStart,
      sqlSelectionEnd,
    );
    clearSelection();
  }

  function handleScriptNodeOpenLogical(nodeId: string, statementIndex: number) {
    setScriptFocusedNodeId(nodeId);
    ignoredSelectionSignatureRef.current = buildSelectionSignature(
      sqlSelectionText,
      sqlSelectionStart,
      sqlSelectionEnd,
    );
    selectStatementIndex(statementIndex, editorSelectionSignature);
    setViewMode("logical");
  }

  function handleReturnToScript() {
    setViewMode("script");
  }

  function handlePanelNodeSelect(nodeId: string) {
    clearNativeTextSelection();
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
      onMouseDown={(event) => {
        event.preventDefault();
        clearNativeTextSelection();
      }}
      onClick={(event) => {
        event.stopPropagation();
        (event.currentTarget as Element & { blur?: () => void }).blur?.();
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
      <text
        className="graph-label"
        x={position.x + 14}
        y={position.y + 38}
        style={
          display.labelScale !== 1
            ? { fontSize: `calc(var(--graph-label-size, 12px) * ${display.labelScale})` }
            : undefined
        }
      >
        {display.labelLines.map((line, index) => (
          <tspan
            key={`${node.id}:label:${index}`}
            x={position.x + 14}
            dy={index === 0 ? 0 : display.labelLineGap}
          >
            {line}
          </tspan>
        ))}
      </text>
      <text
        className="graph-meta"
        x={position.x + 14}
        y={
          position.y +
          Math.min(
            position.height - 8,
            56 + Math.max(display.labelLines.length - 1, 0) * Math.max(display.labelLineGap - 3, 10),
          )
        }
        style={
          display.metaScale !== 1
            ? { fontSize: `calc(var(--graph-meta-size, 10px) * ${display.metaScale})` }
            : undefined
        }
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
    const labelLines = wrapNodeLabel(qualified.objectName, 26, 3);
    return {
      labelLines,
      meta: qualified.namespace || graphMetaText(node),
      ...buildAdaptiveLabelMetrics(labelLines, node.type),
    };
  }

  if (node.type === "write_target") {
    const qualified = splitQualifiedLabel(node.label || node.id);
    const labelLines = wrapNodeLabel(qualified.objectName, 26, 3);
    return {
      labelLines,
      meta: buildQualifiedMeta(qualified.namespace, graphMetaText(node)),
      ...buildAdaptiveLabelMetrics(labelLines, node.type),
    };
  }

  if (node.type === "cte") {
    const labelLines = wrapNodeLabel(node.label || node.id, 24, 3);
    return {
      labelLines,
      meta: graphMetaText(node),
      ...buildAdaptiveLabelMetrics(labelLines, node.type),
    };
  }

  const labelLines = wrapNodeLabel(node.label || node.id, 18, 2);
  return {
    labelLines,
    meta: graphMetaText(node),
    ...buildAdaptiveLabelMetrics(labelLines, node.type),
  };
}

function splitQualifiedLabel(value: string) {
  const parts = splitQualifiedIdentifierParts(value)
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

  const tokens = tokenizeNodeLabel(raw, maxLineLength);
  const lines: string[] = [];
  let currentLine = "";

  for (const token of tokens.length ? tokens : [raw]) {
    if (!currentLine) {
      currentLine = token;
      continue;
    }

    if ((currentLine + token).length <= maxLineLength || lines.length === maxLines - 1) {
      currentLine += token;
      continue;
    }

    lines.push(currentLine);
    currentLine = token;
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

function splitQualifiedIdentifierParts(value: string) {
  const input = String(value || "");
  const parts: string[] = [];
  let current = "";
  let index = 0;

  while (index < input.length) {
    const templateToken = readTemplateToken(input, index);

    if (templateToken) {
      current += templateToken.value;
      index = templateToken.nextIndex;
      continue;
    }

    const quotedToken = readQuotedToken(input, index);

    if (quotedToken) {
      current += quotedToken.value;
      index = quotedToken.nextIndex;
      continue;
    }

    const char = input[index];

    if (char === ".") {
      if (current.trim()) {
        parts.push(current);
      }
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

function tokenizeNodeLabel(value: string, maxLineLength: number) {
  const input = String(value || "");
  const tokens: string[] = [];
  let current = "";
  let index = 0;

  while (index < input.length) {
    const templateToken = readTemplateToken(input, index);

    if (templateToken) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      tokens.push(templateToken.value);
      index = templateToken.nextIndex;
      continue;
    }

    const quotedToken = readQuotedToken(input, index);

    if (quotedToken) {
      current += quotedToken.value;
      index = quotedToken.nextIndex;
      continue;
    }

    const char = input[index];
    current += char;
    index += 1;

    if (char === "." || char === "_" || char === "-") {
      tokens.push(current);
      current = "";
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens.filter(Boolean).flatMap((token) => splitOversizedToken(token, maxLineLength));
}

function readTemplateToken(value: string, index: number) {
  const slice = value.slice(index);
  const templateMatch =
    /^(?:\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\$\{[\s\S]*?\})/.exec(slice);

  if (!templateMatch?.[0]) {
    return null;
  }

  return {
    value: templateMatch[0],
    nextIndex: index + templateMatch[0].length,
  };
}

function readQuotedToken(value: string, index: number) {
  const char = value[index];

  if (char !== '"' && char !== "'" && char !== "`" && char !== "[") {
    return null;
  }

  const closingChar = char === "[" ? "]" : char;
  let cursor = index + 1;

  while (cursor < value.length) {
    if (value[cursor] === closingChar) {
      return {
        value: value.slice(index, cursor + 1),
        nextIndex: cursor + 1,
      };
    }

    cursor += 1;
  }

  return {
    value: value.slice(index),
    nextIndex: value.length,
  };
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

function buildQualifiedMeta(namespace: string, baseMeta: string) {
  const trimmedNamespace = String(namespace || "").trim();
  const trimmedMeta = String(baseMeta || "").trim();

  if (trimmedNamespace && trimmedMeta) {
    return `${truncateMiddle(trimmedNamespace, 16)} · ${trimmedMeta}`;
  }

  return trimmedNamespace || trimmedMeta;
}

function buildAdaptiveLabelMetrics(labelLines: string[], nodeType: string | undefined) {
  const longestLine = Math.max(
    0,
    ...labelLines.map((line) => String(line || "").trim().length),
  );
  let labelScale = 1;

  if (nodeType === "source_table" || nodeType === "write_target" || nodeType === "cte") {
    if (longestLine >= 26) {
      labelScale = 0.82;
    } else if (longestLine >= 24) {
      labelScale = 0.86;
    } else if (longestLine >= 22) {
      labelScale = 0.9;
    } else if (longestLine >= 20) {
      labelScale = 0.94;
    }

    if (labelLines.length >= 3) {
      labelScale = Math.min(labelScale, 0.9);
    }
  } else if (labelLines.length >= 2 && longestLine >= 16) {
    labelScale = 0.95;
  }

  return {
    labelScale,
    metaScale: labelScale < 0.9 ? 0.94 : 1,
    labelLineGap: labelScale < 0.88 ? 12 : 13,
  };
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
    return rerouteJoinClauseInputs(expandNestedSubqueryJoins(graph || { nodes: [], edges: [], columns: [] }));
  }

  const preservedNodeIds = new Set<string>(preservedNodeId ? [preservedNodeId] : []);
  let nextGraph = rerouteJoinClauseInputs(expandNestedSubqueryJoins(graph));

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

function rerouteJoinClauseInputs(graph: QueryGraph): QueryGraph {
  if (!graph?.nodes?.length || !graph?.edges?.length) {
    return graph;
  }

  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const statementNode = graph.nodes.find((node) => node.type === "statement");
  const joinNode = graph.nodes.find((node) => node.type === "join");

  if (!statementNode || !joinNode) {
    return graph;
  }

  let changed = false;
  const edges = graph.edges.map((edge) => {
    if (
      edge.target === statementNode.id &&
      edge.sourceRole === "join" &&
      edge.source !== joinNode.id &&
      isJoinInputCandidateNode(nodeMap.get(edge.source)?.type)
    ) {
      changed = true;
      return {
        ...edge,
        target: joinNode.id,
        id: `${edge.id}:join-target`,
      };
    }

    return edge;
  });

  return changed
    ? {
        nodes: graph.nodes,
        edges: dedupeEdges(edges),
        columns: graph.columns || [],
      }
    : graph;
}

function expandNestedSubqueryJoins(graph: QueryGraph): QueryGraph {
  if (!graph?.nodes?.length || !graph?.edges?.length) {
    return graph;
  }

  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = buildEdgeIndex(graph.edges, "target");
  const extraNodes: GraphNode[] = [];
  const replacementEdges: QueryGraph["edges"] = [];
  const reroutedEdgeIds = new Set<string>();
  let changed = false;

  for (const node of graph.nodes) {
    if (!["inline_view", "cte"].includes(String(node.type || ""))) {
      continue;
    }

    const joinTypes = Array.isArray(node.meta?.joinTypes)
      ? node.meta.joinTypes.filter(Boolean).map((value) => String(value))
      : [];
    const candidateEdges = (incoming.get(node.id) || []).filter((edge) =>
      isJoinInputCandidateNode(nodeMap.get(edge.source)?.type),
    );
    const joinEdges = candidateEdges.filter((edge) => normalizeJoinEdgeRole(edge.sourceRole) === "join");
    const primaryEdges = candidateEdges.filter((edge) => normalizeJoinEdgeRole(edge.sourceRole) !== "join");

    if (!joinEdges.length || !primaryEdges.length) {
      continue;
    }

    const joinNodeId = `${node.id}:nested-join`;
    const nestedRanges = mergeGraphSpans([
      ...getNodeSpans(node),
      ...primaryEdges.flatMap((edge) => getNodeSpans(nodeMap.get(edge.source) || null)),
      ...joinEdges.flatMap((edge) => getNodeSpans(nodeMap.get(edge.source) || null)),
    ]);

    extraNodes.push({
      id: joinNodeId,
      type: "join",
      label: buildJoinLabel(joinTypes),
      meta: {
        joinTypes,
        nestedFor: node.id,
        nestedJoin: true,
        rangeStart: nestedRanges[0]?.start ?? null,
        rangeEnd: nestedRanges[0]?.end ?? null,
        ranges: nestedRanges,
      },
    });

    for (const edge of [...primaryEdges, ...joinEdges]) {
      reroutedEdgeIds.add(edge.id);
      replacementEdges.push({
        ...edge,
        id: `${edge.id}:nested-join`,
        target: joinNodeId,
      });
    }

    replacementEdges.push({
      id: `edge:${joinNodeId}->${node.id}:nested-join-output`,
      source: joinNodeId,
      target: node.id,
      type: "subquery_for",
      sourceRole: "from",
    });

    changed = true;
  }

  if (!changed) {
    return graph;
  }

  return {
    nodes: [...graph.nodes, ...extraNodes],
    edges: dedupeEdges([
      ...graph.edges.filter((edge) => !reroutedEdgeIds.has(edge.id)),
      ...replacementEdges,
    ]),
    columns: graph.columns || [],
  };
}

function isJoinInputCandidateNode(type: string | undefined) {
  return [
    "source_table",
    "unnest_source",
    "lateral_view",
    "cte",
    "inline_view",
    "union_branch",
    "scalar_subquery",
    "exists_subquery",
    "in_subquery",
    "source_cluster",
    "cte_cluster",
  ].includes(String(type || ""));
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
      sourceRole: edge.sourceRole,
    });
  }

  return deduped;
}

function normalizeJoinEdgeRole(sourceRole: string | undefined) {
  const value = String(sourceRole || "").trim().toLowerCase();

  if (!value) {
    return "from";
  }

  if (value === "join" || value === "using" || value.includes("join")) {
    return "join";
  }

  return "from";
}

function buildJoinLabel(joinTypes: string[]) {
  const uniqueJoinTypes = Array.from(
    new Set(
      joinTypes
        .filter(Boolean)
        .map((value) => normalizeJoinTypeToken(String(value)))
        .filter(Boolean),
    ),
  );

  if (!uniqueJoinTypes.length) {
    return "JOIN";
  }

  return uniqueJoinTypes.length === 1 ? `${uniqueJoinTypes[0]} JOIN` : "MULTI JOIN";
}

function normalizeJoinTypeToken(value: string) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");

  if (!normalized) {
    return "";
  }

  if (normalized === "JOIN" || normalized === "USING") {
    return normalized;
  }

  return normalized.replace(/\s+JOIN$/i, "").trim() || "JOIN";
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

  const exactMatches = findNodesByExactToken(nodes, token);
  const exactContainingMatch = localSelection
    ? findNarrowestContainingNode(
        exactMatches,
        localSelection.start,
        localSelection.end,
      )
    : null;
  const exact = exactContainingMatch || exactMatches[0] || null;
  const rangedMatch = localSelection
    ? findNarrowestNodeByRange(nodes, localSelection.start, localSelection.end)
    : null;

  if (
    exactContainingMatch &&
    exactContainingMatch.type !== "statement" &&
    exactContainingMatch.type !== "result"
  ) {
    return exactContainingMatch;
  }

  if (rangedMatch) {
    return rangedMatch;
  }

  if (exact) {
    return exact;
  }

  const qualifier = token.includes(".") ? normalizeMatchToken(token.split(".")[0]) : "";
  const qualifierMatches = qualifier ? findNodesByExactToken(nodes, qualifier) : [];
  const qualifierMatch =
    (localSelection
      ? findNarrowestContainingNode(qualifierMatches, localSelection.start, localSelection.end)
      : null) ||
    qualifierMatches[0] ||
    null;

  if (qualifierMatch) {
    return qualifierMatch;
  }

  const scopeNode = findContainingScopeNode(statement, nodes, selectionStart, selectionEnd);

  if (scopeNode) {
    return scopeNode;
  }

  return nodes.find((node) => node.type === "statement" || node.type === "directive") || null;
}

function findNodesByExactToken(nodes: GraphNode[], token: string) {
  if (!token) {
    return [];
  }

  return nodes.filter((node) => {
      const candidates = [
        normalizeMatchToken(node.label || ""),
        normalizeMatchToken(node.id || ""),
        normalizeMatchToken((node.label || "").split(".").pop() || ""),
        normalizeMatchToken(String(node.meta?.alias || "")),
      ].filter(Boolean);

      return candidates.includes(token);
  });
}

function findNarrowestContainingNode(
  nodes: GraphNode[],
  selectionStart: number,
  selectionEnd: number,
) {
  return (
    nodes
      .map((node) => ({
        node,
        spans: getNodeSpans(node),
      }))
      .flatMap(({ node, spans }) =>
        spans
          .filter((span) => spanContainsSelection(span, selectionStart, selectionEnd))
          .map((span) => ({
            node,
            width: span.end - span.start,
          })),
      )
      .sort((left, right) => {
        const widthDelta = left.width - right.width;

        if (widthDelta !== 0) {
          return widthDelta;
        }

        return nodeSelectionPriority(left.node) - nodeSelectionPriority(right.node);
      })[0]?.node || null
  );
}

function spanContainsSelection(
  span: { start: number; end: number },
  selectionStart: number,
  selectionEnd: number,
) {
  if (selectionStart === selectionEnd) {
    return selectionStart >= span.start && selectionStart <= span.end;
  }

  return selectionStart >= span.start && selectionEnd <= span.end;
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

  return nodes.find((node) => node.type === "statement" || node.type === "directive") || null;
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

function nodeSelectionPriority(node: GraphNode) {
  const type = String(node.type || "");

  if (type === "statement" || type === "result") {
    return 3;
  }

  if (type === "clause_stack" || type === "source_cluster" || type === "cte_cluster") {
    return 2;
  }

  if (type.endsWith("_subquery") || type === "inline_view" || type === "union_branch") {
    return 1;
  }

  return 0;
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

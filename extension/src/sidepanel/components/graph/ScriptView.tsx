import { useEffect, useMemo, useState, type CSSProperties, type PointerEventHandler, type RefObject } from "react";

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
import { useGraphStore, type GraphColorMode } from "../../state/graph-store";
import { EdgeLegend } from "./EdgeLegend";

interface ScriptViewProps {
  analysis: AnalysisResult | null | undefined;
  zoom: number;
  editorSelectionSignature?: string;
  viewportRef: RefObject<HTMLDivElement>;
  onViewportPointerDown: PointerEventHandler<HTMLDivElement>;
  onViewportPointerMove: PointerEventHandler<HTMLDivElement>;
  onViewportPointerUp: PointerEventHandler<HTMLDivElement>;
}

export function ScriptView({
  analysis,
  zoom,
  editorSelectionSignature = "",
  viewportRef,
  onViewportPointerDown,
  onViewportPointerMove,
  onViewportPointerUp,
}: ScriptViewProps) {
  const { selectStatementIndex, setViewMode, colorMode } = useGraphStore();
  const [focusedStatementIndex, setFocusedStatementIndex] = useState<number | null>(null);
  const statements = analysis?.statements || [];
  const dependencies = analysis?.scriptDependencies || [];
  const graph = useMemo(
    () => buildScriptDependencyGraph(statements, dependencies),
    [dependencies, statements],
  );
  const layout = useMemo(() => computeGraphLayout(graph.nodes, graph.edges), [graph.edges, graph.nodes]);
  const focusedNodeId =
    typeof focusedStatementIndex === "number" ? `statement:${focusedStatementIndex}` : null;
  const focusState = useMemo(
    () => buildGraphFocusState(graph.nodes, graph.edges, focusedNodeId),
    [focusedNodeId, graph.edges, graph.nodes],
  );

  useEffect(() => {
    if (
      typeof focusedStatementIndex === "number" &&
      !statements.some((statement) => statement.index === focusedStatementIndex)
    ) {
      setFocusedStatementIndex(null);
    }
  }, [focusedStatementIndex, statements]);

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
            {statements.length} statements / {dependencies.length} deps
          </span>
          {dependencies.length === 0 ? (
            <span className="graph-badge">independent worksheet</span>
          ) : null}
          <span className="graph-badge">click once to focus</span>
          <span className="graph-badge">click again to open logical graph</span>
        </div>
        {focusedStatementIndex !== null ? (
          <button className="graph-reset-button" type="button" onClick={() => setFocusedStatementIndex(null)}>
            Focus Reset
          </button>
        ) : null}
      </div>

      <EdgeLegend items={["script"]} />

      <div
        ref={viewportRef}
        className="graph-canvas-shell"
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
      >
        <div
          className="graph-zoom-layer"
          style={buildZoomLayerStyle(layout.width, layout.height, zoom)}
        >
          <svg
            className="graph-svg-stage"
            width={layout.width * zoom}
            height={layout.height * zoom}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label="SQL script dependency graph"
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

            {statements.map((statement) => {
              const position = layout.positions.get(statement.id);

              if (!position) {
                return null;
              }

              return (
                <ScriptStatementNode
                  key={statement.id}
                  statement={statement}
                  position={position}
                  colorMode={colorMode}
                  focusClassName={focusState.nodeState.get(statement.id)}
                  onSelect={() => {
                    if (focusedStatementIndex === statement.index) {
                      selectStatementIndex(statement.index, editorSelectionSignature);
                      setViewMode("logical");
                      return;
                    }

                    setFocusedStatementIndex(statement.index);
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

interface ScriptStatementNodeProps {
  statement: AnalysisStatement;
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
  statement,
  position,
  colorMode,
  focusClassName,
  onSelect,
}: ScriptStatementNodeProps) {
  const isSelected = focusClassName === "is-selected";
  const visual = createScriptNodeVisual(statement, colorMode);
  const style = {
    ["--node-fill" as string]: visual.fill,
    ["--node-stroke" as string]: visual.stroke,
    ["--node-accent" as string]: visual.accent,
    ["--node-text" as string]: visual.text,
  } as CSSProperties;

  return (
    <g
      className={nodeClassName({ id: statement.id, type: "script_statement" }, focusClassName)}
      role="button"
      tabIndex={0}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
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
        {statement.statementType || "STATEMENT"}
      </text>
      <text className="graph-label" x={position.x + 14} y={position.y + 38}>
        {truncate(statement.title || `Statement ${statement.index + 1}`, 24)}
      </text>
      <text className="graph-meta" x={position.x + 14} y={position.y + 56}>
        {buildStatementMeta(statement)}
      </text>
      <title>{`${statement.title || statement.id} · ${buildStatementMeta(statement)}`}</title>
    </g>
  );
}

export function buildScriptDependencyGraph(
  statements: AnalysisStatement[],
  dependencies: AnalysisResult["scriptDependencies"],
) {
  const nodes: GraphNode[] = statements.map((statement) => ({
    id: statement.id,
    type: "script_statement",
    label: statement.title || `Statement ${statement.index + 1}`,
    meta: {
      statementIndex: statement.index,
      sourceCount: statement.summary?.sourceCount ?? 0,
      clauseCount: statement.summary?.clauseCount ?? 0,
      dependencyCount: statement.dependencies?.length ?? 0,
      writeCount: statement.writes?.length ?? 0,
    },
  }));

  const edges: GraphEdge[] = (dependencies || []).map((dependency) => ({
    id: dependency.id,
    source: `statement:${dependency.sourceIndex}`,
    target: `statement:${dependency.targetIndex}`,
    type: dependency.type || "depends_on",
  }));

  return {
    nodes,
    edges,
  };
}

function buildStatementMeta(statement: AnalysisStatement) {
  const sourceCount = statement.summary?.sourceCount ?? 0;
  const clauseCount = statement.summary?.clauseCount ?? 0;
  const writeCount = statement.writes?.length ?? 0;
  return `${sourceCount} source · ${clauseCount} clauses · ${writeCount} writes`;
}

function createScriptNodeVisual(statement: AnalysisStatement, colorMode: GraphColorMode) {
  const writes = statement.writes?.length ?? 0;
  const dependencies = statement.dependencies?.length ?? 0;
  const dependents = statement.dependents?.length ?? 0;
  const roles = paletteRolesForMode(colorMode);
  const accent =
    writes > 0
      ? roles.deep
      : dependents > 0
        ? roles.main
        : dependencies > 0
          ? roles.soft
          : blendRgb(roles.main, roles.light, 0.5);

  return {
    fill: rgbaString(blendRgb({ r: 255, g: 255, b: 255 }, accent, 0.18), 0.96),
    stroke: rgbaString(blendRgb(accent, roles.soft, 0.22), 0.24),
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
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function toHex(value: number) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

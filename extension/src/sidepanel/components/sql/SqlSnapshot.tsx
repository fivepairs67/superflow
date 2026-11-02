import { Fragment, useMemo } from "react";

import type { AnalysisStatement, GraphColumn, GraphNode, QueryGraph, TabSession } from "../../../shared/types";
import { useGraphStore } from "../../state/graph-store";
import {
  normalizeGraphSpans,
  type GraphSpan,
} from "../../features/graph/spans";
import { resolveGraphSelection } from "../../features/graph/selection";

interface SqlSnapshotProps {
  session: TabSession | null;
  statement: AnalysisStatement | null | undefined;
  graph: QueryGraph;
  selectedNodeId: string | null;
  selectedColumnId: string | null;
}

export function SqlSnapshot({
  session,
  statement,
  graph,
  selectedNodeId,
  selectedColumnId,
}: SqlSnapshotProps) {
  const { selectNode } = useGraphStore();
  const sql = statement?.sql || session?.activeSql || session?.sql || session?.sqlPreview || "";
  const selection = resolveGraphSelection(graph, selectedNodeId, selectedColumnId);
  const { node: selectedNode, column: selectedColumn } = selection;
  const nodeHighlightRanges = normalizeRanges(selection.ranges, sql.length);
  const editorSelectionRanges = useMemo(
    () => buildEditorSelectionRanges(statement, session, sql.length),
    [session, sql.length, statement],
  );
  const statementLabel = statement?.title || "Current statement";

  return (
    <div className="stack">
      <div className="meta-line">
        <span>{session?.activeSqlSource || session?.sqlSource || "No source"}</span>
        <span>{session?.activeSqlLength || session?.sqlLength || 0} chars</span>
      </div>
      <div className="meta-line">
        <span>{statementLabel}</span>
        <span>
          {selectedColumn
              ? `column: ${selectedColumn.label || selectedColumn.name}`
              : selectedNode
                ? `focus: ${selectedNode.label || selectedNode.id}`
              : "No node focus"}
        </span>
      </div>
      {session?.sqlSelectionText ? (
        <div className="meta-line">
          <span>editor selection</span>
          <span>{session.sqlSelectionText}</span>
        </div>
      ) : null}
      <div
        className="code-block code-block-interactive"
        onMouseUp={() => {
          const selectedText = window.getSelection?.()?.toString().trim();

          if (!selectedText || !graph.nodes.length) {
            return;
          }

          const matchedNode = matchNodeFromText(graph.nodes, selectedText);

          if (matchedNode) {
            selectNode(matchedNode.id);
          }
        }}
      >
        {sql
          ? renderSqlWithHighlights(sql, nodeHighlightRanges, editorSelectionRanges)
          : "No SQL has been collected yet."}
      </div>
    </div>
  );
}

function renderSqlWithHighlights(
  sql: string,
  nodeHighlightRanges: GraphSpan[],
  editorSelectionRanges: GraphSpan[],
) {
  const boundaries = new Set<number>([0, sql.length]);

  for (const range of [...nodeHighlightRanges, ...editorSelectionRanges]) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }

  const sortedBoundaries = Array.from(boundaries).sort((left, right) => left - right);

  return sortedBoundaries.slice(0, -1).map((start, index) => {
    const end = sortedBoundaries[index + 1];
    const text = sql.slice(start, end);

    if (!text) {
      return null;
    }

    const isNodeHighlight = rangeIntersects(nodeHighlightRanges, start, end);
    const isEditorSelection = rangeIntersects(editorSelectionRanges, start, end);

    if (!isNodeHighlight && !isEditorSelection) {
      return <Fragment key={`sql-fragment:${start}:${end}`}>{text}</Fragment>;
    }

    const className = [
      "code-highlight",
      isNodeHighlight ? "is-node-highlight" : "",
      isEditorSelection ? "is-editor-selection" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <mark key={`sql-fragment:${start}:${end}`} className={className}>
        {text}
      </mark>
    );
  });
}

function buildEditorSelectionRanges(
  statement: AnalysisStatement | null | undefined,
  session: TabSession | null,
  sqlLength: number,
) {
  if (
    !statement ||
    typeof statement.rangeStart !== "number" ||
    typeof session?.sqlSelectionStart !== "number"
  ) {
    return [];
  }

  const localStart = Math.max(0, session.sqlSelectionStart - statement.rangeStart);
  const localEnd =
    typeof session.sqlSelectionEnd === "number"
      ? Math.max(localStart, session.sqlSelectionEnd - statement.rangeStart)
      : localStart;

  if (localStart > sqlLength || localEnd < 0) {
    return [];
  }

  return normalizeRanges(
    [
      {
        start: localStart,
        end: localEnd,
      },
    ],
    sqlLength,
  );
}

function normalizeRanges(ranges: GraphSpan[], maxLength: number) {
  const clamped = (ranges || [])
    .filter((range) => typeof range?.start === "number" && typeof range?.end === "number")
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, maxLength)),
      end: Math.max(0, Math.min(range.end, maxLength)),
    }));

  return normalizeGraphSpans(clamped);
}

function rangeIntersects(ranges: GraphSpan[], start: number, end: number) {
  return ranges.some((range) => start < range.end && end > range.start);
}

function matchNodeFromText(nodes: GraphNode[], selectedText: string) {
  const normalizedSelection = normalizeToken(selectedText);

  if (!normalizedSelection || normalizedSelection.length < 2) {
    return null;
  }

  return (
    nodes.find((node) => {
      const candidates = [
        normalizeToken(node.label || ""),
        normalizeToken(node.id || ""),
        normalizeToken((node.label || "").split(".").pop() || ""),
      ].filter(Boolean);

      return candidates.some(
        (candidate) =>
          candidate === normalizedSelection ||
          candidate.includes(normalizedSelection) ||
          normalizedSelection.includes(candidate),
      );
    }) || null
  );
}

function normalizeToken(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/["'`[\]]/g, "")
    .trim();
}

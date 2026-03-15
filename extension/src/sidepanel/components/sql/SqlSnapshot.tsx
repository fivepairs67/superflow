import { Fragment, useMemo } from "react";

import type { AnalysisStatement, GraphColumn, GraphNode, TabSession } from "../../../shared/types";
import { useGraphStore } from "../../state/graph-store";
import {
  getNodeSpans,
  normalizeGraphSpans,
  type GraphSpan,
} from "../../features/graph/spans";

interface SqlSnapshotProps {
  session: TabSession | null;
  statement: AnalysisStatement | null | undefined;
  selectedNodeId: string | null;
  selectedColumnId: string | null;
}

export function SqlSnapshot({
  session,
  statement,
  selectedNodeId,
  selectedColumnId,
}: SqlSnapshotProps) {
  const { selectNode } = useGraphStore();
  const sql = statement?.sql || session?.activeSql || session?.sql || session?.sqlPreview || "";
  const selectedNode = statement?.graph?.nodes?.find((node) => node.id === selectedNodeId) || null;
  const selectedColumn =
    statement?.graph?.columns?.find((column) => column.id === selectedColumnId) || null;
  const nodeHighlightRanges = useMemo(
    () =>
      normalizeRanges(
        selectedColumn?.spans?.length ? selectedColumn.spans : getNodeSpans(selectedNode),
        sql.length,
      ),
    [selectedColumn?.spans, selectedNode, sql.length],
  );
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

          if (!selectedText || !statement?.graph?.nodes?.length) {
            return;
          }

          const matchedNode = matchNodeFromText(statement.graph.nodes, selectedText);

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

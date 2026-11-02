import type { AnalysisRange, AnalysisStatement, QueryGraph } from "../../../shared/types";
import { getNodeSpans, normalizeGraphSpans } from "./spans";

export function resolveGraphSelection(
  graph: QueryGraph,
  selectedNodeId: string | null,
  selectedColumnId: string | null,
) {
  const node = graph.nodes.find((candidate) => candidate.id === selectedNodeId) || null;
  const column = graph.columns?.find((candidate) => candidate.id === selectedColumnId) || null;

  return {
    node,
    column,
    ranges: normalizeGraphSpans(column?.spans?.length ? column.spans : getNodeSpans(node)),
  };
}

export function buildEditorHighlightRanges(
  statement: AnalysisStatement | null,
  graph: QueryGraph,
  selectedNodeId: string | null,
  selectedColumnId: string | null,
): AnalysisRange[] {
  if (!statement || typeof statement.rangeStart !== "number") {
    return [];
  }

  const baseOffset = statement.rangeStart;
  return resolveGraphSelection(graph, selectedNodeId, selectedColumnId).ranges.map((range) => ({
    start: baseOffset + range.start,
    end: baseOffset + range.end,
  }));
}

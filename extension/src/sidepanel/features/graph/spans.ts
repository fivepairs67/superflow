import type { GraphNode } from "../../../shared/types";

export interface GraphSpan {
  start: number;
  end: number;
}

export function getNodeSpans(node: GraphNode | null | undefined): GraphSpan[] {
  if (!node?.meta || typeof node.meta !== "object") {
    return [];
  }

  const meta = node.meta as Record<string, unknown>;
  const ranges = Array.isArray(meta.ranges)
    ? meta.ranges
        .filter(
          (range) =>
            range &&
            typeof range === "object" &&
            typeof (range as { start?: unknown }).start === "number" &&
            typeof (range as { end?: unknown }).end === "number",
        )
        .map((range) => ({
          start: (range as { start: number }).start,
          end: (range as { end: number }).end,
        }))
    : [];

  if (ranges.length) {
    return normalizeGraphSpans(ranges);
  }

  if (typeof meta.rangeStart === "number" && typeof meta.rangeEnd === "number") {
    return normalizeGraphSpans([
      {
        start: meta.rangeStart,
        end: meta.rangeEnd,
      },
    ]);
  }

  return [];
}

export function normalizeGraphSpans(spans: GraphSpan[]) {
  const normalized = (spans || [])
    .filter((range) => typeof range?.start === "number" && typeof range?.end === "number")
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, range.end)),
      end: Math.max(range.start, range.end),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: GraphSpan[] = [];

  for (const range of normalized) {
    if (!merged.length) {
      merged.push(range);
      continue;
    }

    const previous = merged[merged.length - 1];

    if (range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }

    merged.push(range);
  }

  return merged;
}

export function findNarrowestNodeByRange(
  nodes: GraphNode[],
  selectionStart: number,
  selectionEnd: number,
): GraphNode | null {
  const exactMatches = nodes
    .map((node) => ({
      node,
      spans: getNodeSpans(node),
    }))
    .flatMap(({ node, spans }) =>
      spans
        .filter((span) => rangeContainsSelection(span, selectionStart, selectionEnd))
        .map((span) => ({
          node,
          span,
          width: span.end - span.start,
        })),
    )
    .sort(compareSpanMatches);

  if (exactMatches.length) {
    return exactMatches[0]?.node || null;
  }

  const overlapMatches = nodes
    .map((node) => ({
      node,
      spans: getNodeSpans(node),
    }))
    .flatMap(({ node, spans }) =>
      spans
        .filter((span) => rangeIntersectsSelection(span, selectionStart, selectionEnd))
        .map((span) => ({
          node,
          span,
          width: span.end - span.start,
          overlap: computeOverlapWidth(span, selectionStart, selectionEnd),
        })),
    )
    .sort((left, right) => {
      const overlapDelta = right.overlap - left.overlap;
      if (overlapDelta !== 0) {
        return overlapDelta;
      }
      return compareSpanMatches(left, right);
    });

  return overlapMatches[0]?.node || null;
}

function rangeContainsSelection(span: GraphSpan, selectionStart: number, selectionEnd: number) {
  if (selectionStart === selectionEnd) {
    return selectionStart >= span.start && selectionStart <= span.end;
  }

  return selectionStart >= span.start && selectionEnd <= span.end;
}

function rangeIntersectsSelection(span: GraphSpan, selectionStart: number, selectionEnd: number) {
  if (selectionStart === selectionEnd) {
    return selectionStart >= span.start && selectionStart <= span.end;
  }

  return selectionStart < span.end && selectionEnd > span.start;
}

function computeOverlapWidth(span: GraphSpan, selectionStart: number, selectionEnd: number) {
  if (selectionStart === selectionEnd) {
    return selectionStart >= span.start && selectionStart <= span.end ? 1 : 0;
  }

  return Math.max(0, Math.min(span.end, selectionEnd) - Math.max(span.start, selectionStart));
}

function compareSpanMatches(
  left: { node: GraphNode; width: number },
  right: { node: GraphNode; width: number },
) {
  const widthDelta = left.width - right.width;

  if (widthDelta !== 0) {
    return widthDelta;
  }

  return nodeSelectionPriority(left.node) - nodeSelectionPriority(right.node);
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

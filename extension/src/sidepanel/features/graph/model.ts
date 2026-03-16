import type { GraphColumn, GraphColumnRef, GraphEdge, GraphNode } from "../../../shared/types";
import type { GraphColorMode } from "../../state/graph-store";
import { GRAPH_COLOR_PRESET_MAP } from "./palettes";

const MAX_LEVEL_COLUMNS = 4;
const MAX_FLOW_COLOR_STOPS = 4;
const BASE_FLOW_PALETTES: Record<GraphColorMode, Array<{ hex: string; rgb: { r: number; g: number; b: number } }>> =
  Object.fromEntries(
    Object.entries(GRAPH_COLOR_PRESET_MAP).map(([mode, colors]) => [
      mode,
      colors.map(buildPaletteEntry),
    ]),
  ) as Record<GraphColorMode, Array<{ hex: string; rgb: { r: number; g: number; b: number } }>>;
const FLOW_PALETTES: Record<GraphColorMode, Array<{ hex: string; rgb: { r: number; g: number; b: number } }>> =
  Object.fromEntries(
    Object.entries(BASE_FLOW_PALETTES).map(([mode, colors]) => [mode, expandPaletteEntries(colors)]),
  ) as Record<GraphColorMode, Array<{ hex: string; rgb: { r: number; g: number; b: number } }>>;

export interface GraphPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  positions: Map<string, GraphPosition>;
  width: number;
  height: number;
}

export interface NodeVisual {
  fill: string;
  bandFill: string;
  stroke: string;
  accent: string;
  text: string;
  gradientId: string | null;
  gradientStops: GradientStop[];
  swatchColors: string[];
}

export interface EdgeVisual {
  stroke: string;
}

export interface GradientStop {
  offset: string;
  color: string;
  opacity: string;
}

export interface FlowVisualContext {
  nodeVisuals: Map<string, NodeVisual>;
  edgeVisuals: Map<string, EdgeVisual>;
}

export interface GraphFocusState {
  selectedNode: GraphNode | null;
  nodeState: Map<string, string>;
  edgeState: Map<string, string>;
  upstreamNodes: GraphNode[];
  downstreamNodes: GraphNode[];
  directUpstreamNodes: GraphNode[];
  upstreamChainNodes: GraphNode[];
  directDownstreamNodes: GraphNode[];
  downstreamChainNodes: GraphNode[];
  directUpstreamRoles: Map<string, string>;
  directDownstreamRoles: Map<string, string>;
}

interface GraphTraversalState {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  nodeDepths: Map<string, number>;
  edgeDepths: Map<string, number>;
}

interface LineageColor {
  id: string;
  seed: string;
  rgb: {
    r: number;
    g: number;
    b: number;
  };
  hex: string;
}

interface PaletteRoles {
  deep: { r: number; g: number; b: number };
  main: { r: number; g: number; b: number };
  soft: { r: number; g: number; b: number };
  light: { r: number; g: number; b: number };
}

interface NodeToneProfile {
  baseRgb: { r: number; g: number; b: number };
  fillTint: number;
  accentBlend: number;
  strokeBlend: number;
  fillAlpha: number;
  strokeAlpha: number;
  swatchLimit: number;
}

export function computeGraphLayout(nodes: GraphNode[], edges: GraphEdge[]): GraphLayout {
  const nodeWidth = 192;
  const nodeHeight = 80;
  const columnGap = 18;
  const levelGap = 48;
  const levelRowGap = 14;
  const paddingX = 16;
  const paddingY = 16;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const incomingAdjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const levelMap = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      continue;
    }

    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
    incomingAdjacency.get(edge.target)?.push(edge.source);
  }

  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .map((node) => node.id);
  const visited = new Set<string>();

  while (queue.length) {
    const currentId = queue.shift();

    if (!currentId) {
      continue;
    }

    visited.add(currentId);
    const nextLevel = levelMap.get(currentId) || 0;

    for (const targetId of adjacency.get(currentId) || []) {
      levelMap.set(targetId, Math.max(levelMap.get(targetId) || 0, nextLevel + 1));
      indegree.set(targetId, (indegree.get(targetId) || 0) - 1);

      if ((indegree.get(targetId) || 0) <= 0) {
        queue.push(targetId);
      }
    }
  }

  let fallbackLevel = Math.max(...levelMap.values(), 0);

  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }

    fallbackLevel += 1;
    levelMap.set(node.id, fallbackLevel);
  }

  applyAnchoredBranchLevels(levelMap, nodes, edges);

  const columns = new Map<number, GraphNode[]>();

  for (const node of nodes) {
    const level = levelMap.get(node.id) || 0;

    if (!columns.has(level)) {
      columns.set(level, []);
    }

    columns.get(level)?.push(node);
  }

  for (const columnNodes of columns.values()) {
    columnNodes.sort((left, right) => {
      const typeCompare = String(left.type || "").localeCompare(String(right.type || ""));
      return (
        typeCompare || String(left.label || left.id).localeCompare(String(right.label || right.id))
      );
    });
  }

  optimizeLevelOrdering(columns, sortedNumericKeys(columns), adjacency, incomingAdjacency);

  const positions = new Map<string, GraphPosition>();
  const sortedLevels = Array.from(columns.keys()).sort((left, right) => left - right);
  const maxColumns = Math.max(
    ...sortedLevels.map((level) => Math.min(columns.get(level)?.length || 0, MAX_LEVEL_COLUMNS)),
    1,
  );
  const maxRowWidth = maxColumns * nodeWidth + Math.max(maxColumns - 1, 0) * columnGap;
  let currentY = paddingY;

  for (const level of sortedLevels) {
    const rowNodes = columns.get(level) || [];
    const chunks = chunk(rowNodes, MAX_LEVEL_COLUMNS);
    const bandHeight =
      chunks.length * nodeHeight + Math.max(chunks.length - 1, 0) * levelRowGap;

    chunks.forEach((group, groupIndex) => {
      const rowWidth = group.length * nodeWidth + Math.max(group.length - 1, 0) * columnGap;
      const startX = paddingX + Math.max(0, (maxRowWidth - rowWidth) / 2);
      const y = currentY + groupIndex * (nodeHeight + levelRowGap);

      group.forEach((node, index) => {
        positions.set(node.id, {
          x: startX + index * (nodeWidth + columnGap),
          y,
          width: nodeWidth,
          height: nodeHeight,
        });
      });
    });

    currentY += bandHeight + levelGap;
  }

  applyJoinNeighborhoodLayout(positions, nodes, edges, columnGap);
  applyStatementPrimaryInputLayout(positions, nodes, edges, columnGap);
  resolveRowOverlaps(positions, Math.max(columnGap, 18));
  normalizeLayoutBounds(positions, paddingX, paddingY);

  let maxRight = 0;
  let maxBottom = 0;

  for (const position of positions.values()) {
    maxRight = Math.max(maxRight, position.x + position.width);
    maxBottom = Math.max(maxBottom, position.y + position.height);
  }

  return {
    positions,
    width: Math.max(paddingX + maxRight + paddingX, paddingX * 2 + maxRowWidth),
    height: Math.max(maxBottom + paddingY, paddingY * 2 + nodeHeight),
  };
}

function applyAnchoredBranchLevels(
  levelMap: Map<string, number>,
  nodes: GraphNode[],
  edges: GraphEdge[],
) {
  const incoming = new Map<string, GraphEdge[]>();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of edges) {
    if (!incoming.has(edge.target)) {
      incoming.set(edge.target, []);
    }

    incoming.get(edge.target)?.push(edge);
  }

  for (const joinNode of nodes.filter((node) => node.type === "join")) {
    const joinLevel = levelMap.get(joinNode.id) || 0;
    const joinInputs = (incoming.get(joinNode.id) || []).filter(
      (edge) =>
        edge.sourceRole === "join" && isJoinInputLayoutNode(nodeMap.get(edge.source)),
    );

    for (const joinInput of joinInputs) {
      const depthMap = new Map<string, number>();
      collectUpstreamBranchDepths(
        joinInput.source,
        0,
        depthMap,
        incoming,
        nodeMap,
      );

      for (const [nodeId, depth] of depthMap.entries()) {
        const desiredLevel = Math.max(0, joinLevel - 1 - depth);
        levelMap.set(nodeId, Math.max(levelMap.get(nodeId) || 0, desiredLevel));
      }
    }
  }
}

function collectUpstreamBranchDepths(
  nodeId: string,
  depth: number,
  depthMap: Map<string, number>,
  incoming: Map<string, GraphEdge[]>,
  nodeMap: Map<string, GraphNode>,
) {
  const existingDepth = depthMap.get(nodeId);

  if (typeof existingDepth === "number" && existingDepth >= depth) {
    return;
  }

  depthMap.set(nodeId, depth);

  for (const edge of incoming.get(nodeId) || []) {
    if (!isJoinInputLayoutNode(nodeMap.get(edge.source))) {
      continue;
    }

    collectUpstreamBranchDepths(edge.source, depth + 1, depthMap, incoming, nodeMap);
  }
}

function applyJoinNeighborhoodLayout(
  positions: Map<string, GraphPosition>,
  nodes: GraphNode[],
  edges: GraphEdge[],
  columnGap: number,
) {
  const incoming = new Map<string, GraphEdge[]>();
  const outgoing = new Map<string, GraphEdge[]>();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of edges) {
    if (!incoming.has(edge.target)) {
      incoming.set(edge.target, []);
    }

    incoming.get(edge.target)?.push(edge);

    if (!outgoing.has(edge.source)) {
      outgoing.set(edge.source, []);
    }

    outgoing.get(edge.source)?.push(edge);
  }

  for (const joinNode of nodes.filter((node) => node.type === "join")) {
    const joinPosition = positions.get(joinNode.id);

    if (!joinPosition) {
      continue;
    }

    const joinIncoming = (incoming.get(joinNode.id) || []).filter((edge) => positions.has(edge.source));

    if (!joinIncoming.length) {
      continue;
    }

    const primaryEdge =
      joinIncoming.find((edge) => nodeMap.get(edge.source)?.type === "statement") ||
      joinIncoming.find(
        (edge) =>
          normalizeSourceRole(edge.sourceRole) !== "join" &&
          isJoinInputLayoutNode(nodeMap.get(edge.source)),
      ) ||
      null;
    const primaryPosition = primaryEdge ? positions.get(primaryEdge.source) : null;

    if (primaryEdge && primaryPosition) {
      primaryPosition.x = joinPosition.x + (joinPosition.width - primaryPosition.width) / 2;
      alignUniqueUpstreamChain(primaryEdge.source, positions, incoming, outgoing, nodeMap);
    }

    const sideEdges = joinIncoming
      .filter(
        (edge) =>
          edge.id !== primaryEdge?.id &&
          isJoinInputLayoutNode(nodeMap.get(edge.source)),
      )
      .sort((left, right) => compareNodeHorizontalCenter(positions, left.source, right.source));

    if (!sideEdges.length) {
      continue;
    }

    const leftCount = Math.floor(sideEdges.length / 2);
    const rightCount = Math.ceil(sideEdges.length / 2);
    const leftEdges = sideEdges.slice(0, leftCount);
    const rightEdges = sideEdges.slice(sideEdges.length - rightCount);
    const centerX = joinPosition.x + joinPosition.width / 2;
    const sideWidths = sideEdges.map((edge) => positions.get(edge.source)?.width || joinPosition.width);
    const widestSideWidth = Math.max(...sideWidths, joinPosition.width);
    const firstLaneOffset = Math.max(Math.round(joinPosition.width * 0.42), 84);
    const laneStep = widestSideWidth + Math.max(columnGap, 18);

    leftEdges.forEach((edge, index) => {
      const sourcePosition = positions.get(edge.source);

      if (!sourcePosition) {
        return;
      }

      const laneOffset = firstLaneOffset + (leftEdges.length - index - 1) * laneStep;
      sourcePosition.x = centerX - laneOffset - sourcePosition.width / 2;
      alignUniqueUpstreamChain(edge.source, positions, incoming, outgoing, nodeMap);
    });

    rightEdges.forEach((edge, index) => {
      const sourcePosition = positions.get(edge.source);

      if (!sourcePosition) {
        return;
      }

      const laneOffset = firstLaneOffset + index * laneStep;
      sourcePosition.x = centerX + laneOffset - sourcePosition.width / 2;
      alignUniqueUpstreamChain(edge.source, positions, incoming, outgoing, nodeMap);
    });
  }
}

function applyStatementPrimaryInputLayout(
  positions: Map<string, GraphPosition>,
  nodes: GraphNode[],
  edges: GraphEdge[],
  columnGap: number,
) {
  const incoming = new Map<string, GraphEdge[]>();
  const outgoing = new Map<string, GraphEdge[]>();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of edges) {
    if (!incoming.has(edge.target)) {
      incoming.set(edge.target, []);
    }
    incoming.get(edge.target)?.push(edge);

    if (!outgoing.has(edge.source)) {
      outgoing.set(edge.source, []);
    }
    outgoing.get(edge.source)?.push(edge);
  }

  for (const statementNode of nodes.filter((node) => node.type === "statement")) {
    const statementPosition = positions.get(statementNode.id);

    if (!statementPosition) {
      continue;
    }

    const primaryInputs = (incoming.get(statementNode.id) || [])
      .filter(
        (edge) =>
          edge.sourceRole !== "join" && isJoinInputLayoutNode(nodeMap.get(edge.source)),
      )
      .sort((left, right) => compareNodeHorizontalCenter(positions, left.source, right.source));

    if (!primaryInputs.length) {
      continue;
    }

    const horizontalGap = Math.max(columnGap, 28);
    const totalWidth =
      primaryInputs.reduce((sum, edge) => {
        const position = positions.get(edge.source);
        return sum + (position?.width || 0);
      }, 0) +
      Math.max(primaryInputs.length - 1, 0) * horizontalGap;
    let currentX =
      statementPosition.x + (statementPosition.width - totalWidth) / 2;

    for (const edge of primaryInputs) {
      const sourcePosition = positions.get(edge.source);

      if (!sourcePosition) {
        continue;
      }

      sourcePosition.x = currentX;
      currentX += sourcePosition.width + horizontalGap;
      alignUniqueUpstreamChain(edge.source, positions, incoming, outgoing, nodeMap);
    }
  }
}

function alignUniqueUpstreamChain(
  nodeId: string,
  positions: Map<string, GraphPosition>,
  incoming: Map<string, GraphEdge[]>,
  outgoing: Map<string, GraphEdge[]>,
  nodeMap: Map<string, GraphNode>,
) {
  const basePosition = positions.get(nodeId);

  if (!basePosition) {
    return;
  }

  let currentNodeId = nodeId;
  let currentCenterX = basePosition.x + basePosition.width / 2;

  while (true) {
    const parentEdges = (incoming.get(currentNodeId) || []).filter((edge) =>
      isJoinInputLayoutNode(nodeMap.get(edge.source)),
    );

    if (parentEdges.length !== 1) {
      break;
    }

    const parentEdge = parentEdges[0];
    const parentOutgoing = outgoing.get(parentEdge.source) || [];

    if (parentOutgoing.length !== 1) {
      break;
    }

    const parentPosition = positions.get(parentEdge.source);

    if (!parentPosition) {
      break;
    }

    parentPosition.x = currentCenterX - parentPosition.width / 2;
    currentNodeId = parentEdge.source;
    currentCenterX = parentPosition.x + parentPosition.width / 2;
  }
}

function compareNodeHorizontalCenter(
  positions: Map<string, GraphPosition>,
  leftNodeId: string,
  rightNodeId: string,
) {
  const leftPosition = positions.get(leftNodeId);
  const rightPosition = positions.get(rightNodeId);
  const leftCenter = leftPosition ? leftPosition.x + leftPosition.width / 2 : 0;
  const rightCenter = rightPosition ? rightPosition.x + rightPosition.width / 2 : 0;
  return leftCenter - rightCenter;
}

function resolveRowOverlaps(
  positions: Map<string, GraphPosition>,
  horizontalGap: number,
) {
  const rows = new Map<number, GraphPosition[]>();

  for (const position of positions.values()) {
    const rowKey = Math.round(position.y);
    if (!rows.has(rowKey)) {
      rows.set(rowKey, []);
    }
    rows.get(rowKey)?.push(position);
  }

  for (const rowPositions of rows.values()) {
    if (rowPositions.length <= 1) {
      continue;
    }

    rowPositions.sort((left, right) => left.x - right.x);

    const originalLeft = Math.min(...rowPositions.map((position) => position.x));
    const originalRight = Math.max(...rowPositions.map((position) => position.x + position.width));
    const originalCenter = (originalLeft + originalRight) / 2;

    let cursorX = rowPositions[0].x;
    rowPositions[0].x = cursorX;

    for (let index = 1; index < rowPositions.length; index += 1) {
      const previous = rowPositions[index - 1];
      const current = rowPositions[index];
      cursorX = Math.max(current.x, previous.x + previous.width + horizontalGap);
      current.x = cursorX;
    }

    const resolvedLeft = Math.min(...rowPositions.map((position) => position.x));
    const resolvedRight = Math.max(...rowPositions.map((position) => position.x + position.width));
    const resolvedCenter = (resolvedLeft + resolvedRight) / 2;
    const shiftX = originalCenter - resolvedCenter;

    if (!shiftX) {
      continue;
    }

    for (const position of rowPositions) {
      position.x += shiftX;
    }
  }
}

function isJoinInputLayoutNode(node: GraphNode | undefined) {
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
  ].includes(String(node?.type || ""));
}

function normalizeLayoutBounds(
  positions: Map<string, GraphPosition>,
  paddingX: number,
  paddingY: number,
) {
  if (!positions.size) {
    return;
  }

  let minX = Infinity;
  let minY = Infinity;

  for (const position of positions.values()) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
  }

  const shiftX = minX < paddingX ? paddingX - minX : 0;
  const shiftY = minY < paddingY ? paddingY - minY : 0;

  if (!shiftX && !shiftY) {
    return;
  }

  for (const position of positions.values()) {
    position.x += shiftX;
    position.y += shiftY;
  }
}

function optimizeLevelOrdering(
  columns: Map<number, GraphNode[]>,
  sortedLevels: number[],
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
) {
  if (sortedLevels.length <= 1) {
    return;
  }

  const initialRank = buildNodeRankMap(columns);

  for (let pass = 0; pass < 4; pass += 1) {
    let orderIndex = buildNodeRankMap(columns);

    for (let index = 1; index < sortedLevels.length; index += 1) {
      reorderLevel(columns, sortedLevels[index], incoming, orderIndex, initialRank);
      orderIndex = buildNodeRankMap(columns);
    }

    for (let index = sortedLevels.length - 2; index >= 0; index -= 1) {
      reorderLevel(columns, sortedLevels[index], outgoing, orderIndex, initialRank);
      orderIndex = buildNodeRankMap(columns);
    }
  }
}

function reorderLevel(
  columns: Map<number, GraphNode[]>,
  level: number,
  neighborMap: Map<string, string[]>,
  orderIndex: Map<string, number>,
  initialRank: Map<string, number>,
) {
  const levelNodes = columns.get(level);

  if (!levelNodes || levelNodes.length <= 1) {
    return;
  }

  levelNodes.sort((left, right) => {
    const leftCenter = computeNeighborBarycenter(left.id, neighborMap, orderIndex);
    const rightCenter = computeNeighborBarycenter(right.id, neighborMap, orderIndex);

    if (Number.isFinite(leftCenter) && Number.isFinite(rightCenter) && leftCenter !== rightCenter) {
      return leftCenter - rightCenter;
    }

    if (Number.isFinite(leftCenter) !== Number.isFinite(rightCenter)) {
      return Number.isFinite(leftCenter) ? -1 : 1;
    }

    const initialDelta = (initialRank.get(left.id) || 0) - (initialRank.get(right.id) || 0);

    if (initialDelta !== 0) {
      return initialDelta;
    }

    return String(left.label || left.id).localeCompare(String(right.label || right.id));
  });
}

function computeNeighborBarycenter(
  nodeId: string,
  neighborMap: Map<string, string[]>,
  orderIndex: Map<string, number>,
) {
  const neighbors = (neighborMap.get(nodeId) || []).filter((id) => orderIndex.has(id));

  if (!neighbors.length) {
    return Number.NaN;
  }

  const sum = neighbors.reduce((total, neighborId) => total + (orderIndex.get(neighborId) || 0), 0);
  return sum / neighbors.length;
}

function buildNodeRankMap(columns: Map<number, GraphNode[]>) {
  const orderIndex = new Map<string, number>();
  const levels = sortedNumericKeys(columns);

  for (const level of levels) {
    const nodes = columns.get(level) || [];
    nodes.forEach((node, index) => {
      orderIndex.set(node.id, index);
    });
  }

  return orderIndex;
}

function sortedNumericKeys(columns: Map<number, GraphNode[]>) {
  return Array.from(columns.keys()).sort((left, right) => left - right);
}

export function buildGraphFocusState(
  nodes: GraphNode[],
  edges: GraphEdge[],
  selectedNodeId: string | null,
  selectedColumn: GraphColumn | null = null,
  columns: GraphColumn[] = [],
): GraphFocusState {
  const focusState: GraphFocusState = {
    selectedNode: null,
    nodeState: new Map(),
    edgeState: new Map(),
    upstreamNodes: [],
    downstreamNodes: [],
    directUpstreamNodes: [],
    upstreamChainNodes: [],
    directDownstreamNodes: [],
    downstreamChainNodes: [],
    directUpstreamRoles: new Map(),
    directDownstreamRoles: new Map(),
  };

  if (!selectedNodeId) {
    return focusState;
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  if (!nodeMap.has(selectedNodeId)) {
    return focusState;
  }

  const outgoing = new Map(nodes.map((node) => [node.id, [] as GraphEdge[]]));
  const incoming = new Map(nodes.map((node) => [node.id, [] as GraphEdge[]]));

  for (const edge of edges) {
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  }

  const upstream = selectedColumn
    ? buildColumnUpstreamFocus(selectedNodeId, selectedColumn, incoming, columns)
    : traverseGraphEdges(selectedNodeId, incoming, "source");
  const downstream = traverseGraphEdges(selectedNodeId, outgoing, "target");
  focusState.selectedNode = nodeMap.get(selectedNodeId) || null;
  focusState.upstreamNodes = sortGraphNodes(
    Array.from(upstream.nodeIds)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter(Boolean) as GraphNode[],
  );
  focusState.directUpstreamNodes = sortGraphNodes(
    Array.from(upstream.nodeIds)
      .filter((nodeId) => upstream.nodeDepths.get(nodeId) === 1)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter(Boolean) as GraphNode[],
  );
  focusState.upstreamChainNodes = sortGraphNodes(
    Array.from(upstream.nodeIds)
      .filter((nodeId) => (upstream.nodeDepths.get(nodeId) || 0) > 1)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter(Boolean) as GraphNode[],
  );
  focusState.downstreamNodes = sortGraphNodes(
    Array.from(downstream.nodeIds)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter(Boolean) as GraphNode[],
  );
  focusState.directDownstreamNodes = sortGraphNodes(
    Array.from(downstream.nodeIds)
      .filter((nodeId) => downstream.nodeDepths.get(nodeId) === 1)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter(Boolean) as GraphNode[],
  );
  focusState.downstreamChainNodes = sortGraphNodes(
    Array.from(downstream.nodeIds)
      .filter((nodeId) => (downstream.nodeDepths.get(nodeId) || 0) > 1)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter(Boolean) as GraphNode[],
  );
  const directIncomingEdges = new Map(
    (incoming.get(selectedNodeId) || []).map((edge) => [edge.source, edge]),
  );
  const directOutgoingEdges = new Map(
    (outgoing.get(selectedNodeId) || []).map((edge) => [edge.target, edge]),
  );

  for (const node of nodes) {
    if (node.id === selectedNodeId) {
      focusState.nodeState.set(node.id, "is-selected");
      continue;
    }

    if (upstream.nodeIds.has(node.id)) {
      if (upstream.nodeDepths.get(node.id) === 1) {
        focusState.directUpstreamRoles.set(
          node.id,
          normalizeSourceRole(directIncomingEdges.get(node.id)?.sourceRole),
        );
        focusState.nodeState.set(
          node.id,
          buildDirectUpstreamNodeClass(directIncomingEdges.get(node.id)?.sourceRole),
        );
      } else {
        focusState.nodeState.set(node.id, "is-upstream-chain");
      }
      continue;
    }

    if (downstream.nodeIds.has(node.id)) {
      if (downstream.nodeDepths.get(node.id) === 1) {
        focusState.directDownstreamRoles.set(
          node.id,
          normalizeSourceRole(directOutgoingEdges.get(node.id)?.sourceRole),
        );
        focusState.nodeState.set(
          node.id,
          buildDirectDownstreamNodeClass(directOutgoingEdges.get(node.id)?.sourceRole),
        );
      } else {
        focusState.nodeState.set(node.id, "is-downstream-chain");
      }
      continue;
    }

    focusState.nodeState.set(node.id, "is-dimmed");
  }

  for (const edge of edges) {
    if (upstream.edgeIds.has(edge.id)) {
      if (upstream.edgeDepths.get(edge.id) === 1) {
        focusState.edgeState.set(edge.id, buildDirectUpstreamEdgeClass(edge.sourceRole));
      } else {
        focusState.edgeState.set(edge.id, "is-upstream-chain");
      }
      continue;
    }

    if (downstream.edgeIds.has(edge.id)) {
      if (downstream.edgeDepths.get(edge.id) === 1) {
        focusState.edgeState.set(edge.id, buildDirectDownstreamEdgeClass(edge.sourceRole));
      } else {
        focusState.edgeState.set(edge.id, "is-downstream-chain");
      }
      continue;
    }

    focusState.edgeState.set(edge.id, "is-dimmed");
  }

  return focusState;
}

function buildColumnUpstreamFocus(
  selectedNodeId: string,
  selectedColumn: GraphColumn,
  incoming: Map<string, GraphEdge[]>,
  columns: GraphColumn[],
): GraphTraversalState {
  const directRefs = dedupeColumnRefs(selectedColumn.upstream || []);

  if (!directRefs.length) {
    return traverseGraphEdges(selectedNodeId, incoming, "source");
  }

  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nodeDepths = new Map<string, number>();
  const edgeDepths = new Map<string, number>();
  const columnsByNodeId = new Map<string, GraphColumn[]>();
  const visited = new Map<string, number>();

  for (const column of columns) {
    if (!columnsByNodeId.has(column.nodeId)) {
      columnsByNodeId.set(column.nodeId, []);
    }

    columnsByNodeId.get(column.nodeId)?.push(column);
  }

  walkColumnLineage(selectedColumn, selectedNodeId, 0);

  function walkColumnLineage(column: GraphColumn, currentNodeId: string, currentDepth: number) {
    const refs = dedupeColumnRefs(column.upstream || []);

    for (const ref of refs) {
      const sourceNodeId = ref.sourceNodeId;
      const nextDepth = currentDepth + 1;

      if (!sourceNodeId) {
        continue;
      }

      nodeIds.add(sourceNodeId);
      assignMinimumDepth(nodeDepths, sourceNodeId, nextDepth);

      const directEdge = (incoming.get(currentNodeId) || []).find(
        (edge) => edge.source === sourceNodeId,
      );

      if (directEdge) {
        edgeIds.add(directEdge.id);
        assignMinimumDepth(edgeDepths, directEdge.id, nextDepth);
      }

      const key = `${sourceNodeId}:${normalizeColumnName(ref.columnName)}`;
      const previousDepth = visited.get(key);

      if (typeof previousDepth === "number" && previousDepth <= nextDepth) {
        continue;
      }

      visited.set(key, nextDepth);

      if (sourceNodeId.startsWith("source:")) {
        continue;
      }

      const matchingColumns = resolveUpstreamColumnsForRef(
        columnsByNodeId.get(sourceNodeId) || [],
        ref,
      );

      if (!matchingColumns.length) {
        continue;
      }

      for (const nextColumn of matchingColumns) {
        walkColumnLineage(nextColumn, sourceNodeId, nextDepth);
      }
    }
  }

  return {
    nodeIds,
    edgeIds,
    nodeDepths,
    edgeDepths,
  };
}

function resolveUpstreamColumnsForRef(columns: GraphColumn[], ref: GraphColumnRef) {
  const targetName = normalizeColumnName(ref.columnName);

  if (!targetName) {
    return [];
  }

  return columns.filter((column) => {
    const names = [column.name, column.label].map((value) => normalizeColumnName(value));
    return names.includes(targetName);
  });
}

function dedupeColumnRefs(refs: GraphColumn["upstream"] = []) {
  const seen = new Set<string>();
  const result = [];

  for (const ref of refs) {
    const key = [ref.sourceNodeId || "", ref.sourceName || ref.qualifier || "", ref.columnName || "*"].join(":");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(ref);
  }

  return result;
}

function normalizeColumnName(value: string | null | undefined) {
  return String(value || "")
    .replace(/[`"'[\]]/g, "")
    .trim()
    .toLowerCase();
}

export function computeFlowVisualContext(
  nodes: GraphNode[],
  edges: GraphEdge[],
  colorMode: GraphColorMode = "ocean",
): FlowVisualContext {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const incoming = new Map(nodes.map((node) => [node.id, [] as GraphEdge[]]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as GraphEdge[]]));

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      continue;
    }

    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    incoming.get(edge.target)?.push(edge);
    outgoing.get(edge.source)?.push(edge);
  }

  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .map((node) => node.id);
  const visited = new Set<string>();
  const lineageMap = new Map<string, LineageColor[]>();

  while (queue.length) {
    const currentId = queue.shift();
    const node = currentId ? nodeMap.get(currentId) : null;

    if (!currentId || !node) {
      continue;
    }

    visited.add(currentId);
    const parentLineages = (incoming.get(currentId) || []).map((edge) => lineageMap.get(edge.source));
    lineageMap.set(currentId, buildNodeLineage(node, parentLineages, colorMode));

    for (const edge of outgoing.get(currentId) || []) {
      indegree.set(edge.target, (indegree.get(edge.target) || 0) - 1);

      if ((indegree.get(edge.target) || 0) <= 0) {
        queue.push(edge.target);
      }
    }
  }

  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }

    const parentLineages = (incoming.get(node.id) || []).map((edge) => lineageMap.get(edge.source));
    lineageMap.set(node.id, buildNodeLineage(node, parentLineages, colorMode));
  }

  const nodeVisuals = new Map<string, NodeVisual>();
  const edgeVisuals = new Map<string, EdgeVisual>();
  let gradientIndex = 1;

  for (const node of nodes) {
    const lineage = lineageMap.get(node.id) || [createFallbackLineageColor(node, colorMode)];
    const visual = createNodeFlowVisual(node, lineage, gradientIndex, colorMode);
    nodeVisuals.set(node.id, visual);

    if (visual.gradientId) {
      gradientIndex += 1;
    }
  }

  for (const edge of edges) {
    const lineage =
      lineageMap.get(edge.source) ||
      lineageMap.get(edge.target) ||
      [createFallbackLineageColor(nodeMap.get(edge.source) || nodeMap.get(edge.target) || null, colorMode)];
    edgeVisuals.set(edge.id, createEdgeFlowVisual(lineage, colorMode));
  }

  return {
    nodeVisuals,
    edgeVisuals,
  };
}

export function createEdgePath(
  source: GraphPosition,
  target: GraphPosition,
  edge?: GraphEdge | null,
  _sourceNode?: GraphNode | null,
  targetNode?: GraphNode | null,
) {
  if (
    source.x === target.x &&
    source.y === target.y &&
    source.width === target.width &&
    source.height === target.height
  ) {
    const rightX = source.x + source.width - 8;
    const upperY = source.y + Math.max(16, source.height * 0.28);
    const lowerY = source.y + source.height - Math.max(16, source.height * 0.28);
    const loopX = source.x + source.width + Math.max(44, source.width * 0.52);
    const outerTopY = source.y - Math.max(28, source.height * 0.38);
    const outerBottomY = source.y + source.height + Math.max(28, source.height * 0.38);

    return `M ${rightX} ${lowerY} C ${loopX} ${outerBottomY}, ${loopX} ${outerTopY}, ${rightX} ${upperY}`;
  }

  const startX = source.x + source.width / 2;
  const startY = source.y + source.height;
  const defaultEndX = target.x + target.width / 2;
  const defaultEndY = target.y;

  if (targetNode?.type === "join") {
    if (_sourceNode?.type === "statement" || normalizeSourceRole(edge?.sourceRole) !== "join") {
      const endX = target.x + target.width / 2;
      const endY = target.y;
      const curve = Math.max((endY - startY) / 2, 28);

      return `M ${startX} ${startY} C ${startX} ${startY + curve}, ${endX} ${endY - curve}, ${endX} ${endY}`;
    }

    const sourceCenterX = source.x + source.width / 2;
    const targetCenterX = target.x + target.width / 2;
    const attachRight = sourceCenterX >= targetCenterX;
    const endX = attachRight ? target.x + target.width : target.x;
    const endY = target.y + target.height / 2;
    const controlY = Math.max(startY + 28, endY - 32);
    const controlX = attachRight ? endX + 32 : endX - 32;

    return `M ${startX} ${startY} C ${startX} ${controlY}, ${controlX} ${endY}, ${endX} ${endY}`;
  }

  const curve = Math.max((defaultEndY - startY) / 2, 28);

  return `M ${startX} ${startY} C ${startX} ${startY + curve}, ${defaultEndX} ${defaultEndY - curve}, ${defaultEndX} ${defaultEndY}`;
}

export function graphMetaText(node: GraphNode) {
  if (node.type === "cte") {
    const sourceCount = Number(node.meta?.sourceCount ?? 0);
    const dependencyCount = Number(node.meta?.dependencyCount ?? 0);
    const recursive = Boolean(node.meta?.recursive);
    return `${recursive ? "recursive · " : ""}${sourceCount} input · ${dependencyCount} cte`;
  }

  if (node.type === "source_table") {
    const sampleKind = String(node.meta?.sampleKind || "").trim().toUpperCase();
    return sampleKind || "PHYSICAL TABLE";
  }

  if (node.type === "unnest_source") {
    return "EXPANDED SOURCE";
  }

  if (node.type === "lateral_view") {
    return "DERIVED ROW SOURCE";
  }

  if (node.type === "statement") {
    return "MAIN QUERY";
  }

  if (node.type === "directive") {
    return "SESSION CONFIG";
  }

  if (node.type === "join") {
    const joinTypes = Array.isArray(node.meta?.joinTypes)
      ? node.meta.joinTypes.filter(Boolean).map((value) => String(value))
      : [];

    if (!joinTypes.length) {
      return "JOIN SOURCE";
    }

    return joinTypes.length === 1 ? `${joinTypes[0]} JOIN` : `${joinTypes.length} JOIN TYPES`;
  }

  if (node.type === "having") {
    return "POST-AGG FILTER";
  }

  if (node.type === "qualify") {
    return "POST-WINDOW FILTER";
  }

  if (node.type === "aggregate") {
    const groupByKind = String(node.meta?.groupByKind || "").trim().toUpperCase();
    return groupByKind || "AGGREGATE";
  }

  if (node.type === "merge_action") {
    const mergeAction = String(node.meta?.mergeAction || "").trim();
    const mergeActionKind = String(node.meta?.mergeActionKind || "").trim().toUpperCase();

    if (mergeActionKind) {
      return `${mergeActionKind} PATH`;
    }

    return mergeAction === "notMatched" ? "INSERT PATH" : "MATCHED PATH";
  }

  if (node.type === "merge_match") {
    return "MATCH CONDITION";
  }

  if (node.type === "set") {
    return "WRITE MAPPING";
  }

  if (node.type === "values") {
    const rowCount = Number(node.meta?.valuesRowCount ?? 0);
    return rowCount > 0 ? `${rowCount} row${rowCount === 1 ? "" : "s"}` : "LITERAL INPUT";
  }

  if (node.type === "returning") {
    return "WRITE OUTPUT";
  }

  if (node.type === "conflict") {
    return "CONFLICT TARGET";
  }

  if (node.type === "conflict_action") {
    const conflictKind = String(node.meta?.conflictKind || "").trim().toUpperCase();
    return conflictKind || "UPSERT ACTION";
  }

  if (node.type === "offset") {
    return "ROW SKIP";
  }

  if (node.type === "distinct") {
    const distinctKind = String(node.meta?.distinctKind || "").trim().toUpperCase();
    return distinctKind || "DEDUP";
  }

  if (node.type === "union") {
    const setOperatorKind = String(node.meta?.setOperatorKind || "").trim().toUpperCase();
    return setOperatorKind || "SET OP";
  }

  if (node.type === "script_statement") {
    return "SCRIPT STATEMENT";
  }

  if (node.type === "result") {
    return "FINAL OUTPUT";
  }

  if (node.type === "write_target") {
    return String(node.meta?.writeKind || "write")
      .replace(/_/g, " ")
      .toUpperCase();
  }

  if (
    node.type === "inline_view" ||
    node.type === "union_branch" ||
    node.type === "scalar_subquery" ||
    node.type === "exists_subquery" ||
    node.type === "in_subquery"
  ) {
    const sourceCount = Number(node.meta?.sourceCount ?? 0);
    const clauseCount = Number(node.meta?.clauseCount ?? 0);
    const setOperator = String(node.meta?.setOperator || "").trim();
    const branchCount = Number(node.meta?.branchCount ?? 0);
    const branchIndex = Number(node.meta?.branchIndex ?? -1);

    if (node.type === "union_branch" && setOperator) {
      if (branchCount > 1 && branchIndex >= 0) {
        return `branch ${branchIndex + 1}/${branchCount} · ${sourceCount} source`;
      }

      return `${sourceCount} source · ${setOperator}`;
    }

    if (setOperator && branchCount > 1) {
      return `${branchCount} branches · ${setOperator}`;
    }

    return clauseCount > 0
      ? `${sourceCount} source · ${clauseCount} clause`
      : `${sourceCount} source · subquery`;
  }

  if (node.type === "clause_stack") {
    return `${Number(node.meta?.clauseCount ?? 0)} folded`;
  }

  if (node.type === "source_cluster") {
    return `${Number(node.meta?.sourceCount ?? 0)} folded`;
  }

  if (node.type === "cte_cluster") {
    return `${Number(node.meta?.cteCount ?? 0)} folded`;
  }

  return String(node.type || "node").replace(/_/g, " ").toUpperCase();
}

export function graphEyebrowText(node: GraphNode) {
  if (node.type === "cte") {
    return "CTE";
  }

  if (node.type === "source_table") {
    return "DB TABLE";
  }

  if (node.type === "unnest_source") {
    return "UNNEST";
  }

  if (node.type === "lateral_view") {
    return "LATERAL";
  }

  if (node.type === "source_cluster") {
    return "SOURCES";
  }

  if (node.type === "cte_cluster") {
    return "CTE";
  }

  if (node.type === "statement") {
    return "QUERY";
  }

  if (node.type === "directive") {
    return "DIRECTIVE";
  }

  if (
    node.type === "join" ||
    node.type === "merge_match" ||
    node.type === "set" ||
    node.type === "values" ||
    node.type === "returning" ||
    node.type === "conflict" ||
    node.type === "conflict_action" ||
    node.type === "offset" ||
    node.type === "distinct" ||
    node.type === "having" ||
    node.type === "qualify" ||
    node.type === "union"
  ) {
    return "CLAUSE";
  }

  if (node.type === "merge_action") {
    return "MERGE";
  }

  if (node.type === "script_statement") {
    return "SCRIPT";
  }

  if (node.type === "result") {
    return "OUTPUT";
  }

  if (node.type === "write_target") {
    return "WRITE";
  }

  if (
    node.type === "inline_view" ||
    node.type === "union_branch" ||
    node.type === "scalar_subquery" ||
    node.type === "exists_subquery" ||
    node.type === "in_subquery"
  ) {
    return node.type === "union_branch" ? "SET" : "SUBQUERY";
  }

  if (node.type === "clause_stack") {
    return "FOLDED";
  }

  return "CLAUSE";
}

export function nodeClassName(node: GraphNode, focusClassName?: string) {
  const classNames = ["graph-node", `type-${sanitizeCssClass(node.type || "unknown")}`];

  if (focusClassName) {
    classNames.push(focusClassName);
  }

  return classNames.join(" ");
}

export function edgeClassName(edgeType?: string, focusClassName?: string) {
  const classNames = ["graph-edge"];

  if (edgeType) {
    classNames.push(`type-${sanitizeCssClass(edgeType)}`);
  }

  if (focusClassName) {
    classNames.push(focusClassName);
  }

  return classNames.join(" ");
}

export function truncate(value: string | undefined, length: number) {
  const input = String(value || "");
  return input.length <= length ? input : `${input.slice(0, length - 1)}...`;
}

function sanitizeCssClass(value: string) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function traverseGraphEdges(
  startNodeId: string,
  edgeMap: Map<string, GraphEdge[]>,
  nextNodeKey: "source" | "target",
) : GraphTraversalState {
  const queue = [{ nodeId: startNodeId, depth: 0 }];
  const edgeIds = new Set<string>();
  const nodeIds = new Set<string>();
  const nodeDepths = new Map<string, number>();
  const edgeDepths = new Map<string, number>();

  while (queue.length) {
    const current = queue.shift();

    if (!current?.nodeId) {
      continue;
    }

    for (const edge of edgeMap.get(current.nodeId) || []) {
      if (!edge?.id) {
        continue;
      }

      const nextNodeId = edge[nextNodeKey];
      const nextDepth = current.depth + 1;

      edgeIds.add(edge.id);
      assignMinimumDepth(edgeDepths, edge.id, nextDepth);

      if (!nextNodeId) {
        continue;
      }

      const previousDepth = nodeDepths.get(nextNodeId);

      if (typeof previousDepth === "number" && previousDepth <= nextDepth) {
        continue;
      }

      nodeIds.add(nextNodeId);
      nodeDepths.set(nextNodeId, nextDepth);
      queue.push({ nodeId: nextNodeId, depth: nextDepth });
    }
  }

  return {
    nodeIds,
    edgeIds,
    nodeDepths,
    edgeDepths,
  };
}

function assignMinimumDepth(depthMap: Map<string, number>, key: string, depth: number) {
  const previousDepth = depthMap.get(key);

  if (typeof previousDepth !== "number" || depth < previousDepth) {
    depthMap.set(key, depth);
  }
}

function buildDirectUpstreamNodeClass(sourceRole: string | undefined) {
  const role = normalizeSourceRole(sourceRole);

  if (role === "join") {
    return "is-upstream-direct is-upstream-direct-join";
  }

  if (role === "from") {
    return "is-upstream-direct is-upstream-direct-from";
  }

  return "is-upstream-direct";
}

function buildDirectUpstreamEdgeClass(sourceRole: string | undefined) {
  const role = normalizeSourceRole(sourceRole);

  if (role === "join") {
    return "is-upstream-direct is-upstream-direct-join";
  }

  if (role === "from") {
    return "is-upstream-direct is-upstream-direct-from";
  }

  return "is-upstream-direct";
}

function buildDirectDownstreamNodeClass(sourceRole: string | undefined) {
  const role = normalizeSourceRole(sourceRole);

  if (role === "join") {
    return "is-downstream-direct is-downstream-direct-join";
  }

  if (role === "from") {
    return "is-downstream-direct is-downstream-direct-from";
  }

  return "is-downstream-direct";
}

function buildDirectDownstreamEdgeClass(sourceRole: string | undefined) {
  const role = normalizeSourceRole(sourceRole);

  if (role === "join") {
    return "is-downstream-direct is-downstream-direct-join";
  }

  if (role === "from") {
    return "is-downstream-direct is-downstream-direct-from";
  }

  return "is-downstream-direct";
}

function normalizeSourceRole(sourceRole: string | undefined) {
  const value = String(sourceRole || "").trim().toLowerCase();

  if (!value) {
    return "";
  }

  if (value === "from") {
    return "from";
  }

  if (value === "join" || value === "using" || value.includes("join")) {
    return "join";
  }

  return value;
}

function sortGraphNodes(nodes: GraphNode[]) {
  return [...nodes].sort((left, right) => {
    const leftType = String(left.type || "");
    const rightType = String(right.type || "");
    return (
      leftType.localeCompare(rightType) ||
      String(left.label || left.id).localeCompare(String(right.label || right.id))
    );
  });
}

function buildNodeLineage(
  node: GraphNode,
  parentLineages: Array<LineageColor[] | undefined>,
  colorMode: GraphColorMode,
) {
  const merged = mergeLineageColors(parentLineages.flat().filter(Boolean) as LineageColor[]);

  if (node.type === "source_table") {
    return [createSourceLineageColor(node, colorMode)];
  }

  if (merged.length) {
    return merged;
  }

  return [createFallbackLineageColor(node, colorMode)];
}

function createSourceLineageColor(node: GraphNode, colorMode: GraphColorMode) {
  const key = node.label || node.id || "source";
  return createLineageColor(`source:${key}`, key, colorMode);
}

function createFallbackLineageColor(node: GraphNode | null, colorMode: GraphColorMode) {
  const type = node?.type || "unknown";
  const key = `${type}:${node?.label || node?.id || "node"}`;
  return createLineageColor(key, key, colorMode, fallbackPaletteOffset(type));
}

function createLineageColor(
  id: string,
  seed: string,
  colorMode: GraphColorMode,
  paletteOffset = 0,
): LineageColor {
  const hash = Math.abs(hashString(`${id}:${seed}`));
  const palette = paletteEntriesForMode(colorMode);
  const paletteIndex = (hash + paletteOffset) % palette.length;
  const entry = palette[paletteIndex];

  return {
    id,
    seed,
    rgb: entry.rgb,
    hex: entry.hex,
  };
}

function fallbackPaletteOffset(type: string) {
  const offsets: Record<string, number> = {
    cte: 1,
    cte_cluster: 1,
    statement: 2,
    result: 3,
    source_cluster: 3,
    unnest_source: 4,
    lateral_view: 5,
    inline_view: 4,
    union_branch: 6,
    scalar_subquery: 7,
    exists_subquery: 8,
    in_subquery: 9,
    aggregate: 4,
    filter: 5,
    orderBy: 6,
    limit: 7,
    join: 8,
    union: 9,
    qualify: 10,
    script_statement: 11,
    write_target: 12,
  };

  return offsets[type] || 0;
}

function mergeLineageColors(colors: LineageColor[]) {
  const merged: LineageColor[] = [];
  const seen = new Set<string>();

  for (const color of colors) {
    if (!color.id || seen.has(color.id)) {
      continue;
    }

    seen.add(color.id);
    merged.push(color);
  }

  return merged;
}

function createNodeFlowVisual(
  node: GraphNode,
  lineage: LineageColor[],
  gradientIndex: number,
  colorMode: GraphColorMode,
): NodeVisual {
  const colors = lineage.length ? lineage : [createFallbackLineageColor(node, colorMode)];
  const representative = sampleLineageColors(colors, MAX_FLOW_COLOR_STOPS);
  const paletteRoles = paletteRolesForMode(colorMode);
  const mixedLineageRgb = mixLineageColors(colors);
  const primaryLineage = pickRepresentativeLineageColor(node, representative, 0);
  const secondaryLineage = pickRepresentativeLineageColor(node, representative, 1) || primaryLineage;
  const sourceDrivenRgb =
    node.type === "source_table"
      ? representative[0]?.rgb || mixedLineageRgb
      : blendRgb(primaryLineage.rgb, mixedLineageRgb, 0.36);
  const accentSourceRgb =
    representative.length > 1
      ? blendRgb(primaryLineage.rgb, secondaryLineage.rgb, 0.28)
      : sourceDrivenRgb;
  const profile = nodeToneProfile(node.type, paletteRoles, colorMode);
  const accentRgb =
    colorMode === "mono"
      ? monochromeAccentForNode(node.type)
      : blendRgb(accentSourceRgb, paletteRoles.deep, profile.accentBlend);
  const fillRgb =
    colorMode === "mono"
      ? blendRgb(profile.baseRgb, accentRgb, 0.14)
      : blendRgb(profile.baseRgb, sourceDrivenRgb, profile.fillTint);
  const strokeRgb =
    colorMode === "mono"
      ? blendRgb({ r: 116, g: 148, b: 180 }, accentRgb, 0.16)
      : blendRgb(accentRgb, paletteRoles.deep, profile.strokeBlend);

  return {
    fill: rgbaString(fillRgb, profile.fillAlpha),
    bandFill: rgbToHex(accentRgb),
    stroke: rgbaString(strokeRgb, profile.strokeAlpha),
    accent: rgbToHex(accentRgb),
    text: textColorForMode(colorMode),
    gradientId: null,
    gradientStops: [],
    swatchColors: representative.slice(0, profile.swatchLimit).map((color) => color.hex),
  };
}

function createEdgeFlowVisual(lineage: LineageColor[], colorMode: GraphColorMode): EdgeVisual {
  const colors = lineage.length ? lineage : [createFallbackLineageColor(null, colorMode)];
  const mixed = mixLineageColors(colors);
  const paletteRoles = paletteRolesForMode(colorMode);
  const strokeRgb =
    colorMode === "mono"
      ? edgeBaseForMode(colorMode)
      : blendRgb(mixed, paletteRoles.deep, 0.18);
  return {
    stroke: rgbaString(strokeRgb, colorMode === "mono" ? 0.26 : 0.42),
  };
}

function sampleLineageColors(colors: LineageColor[], limit: number) {
  if (colors.length <= limit) {
    return colors;
  }

  const result: LineageColor[] = [];
  const step = (colors.length - 1) / Math.max(limit - 1, 1);

  for (let index = 0; index < limit; index += 1) {
    result.push(colors[Math.round(index * step)]);
  }

  return mergeLineageColors(result);
}

function buildGradientStops(colors: LineageColor[], nodeType?: string): GradientStop[] {
  const opacity = gradientStopOpacity(nodeType);

  if (colors.length === 1) {
    return [
      {
        offset: "0%",
        color: colors[0].hex,
        opacity: `${opacity}`,
      },
    ];
  }

  return colors.map((color, index) => ({
    offset: `${Math.round((index / (colors.length - 1)) * 100)}%`,
    color: color.hex,
    opacity: `${opacity}`,
  }));
}

function pickRepresentativeLineageColor(
  node: GraphNode,
  colors: LineageColor[],
  offset: number,
) {
  if (!colors.length) {
    return createFallbackLineageColor(node, "ocean");
  }

  const index = Math.abs(hashString(`${node.id}:${offset}`)) % colors.length;
  return colors[index];
}

function mixLineageColors(colors: LineageColor[]) {
  const totals = colors.reduce(
    (accumulator, color) => {
      accumulator.r += color.rgb.r;
      accumulator.g += color.rgb.g;
      accumulator.b += color.rgb.b;
      return accumulator;
    },
    { r: 0, g: 0, b: 0 },
  );
  const count = Math.max(colors.length, 1);

  return {
    r: Math.round(totals.r / count),
    g: Math.round(totals.g / count),
    b: Math.round(totals.b / count),
  };
}

function rgbaString(rgb: { r: number; g: number; b: number }, alpha: number) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function rgbToHex(rgb: { r: number; g: number; b: number }) {
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function hexToRgb(hex: string) {
  const value = String(hex || "").replace(/^#/, "");
  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : value;

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) || 0,
    g: Number.parseInt(normalized.slice(2, 4), 16) || 0,
    b: Number.parseInt(normalized.slice(4, 6), 16) || 0,
  };
}

function toHex(value: number) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function hashString(value: string) {
  let hash = 0;

  for (const char of String(value || "")) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }

  return hash;
}

function chunk<T>(items: T[], size: number) {
  if (!items.length) {
    return [];
  }

  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
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

function baseFillForNode(
  nodeType: string | undefined,
  colorMode: GraphColorMode,
  accent: { r: number; g: number; b: number },
) {
  if (colorMode === "mono") {
    return blendRgb({ r: 247, g: 250, b: 253 }, accent, 0.08);
  }

  return blendRgb({ r: 255, g: 255, b: 255 }, accent, baseTintStrength(nodeType));
}

function nodeToneProfile(
  nodeType: string | undefined,
  paletteRoles: PaletteRoles,
  colorMode: GraphColorMode,
): NodeToneProfile {
  if (colorMode === "mono") {
    return {
      baseRgb: blendRgb({ r: 247, g: 250, b: 253 }, paletteRoles.soft, 0.16),
      fillTint: 0.14,
      accentBlend: 0.2,
      strokeBlend: 0.18,
      fillAlpha: 0.96,
      strokeAlpha: 0.42,
      swatchLimit: 2,
    };
  }

  switch (nodeType) {
    case "source_table":
    case "source_cluster":
      return {
        baseRgb: blendRgb({ r: 255, g: 255, b: 255 }, paletteRoles.light, 0.32),
        fillTint: 0.4,
        accentBlend: 0.08,
        strokeBlend: 0.14,
        fillAlpha: 0.96,
        strokeAlpha: 0.54,
        swatchLimit: 1,
      };
    case "unnest_source":
    case "lateral_view":
      return {
        baseRgb: blendRgb({ r: 252, g: 255, b: 253 }, paletteRoles.soft, 0.24),
        fillTint: 0.32,
        accentBlend: 0.16,
        strokeBlend: 0.16,
        fillAlpha: 0.96,
        strokeAlpha: 0.56,
        swatchLimit: 2,
      };
    case "cte":
    case "cte_cluster":
      return {
        baseRgb: blendRgb({ r: 255, g: 255, b: 255 }, paletteRoles.soft, 0.2),
        fillTint: 0.34,
        accentBlend: 0.12,
        strokeBlend: 0.22,
        fillAlpha: 0.97,
        strokeAlpha: 0.48,
        swatchLimit: 4,
      };
    case "statement":
    case "script_statement":
    case "directive":
      return {
        baseRgb: blendRgb({ r: 255, g: 255, b: 255 }, paletteRoles.light, 0.12),
        fillTint: 0.22,
        accentBlend: 0.28,
        strokeBlend: 0.1,
        fillAlpha: 0.98,
        strokeAlpha: 0.68,
        swatchLimit: 2,
      };
    case "result":
      return {
        baseRgb: blendRgb({ r: 255, g: 251, b: 247 }, paletteRoles.light, 0.22),
        fillTint: 0.28,
        accentBlend: 0.2,
        strokeBlend: 0.14,
        fillAlpha: 0.98,
        strokeAlpha: 0.56,
        swatchLimit: 3,
      };
    case "inline_view":
    case "union_branch":
    case "scalar_subquery":
    case "exists_subquery":
    case "in_subquery":
      return {
        baseRgb: blendRgb({ r: 252, g: 254, b: 255 }, paletteRoles.soft, 0.18),
        fillTint: 0.26,
        accentBlend: 0.2,
        strokeBlend: 0.16,
        fillAlpha: 0.98,
        strokeAlpha: 0.52,
        swatchLimit: 3,
      };
    case "write_target":
      return {
        baseRgb: blendRgb({ r: 255, g: 252, b: 247 }, paletteRoles.light, 0.16),
        fillTint: 0.24,
        accentBlend: 0.32,
        strokeBlend: 0.12,
        fillAlpha: 0.98,
        strokeAlpha: 0.62,
        swatchLimit: 2,
      };
    case "clause_stack":
      return {
        baseRgb: blendRgb({ r: 251, g: 252, b: 255 }, paletteRoles.soft, 0.16),
        fillTint: 0.22,
        accentBlend: 0.24,
        strokeBlend: 0.12,
        fillAlpha: 0.97,
        strokeAlpha: 0.54,
        swatchLimit: 2,
      };
    default:
      return {
        baseRgb: blendRgb({ r: 253, g: 254, b: 255 }, paletteRoles.soft, 0.12),
        fillTint: 0.2,
        accentBlend: 0.26,
        strokeBlend: 0.1,
        fillAlpha: 0.97,
        strokeAlpha: 0.6,
        swatchLimit: 2,
      };
  }
}

function fillBlendStrength(nodeType: string | undefined) {
  if (nodeType === "source_table" || nodeType === "source_cluster") {
    return 0.32;
  }

  if (nodeType === "unnest_source" || nodeType === "lateral_view") {
    return 0.28;
  }

  if (nodeType === "cte" || nodeType === "cte_cluster") {
    return 0.3;
  }

  if (nodeType === "result") {
    return 0.26;
  }

  if (nodeType === "statement" || nodeType === "script_statement") {
    return 0.18;
  }

  if (nodeType === "directive") {
    return 0.16;
  }

  return 0.22;
}

function strokeBlendStrength(nodeType: string | undefined) {
  if (nodeType === "source_table" || nodeType === "source_cluster") {
    return 0.24;
  }

  if (nodeType === "unnest_source" || nodeType === "lateral_view") {
    return 0.26;
  }

  if (nodeType === "cte" || nodeType === "cte_cluster") {
    return 0.28;
  }

  if (nodeType === "result") {
    return 0.18;
  }

  if (nodeType === "statement" || nodeType === "script_statement") {
    return 0.16;
  }

  if (nodeType === "directive") {
    return 0.14;
  }

  return 0.2;
}

function monochromeAccentForNode(nodeType: string | undefined) {
  switch (nodeType) {
    case "source_table":
    case "source_cluster":
      return { r: 76, g: 133, b: 187 };
    case "unnest_source":
    case "lateral_view":
      return { r: 72, g: 150, b: 166 };
    case "cte":
    case "cte_cluster":
      return { r: 67, g: 124, b: 177 };
    case "statement":
    case "script_statement":
    case "directive":
      return { r: 57, g: 112, b: 164 };
    case "result":
      return { r: 70, g: 136, b: 176 };
    case "inline_view":
    case "union_branch":
    case "scalar_subquery":
    case "exists_subquery":
    case "in_subquery":
      return { r: 76, g: 131, b: 180 };
    case "write_target":
      return { r: 64, g: 122, b: 168 };
    default:
      return { r: 88, g: 136, b: 182 };
  }
}

function baseTintStrength(nodeType: string | undefined) {
  switch (nodeType) {
    case "source_table":
    case "source_cluster":
      return 0.2;
    case "unnest_source":
    case "lateral_view":
      return 0.18;
    case "cte":
    case "cte_cluster":
      return 0.16;
    case "statement":
    case "script_statement":
    case "directive":
      return 0.1;
    case "result":
      return 0.14;
    case "inline_view":
    case "union_branch":
    case "scalar_subquery":
    case "exists_subquery":
    case "in_subquery":
      return 0.14;
    case "filter":
    case "aggregate":
    case "having":
    case "qualify":
    case "join":
    case "merge_match":
    case "merge_action":
    case "set":
    case "window":
    case "orderBy":
    case "limit":
    case "clause_stack":
      return 0.15;
    default:
      return 0.12;
  }
}

function accentDepthStrength(nodeType: string | undefined) {
  switch (nodeType) {
    case "source_table":
    case "source_cluster":
      return 0.06;
    case "unnest_source":
    case "lateral_view":
      return 0.1;
    case "cte":
    case "cte_cluster":
      return 0.12;
    case "statement":
    case "script_statement":
    case "directive":
      return 0.22;
    case "result":
      return 0.1;
    default:
      return 0.18;
  }
}

function paletteEntriesForMode(colorMode: GraphColorMode) {
  return FLOW_PALETTES[colorMode] || FLOW_PALETTES.ocean;
}

function textColorForMode(colorMode: GraphColorMode) {
  return rgbToHex(paletteRolesForMode(colorMode).deep);
}

function edgeBaseForMode(colorMode: GraphColorMode) {
  const roles = paletteRolesForMode(colorMode);
  return blendRgb(roles.main, roles.soft, 0.5);
}

function strokeBaseForMode(colorMode: GraphColorMode) {
  const roles = paletteRolesForMode(colorMode);
  return blendRgb(roles.deep, roles.soft, 0.28);
}

export function paletteRolesForMode(colorMode: GraphColorMode): PaletteRoles {
  const palette = [...basePaletteEntriesForMode(colorMode)].sort(
    (left, right) => rgbLuminance(left.rgb) - rgbLuminance(right.rgb),
  );
  const [deep, main, soft, light] = palette;

  return {
    deep: deep.rgb,
    main: main.rgb,
    soft: soft.rgb,
    light: light.rgb,
  };
}

function basePaletteEntriesForMode(colorMode: GraphColorMode) {
  return BASE_FLOW_PALETTES[colorMode] || BASE_FLOW_PALETTES.ocean;
}

function buildPaletteEntry(hex: string) {
  return {
    hex,
    rgb: hexToRgb(hex),
  };
}

function expandPaletteEntries(
  baseEntries: Array<{ hex: string; rgb: { r: number; g: number; b: number } }>,
) {
  const derived: Array<{ hex: string; rgb: { r: number; g: number; b: number } }> = [];

  for (let index = 0; index < baseEntries.length; index += 1) {
    const current = baseEntries[index];
    const previous = baseEntries[(index - 1 + baseEntries.length) % baseEntries.length];
    const next = baseEntries[(index + 1) % baseEntries.length];

    derived.push(current);
    derived.push({
      hex: rgbToHex(blendRgb(current.rgb, next.rgb, 0.34)),
      rgb: blendRgb(current.rgb, next.rgb, 0.34),
    });
    derived.push({
      hex: rgbToHex(blendRgb(current.rgb, next.rgb, 0.66)),
      rgb: blendRgb(current.rgb, next.rgb, 0.66),
    });
    derived.push({
      hex: rgbToHex(blendRgb(current.rgb, previous.rgb, 0.5)),
      rgb: blendRgb(current.rgb, previous.rgb, 0.5),
    });
    derived.push({
      hex: rgbToHex(blendRgb(current.rgb, { r: 255, g: 255, b: 255 }, 0.16)),
      rgb: blendRgb(current.rgb, { r: 255, g: 255, b: 255 }, 0.16),
    });
    derived.push({
      hex: rgbToHex(blendRgb(current.rgb, { r: 0, g: 0, b: 0 }, 0.1)),
      rgb: blendRgb(current.rgb, { r: 0, g: 0, b: 0 }, 0.1),
    });
  }

  return dedupePaletteEntries(derived);
}

function dedupePaletteEntries(
  entries: Array<{ hex: string; rgb: { r: number; g: number; b: number } }>,
) {
  const seen = new Set<string>();
  const result: Array<{ hex: string; rgb: { r: number; g: number; b: number } }> = [];

  for (const entry of entries) {
    if (seen.has(entry.hex)) {
      continue;
    }

    seen.add(entry.hex);
    result.push(entry);
  }

  return result;
}

function rgbLuminance(rgb: { r: number; g: number; b: number }) {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

function gradientStopOpacity(nodeType: string | undefined) {
  switch (nodeType) {
    case "cte":
      return 0.34;
    case "result":
      return 0.28;
    case "statement":
    case "script_statement":
    case "directive":
      return 0.22;
    default:
      return 0.26;
  }
}

import type { GraphNode, QueryGraph } from "../../../shared/types";
import { getNodeSpans, normalizeGraphSpans } from "./spans";

export function hasFoldableClauses(graph: QueryGraph | null | undefined) {
  if (!graph?.nodes?.length) {
    return false;
  }

  return graph.nodes.filter((node) => isClauseNode(node.type)).length >= 2;
}

export function buildLogicalDisplayGraph(
  graph: QueryGraph | null | undefined,
  compactMode: boolean,
  preservedNodeId: string | null = null,
): QueryGraph {
  if (!graph?.nodes?.length || !compactMode) {
    return rerouteJoinClauseInputs(expandNestedSubqueryJoins(graph || { nodes: [], edges: [], columns: [] }));
  }

  const preservedNodeIds = new Set<string>(preservedNodeId ? [preservedNodeId] : []);
  let nextGraph = rerouteJoinClauseInputs(expandNestedSubqueryJoins(graph));

  const clauseNodes = nextGraph.nodes.filter((node) => isClauseNode(node.type) && !node.meta?.nestedJoin);

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
        edges: dedupeEdges(nextGraph.edges.map((edge) => ({
          ...edge,
          source: clauseIds.has(edge.source) ? "clause:stack" : edge.source,
          target: clauseIds.has(edge.target) ? "clause:stack" : edge.target,
        })).filter((edge) => edge.source !== edge.target)),
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
  const joinNode = graph.nodes.find((node) => node.type === "join" && !node.meta?.nestedJoin);

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
    // Source nodes may also be referenced outside this query block.
    const rangeStart = node.meta?.bodyRangeStart ?? node.meta?.rangeStart;
    const rangeEnd = node.meta?.bodyRangeEnd ?? node.meta?.rangeEnd;
    const nestedRanges = Array.isArray(node.meta?.joinRanges) && node.meta.joinRanges.length
      ? normalizeGraphSpans(node.meta.joinRanges)
      : typeof rangeStart === "number" && typeof rangeEnd === "number"
      ? normalizeGraphSpans([{ start: rangeStart, end: rangeEnd }])
      : getNodeSpans(node);

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

function mergeGraphSpans(spans: Array<{ start: number; end: number }>) {
  return normalizeGraphSpans(spans);
}

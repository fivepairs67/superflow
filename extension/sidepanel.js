const pillEl = document.getElementById("status-pill");
const pageUrlEl = document.getElementById("page-url");
const pageTitleEl = document.getElementById("page-title");
const supersetLikeEl = document.getElementById("superset-like");
const sqlLabEl = document.getElementById("sql-lab");
const signalsEl = document.getElementById("signals");
const sqlSourceEl = document.getElementById("sql-source");
const sqlLengthEl = document.getElementById("sql-length");
const sqlUpdatedAtEl = document.getElementById("sql-updated-at");
const sqlPreviewEl = document.getElementById("sql-preview");
const heroExecutionChipEl = document.getElementById("hero-execution-chip");
const heroRowsChipEl = document.getElementById("hero-rows-chip");
const heroDurationChipEl = document.getElementById("hero-duration-chip");
const executionStatusEl = document.getElementById("execution-status");
const executionQueryIdEl = document.getElementById("execution-query-id");
const executionDurationEl = document.getElementById("execution-duration");
const executionRowCountEl = document.getElementById("execution-row-count");
const executionLastEventEl = document.getElementById("execution-last-event");
const executionErrorEl = document.getElementById("execution-error");
const analysisModeEl = document.getElementById("analysis-mode");
const analysisStatsEl = document.getElementById("analysis-stats");
const analysisClausesEl = document.getElementById("analysis-clauses");
const graphSummaryEl = document.getElementById("graph-summary");
const graphCanvasEl = document.getElementById("graph-canvas");
const graphFocusEl = document.getElementById("graph-focus");
const graphResetButtonEl = document.getElementById("graph-reset-button");
const flowSequenceEl = document.getElementById("flow-sequence");
const cteListEl = document.getElementById("cte-list");
const sourceListEl = document.getElementById("source-list");
const eventLogEl = document.getElementById("event-log");
const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_LEVEL_COLUMNS = 4;
const GRAPH_FOCUS_LIMIT = 10;
const MAX_FLOW_COLOR_STOPS = 4;
const panelState = {
  analysis: null,
  selectedNodeId: null,
};

graphResetButtonEl?.addEventListener("click", () => {
  clearGraphNodeSelection();
});

bootstrap().catch((error) => {
  console.error("Failed to bootstrap side panel", error);
  renderEmptyState("Could not load the current state.");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "TAB_SESSION_UPDATED" && message.session) {
    void renderSession(message.session);
  }
});

async function bootstrap() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    renderEmptyState("Could not find the active tab.");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "GET_TAB_SESSION",
    tabId: tab.id,
  });

  if (!response?.ok || !response.session) {
    renderEmptyState("No Superset session has been detected yet.");
    return;
  }

  renderSession(response.session);
}

function renderSession(session) {
  pageUrlEl.textContent = session.url || "-";
  pageTitleEl.textContent = session.title || "-";
  supersetLikeEl.textContent = formatBoolean(session.isSupersetLike);
  sqlLabEl.textContent = formatBoolean(session.isSqlLab);

  if (session.isSqlLab) {
    setPill("SQL Lab detected", "pill-ready");
  } else if (session.isSupersetLike) {
    setPill("Superset detected", "pill-warn");
  } else {
    setPill("Waiting", "pill-idle");
  }

  renderSignals(session.signals || []);
  renderSqlSnapshot(session);
  renderExecution(session?.execution, session?.executionEvents || []);
  renderAnalysis(session?.analysis);
}

function renderSignals(signals) {
  signalsEl.textContent = "";

  if (!signals.length) {
    const empty = document.createElement("span");
    empty.className = "signal-empty";
    empty.textContent = "No signals collected yet.";
    signalsEl.appendChild(empty);
    return;
  }

  for (const signal of signals) {
    const el = document.createElement("span");
    el.className = "signal";
    el.textContent = signal;
    signalsEl.appendChild(el);
  }
}

function renderEmptyState(message) {
  pageUrlEl.textContent = message;
  pageTitleEl.textContent = "-";
  supersetLikeEl.textContent = "-";
  sqlLabEl.textContent = "-";
  setPill("Waiting", "pill-idle");
  renderSignals([]);
  renderSqlSnapshot(null);
  renderExecution(null, []);
  renderAnalysis(null);
}

function setPill(label, className) {
  pillEl.textContent = label;
  pillEl.className = `pill ${className}`;
}

function formatBoolean(value) {
  return value ? "Yes" : "No";
}

function renderSqlSnapshot(session) {
  const hasSql = Boolean(session?.hasSqlSnapshot && session?.sqlPreview);

  sqlSourceEl.textContent = hasSql ? session.sqlSource || "Captured" : "None";
  sqlSourceEl.className = `pill ${hasSql ? "pill-ready" : "pill-idle"}`;
  sqlLengthEl.textContent = `${session?.sqlLength || 0} chars`;
  sqlUpdatedAtEl.textContent = session?.sqlUpdatedAt
    ? `Updated ${formatTimestamp(session.sqlUpdatedAt)}`
    : "No updates";
  sqlPreviewEl.textContent = hasSql ? session.sqlPreview : "No SQL has been collected yet.";
}

function renderExecution(execution, events) {
  const status = execution?.status || "idle";
  const pillClass =
    status === "success"
      ? "pill-ready"
      : status === "failed" || status === "canceled"
        ? "pill-warn"
        : "pill-idle";

  executionStatusEl.textContent = status;
  executionStatusEl.className = `pill ${pillClass}`;
  heroExecutionChipEl.textContent = status;
  heroExecutionChipEl.className = `hero-chip ${
    status === "success"
      ? "is-ready"
      : status === "failed" || status === "canceled"
        ? "is-warn"
        : "is-idle"
  }`;
  executionQueryIdEl.textContent = execution?.queryId || "-";
  executionDurationEl.textContent =
    typeof execution?.durationMs === "number" ? `${execution.durationMs} ms` : "-";
  executionRowCountEl.textContent =
    typeof execution?.rowCount === "number" ? String(execution.rowCount) : "-";
  heroRowsChipEl.textContent =
    typeof execution?.rowCount === "number" ? `rows ${execution.rowCount}` : "rows -";
  heroDurationChipEl.textContent =
    typeof execution?.durationMs === "number"
      ? `${execution.durationMs} ms`
      : "duration -";
  executionLastEventEl.textContent = execution?.lastKind
    ? `${execution.lastKind} / ${execution.lastPhase || "-"}`
    : "-";
  executionErrorEl.textContent = execution?.errorMessage || "-";

  renderEventLog(events);
}

function renderAnalysis(analysis) {
  panelState.analysis = analysis || null;
  const graphNodes = Array.isArray(analysis?.graph?.nodes) ? analysis.graph.nodes : [];

  if (!graphNodes.some((node) => node.id === panelState.selectedNodeId)) {
    panelState.selectedNodeId = null;
  }

  const hasAnalysis = Boolean(analysis?.summary);
  const isError = analysis?.mode === "error";

  analysisModeEl.textContent = hasAnalysis || isError ? analysis.mode || "heuristic" : "None";
  analysisModeEl.className = `pill ${
    isError ? "pill-warn" : hasAnalysis ? "pill-ready" : "pill-idle"
  }`;

  renderStats(analysis?.summary || null);
  renderClauseSignals(analysis?.clauses || null);
  renderGraph(analysis?.graph || null, analysis);
  renderGraphFocus(analysis?.graph || null);
  renderFlowSequence(analysis?.flowSequence || []);
  renderCteList(analysis?.ctes || []);
  renderSourceList(analysis?.sources || []);
}

function renderStats(summary) {
  analysisStatsEl.textContent = "";

  if (!summary) {
    const empty = document.createElement("span");
    empty.className = "stat-empty";
    empty.textContent = "No analyzed structure is available yet.";
    analysisStatsEl.appendChild(empty);
    return;
  }

  const stats = [
    `${summary.statementType || "UNKNOWN"} statement`,
    `${summary.cteCount || 0} CTE`,
    `${summary.sourceCount || 0} sources`,
    `${summary.joinCount || 0} joins`,
    `${summary.clauseCount || 0} clauses`,
    `${summary.templateCount || 0} templates`,
  ];

  for (const stat of stats) {
    const el = document.createElement("span");
    el.className = "stat";
    el.textContent = stat;
    analysisStatsEl.appendChild(el);
  }
}

function renderClauseSignals(clauses) {
  analysisClausesEl.textContent = "";

  if (!clauses) {
    const empty = document.createElement("span");
    empty.className = "signal-empty";
    empty.textContent = "No clause information";
    analysisClausesEl.appendChild(empty);
    return;
  }

  const labels = {
    join: "JOIN",
    where: "WHERE",
    groupBy: "GROUP BY",
    having: "HAVING",
    window: "WINDOW",
    union: "UNION",
    orderBy: "ORDER BY",
    limit: "LIMIT",
  };

  const active = Object.keys(labels).filter((key) => clauses[key]);

  if (!active.length) {
    const empty = document.createElement("span");
    empty.className = "signal-empty";
    empty.textContent = "No active clauses";
    analysisClausesEl.appendChild(empty);
    return;
  }

  for (const key of active) {
    const el = document.createElement("span");
    el.className = "signal";
    el.textContent = labels[key];
    analysisClausesEl.appendChild(el);
  }
}

function renderFlowSequence(sequence) {
  flowSequenceEl.textContent = "";

  if (!sequence.length) {
    const empty = document.createElement("span");
    empty.className = "signal-empty";
    empty.textContent = "No flow has been generated yet.";
    flowSequenceEl.appendChild(empty);
    return;
  }

  for (const step of sequence) {
    const el = document.createElement("span");
    el.className = "flow-step";
    el.textContent = step;
    flowSequenceEl.appendChild(el);
  }
}

function renderCteList(ctes) {
  cteListEl.textContent = "";

  if (!ctes.length) {
    const empty = document.createElement("div");
    empty.className = "stack-empty";
    empty.textContent = "No CTEs";
    cteListEl.appendChild(empty);
    return;
  }

  for (const cte of ctes) {
    const item = document.createElement("div");
    item.className = "stack-item";

    const title = document.createElement("p");
    title.className = "stack-title";
    title.textContent = cte.name;

    const meta = document.createElement("p");
    meta.className = "stack-meta";
    meta.textContent = cte.dependencies?.length
      ? `CTE · deps: ${cte.dependencies.join(", ")}`
      : `CTE · ${cte.sourceCount || 0} source(s)`;

    item.appendChild(title);
    item.appendChild(meta);
    cteListEl.appendChild(item);
  }
}

function renderSourceList(sources) {
  sourceListEl.textContent = "";

  if (!sources.length) {
    const empty = document.createElement("div");
    empty.className = "stack-empty";
    empty.textContent = "No sources";
    sourceListEl.appendChild(empty);
    return;
  }

  for (const source of sources) {
    const item = document.createElement("div");
    item.className = "stack-item";

    const title = document.createElement("p");
    title.className = "stack-title";
    title.textContent = source.name;

    const meta = document.createElement("p");
    meta.className = "stack-meta";
    meta.textContent = `DB table · ${source.type || "source"}`;

    item.appendChild(title);
    item.appendChild(meta);
    sourceListEl.appendChild(item);
  }
}

function renderEventLog(events) {
  eventLogEl.textContent = "";

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "event-empty";
    empty.textContent = "No execution events have been collected yet.";
    eventLogEl.appendChild(empty);
    return;
  }

  for (const event of events.slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "event-item";

    const title = document.createElement("div");
    title.className = "event-title";

    const left = document.createElement("span");
    left.textContent = `${event.kind} / ${event.phase}`;

    const right = document.createElement("span");
    right.textContent = formatTimestamp(event.at);

    title.appendChild(left);
    title.appendChild(right);

    const meta = document.createElement("div");
    meta.className = "event-meta";
    meta.textContent = [
      event.method,
      event.httpStatus ? `HTTP ${event.httpStatus}` : null,
      event.status || null,
      typeof event.rowCount === "number" ? `rows ${event.rowCount}` : null,
      event.queryId ? `qid ${event.queryId}` : null,
      event.errorMessage ? `error ${event.errorMessage}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    item.appendChild(title);
    item.appendChild(meta);
    eventLogEl.appendChild(item);
  }
}

function renderGraph(graph, analysis) {
  graphCanvasEl.textContent = "";

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const hasGraph = nodes.length > 0;
  const isError = analysis?.mode === "error";
  const focusState = buildGraphFocusState(nodes, edges, panelState.selectedNodeId);
  const flowContext = computeFlowVisualContext(nodes, edges);

  graphSummaryEl.textContent = hasGraph ? `${nodes.length} nodes` : isError ? "error" : "0 nodes";
  graphSummaryEl.className = `pill ${
    isError ? "pill-warn" : hasGraph ? "pill-ready" : "pill-idle"
  }`;

  if (isError) {
    const empty = document.createElement("div");
    empty.className = "graph-empty";
    empty.textContent = analysis.errorMessage || "Could not generate the graph.";
    graphCanvasEl.appendChild(empty);
    return;
  }

  if (!hasGraph) {
    const empty = document.createElement("div");
    empty.className = "graph-empty";
    empty.textContent = "No graph has been generated yet.";
    graphCanvasEl.appendChild(empty);
    return;
  }

  const layout = computeGraphLayout(nodes, edges);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "graph-svg");
  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "SQL logical graph");
  svg.addEventListener("click", (event) => {
    if (event.target === svg) {
      clearGraphNodeSelection();
    }
  });

  svg.appendChild(createGraphDefs(flowContext));

  for (const edge of edges) {
    const source = layout.positions.get(edge.source);
    const target = layout.positions.get(edge.target);

    if (!source || !target) {
      continue;
    }

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", edgeClassName(focusState.edgeState.get(edge.id)));
    path.setAttribute("marker-end", "url(#graph-arrow)");
    path.setAttribute("d", createEdgePath(source, target));
    path.style.setProperty(
      "--edge-stroke",
      flowContext.edgeVisuals.get(edge.id)?.stroke || "rgba(45, 38, 31, 0.22)",
    );
    svg.appendChild(path);
  }

  for (const node of nodes) {
    const position = layout.positions.get(node.id);

    if (!position) {
      continue;
    }

    svg.appendChild(
      createGraphNode(
        node,
        position,
        focusState.nodeState.get(node.id),
        flowContext.nodeVisuals.get(node.id),
      ),
    );
  }

  graphCanvasEl.appendChild(svg);
}

function computeGraphLayout(nodes, edges) {
  const nodeWidth = 196;
  const nodeHeight = 86;
  const columnGap = 18;
  const levelGap = 54;
  const levelRowGap = 16;
  const paddingX = 16;
  const paddingY = 16;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  const levelMap = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      continue;
    }

    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    adjacency.get(edge.source).push(edge.target);
  }

  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .map((node) => node.id);
  const visited = new Set();

  while (queue.length) {
    const currentId = queue.shift();
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

  const columns = new Map();

  for (const node of nodes) {
    const level = levelMap.get(node.id) || 0;

    if (!columns.has(level)) {
      columns.set(level, []);
    }

    columns.get(level).push(node);
  }

  for (const columnNodes of columns.values()) {
    columnNodes.sort((left, right) => {
      const typeCompare = String(left.type || "").localeCompare(String(right.type || ""));
      return typeCompare || String(left.label || "").localeCompare(String(right.label || ""));
    });
  }

  const positions = new Map();
  const sortedLevels = Array.from(columns.keys()).sort((left, right) => left - right);
  const maxColumns = Math.max(
    ...sortedLevels.map((level) => Math.min(columns.get(level).length, MAX_LEVEL_COLUMNS)),
    1,
  );
  const maxRowWidth = maxColumns * nodeWidth + Math.max(maxColumns - 1, 0) * columnGap;
  let currentY = paddingY;

  for (const level of sortedLevels) {
    const rowNodes = columns.get(level);
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
          level,
          maxLevel: 0,
        });
      });
    });

    currentY += bandHeight + levelGap;
  }

  const maxLevel = Math.max(...sortedLevels, 0);

  for (const position of positions.values()) {
    position.maxLevel = maxLevel;
  }

  return {
    positions,
    levels: levelMap,
    maxLevel,
    width: paddingX * 2 + maxRowWidth,
    height: Math.max(currentY - levelGap + paddingY, paddingY * 2 + nodeHeight),
  };
}

function createGraphDefs(flowContext) {
  const defs = document.createElementNS(SVG_NS, "defs");
  defs.appendChild(createArrowMarker());

  for (const visual of flowContext.nodeVisuals.values()) {
    if (!Array.isArray(visual?.gradientStops) || visual.gradientStops.length < 2) {
      continue;
    }

    defs.appendChild(createLinearGradient(visual.gradientId, visual.gradientStops));
  }

  return defs;
}

function createArrowMarker() {
  const marker = document.createElementNS(SVG_NS, "marker");
  marker.setAttribute("id", "graph-arrow");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "6");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("orient", "auto-start-reverse");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  path.setAttribute("fill", "rgba(45, 38, 31, 0.22)");

  marker.appendChild(path);
  return marker;
}

function createLinearGradient(id, stops) {
  const gradient = document.createElementNS(SVG_NS, "linearGradient");
  gradient.setAttribute("id", id);
  gradient.setAttribute("x1", "0%");
  gradient.setAttribute("y1", "0%");
  gradient.setAttribute("x2", "100%");
  gradient.setAttribute("y2", "0%");

  for (const stopDef of stops) {
    const stop = document.createElementNS(SVG_NS, "stop");
    stop.setAttribute("offset", stopDef.offset);
    stop.setAttribute("stop-color", stopDef.color);
    stop.setAttribute("stop-opacity", stopDef.opacity);
    gradient.appendChild(stop);
  }

  return gradient;
}

function createEdgePath(source, target) {
  const startX = source.x + source.width / 2;
  const startY = source.y + source.height;
  const endX = target.x + target.width / 2;
  const endY = target.y;
  const curve = Math.max((endY - startY) / 2, 28);
  return `M ${startX} ${startY} C ${startX} ${startY + curve}, ${endX} ${endY - curve}, ${endX} ${endY}`;
}

function createGraphNode(node, position, focusClassName, visual) {
  const nodeVisual = visual || fallbackNodeVisual(node);
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", nodeClassName(node, focusClassName));
  group.setAttribute("tabindex", "0");
  group.setAttribute("role", "button");
  group.setAttribute("aria-label", `Select ${node.label || node.id}`);
  group.style.setProperty("--node-fill", nodeVisual.fill);
  group.style.setProperty("--node-band-fill", nodeVisual.bandFill);
  group.style.setProperty("--node-stroke", nodeVisual.stroke);
  group.style.setProperty("--node-accent", nodeVisual.accent);
  group.style.setProperty("--node-text", nodeVisual.text);
  group.addEventListener("click", (event) => {
    event.stopPropagation();
    handleGraphNodeSelection(node.id);
  });
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      event.stopPropagation();
      handleGraphNodeSelection(node.id);
    }
  });

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("class", "graph-node-body");
  rect.setAttribute("x", String(position.x));
  rect.setAttribute("y", String(position.y));
  rect.setAttribute("width", String(position.width));
  rect.setAttribute("height", String(position.height));
  rect.setAttribute("rx", "16");
  rect.setAttribute("ry", "16");

  const band = document.createElementNS(SVG_NS, "rect");
  band.setAttribute("class", "graph-node-band");
  band.setAttribute("x", String(position.x + 1));
  band.setAttribute("y", String(position.y + 1));
  band.setAttribute("width", String(position.width - 2));
  band.setAttribute("height", "8");
  band.setAttribute("rx", "15");
  band.setAttribute("ry", "15");
  band.style.fill = nodeVisual.bandFill;

  const eyebrow = document.createElementNS(SVG_NS, "text");
  eyebrow.setAttribute("class", "graph-eyebrow");
  eyebrow.setAttribute("x", String(position.x + 12));
  eyebrow.setAttribute("y", String(position.y + 18));
  eyebrow.textContent = graphEyebrowText(node);

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("class", "graph-label");
  label.setAttribute("x", String(position.x + 12));
  label.setAttribute("y", String(position.y + 38));

  appendTextLines(label, truncate(node.label || node.id, 24), 0);

  const meta = document.createElementNS(SVG_NS, "text");
  meta.setAttribute("class", "graph-meta");
  meta.setAttribute("x", String(position.x + 12));
  meta.setAttribute("y", String(position.y + 58));

  appendTextLines(meta, graphMetaText(node), 0);
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = `${node.label || node.id} · ${graphMetaText(node)}`;

  group.appendChild(rect);
  group.appendChild(band);
  group.appendChild(eyebrow);
  group.appendChild(label);
  group.appendChild(meta);
  group.appendChild(title);
  return group;
}

function handleGraphNodeSelection(nodeId) {
  panelState.selectedNodeId = panelState.selectedNodeId === nodeId ? null : nodeId;

  if (panelState.analysis) {
    renderAnalysis(panelState.analysis);
  }
}

function clearGraphNodeSelection() {
  if (!panelState.selectedNodeId) {
    return;
  }

  panelState.selectedNodeId = null;

  if (panelState.analysis) {
    renderAnalysis(panelState.analysis);
  }
}

function renderGraphFocus(graph) {
  graphFocusEl.textContent = "";

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const focusState = buildGraphFocusState(nodes, edges, panelState.selectedNodeId);

  graphResetButtonEl.hidden = !focusState.selectedNode;

  if (!nodes.length) {
    graphFocusEl.className = "graph-focus graph-focus-empty";
    graphFocusEl.textContent = "No node is selected yet. Click a node to inspect its upstream and downstream lineage.";
    return;
  }

  if (!focusState.selectedNode) {
    graphFocusEl.className = "graph-focus graph-focus-empty";
    graphFocusEl.textContent = "Click a node to highlight its upstream sources and downstream query flow. Click the empty background to clear the selection.";
    return;
  }

  graphFocusEl.className = "graph-focus";

  const head = document.createElement("div");
  head.className = "graph-focus-head";

  const title = document.createElement("p");
  title.className = "graph-focus-title";
  title.textContent = focusState.selectedNode.label || focusState.selectedNode.id;

  const meta = document.createElement("p");
  meta.className = "graph-focus-meta";
  meta.textContent = `${graphMetaText(focusState.selectedNode)} · Up ${
    focusState.upstreamNodes.length
  } · Down ${focusState.downstreamNodes.length}`;

  head.appendChild(title);
  head.appendChild(meta);

  const grid = document.createElement("div");
  grid.className = "graph-focus-grid";
  grid.appendChild(
    createGraphFocusColumn(
      "Upstream",
      focusState.upstreamNodes,
      "is-upstream",
      "No upstream sources feed into this node.",
    ),
  );
  grid.appendChild(
    createGraphFocusColumn(
      "Downstream",
      focusState.downstreamNodes,
      "is-downstream",
      "No downstream steps continue from this node.",
    ),
  );

  graphFocusEl.appendChild(head);
  graphFocusEl.appendChild(grid);
}

function createGraphFocusColumn(titleText, nodes, toneClassName, emptyMessage) {
  const column = document.createElement("section");
  column.className = "graph-focus-column";

  const title = document.createElement("h3");
  title.textContent = titleText;
  column.appendChild(title);

  if (!nodes.length) {
    const empty = document.createElement("p");
    empty.className = "graph-focus-empty-note";
    empty.textContent = emptyMessage;
    column.appendChild(empty);
    return column;
  }

  const list = document.createElement("div");
  list.className = "graph-focus-list";

  for (const node of nodes.slice(0, GRAPH_FOCUS_LIMIT)) {
    const pill = document.createElement("span");
    pill.className = `graph-focus-pill ${toneClassName}`;
    pill.textContent = truncate(node.label || node.id, 22);
    list.appendChild(pill);
  }

  if (nodes.length > GRAPH_FOCUS_LIMIT) {
    const more = document.createElement("span");
    more.className = `graph-focus-pill ${toneClassName}`;
    more.textContent = `+${nodes.length - GRAPH_FOCUS_LIMIT} more`;
    list.appendChild(more);
  }

  column.appendChild(list);
  return column;
}

function buildGraphFocusState(nodes, edges, selectedNodeId) {
  const focusState = {
    selectedNode: null,
    nodeState: new Map(),
    edgeState: new Map(),
    upstreamNodes: [],
    downstreamNodes: [],
  };

  if (!selectedNodeId) {
    return focusState;
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  if (!nodeMap.has(selectedNodeId)) {
    return focusState;
  }

  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of edges) {
    if (!outgoing.has(edge.source) || !incoming.has(edge.target)) {
      continue;
    }

    outgoing.get(edge.source).push(edge);
    incoming.get(edge.target).push(edge);
  }

  const upstream = traverseGraphEdges(selectedNodeId, incoming, "source");
  const downstream = traverseGraphEdges(selectedNodeId, outgoing, "target");
  focusState.selectedNode = nodeMap.get(selectedNodeId);
  focusState.upstreamNodes = sortGraphNodes(
    Array.from(upstream.nodeIds)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter(Boolean),
  );
  focusState.downstreamNodes = sortGraphNodes(
    Array.from(downstream.nodeIds)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter(Boolean),
  );

  for (const node of nodes) {
    if (node.id === selectedNodeId) {
      focusState.nodeState.set(node.id, "is-selected");
      continue;
    }

    if (upstream.nodeIds.has(node.id)) {
      focusState.nodeState.set(node.id, "is-upstream");
      continue;
    }

    if (downstream.nodeIds.has(node.id)) {
      focusState.nodeState.set(node.id, "is-downstream");
      continue;
    }

    focusState.nodeState.set(node.id, "is-dimmed");
  }

  for (const edge of edges) {
    if (upstream.edgeIds.has(edge.id)) {
      focusState.edgeState.set(edge.id, "is-upstream");
      continue;
    }

    if (downstream.edgeIds.has(edge.id)) {
      focusState.edgeState.set(edge.id, "is-downstream");
      continue;
    }

    focusState.edgeState.set(edge.id, "is-dimmed");
  }

  return focusState;
}

function traverseGraphEdges(startNodeId, edgeMap, nextNodeKey) {
  const queue = [...(edgeMap.get(startNodeId) || [])];
  const edgeIds = new Set();
  const nodeIds = new Set();

  while (queue.length) {
    const edge = queue.shift();

    if (!edge?.id || edgeIds.has(edge.id)) {
      continue;
    }

    edgeIds.add(edge.id);
    const nextNodeId = edge[nextNodeKey];

    if (!nextNodeId || nodeIds.has(nextNodeId)) {
      continue;
    }

    nodeIds.add(nextNodeId);
    queue.push(...(edgeMap.get(nextNodeId) || []));
  }

  return {
    nodeIds,
    edgeIds,
  };
}

function sortGraphNodes(nodes) {
  return [...nodes].sort((left, right) => {
    const leftType = String(left.type || "");
    const rightType = String(right.type || "");
    return leftType.localeCompare(rightType) || String(left.label || "").localeCompare(String(right.label || ""));
  });
}

function nodeClassName(node, focusClassName) {
  const classNames = ["graph-node", `type-${sanitizeCssClass(node.type || "unknown")}`];

  if (focusClassName) {
    classNames.push(focusClassName);
  }

  return classNames.join(" ");
}

function edgeClassName(focusClassName) {
  const classNames = ["graph-edge"];

  if (focusClassName) {
    classNames.push(focusClassName);
  }

  return classNames.join(" ");
}

function appendTextLines(textNode, text, startDy) {
  const lines = Array.isArray(text) ? text : [text];

  lines.forEach((line, index) => {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    tspan.setAttribute("x", textNode.getAttribute("x"));
    tspan.setAttribute("dy", index === 0 ? String(startDy) : "13");
    tspan.textContent = line;
    textNode.appendChild(tspan);
  });
}

function graphMetaText(node) {
  if (node.type === "cte") {
    const sourceCount = node.meta?.sourceCount ?? 0;
    const dependencyCount = node.meta?.dependencyCount ?? 0;
    return `${sourceCount} source · ${dependencyCount} dep`;
  }

  if (node.type === "source_table") {
    return "PHYSICAL TABLE";
  }

  if (node.type === "statement") {
    return "MAIN QUERY";
  }

  if (node.type === "result") {
    return "FINAL OUTPUT";
  }

  return String(node.type || "node").replace(/_/g, " ").toUpperCase();
}

function graphEyebrowText(node) {
  if (node.type === "cte") {
    return "CTE";
  }

  if (node.type === "source_table") {
    return "DB TABLE";
  }

  if (node.type === "statement") {
    return "QUERY";
  }

  if (node.type === "result") {
    return "OUTPUT";
  }

  return "CLAUSE";
}

function computeFlowVisualContext(nodes, edges) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      continue;
    }

    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    incoming.get(edge.target).push(edge);
    outgoing.get(edge.source).push(edge);
  }

  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .map((node) => node.id);
  const visited = new Set();
  const lineageMap = new Map();

  while (queue.length) {
    const currentId = queue.shift();
    const node = nodeMap.get(currentId);

    if (!node) {
      continue;
    }

    visited.add(currentId);
    const parentLineages = (incoming.get(currentId) || []).map((edge) => lineageMap.get(edge.source));
    const lineage = buildNodeLineage(node, parentLineages);
    lineageMap.set(currentId, lineage);

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
    lineageMap.set(node.id, buildNodeLineage(node, parentLineages));
  }

  const nodeVisuals = new Map();
  const edgeVisuals = new Map();
  let gradientIndex = 1;

  for (const node of nodes) {
    const lineage = lineageMap.get(node.id) || [createFallbackLineageColor(node)];
    const visual = createNodeFlowVisual(node, lineage, gradientIndex);
    nodeVisuals.set(node.id, visual);

    if (visual.gradientId) {
      gradientIndex += 1;
    }
  }

  for (const edge of edges) {
    const lineage =
      lineageMap.get(edge.source) ||
      lineageMap.get(edge.target) ||
      [createFallbackLineageColor(nodeMap.get(edge.source) || nodeMap.get(edge.target))];
    edgeVisuals.set(edge.id, createEdgeFlowVisual(lineage));
  }

  return {
    lineages: lineageMap,
    nodeVisuals,
    edgeVisuals,
  };
}

function buildNodeLineage(node, parentLineages) {
  const merged = mergeLineageColors(parentLineages.flat().filter(Boolean));

  if (node?.type === "source_table") {
    return [createSourceLineageColor(node)];
  }

  if (merged.length) {
    return merged;
  }

  return [createFallbackLineageColor(node)];
}

function createSourceLineageColor(node) {
  const key = node?.label || node?.id || "source";
  return createLineageColor(`source:${key}`, key);
}

function createFallbackLineageColor(node) {
  const type = node?.type || "unknown";
  const key = `${type}:${node?.label || node?.id || "node"}`;
  return createLineageColor(key, key, fallbackHueOffset(type));
}

function createLineageColor(id, seed, hueOffset = 0) {
  const hash = Math.abs(hashString(`${id}:${seed}`));
  const hue = (hash % 360 + hueOffset) % 360;
  const saturation = 62 + (hash % 10);
  const lightness = 48 + ((hash >> 4) % 8);
  const rgb = hslToRgb(hue, saturation / 100, lightness / 100);

  return {
    id,
    seed,
    rgb,
    hex: rgbToHex(rgb),
  };
}

function fallbackHueOffset(type) {
  const offsets = {
    cte: 18,
    statement: 42,
    result: 126,
    aggregate: 160,
    filter: 188,
    orderBy: 220,
    limit: 250,
    join: 280,
    union: 318,
  };

  return offsets[type] || 0;
}

function mergeLineageColors(colors) {
  const merged = [];
  const seen = new Set();

  for (const color of colors) {
    if (!color?.id || seen.has(color.id)) {
      continue;
    }

    seen.add(color.id);
    merged.push(color);
  }

  return merged;
}

function createNodeFlowVisual(node, lineage, gradientIndex) {
  const colors = Array.isArray(lineage) && lineage.length ? lineage : [createFallbackLineageColor(node)];
  const representative = sampleLineageColors(colors, MAX_FLOW_COLOR_STOPS);
  const mixedRgb = mixLineageColors(colors);
  const fillAlpha = node?.type === "cte" ? 0.22 : node?.type === "source_table" ? 0.14 : 0.11;
  const strokeAlpha = node?.type === "source_table" ? 0.62 : 0.42;
  const gradientId =
    representative.length > 1 ? `graph-flow-gradient-${gradientIndex}` : null;

  return {
    fill: rgbaString(mixedRgb, fillAlpha),
    bandFill: gradientId ? `url(#${gradientId})` : representative[0]?.hex || rgbToHex(mixedRgb),
    stroke: rgbaString(mixedRgb, strokeAlpha),
    accent: representative[0]?.hex || rgbToHex(mixedRgb),
    text: "#2d261f",
    gradientId,
    gradientStops: gradientId ? buildGradientStops(representative) : [],
  };
}

function fallbackNodeVisual(node) {
  return createNodeFlowVisual(node, [createFallbackLineageColor(node)], 0);
}

function createEdgeFlowVisual(lineage) {
  const colors = Array.isArray(lineage) && lineage.length ? lineage : [createFallbackLineageColor(null)];
  const mixedRgb = mixLineageColors(colors);

  return {
    stroke: rgbaString(mixedRgb, 0.34),
  };
}

function sampleLineageColors(colors, limit) {
  if (colors.length <= limit) {
    return colors;
  }

  const result = [];
  const step = (colors.length - 1) / Math.max(limit - 1, 1);

  for (let index = 0; index < limit; index += 1) {
    result.push(colors[Math.round(index * step)]);
  }

  return mergeLineageColors(result);
}

function buildGradientStops(colors) {
  if (!colors.length) {
    return [];
  }

  if (colors.length === 1) {
    return [
      {
        offset: "0%",
        color: colors[0].hex,
        opacity: "0.95",
      },
    ];
  }

  return colors.map((color, index) => ({
    offset: `${Math.round((index / (colors.length - 1)) * 100)}%`,
    color: color.hex,
    opacity: "0.95",
  }));
}

function mixLineageColors(colors) {
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

function rgbaString(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function rgbToHex(rgb) {
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function toHex(value) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function hslToRgb(hue, saturation, lightness) {
  if (saturation === 0) {
    const gray = Math.round(lightness * 255);
    return { r: gray, g: gray, b: gray };
  }

  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const hk = hue / 360;
  const r = hueToChannel(p, q, hk + 1 / 3);
  const g = hueToChannel(p, q, hk);
  const b = hueToChannel(p, q, hk - 1 / 3);

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function hueToChannel(p, q, t) {
  let channel = t;

  if (channel < 0) {
    channel += 1;
  }

  if (channel > 1) {
    channel -= 1;
  }

  if (channel < 1 / 6) {
    return p + (q - p) * 6 * channel;
  }

  if (channel < 1 / 2) {
    return q;
  }

  if (channel < 2 / 3) {
    return p + (q - p) * (2 / 3 - channel) * 6;
  }

  return p;
}

function hashString(value) {
  let hash = 0;

  for (const char of String(value || "")) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }

  return hash;
}

function truncate(value, length) {
  const input = String(value || "");
  return input.length <= length ? input : `${input.slice(0, length - 1)}…`;
}

function sanitizeCssClass(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function chunk(items, size) {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }

  const result = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function formatTimestamp(value) {
  try {
    return new Date(value).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (_error) {
    return "-";
  }
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { build, transform } from "esbuild";

import { registerSidePanelController } from "../../extension/sidepanel-controller.js";
import { analyzeSql } from "../../extension/sql-analysis.js";
import { extractClauseRanges, extractTopLevelJoinMatches } from "../../extension/sql-clause-ranges.js";

const readSource = (file) => readFile(new URL("../../extension/" + file, import.meta.url), "utf8");
const subscriptionSource = await readSource("src/sidepanel/state/tab-session-subscription.ts");
const { code } = await transform(subscriptionSource, { loader: "ts", format: "esm" });
const { getPanelTabId, subscribeToTabSession } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const graphModule = await build({
  stdin: {
    contents: `export { buildLogicalDisplayGraph } from "./display-graph";
      export { resolveGraphSelection, buildEditorHighlightRanges } from "./selection";
      export { normalizeGraphSpans, findNarrowestNodeByRange } from "./spans";
      export { buildStatementDisplayGroups, buildStatementGroupStatement } from "../sql/statement-groups";`,
    resolveDir: new URL("../../extension/src/sidepanel/features/graph/", import.meta.url).pathname,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { buildLogicalDisplayGraph, resolveGraphSelection, buildEditorHighlightRanges,
  normalizeGraphSpans, findNarrowestNodeByRange, buildStatementDisplayGroups,
  buildStatementGroupStatement } = await import(
  "data:text/javascript;base64," + Buffer.from(graphModule.outputFiles[0].text).toString("base64")
);
// Expose block-scoped async functions in the isolated VM without copying their implementations.
const contentSource = (await readSource("content.js")).replace(/}\s*$/, `
  Object.assign(globalThis, { fetchBitbucketRawSqlSnapshot, collectNetworkSqlSnapshot, sendPageStatus,
    withBitbucketSelection, focusBitbucketSource });
}
`);
const bridgeSource = await readSource("page-bridge.js");
const backgroundSource = (await readSource("background.js")).replace(/^import .*;\n/gm, "");
const tick = () => new Promise((resolve) => setImmediate(resolve));

const clauseText = (sql, ranges, key) => (ranges.get(key)?.ranges || []).map(({ start, end }) => sql.slice(start, end));
const focusedText = (statement, id) => resolveGraphSelection(statement.graph, id, null).ranges
  .map(({ start, end }) => statement.sql.slice(start, end));

test("store sample exposes six CTEs, nested joins, window columns and revenue lineage", async () => {
  const sql = await readFile(new URL("../../docs/store/sample.sql", import.meta.url), "utf8");
  const analysis = analyzeSql(sql, { dialectPreference: "postgresql" });
  assert.equal(analysis.mode, "ast");
  assert.deepEqual(analysis.ctes.map((cte) => cte.name), [
    "base_orders", "customer_value", "visit_ranked", "latest_visit", "refund_totals", "customer_ranking",
  ]);
  const graph = buildLogicalDisplayGraph(analysis.graph, false);
  assert.ok(graph.nodes.some((node) => node.id === "cte:customer_ranking:nested-join"));
  const revenue = graph.columns.find((column) => column.nodeId === "cte:customer_ranking" && column.name === "net_revenue");
  assert.deepEqual(revenue.upstream.map((ref) => ref.columnName).sort(), ["gross_revenue", "refund_amount"]);
  const rank = graph.columns.find((column) => column.nodeId === "cte:customer_ranking" && column.name === "region_rank");
  assert.equal(rank.role, "window");
});

test("store script sample links two staging writes to the six-CTE report", async () => {
  const root = new URL("../../docs/store/", import.meta.url);
  const prefix = await readFile(new URL("script-prefix.sql", root), "utf8");
  const query = await readFile(new URL("sample.sql", root), "utf8");
  const analysis = analyzeSql(`${prefix}\n${query}`, { dialectPreference: "postgresql" });
  assert.equal(analysis.statements.length, 4);
  assert.ok(analysis.statements.every((statement) => statement.mode === "ast"));
  assert.equal(buildStatementDisplayGroups(analysis.statements).length, 3);
  const dependencies = analysis.scriptDependencies.filter((edge) => edge.targetIndex === 3);
  assert.deepEqual(dependencies.map((edge) => edge.sourceIndex).sort(), [1, 2]);
  assert.equal(analysis.statements[3].ctes.length, 6);
});

for (const dialectPreference of ["auto", "hive", "trino", "postgresql"]) {
  test(`${dialectPreference}: REBUILD grouping shifts internal JOIN focus with its query body`, () => {
    const joins = [
      "LEFT JOIN sample_flags t2 ON t1.id = t2.id",
      "LEFT JOIN sample_items t3 ON t2.id = t3.id",
    ];
    const sql = `SELECT 1;\n-- Rebuild the synthetic output; preserve this prelude in the group.\nDROP TABLE IF EXISTS sample_result;\n\n
      /* Source query starts after the DROP statement. */
      CREATE TABLE sample_result AS WITH sample_scope AS (
        SELECT t1.id FROM sample_events t1 ${joins[0]} WHERE t1.active = 1
      ) SELECT t1.id FROM sample_scope t1 INNER JOIN (
        SELECT t2.id FROM sample_tags t2 ${joins[1]} WHERE t3.active = 1
      ) t4 ON t1.id = t4.id WHERE t1.id > 0;`;
    const analysis = analyzeSql(sql, { dialectPreference });
    const group = buildStatementDisplayGroups(analysis.statements).find((entry) => entry.kind === "rebuild");
    assert.ok(group);
    const original = group.statements.at(-1);
    const before = structuredClone(original.graph);
    const grouped = buildStatementGroupStatement(group, sql);
    const delta = original.rangeStart - grouped.rangeStart;
    assert.ok(delta > 0);

    for (const node of before.nodes) {
      const shifted = grouped.graph.nodes.find((candidate) => candidate.id === node.id);
      for (const field of ["rangeStart", "rangeEnd", "bodyRangeStart", "bodyRangeEnd"]) {
        if (typeof node.meta?.[field] === "number") assert.equal(shifted.meta[field], node.meta[field] + delta, field);
      }
      for (const field of ["ranges", "joinRanges"]) {
        if (Array.isArray(node.meta?.[field])) assert.deepEqual(shifted.meta[field],
          node.meta[field].map(({ start, end }) => ({ start: start + delta, end: end + delta })), field);
      }
    }
    const inner = original.graph.nodes.find((node) => node.type === "inline_view");
    for (const compactMode of [false, true]) {
      const graph = buildLogicalDisplayGraph(grouped.graph, compactMode);
      for (const [id, join] of [["cte:sample_scope:nested-join", joins[0]], [`${inner.id}:nested-join`, joins[1]]]) {
        const local = resolveGraphSelection(graph, id, null).ranges;
        assert.deepEqual(local.map(({ start, end }) => grouped.sql.slice(start, end)), [join]);
        const full = buildEditorHighlightRanges(grouped, graph, id, null);
        assert.deepEqual(full, [{ start: sql.indexOf(join), end: sql.indexOf(join) + join.length }]);
        assert.equal(findNarrowestNodeByRange(graph.nodes, local[0].start, local[0].start + 4).id, id);
      }
    }
    assert.deepEqual(original.graph, before, "grouping must not mutate the original statement graph");
  });
}

for (const dialectPreference of ["auto", "hive", "trino", "postgresql"]) {
  test(`${dialectPreference}: FILTER and WINDOW focus stay in the owning query block`, () => {
    const windows = ["MIN(t1.flag) OVER (PARTITION BY t1.id)", "ROW_NUMBER() OVER (PARTITION BY t1.id ORDER BY t1.ts)"];
    const joins = [
      "LEFT JOIN (SELECT id FROM sample_flags WHERE active = 1 ORDER BY id LIMIT 5) t2 ON t1.id = t2.id",
      "LEFT JOIN (SELECT id FROM sample_tags WHERE enabled = 1) t3 ON t1.id = t3.id",
    ];
    const sql = `SELECT COALESCE(${windows[0]}, 0) AS metric, t1.label, ${windows[1]} AS rn
      FROM sample_events t1 ${joins.join("\n")} WHERE t1.part_dt = '20260101'
      ORDER BY t1.id LIMIT 20`;
    const statement = analyzeSql(sql, { dialectPreference }).statements[0];
    assert.deepEqual(focusedText(statement, "clause:where"), ["WHERE t1.part_dt = '20260101'"]);
    assert.deepEqual(focusedText(statement, "clause:window"), windows);
    assert.deepEqual(focusedText(statement, "clause:join"), joins);
    assert.deepEqual(focusedText(statement, "clause:orderBy"), ["ORDER BY t1.id"]);
    assert.deepEqual(focusedText(statement, "clause:limit"), ["LIMIT 20"]);
    const graph = buildLogicalDisplayGraph(statement.graph, false);
    const whereStart = statement.sql.indexOf("WHERE t1.part_dt");
    assert.equal(findNarrowestNodeByRange(graph.nodes, whereStart, whereStart + 5).id, "clause:where");
    const windowStart = statement.sql.indexOf("OVER (PARTITION");
    assert.equal(findNarrowestNodeByRange(graph.nodes, windowStart, windowStart + 4).id, "clause:window");
  });

  test(`${dialectPreference}: GROUP BY, HAVING, DISTINCT and pagination exclude child clauses`, () => {
    const statement = analyzeSql(`SELECT DISTINCT t1.id, COUNT(*) AS cnt
      FROM (SELECT id FROM sample_events WHERE active = 1 GROUP BY ROLLUP(id) HAVING COUNT(*) > 0 ORDER BY id LIMIT 7) t1
      WHERE t1.id > 0 GROUP BY t1.id HAVING COUNT(*) > 2 ORDER BY cnt DESC LIMIT 10 OFFSET 3`, { dialectPreference }).statements[0];
    for (const [key, expected] of Object.entries({
      distinct: "DISTINCT", where: "WHERE t1.id > 0", groupBy: "GROUP BY t1.id",
      having: "HAVING COUNT(*) > 2", orderBy: "ORDER BY cnt DESC", limit: "LIMIT 10", offset: "OFFSET 3",
    })) assert.deepEqual(focusedText(statement, `clause:${key}`), [expected]);
    assert.equal(statement.graph.nodes.find((node) => node.id === "clause:groupBy").label, "GROUP BY");
  });

  test(`${dialectPreference}: CTAS and script offsets preserve precise internal JOIN focus`, () => {
    const sql = `SELECT 1;\nCREATE TABLE sample_result AS WITH sample_scope AS (
      SELECT t1.id FROM sample_events t1 LEFT JOIN sample_flags t2 ON t1.id = t2.id WHERE t2.active = 1
    ) SELECT t1.id FROM sample_scope t1 INNER JOIN (
      SELECT t2.id FROM sample_tags t2 RIGHT JOIN sample_items t3 ON t2.id = t3.id WHERE t3.active = 1
    ) t4 ON t1.id = t4.id WHERE t1.id > 0`;
    const statement = analyzeSql(sql, { dialectPreference }).statements[1];
    const graph = buildLogicalDisplayGraph(statement.graph, false);
    const inner = graph.nodes.find((node) => node.type === "inline_view");
    for (const [id, expected] of [
      ["cte:sample_scope:nested-join", "LEFT JOIN sample_flags t2 ON t1.id = t2.id"],
      [`${inner.id}:nested-join`, "RIGHT JOIN sample_items t3 ON t2.id = t3.id"],
    ]) {
      const ranges = buildEditorHighlightRanges(statement, graph, id, null);
      assert.deepEqual(ranges.map(({ start, end }) => sql.slice(start, end)), [expected]);
    }
    assert.deepEqual(focusedText(statement, "clause:where"), ["WHERE t1.id > 0"]);
  });
}

test("clause scanner ignores comments, quoted identifiers, dollar strings and templates", () => {
  const sql = `SELECT 'WHERE GROUP BY', $$ORDER BY WHERE$$, $tag$LIMIT$tag$, "HAVING", [OFFSET], \`QUALIFY\`,
      t1.where_value, t1.where, {{ params.window }}, \${where}, 'it''s JOIN'
    FROM sample_events t1 /* WHERE false /* HAVING false */ ORDER BY fake */
    WHERE t1.id > 0 -- ORDER BY fake\n GROUP /* gap */ BY t1.id HAVING COUNT(*) > 1; -- LIMIT 8`;
  const ranges = extractClauseRanges(sql);
  assert.deepEqual([...ranges.keys()], ["where", "groupBy", "having"]);
  assert.deepEqual(clauseText(sql, ranges, "where"), ["WHERE t1.id > 0"]);
  assert.deepEqual(clauseText(sql, ranges, "groupBy"), ["GROUP /* gap */ BY t1.id"]);
  assert.deepEqual(clauseText(sql, ranges, "having"), ["HAVING COUNT(*) > 1"]);
});

test("window ranges include FILTER and null handling but exclude scalar subqueries and sibling columns", () => {
  const expressions = [
    "SUM(t1.amount) FILTER (WHERE t1.active = 1) OVER (PARTITION BY t1.id ORDER BY t1.ts)",
    "LAST_VALUE(t1.amount) IGNORE NULLS OVER w",
    "ROW_NUMBER() OVER (ORDER BY t1.id)",
  ];
  const sql = `SELECT ${expressions[0]} AS total, ${expressions[1]} AS last_amount,
    COALESCE((SELECT MAX(t2.id) OVER () FROM sample_flags t2), ${expressions[2]}) AS rn, t1.label
    FROM sample_events t1 WINDOW w AS (PARTITION BY t1.id) ORDER BY t1.id`;
  const ranges = extractClauseRanges(sql);
  assert.deepEqual(clauseText(sql, ranges, "window"), [...expressions, "WINDOW w AS (PARTITION BY t1.id)"]);
  assert.equal(ranges.has("where"), false);
  assert.deepEqual(clauseText(sql, ranges, "orderBy"), ["ORDER BY t1.id"]);
});

test("parenthesized queries and set branches keep their clause ranges separate", () => {
  const sql = "((SELECT id FROM sample_events WHERE active = 1 UNION ALL SELECT id FROM sample_flags WHERE enabled = 1 ORDER BY id LIMIT 2));";
  const ranges = extractClauseRanges(sql);
  assert.deepEqual(clauseText(sql, ranges, "where"), ["WHERE active = 1", "WHERE enabled = 1"]);
  assert.deepEqual(clauseText(sql, ranges, "union"), ["UNION ALL"]);
  assert.deepEqual(clauseText(sql, ranges, "orderBy"), ["ORDER BY id"]);
  assert.deepEqual(clauseText(sql, ranges, "limit"), ["LIMIT 2"]);
  const shifted = extractClauseRanges(sql, 31);
  for (const [key, entry] of ranges) {
    assert.deepEqual(shifted.get(key).ranges, entry.ranges.map(({ start, end }) => ({ start: start + 31, end: end + 31 })));
  }
});

test("DML ranges distinguish update predicates and MERGE source subqueries", () => {
  const update = "UPDATE sample_events SET flag = (SELECT MAX(flag) FROM sample_flags WHERE active = 1) WHERE id > 0 RETURNING id";
  const ranges = extractClauseRanges(update);
  assert.deepEqual(clauseText(update, ranges, "set"), ["SET flag = (SELECT MAX(flag) FROM sample_flags WHERE active = 1)"]);
  assert.deepEqual(clauseText(update, ranges, "where"), ["WHERE id > 0"]);
  assert.deepEqual(clauseText(update, ranges, "returning"), ["RETURNING id"]);
  const merge = "MERGE INTO sample_events t1 USING (SELECT id FROM sample_flags WHERE active = 1) t2 ON t1.id = t2.id WHEN MATCHED THEN DELETE WHEN NOT MATCHED THEN INSERT (id) VALUES (t2.id)";
  const mergeRanges = extractClauseRanges(merge);
  assert.deepEqual(clauseText(merge, mergeRanges, "mergeOn"), ["ON t1.id = t2.id"]);
  assert.equal(mergeRanges.has("where"), false);
  assert.deepEqual(clauseText(merge, mergeRanges, "matched"), ["WHEN MATCHED THEN DELETE"]);
  assert.deepEqual(clauseText(merge, mergeRanges, "join"), ["USING (SELECT id FROM sample_flags WHERE active = 1) t2"]);
  const deletion = "DELETE FROM sample_events t1 USING sample_flags t2 WHERE t1.id = t2.id RETURNING t1.id";
  assert.deepEqual(clauseText(deletion, extractClauseRanges(deletion), "join"), ["USING sample_flags t2"]);
});

test("JOIN types use the same scoped lexer as highlights, without quoted or identifier false positives", () => {
  const sql = "SELECT $$LEFT JOIN fake$$, $tag$RIGHT JOIN fake$tag$, t1.join, t1.join2, 'CROSS JOIN' FROM sample_events t1 LEFT /* gap */ OUTER JOIN sample_flags t2 ON t1.id = t2.id";
  assert.deepEqual(extractTopLevelJoinMatches(sql), [{ type: "LEFT", start: sql.indexOf("LEFT /*"), end: sql.indexOf("JOIN sample_flags") + 4 }]);
  assert.deepEqual(analyzeSql(sql).statements[0].joins, ["LEFT"]);
});

test("range normalization does not bridge a one-character SQL gap or claim the next token", () => {
  assert.deepEqual(normalizeGraphSpans([{ start: 0, end: 4 }, { start: 5, end: 9 }]), [{ start: 0, end: 4 }, { start: 5, end: 9 }]);
  const nodes = [{ id: "first", meta: { ranges: [{ start: 0, end: 4 }] } },
    { id: "second", meta: { ranges: [{ start: 4, end: 10 }] } }];
  assert.equal(findNarrowestNodeByRange(nodes, 4, 4).id, "second");
  const sql = "SELECT SUM(id) OVER (),MAX(id) OVER () FROM sample_events";
  const statement = analyzeSql(sql).statements[0];
  assert.deepEqual(focusedText(statement, "clause:window"), ["SUM(id) OVER ()", "MAX(id) OVER ()"]);
});

test("SQL Snapshot renders nested JOIN and folded-node highlights from the display graph", async () => {
  const output = await build({
    stdin: {
      contents: `import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import { SqlSnapshot } from "./components/sql/SqlSnapshot";
        import { GraphStoreProvider } from "./state/graph-store";
        export const renderSnapshot = (props) => renderToStaticMarkup(
          createElement(GraphStoreProvider, null, createElement(SqlSnapshot, props)));`,
      resolveDir: new URL("../../extension/src/sidepanel/", import.meta.url).pathname,
    },
    bundle: true,
    packages: "external",
    write: false,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
  });
  const module = { exports: {} };
  vm.runInNewContext(output.outputFiles[0].text, { module, require: createRequire(import.meta.url) });
  const statement = analyzeSql(`SELECT t1.id FROM
    (SELECT t2.id FROM sample_orders t2 LEFT JOIN sample_items t3 ON t2.id = t3.order_id) t1
    RIGHT JOIN sample_flags t4 ON t1.id = t4.id WHERE t1.id > 0`).statements[0];
  const owner = statement.graph.nodes.find((node) => node.type === "inline_view");
  for (const selectedNodeId of [`${owner.id}:nested-join`, "clause:stack"]) {
    const graph = buildLogicalDisplayGraph(statement.graph, true, selectedNodeId);
    const html = module.exports.renderSnapshot({ session: null, statement, graph, selectedNodeId, selectedColumnId: null });
    assert.ok(!html.includes("No node focus"));
    assert.match(html, /<mark[^>]+is-node-highlight/);
    assert.ok(html.includes(`focus: ${graph.nodes.find((node) => node.id === selectedNodeId).label}`));
  }
});

for (const dialectPreference of ["auto", "hive", "trino", "postgresql"]) {
  test(`${dialectPreference}: nested JOIN selection resolves SQL in normal and compact views`, () => {
    for (const joinType of ["LEFT", "RIGHT", "INNER", "FULL", "CROSS"]) {
      const condition = joinType === "CROSS" ? "" : " ON t2.id = t3.order_id";
      const sql = `SELECT t1.id FROM (
        SELECT t2.id FROM sample_orders t2 ${joinType} JOIN sample_items t3${condition}
      ) t1 RIGHT JOIN sample_flags t4 ON t1.id = t4.id WHERE t1.id > 0`;
      const statement = analyzeSql(sql, { dialectPreference }).statements[0];
      assert.deepEqual(statement.joins, ["RIGHT"]);
      const owner = statement.graph.nodes.find((node) => node.type === "inline_view");
      assert.equal(owner.meta.alias, "t1");
      const id = `${owner.id}:nested-join`;
      assert.equal(statement.graph.nodes.some((node) => node.id === id), false);

      for (const compactMode of [false, true]) {
        const graph = buildLogicalDisplayGraph(statement.graph, compactMode, id);
        const selection = resolveGraphSelection(graph, id, null);
        assert.equal(selection.node.label, `${joinType} JOIN`);
        assert.equal(selection.ranges.length, 1);
        const focusedSql = selection.ranges.map((range) => statement.sql.slice(range.start, range.end)).join(" ");
        assert.ok(focusedSql.includes(`${joinType} JOIN sample_items`));
        assert.ok(!focusedSql.includes("sample_flags"));
        assert.ok(graph.edges.some((edge) => edge.source === id && edge.target === owner.id));
        assert.equal(graph.edges.filter((edge) => edge.target === id).length, 2);
        assert.deepEqual(buildEditorHighlightRanges({ ...statement, rangeStart: 93 }, graph, id, null),
          selection.ranges.map((range) => ({ start: range.start + 93, end: range.end + 93 })));
      }
    }
  });
}

test("nested CTE JOIN focus excludes shared source definitions and other references", () => {
  const statement = analyzeSql(`WITH sample_base AS (SELECT id FROM sample_orders),
    sample_match AS (SELECT t1.id FROM sample_base t1 LEFT JOIN sample_items t2 ON t1.id = t2.order_id)
    SELECT t1.id FROM sample_match t1 INNER JOIN sample_base t2 ON t1.id = t2.id`).statements[0];
  const graph = buildLogicalDisplayGraph(statement.graph, false);
  const selection = resolveGraphSelection(graph, "cte:sample_match:nested-join", null);
  assert.equal(selection.node.label, "LEFT JOIN");
  const focusedSql = selection.ranges.map((range) => statement.sql.slice(range.start, range.end)).join(" ");
  assert.ok(focusedSql.includes("LEFT JOIN sample_items"));
  assert.ok(!focusedSql.includes("sample_orders"));
  assert.ok(!focusedSql.includes("INNER JOIN"));
});

test("Auto hydrates nested inline-view ranges inside CTEs without mixing their JOIN types", () => {
  const statement = analyzeSql(`WITH sample_scope AS (
    SELECT t1.id FROM (SELECT t2.id FROM sample_orders t2 LEFT JOIN sample_items t3 ON t2.id = t3.order_id) t1
    RIGHT JOIN sample_flags t4 ON t1.id = t4.id
  ) SELECT id FROM sample_scope`).statements[0];
  const graph = buildLogicalDisplayGraph(statement.graph, false);
  assert.equal(graph.nodes.find((node) => node.id === "cte:sample_scope:nested-join").label, "RIGHT JOIN");
  const inner = graph.nodes.find((node) => node.type === "inline_view");
  const selection = resolveGraphSelection(graph, `${inner.id}:nested-join`, null);
  const focusedSql = selection.ranges.map((range) => statement.sql.slice(range.start, range.end)).join(" ");
  assert.ok(focusedSql.includes("LEFT JOIN sample_items"));
  assert.ok(!focusedSql.includes("sample_flags"));
  assert.equal(statement.clauses.join, false);
});

test("repeated source names keep sibling inline-view JOIN focus separate", () => {
  const statement = analyzeSql(`SELECT t1.id FROM
    (SELECT t3.id FROM sample_orders t3 LEFT JOIN sample_items t4 ON t3.id = t4.order_id) t1
    INNER JOIN (SELECT t3.id FROM sample_orders t3 RIGHT JOIN sample_items t4 ON t3.id = t4.order_id) t2
    ON t1.id = t2.id`).statements[0];
  const graph = buildLogicalDisplayGraph(statement.graph, false);
  for (const [alias, joinType] of [["t1", "LEFT"], ["t2", "RIGHT"]]) {
    const owner = graph.nodes.find((node) => node.meta?.alias === alias);
    const selection = resolveGraphSelection(graph, `${owner.id}:nested-join`, null);
    assert.equal(selection.node.label, `${joinType} JOIN`);
    assert.equal(selection.ranges.length, 1);
    const focusedSql = statement.sql.slice(selection.ranges[0].start, selection.ranges[0].end);
    assert.ok(focusedSql.includes(`${joinType} JOIN`));
    assert.ok(!focusedSql.includes(`${joinType === "LEFT" ? "RIGHT" : "LEFT"} JOIN`));
  }
});

test("folded clauses and source clusters share SQL focus; column selection takes precedence", () => {
  const statement = analyzeSql(`SELECT t1.id FROM sample_orders t1
    LEFT JOIN sample_items t2 ON t1.id = t2.order_id LEFT JOIN sample_flags t3 ON t1.id = t3.id
    LEFT JOIN sample_tags t4 ON t1.id = t4.id WHERE t1.id > 0`).statements[0];
  const graph = buildLogicalDisplayGraph(statement.graph, true);
  assert.ok(resolveGraphSelection(graph, "clause:stack", null).ranges.length);
  for (const name of ["sample_items", "sample_flags", "sample_tags"]) {
    const input = graph.nodes.find((node) => node.id === `source:${name}` || node.meta?.memberLabels?.includes(name));
    assert.ok(input, `folded input remains visible: ${name}`);
    assert.ok(graph.edges.some((edge) => edge.source === input.id && edge.target === "clause:stack"));
  }
  const clusters = buildLogicalDisplayGraph({
    nodes: [1, 2, 3].map((id) => ({ id: `source:${id}`, type: "source_table", meta: { ranges: [{ start: id * 10, end: id * 10 + 5 }] } }))
      .concat({ id: "statement", type: "statement" }),
    edges: [1, 2, 3].map((id) => ({ id: `edge:${id}`, source: `source:${id}`, target: "statement" })),
    columns: [{ id: "column:id", spans: [{ start: 7, end: 9 }] }],
  }, true);
  const cluster = clusters.nodes.find((node) => node.type === "source_cluster");
  assert.equal(resolveGraphSelection(clusters, cluster.id, null).ranges.length, 3);
  assert.deepEqual(resolveGraphSelection(clusters, cluster.id, "column:id").ranges, [{ start: 7, end: 9 }]);
  assert.deepEqual(resolveGraphSelection(clusters, "stale-node", null).ranges, []);
  assert.deepEqual(buildEditorHighlightRanges(null, clusters, cluster.id, null), []);
});

function event() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    emit: (...args) => [...listeners].map((fn) => fn(...args)),
    get size() { return listeners.size; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function panelApi() {
  const calls = [];
  const options = new Map();
  const tabs = [{ id: 11, windowId: 1 }, { id: 22, windowId: 2 }];
  const api = {
    action: { onClicked: event() },
    runtime: { onInstalled: event(), onStartup: event() },
    tabs: { query: async () => tabs },
    sidePanel: {
      setPanelBehavior: async (value) => calls.push(["behavior", value]),
      setOptions: async (value) => {
        calls.push(["options", value]);
        options.set(value.tabId ?? "default", value);
      },
      getOptions: async ({ tabId }) => options.get(tabId) || { path: "sidepanel.html", enabled: true },
      open: async (value) => calls.push(["open", value]),
    },
  };
  return { api, calls, options, tabs };
}

test("toolbar opens only the clicked tab, without a global/window-wide panel", async () => {
  const { api, calls, options, tabs } = panelApi();
  registerSidePanelController(api);
  await tick();
  assert.equal(options.get("default").enabled, false);
  assert.deepEqual(calls[0], ["behavior", { openPanelOnActionClick: false }]);
  api.action.onClicked.emit(tabs[0]);
  await tick();
  assert.deepEqual(options.get(11), { tabId: 11, path: "sidepanel.html?tabId=11", enabled: true });
  assert.equal(options.has(22), false);
  assert.deepEqual(calls.filter(([name]) => name === "open"), [["open", { tabId: 11 }]]);
  api.action.onClicked.emit(tabs[1]);
  await tick();
  assert.equal(options.get(22).path, "sidepanel.html?tabId=22");
});

test("toolbar dispatches open before yielding the service worker user gesture", async () => {
  const { api, tabs } = panelApi();
  const configured = deferred();
  const originalSetOptions = api.sidePanel.setOptions;
  const opened = [];
  let userGesture = false;
  api.sidePanel.setOptions = (options) => {
    const result = originalSetOptions(options);
    return options.tabId === undefined ? result : configured.promise;
  };
  api.sidePanel.open = async (options) => opened.push({ ...options, userGesture });
  registerSidePanelController(api);
  await tick();

  userGesture = true;
  api.action.onClicked.emit(tabs[0]);
  userGesture = false;
  try {
    assert.deepEqual(opened, [{ tabId: 11, userGesture: true }]);
  } finally {
    configured.resolve();
    await tick();
  }
});

test("upgrade disables legacy auto-enabled tabs but preserves explicitly configured tabs", async () => {
  const { api, options } = panelApi();
  options.set(11, { path: "sidepanel.html?tabId=11", enabled: true });
  registerSidePanelController(api);
  api.runtime.onInstalled.emit();
  await tick();
  assert.equal(options.get(11).enabled, true);
  assert.equal(options.get(22).enabled, false);
  assert.equal(options.get("default").enabled, false);
});

function sessionApi() {
  const requests = [];
  const api = {
    runtime: {
      onMessage: event(),
      sendMessage: (message) => {
        const request = deferred();
        requests.push({ ...request, message });
        return request.promise;
      },
    },
    tabs: { onUpdated: event(), onRemoved: event() },
  };
  globalThis.chrome = api;
  return { api, requests };
}

test("panel tab identity rejects missing, malformed and unsafe IDs", () => {
  assert.equal(getPanelTabId("?tabId=11"), 11);
  for (const query of ["", "?tabId=", "?tabId=-1", "?tabId=1.2", "?tabId=9007199254740992"]) {
    assert.equal(getPanelTabId(query), null);
  }
  const { requests } = sessionApi();
  const states = [];
  subscribeToTabSession(null, (state) => states.push(state))();
  assert.equal(requests.length, 0);
  assert.equal(states[0].status, "error");
});

test("other windows/tabs cannot replace a panel session, including during initial loading", async () => {
  const { api, requests } = sessionApi();
  const states = [];
  const dispose = subscribeToTabSession(11, (state) => states.push(state));
  api.runtime.onMessage.emit({ type: "TAB_SESSION_UPDATED", session: { tabId: 22 } });
  api.tabs.onUpdated.emit(22, { status: "complete" });
  assert.equal(states.length, 1);
  assert.equal(requests.length, 1);
  requests[0].resolve({ ok: true, session: { tabId: 11, sql: "SELECT 1" } });
  await tick();
  assert.equal(states.at(-1).session.sql, "SELECT 1");
  dispose();
  assert.equal(api.runtime.onMessage.size, 0);
  assert.equal(api.tabs.onUpdated.size, 0);
});

test("late GET responses cannot overwrite a newer session broadcast", async () => {
  const { api, requests } = sessionApi();
  const states = [];
  const dispose = subscribeToTabSession(11, (state) => states.push(state));
  api.runtime.onMessage.emit({ type: "TAB_SESSION_UPDATED", session: { tabId: 11, sql: "SELECT 2" } });
  requests[0].resolve({ ok: true, session: { tabId: 11, sql: "SELECT 1" } });
  await tick();
  assert.equal(states.at(-1).session.sql, "SELECT 2");
  dispose();
});

test("navigation refreshes ignore reversed response order and disposed requests", async () => {
  const { api, requests } = sessionApi();
  const states = [];
  const dispose = subscribeToTabSession(11, (state) => states.push(state));
  api.tabs.onUpdated.emit(11, { url: "https://example.test/new" });
  requests[1].resolve({ ok: true, session: { tabId: 11, sql: "SELECT 2" } });
  requests[0].resolve({ ok: true, session: { tabId: 11, sql: "SELECT 1" } });
  await tick();
  assert.equal(states.at(-1).session.sql, "SELECT 2");
  api.tabs.onUpdated.emit(11, { status: "complete" });
  dispose();
  const count = states.length;
  requests[2].resolve({ ok: true, session: { tabId: 11, sql: "SELECT 3" } });
  await tick();
  assert.equal(states.length, count);
});

function pageContext(url = "https://example.test/editor") {
  const messages = [];
  const timers = [];
  const listeners = [];
  const cancelledTimers = new Set();
  const observers = [];
  const removeListener = (name, listener) => {
    const index = listeners.findIndex((entry) => entry[0] === name && entry[1] === listener);
    if (index >= 0) listeners.splice(index, 1);
  };
  class Element {
    children = [];
    dataset = {};
    querySelectorAll() { return []; }
  }
  class XMLHttpRequest {
    open() {}
    send() {}
    addEventListener() {}
  }
  const document = {
    title: "", body: { innerText: "" }, documentElement: new Element(),
    head: { appendChild() {} }, getElementById: () => null, createElement: () => new Element(),
    querySelectorAll: () => [], querySelector: () => null,
    createTreeWalker: () => ({ nextNode: () => null }),
    addEventListener: (...args) => listeners.push(args),
    removeEventListener: removeListener,
  };
  const context = vm.createContext({
    console, URL, URLSearchParams, FormData, Response, Element, XMLHttpRequest, document,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      constructor() { observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    location: new URL(url),
    history: { pushState() {}, replaceState(_state, _title, href) { context.location = new URL(href); } },
    PopStateEvent: class { constructor(type, options) { this.type = type; this.state = options.state; } },
    PointerEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    dispatchEvent: (event) => {
      for (const [name, listener] of listeners) if (name === event.type) listener(event);
    },
    setInterval: (...args) => timers.push(args),
    setTimeout: (...args) => timers.push(args),
    clearTimeout: (id) => cancelledTimers.add(id),
    clearInterval: (id) => cancelledTimers.add(id),
    addEventListener: (...args) => listeners.push(args),
    removeEventListener: removeListener,
    postMessage: (message) => messages.push(message),
    fetch: async () => new Response('{"data":[]}', { headers: { "content-type": "application/json" } }),
    chrome: {
      runtime: {
        onMessage: event(),
        sendMessage: async (message) => messages.push(message),
      },
    },
  });
  context.window = context;
  return { context, messages, timers, listeners, observers, cancelledTimers };
}

test("content reinjection replaces a stale legacy guard and cleans up previous observers", () => {
  const { context, listeners, observers, cancelledTimers } = pageContext();
  context.__SQV_CONTENT_SCRIPT_ACTIVE__ = true;
  vm.runInContext(contentSource, context);
  assert.equal(context.chrome.runtime.onMessage.size, 1);
  const first = context.__SQV_CONTENT_SCRIPT_ACTIVE__;
  const listenerCount = listeners.length;
  vm.runInContext(contentSource, context);
  assert.notEqual(context.__SQV_CONTENT_SCRIPT_ACTIVE__, first);
  assert.equal(context.chrome.runtime.onMessage.size, 1);
  assert.equal(listeners.length, listenerCount);
  assert.equal(observers[0].disconnected, true);
  assert.equal(cancelledTimers.size, 2);
  let response;
  context.chrome.runtime.onMessage.emit({ type: "REFRESH_SQL_OBSERVER" }, {}, (value) => { response = value; });
  assert.equal(response.observer, "superflow-content-v1");
});

test("invalidated content runtimes stop observing and recover when replaced", async () => {
  const { context, messages, observers } = pageContext(sourceUrl("reloaded"));
  context.fetch = async () => new Response("SELECT 1 AS value");
  vm.runInContext(contentSource, context);
  context.chrome.runtime.sendMessage = async () => { throw new Error("Extension context invalidated."); };
  await context.sendPageStatus();
  assert.equal(context.__SQV_CONTENT_SCRIPT_ACTIVE__, null);
  assert.equal(observers[0].disconnected, true);
  assert.equal(context.chrome.runtime.onMessage.size, 0);
  context.chrome.runtime.sendMessage = async (message) => messages.push(message);
  vm.runInContext(contentSource, context);
  await context.sendPageStatus();
  assert.equal(messages.filter((message) => message.type === "PAGE_STATUS_UPDATED").length, 1);
});

test("a replaced observer cannot publish its pending raw-file response", async () => {
  const { context, messages } = pageContext(sourceUrl("reloaded"));
  const pending = deferred();
  context.fetch = () => pending.promise;
  vm.runInContext(contentSource, context);
  const oldStatus = context.sendPageStatus();
  vm.runInContext(contentSource, context);
  context.fetch = async () => new Response("SELECT 2");
  await context.sendPageStatus();
  pending.resolve(new Response("SELECT 1"));
  await oldStatus;
  assert.deepEqual(messages.filter((message) => message.type === "PAGE_STATUS_UPDATED").map((message) => message.sql), ["SELECT 2"]);
});

test("bridge reinjection does not stack fetch/XHR wrappers or event listeners", async () => {
  const { context, messages, timers, listeners } = pageContext();
  vm.runInContext(bridgeSource, context);
  const first = {
    fetch: context.fetch, open: context.XMLHttpRequest.prototype.open,
    send: context.XMLHttpRequest.prototype.send, timers: timers.length, listeners: listeners.length,
  };
  vm.runInContext(bridgeSource, context);
  assert.equal(context.fetch, first.fetch);
  assert.equal(context.XMLHttpRequest.prototype.open, first.open);
  assert.equal(context.XMLHttpRequest.prototype.send, first.send);
  assert.equal(timers.length, first.timers);
  assert.equal(listeners.length, first.listeners);
  await context.fetch("/api/v1/sqllab/execute", { method: "POST", body: '{"sql":"SELECT 1"}' });
  const events = messages.filter((message) => message.type === "SUPERSET_NETWORK_EVENT");
  assert.deepEqual(events.map((message) => message.payload.phase), ["request", "response"]);
});

function monacoPage() {
  const page = pageContext();
  const { context } = page;
  const root = new context.Element();
  root.tagName = "DIV";
  root.textContent = "SELECT visible_part FROM sample_events;\n".repeat(160);
  root.getBoundingClientRect = () => ({ width: 800, height: 600 });
  root.matches = () => false;
  root.contains = (element) => element === root;
  context.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  context.document.activeElement = root;
  context.document.querySelectorAll = (selector) =>
    [".monaco-editor", "[role='code']"].includes(selector) ? [root] : [];
  let sql = "WITH full_query AS (SELECT id FROM sample_events) SELECT id FROM full_query;";
  const model = { getValue: () => sql, getLanguageId: () => "sql" };
  const editor = { getDomNode: () => root, getModel: () => model, hasTextFocus: () => true };
  context.monaco = { editor: { getModels: () => [model], getEditors: () => [editor] } };
  const source = bridgeSource.replace("  const previousCollector =", `
    Object.assign(globalThis, { findBestSqlSnapshot });
    const previousCollector =`);
  vm.runInContext(source, context);
  return { ...page, root, model, editor, source, setSql: (value) => { sql = value; } };
}

test("Monaco full models outrank focused virtual DOM fragments at both capture layers", () => {
  const { context, root, model, setSql } = monacoPage();
  let snapshot = context.findBestSqlSnapshot();
  assert.equal(snapshot.sql, model.getValue());
  assert.equal(snapshot.source, "bridge:monaco:sql");
  root.textContent = "SELECT another_visible_part FROM sample_events";
  assert.equal(context.findBestSqlSnapshot().sql, model.getValue());
  setSql("SELECT 1;");
  snapshot = context.findBestSqlSnapshot();
  assert.equal(snapshot.sql, "SELECT 1;");
  vm.runInContext(contentSource, context);
  const captured = context.pickBestSnapshot([
    context.normalizeIncomingSnapshot(snapshot),
    { sql: root.textContent, source: "dom:monaco", isVisible: true, isFocused: true },
  ]);
  assert.equal(captured.sql, "SELECT 1;");
  assert.equal(captured.source, "bridge:monaco:sql");
});

test("Monaco selects the focused editor instead of a longer hidden model", () => {
  const { context, model, editor } = monacoPage();
  const hidden = { getValue: () => "SELECT hidden_value FROM hidden_file;\n".repeat(200), getLanguageId: () => "sql" };
  context.monaco.editor.getModels = () => [hidden, model];
  context.monaco.editor.getEditors = () => [
    { getDomNode: () => null, getModel: () => hidden, hasTextFocus: () => false }, editor,
  ];
  assert.equal(context.findBestSqlSnapshot().sql, model.getValue());
});

test("bridge reinjection updates the active collector without adding more hooks", () => {
  const { context, timers, source, messages, setSql } = monacoPage();
  const previous = context.__SQV_SQL_COLLECTOR__.emit;
  const count = timers.length;
  vm.runInContext(source, context);
  assert.notEqual(context.__SQV_SQL_COLLECTOR__.emit, previous);
  assert.equal(timers.length, count);
  setSql("SELECT updated_model FROM sample_events;");
  previous();
  assert.equal(messages.at(-1).payload.sql, "SELECT updated_model FROM sample_events;");
  assert.equal(messages.at(-1).bridgeVersion, 2);
});

test("Monaco highlights and reveals normalized ranges without moving the cursor", () => {
  const { context, editor, model, setSql } = monacoPage();
  setSql("\r\n  SELECT id\r\nFROM sample_events");
  const sql = "SELECT id\nFROM sample_events";
  let decorations, revealed, cleared = 0;
  editor.createDecorationsCollection = (items) => {
    decorations = items;
    return { clear: () => { cleared += 1; } };
  };
  editor.revealRangeInCenter = (range) => { revealed = range; };
  editor.setSelection = () => assert.fail("must preserve the user's cursor");
  context.__SQV_SQL_COLLECTOR__.applyHighlight([{ start: 0, end: 9 }, { start: 15, end: 29 }], sql);
  assert.equal(decorations.length, 1, "out-of-bounds ranges are rejected");
  assert.deepEqual(JSON.parse(JSON.stringify(revealed)), {
    startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 12,
  });
  assert.equal(decorations[0].options.inlineClassName, "sqv-monaco-highlight");
  assert.equal(model.getValue(), "\r\n  SELECT id\r\nFROM sample_events");
  context.__SQV_SQL_COLLECTOR__.applyHighlight([], sql);
  assert.equal(cleared, 1);
});

test("Monaco retries the same range after model availability and rejects stale SQL", () => {
  const { context, editor, model } = monacoPage();
  let applied = 0;
  editor.createDecorationsCollection = () => { applied += 1; return { clear() {} }; };
  const sql = model.getValue();
  context.monaco.editor.getEditors = () => [];
  context.__SQV_SQL_COLLECTOR__.applyHighlight([{ start: 0, end: 4 }], sql);
  context.monaco.editor.getEditors = () => [editor];
  context.__SQV_SQL_COLLECTOR__.applyHighlight([{ start: 0, end: 4 }], sql);
  context.__SQV_SQL_COLLECTOR__.applyHighlight([{ start: 0, end: 4 }], "SELECT another_query");
  assert.equal(applied, 1);
});

test("Monaco cursor snapshots map CRLF and leading blanks to analyzed SQL offsets", () => {
  const { context, editor, model, setSql } = monacoPage();
  setSql("\r\n  SELECT id\r\nFROM sample_events");
  editor.getSelection = () => ({ startLineNumber: 3, startColumn: 6, endLineNumber: 3, endColumn: 19 });
  model.getOffsetAt = ({ lineNumber, column }) => {
    const lines = model.getValue().split("\r\n");
    return lines.slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 2, 0) + column - 1;
  };
  model.getValueInRange = () => "sample_events";
  const snapshot = context.findBestSqlSnapshot();
  assert.equal(snapshot.selectionStart, snapshot.sql.indexOf("sample_events"));
  assert.equal(snapshot.sql.slice(snapshot.selectionStart, snapshot.selectionEnd), "sample_events");
});

test("highlight messages upgrade without page reload or stacking listeners", () => {
  const { context, editor, model, source, listeners } = monacoPage();
  let applied = 0, cleared = 0;
  editor.createDecorationsCollection = () => {
    applied += 1;
    return { clear: () => { cleared += 1; } };
  };
  const handler = (message) => {
    for (const [name, listener] of listeners) if (name === "message") listener(message);
  };
  const message = { source: vm.runInContext("window", context), data: {
    target: "superset-query-visualizer:page-bridge", type: "APPLY_EDITOR_HIGHLIGHT_V2",
    payload: { sql: model.getValue(), ranges: [{ start: 0, end: 4 }] },
  } };
  handler(message);
  const count = listeners.length;
  vm.runInContext(source, context);
  assert.equal(cleared, 1);
  assert.equal(listeners.length, count);
  handler(message);
  assert.equal(applied, 2);
});

test("Superset Ace highlights and cursor positions use the same normalized SQL", () => {
  const { context, root } = monacoPage();
  context.monaco = undefined;
  const value = "\r\n  SELECT id\r\nFROM sample_events";
  const markers = [];
  const removed = [];
  let scrolled;
  const editor = {
    getValue: () => value, getSelectedText: () => "sample_events",
    getSelectionRange: () => ({ start: { row: 2, column: 5 }, end: { row: 2, column: 18 } }),
    getSession: () => ({ addMarker: (range) => markers.push(range), removeMarker: (id) => removed.push(id) }),
    scrollToLine: (line) => { scrolled = line; },
  };
  context.document.querySelectorAll = (selector) => selector === ".ace_editor" ? [root] : [];
  context.ace = { edit: () => editor, require: () => ({ Range: class {
    constructor(row, column, endRow, endColumn) { Object.assign(this, { row, column, endRow, endColumn }); }
  } }) };
  const snapshot = context.findBestSqlSnapshot();
  assert.equal(snapshot.source, "bridge:ace:api");
  assert.equal(snapshot.sql.slice(snapshot.selectionStart, snapshot.selectionEnd), "sample_events");
  context.__SQV_SQL_COLLECTOR__.applyHighlight([{ start: 0, end: 9 }], snapshot.sql);
  assert.equal(markers[0].row, 1);
  assert.equal(markers[0].column, 2);
  assert.equal(scrolled, 1);
  context.__SQV_SQL_COLLECTOR__.applyHighlight([], snapshot.sql);
  assert.equal(removed.length, 1);
});

test("Bitbucket maps the accessibility textarea into the complete raw file", () => {
  const { context } = pageContext(sourceUrl("focus"));
  vm.runInContext(contentSource, context);
  const value = "  SELECT id\r\nFROM sample_events";
  const input = { value, selectionStart: value.indexOf("sample_events"), selectionEnd: value.length };
  context.document.querySelector = () => input;
  context.document.activeElement = input;
  const snapshot = { sql: "SET sample=true;\nSELECT id\nFROM sample_events;", source: "network:bitbucket:raw" };
  const selected = context.withBitbucketSelection(snapshot);
  assert.equal(selected.sql.slice(selected.selectionStart, selected.selectionEnd), "sample_events");
  assert.equal(selected.selectionStart, selected.sql.indexOf("sample_events"));
  const repeated = { ...snapshot, sql: snapshot.sql + "\n" + snapshot.sql };
  assert.equal(context.withBitbucketSelection(repeated).selectionStart, undefined);
});

function bitbucketViewer(context) {
  const events = [];
  const rendered = [1, 2, 103, 104, 105].map((number) => ({
    number, style: { top: `${(number - 1) * 20}px`, height: "20px" },
    classList: {
      active: false,
      toggle(_name, active) { this.active = active; },
      remove() { this.active = false; },
    },
  }));
  const anchors = rendered.map((line) => ({
    closest: () => ({ parentElement: { style: line.style } }),
    getAttribute: () => String(line.number),
  }));
  const bar = {
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 10 }) }),
    getBoundingClientRect: () => ({ top: 10, left: 200, width: 14, height: 100 }),
    dispatchEvent: (event) => events.push(event),
  };
  const elements = {
    "a.line-number[data-line-num]": anchors[0],
    ".editor-scrollable": { getBoundingClientRect: () => ({ height: 200 }) },
    ".editor-scrollable > .scrollbar.vertical": bar,
    ".view-line": rendered[0],
    ".view-lines": { style: { height: "4000px" } },
  };
  const root = {
    querySelector: (selector) => elements[selector] || null,
    querySelectorAll: (selector) => selector === "a.line-number[data-line-num]" ? anchors :
      selector === ".view-line" ? rendered : rendered.filter((line) => line.classList.active),
  };
  context.document.querySelector = (selector) => selector === ".monaco-editor" ? root :
    selector === ".monaco-editor .editor-scrollable > .scrollbar.vertical" ? bar : null;
  return { events, rendered, elements };
}

test("Bitbucket graph focus scrolls the viewport without navigation or cursor changes", async () => {
  const { context, timers, messages } = pageContext(sourceUrl("focus"));
  vm.runInContext(contentSource, context);
  vm.runInContext(bridgeSource, context);
  context.fetch = async () => new Response("\n\n" + "-- padding\n".repeat(100) + "SELECT id\nFROM sample_events;");
  const snapshot = await context.collectNetworkSqlSnapshot(context.location.href);
  const { events, rendered } = bitbucketViewer(context);
  const originalUrl = context.location.href;
  const message = { sql: snapshot.sql, ranges: [{ start: snapshot.sql.indexOf("FROM"), end: snapshot.sql.length }] };
  assert.equal(context.focusBitbucketSource(message), true);
  assert.equal(context.location.href, originalUrl);
  assert.equal(events.length, 0, "isolated content delegates pointer events to MAIN");
  assert.equal(messages.at(-1).type, "SCROLL_SOURCE_VIEW");
  context.__SQV_SQL_COLLECTOR__.scrollSource(messages.at(-1).payload);
  assert.deepEqual(events.map((event) => event.type), ["pointerdown", "pointerup"]);
  const expectedY = 10 + 5 + ((104 - 1) * 20 - 200 / 3) / (4000 - 200) * 90;
  assert.ok(Math.abs(events[0].clientY - expectedY) < 0.001);
  assert.equal(events[0].offsetX, 7);
  assert.equal(events[0].offsetY, events[0].clientY - 10);
  timers.at(-1)[0]();
  assert.deepEqual(rendered.filter((line) => line.classList.active).map((line) => line.number), [104]);
  assert.equal(context.focusBitbucketSource({ ...message, ranges: [{ start: 0, end: 10 }] }), true);
  context.__SQV_SQL_COLLECTOR__.scrollSource(messages.at(-1).payload);
  assert.ok(events[2].clientY < events[0].clientY, "earlier nodes scroll upwards as well");
  timers.at(-1)[0]();
  assert.equal(context.focusBitbucketSource({ ...message, ranges: [] }), false);
  assert.ok(rendered.every((line) => !line.classList.active));
  assert.equal(context.focusBitbucketSource({ ...message, sql: "SELECT other_sql" }), false);
  context.location = new URL(sourceUrl("different"));
  assert.equal(context.focusBitbucketSource(message), false);
});

test("Bitbucket focus fails safely when the viewer layout is unavailable", async () => {
  const { context } = pageContext(sourceUrl("focus"));
  vm.runInContext(contentSource, context);
  context.fetch = async () => new Response("SELECT id FROM sample_events;");
  const snapshot = await context.collectNetworkSqlSnapshot(context.location.href);
  const { events, elements } = bitbucketViewer(context);
  elements[".view-line"].style.height = "auto";
  assert.equal(context.focusBitbucketSource({ sql: snapshot.sql, ranges: [{ start: 0, end: 9 }] }), false);
  assert.equal(events.length, 0);
});

test("Bitbucket cursor movement is observed even when visible SQL text is unchanged", async () => {
  const { context, listeners, timers, messages } = pageContext(sourceUrl("cursor"));
  vm.runInContext(contentSource, context);
  context.fetch = async () => new Response("SELECT id FROM sample_events;");
  const input = { value: "SELECT id FROM sample_events;", selectionStart: 7, selectionEnd: 7 };
  context.document.querySelector = () => input;
  context.document.activeElement = input;
  await context.sendPageStatus();
  input.selectionStart = input.selectionEnd = 15;
  listeners.find(([name]) => name === "keyup")[1]();
  timers.at(-1)[0]();
  await tick();
  assert.equal(messages.at(-1).sqlSelectionStart, 15);
});

test("snapshot selection never borrows local offsets from unrelated editor SQL", () => {
  const { context } = pageContext();
  vm.runInContext(contentSource, context);
  const snapshot = context.pickBestSnapshot([
    { sql: "SELECT id FROM sample_events", source: "bridge:monaco:sql", selectionStart: 15, selectionEnd: 15 },
    { sql: "SELECT id FROM other_file", source: "dom:textarea", selectedText: "other_file", selectionStart: 15, selectionEnd: 25 },
  ]);
  assert.equal(snapshot.selectedText, "");
  assert.equal(snapshot.selectionEnd, 15);
});

test("legacy bridge snapshots cannot overwrite the newly installed model collector", () => {
  const { context, listeners } = pageContext();
  vm.runInContext(contentSource, context);
  const handler = listeners.find(([name]) => name === "message")[1];
  const window = vm.runInContext("window", context);
  handler({ source: window, data: { source: "superset-query-visualizer", type: "BRIDGE_READY",
    bridgeVersion: 2, payload: { sqlSnapshot: { sql: "SELECT complete_sql FROM sample_events", source: "bridge:monaco:sql" } } } });
  handler({ source: window, data: { source: "superset-query-visualizer", type: "SQL_SNAPSHOT",
    payload: { sql: "SELECT fragment", source: "bridge:div" } } });
  assert.equal(context.detectSupersetSqlLab().signals.includes("sql:bridge:monaco:sql"), true);
});

const sourceUrl = (file) => "https://bitbucket.org/sample/repo/src/main/" + file + ".sql";

test("Bitbucket login HTML is not treated as SQL", async () => {
  const { context } = pageContext(sourceUrl("a"));
  vm.runInContext(contentSource, context);
  for (const type of ["text/html", "text/plain"]) {
    context.fetch = async () => new Response("<!doctype html><html>SELECT an account</html>", {
      headers: { "content-type": type },
    });
    assert.equal(await context.fetchBitbucketRawSqlSnapshot(sourceUrl("a")), null);
  }
});

test("old raw-file responses cannot replace a new page cache or publish stale SQL", async () => {
  const { context, messages } = pageContext(sourceUrl("a"));
  const requests = [];
  context.fetch = () => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  };
  vm.runInContext(contentSource, context);
  const oldStatus = context.sendPageStatus();
  context.location = new URL(sourceUrl("b"));
  const newStatus = context.sendPageStatus();
  requests[1].resolve(new Response("SELECT 2"));
  await newStatus;
  requests[0].resolve(new Response("SELECT 1"));
  await oldStatus;
  const statuses = messages.filter((message) => message.type === "PAGE_STATUS_UPDATED");
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].url, sourceUrl("b"));
  assert.equal(statuses[0].sql, "SELECT 2");
  assert.equal((await context.collectNetworkSqlSnapshot(sourceUrl("b"))).sql, "SELECT 2");
  assert.equal(requests.length, 2);
});

test("editable pages accept shorter SQL while Bitbucket retains complete readonly snapshots", () => {
  const { context } = pageContext();
  vm.runInContext(contentSource, context);
  const long = { sql: "SELECT id, name FROM sample_table", source: "dom:structured-code" };
  const short = { sql: "SELECT id FROM sample_table", source: "dom:structured-code" };
  const url = "https://example.test/editor";
  context.stabilizeSqlSnapshot(url, long);
  assert.equal(context.stabilizeSqlSnapshot(url, short).sql, short.sql);
  assert.equal(context.stabilizeSqlSnapshot(url, null), null);
  context.stabilizeSqlSnapshot(sourceUrl("a"), long);
  assert.equal(context.stabilizeSqlSnapshot(sourceUrl("a"), short).sql, long.sql);
});

function backgroundContext(granted = true) {
  const { api } = panelApi();
  const data = {};
  const injections = [];
  const broadcasts = [];
  const tab = { id: 11, url: "https://example.test/editor", title: "Editor" };
  const storage = {
    get: async (key) => structuredClone({ [key]: data[key] }),
    set: async (value) => Object.assign(data, structuredClone(value)),
    remove: async (key) => { delete data[key]; },
  };
  Object.assign(api.runtime, { onMessage: event(), sendMessage: async (message) => broadcasts.push(message) });
  Object.assign(api.tabs, {
    get: async () => tab, query: async () => [tab],
    onUpdated: event(), onRemoved: event(), sendMessage: async () => ({ ok: true }),
  });
  api.storage = { session: storage, local: storage };
  api.permissions = {
    contains: async () => granted,
    remove: async () => { granted = false; return true; },
  };
  api.scripting = { executeScript: async (details) => injections.push(details) };
  const context = vm.createContext({
    chrome: api, console, URL, setTimeout, registerSidePanelController,
    analyzeSql: (sql, options) => ({ normalizedSql: sql, dialectPreference: options.dialectPreference }),
  });
  vm.runInContext(backgroundSource, context);
  const send = (message, sender = {}) => new Promise((resolve) => {
    api.runtime.onMessage.emit(message, sender, resolve);
  });
  return { context, api, data, tab, injections, broadcasts, send };
}

test("concurrent page updates do not discard newly pasted SQL", async () => {
  const { send, data, tab } = backgroundContext();
  const capture = send({ type: "CAPTURE_SELECTION_SQL", tabId: 11, sql: "SELECT 9", source: "capture:manual" });
  const page = send({ type: "PAGE_STATUS_UPDATED", sql: "SELECT 1", url: tab.url }, { tab, url: tab.url });
  const responses = await Promise.all([capture, page]);
  assert.ok(responses.every((response) => response.ok));
  assert.equal(data["tab:11"].capturedSql, "SELECT 9");
  assert.equal(data["tab:11"].sql, "SELECT 1");
  assert.equal(data["tab:11"].activeSql, "SELECT 9");
});

test("revoked site access clears page SQL even when manual SQL remains", async () => {
  const { send, data, tab } = backgroundContext();
  await send({ type: "PAGE_STATUS_UPDATED", sql: "SELECT 1", url: tab.url }, { tab, url: tab.url });
  await send({ type: "CAPTURE_SELECTION_SQL", tabId: 11, sql: "SELECT 9", source: "capture:manual" });
  const response = await send({ type: "DISABLE_SITE_ACCESS", tabId: 11 });
  assert.equal(response.ok, true);
  assert.equal(response.session.sql, "");
  assert.equal(response.session.activeSql, "SELECT 9");
  assert.equal(response.session.siteAccessGranted, false);
  await send({ type: "PAGE_STATUS_UPDATED", sql: "SELECT 2", url: tab.url }, { tab, url: tab.url });
  assert.equal(data["tab:11"].sql, "");
  assert.equal(data["tab:11"].analysis.normalizedSql, "SELECT 9");
});

test("revocation waits for an in-flight page write before clearing collected SQL", async () => {
  const { send, data, tab, api } = backgroundContext();
  const entered = deferred();
  const release = deferred();
  const originalSet = api.storage.session.set;
  api.storage.session.set = async (value) => {
    if (value["tab:11"]?.sql === "SELECT 1") {
      entered.resolve();
      await release.promise;
    }
    return originalSet(value);
  };
  const page = send({ type: "PAGE_STATUS_UPDATED", sql: "SELECT 1", url: tab.url }, { tab, url: tab.url });
  await entered.promise;
  const revoke = send({ type: "DISABLE_SITE_ACCESS", tabId: 11 });
  await tick();
  release.resolve();
  await Promise.all([page, revoke]);
  assert.equal(data["tab:11"].sql, "");
  assert.equal(data["tab:11"].siteAccessGranted, false);
});

test("messages from a previous navigation cannot repopulate the current tab", async () => {
  const { send, tab, data } = backgroundContext();
  const previousUrl = tab.url;
  tab.url = "https://example.test/new";
  const response = await send(
    { type: "PAGE_STATUS_UPDATED", sql: "SELECT 1", url: previousUrl },
    { tab, url: previousUrl },
  );
  assert.equal(response.ok, true);
  assert.equal(data["tab:11"], undefined);
});

test("Bitbucket SPA file changes publish new SQL even when sender metadata retains the initial URL", async () => {
  const { send, tab, data, api } = backgroundContext();
  const initialUrl = sourceUrl("first");
  tab.url = initialUrl;
  const { context, listeners, timers } = pageContext(initialUrl);
  context.fetch = async (url) => new Response(url.includes("second.sql") ? "SELECT 2 AS second_file" : "SELECT 1 AS first_file");
  context.chrome.runtime.sendMessage = (message) => send(message, {
    tab: { ...tab }, url: initialUrl, frameId: 0,
  });
  vm.runInContext(contentSource, context);
  await context.sendPageStatus();
  assert.equal(data["tab:11"].sql, "SELECT 1 AS first_file");

  const handler = listeners.find(([name]) => name === "message")[1];
  const window = vm.runInContext("window", context);
  for (const file of ["second", "first"]) {
    tab.url = sourceUrl(file);
    context.location = new URL(tab.url);
    api.tabs.onUpdated.emit(11, { url: tab.url });
    await tick();
    handler({ source: window, data: { source: "superset-query-visualizer", type: "LOCATION_CHANGED" } });
    timers.at(-1)[0]();
    await tick();
    assert.equal(data["tab:11"]?.url, tab.url);
    assert.equal(data["tab:11"]?.sql, file === "second" ? "SELECT 2 AS second_file" : "SELECT 1 AS first_file");
  }
});

test("current page URLs do not authorize cross-origin or child-frame status messages", async () => {
  for (const sender of [
    { url: "https://other.test/editor", frameId: 0 },
    { url: "https://example.test/editor", frameId: 2 },
  ]) {
    const { send, tab, data } = backgroundContext();
    await send({ type: "PAGE_STATUS_UPDATED", sql: "SELECT 99", url: tab.url }, { tab, ...sender });
    assert.equal(data["tab:11"], undefined);
  }
});

test("source-line fragment changes preserve analysis and accept the original document sender", async () => {
  const { send, data, tab, api } = backgroundContext();
  const initial = tab.url;
  await send({ type: "PAGE_STATUS_UPDATED", sql: "SELECT id FROM sample_events", url: initial }, { tab, url: initial });
  tab.url = initial + "#lines-20";
  api.tabs.onUpdated.emit(11, { url: tab.url });
  await tick();
  assert.equal(data["tab:11"].sql, "SELECT id FROM sample_events");
  await send({ type: "PAGE_STATUS_UPDATED", sql: "SELECT id FROM sample_events", url: tab.url,
    sqlSelectionStart: 15, sqlSelectionEnd: 15 }, { tab, url: initial });
  assert.equal(data["tab:11"].sqlSelectionStart, 15);
  assert.equal(data["tab:11"].url, tab.url);
  tab.url = "https://example.test/another-document";
  api.tabs.onUpdated.emit(11, { url: tab.url });
  await tick();
  assert.equal(data["tab:11"], undefined);
});

test("reopening an existing session reinjects observers, content before page bridge", async () => {
  const { send, injections } = backgroundContext();
  await send({ type: "CAPTURE_SELECTION_SQL", tabId: 11, sql: "SELECT 9", source: "capture:manual" });
  const response = await send({ type: "GET_TAB_SESSION", tabId: 11 });
  assert.equal(response.ok, true);
  assert.deepEqual(injections.map((entry) => entry.files[0]), ["content.js", "page-bridge.js"]);
  assert.equal(injections[1].world, "MAIN");
});

test("a responsive content observer is refreshed without stacking another injection", async () => {
  const { send, injections, api } = backgroundContext();
  await send({ type: "CAPTURE_SELECTION_SQL", tabId: 11, sql: "SELECT 9", source: "capture:manual" });
  api.tabs.sendMessage = async (_tabId, message) => message.type === "REFRESH_SQL_OBSERVER"
    ? { ok: true, observer: "superflow-content-v1" } : { ok: true };
  const response = await send({ type: "GET_TAB_SESSION", tabId: 11 });
  assert.equal(response.ok, true);
  assert.deepEqual(injections.map((entry) => entry.files[0]), ["page-bridge.js"]);
});

test("a disconnected content receiver is replaced when the panel requests its session", async () => {
  const { send, injections, api } = backgroundContext();
  await send({ type: "CAPTURE_SELECTION_SQL", tabId: 11, sql: "SELECT 9", source: "capture:manual" });
  api.tabs.sendMessage = async () => { throw new Error("Receiving end does not exist."); };
  const response = await send({ type: "GET_TAB_SESSION", tabId: 11 });
  assert.equal(response.ok, true);
  assert.deepEqual(injections.map((entry) => entry.files[0]), ["content.js", "page-bridge.js"]);
});

for (const dialectPreference of ["auto", "trino", "hive", "postgresql"]) {
  test(dialectPreference + ": bare JOIN and JOIN USING preserve their actual join types", () => {
    for (const [join, label, condition] of [
      ["JOIN", "INNER JOIN", "ON a.id = b.id"],
      ["JOIN", "INNER JOIN", "USING (id)"],
      ["LEFT JOIN", "LEFT JOIN", "USING (id)"],
      ["RIGHT JOIN", "RIGHT JOIN", "USING (id)"],
      ["FULL OUTER JOIN", "FULL JOIN", "ON a.id = b.id"],
      ["CROSS JOIN", "CROSS JOIN", ""],
    ]) {
      const analysis = analyzeSql(
        "SELECT a.id FROM sample_a a " + join + " sample_b b " + condition,
        { dialectPreference },
      );
      const joins = analysis.graph.nodes.filter((node) => node.type === "join");
      assert.ok(joins.length > 0);
      assert.ok(joins.every((node) => node.label === label), JSON.stringify(joins));
    }
  });
}

test("different join types remain MULTI JOIN rather than being flattened", () => {
  const analysis = analyzeSql("SELECT a.id FROM sample_a a LEFT JOIN sample_b b ON a.id = b.id INNER JOIN sample_c c ON a.id = c.id");
  const join = analysis.graph.nodes.find((node) => node.type === "join");
  assert.equal(join.label, "MULTI JOIN");
  assert.deepEqual([...join.meta.joinTypes].sort(), ["INNER", "LEFT"]);
});

test("Hive script syntax outweighs the shared NVL function in Auto mode", () => {
  for (const prelude of [
    "SET hivevar:run_date = '20260101';",
    "SET hive.exec.dynamic.partition = true;",
    "ADD JAR 'hdfs:///lib/sample.jar';",
    "CREATE TEMPORARY FUNCTION sample_fn AS 'example.SampleFunction';",
  ]) {
    const analysis = analyzeSql(prelude + " SELECT NVL(value, 0) FROM sample_events");
    assert.equal(analysis.detectedDialect, "hive", prelude);
    assert.equal(analysis.parserDialect, "hive", prelude);
  }
});

test("comment-only fragments do not create phantom worksheet statements", () => {
  const sql = "-- header;\nSELECT ';' AS value;\n/* separator */;\n-- next\nSELECT 2;\n-- END\n/* footer */";
  const analysis = analyzeSql(sql);
  assert.equal(analysis.statements.length, 2);
  for (const statement of analysis.statements) {
    assert.equal(sql.slice(statement.rangeStart, statement.rangeEnd), statement.sql);
  }
  assert.equal(analyzeSql("-- only a comment\n/* no query */").statements.length, 0);
});

for (const dialectPreference of ["auto", "hive", "trino", "postgresql"]) {
  test(dialectPreference + ": window functions stay in their query scope", () => {
    const analysis = analyzeSql(
      "SELECT t1.id FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM sample_events) t1 WHERE t1.rn = 1",
      { dialectPreference },
    );
    assert.equal(analysis.clauses.window, false);
    assert.equal(analysis.graph.nodes.some((node) => node.id === "clause:window"), false);
    const inner = analysis.graph.nodes.find((node) => node.type === "inline_view");
    assert.ok(inner.meta.flowSequence.includes("WINDOW"));

    const wrapped = analyzeSql("SELECT COALESCE(SUM(value) OVER (PARTITION BY id), 0) AS total FROM sample_events", { dialectPreference });
    assert.equal(wrapped.clauses.window, true);
    const literal = analyzeSql("SELECT 'OVER (ORDER BY id)' AS note FROM sample_events", { dialectPreference });
    assert.equal(literal.clauses.window, false);
    const identifier = analyzeSql("SELECT over AS metric FROM sample_events", { dialectPreference });
    assert.equal(identifier.clauses.window, false);
    const scalar = analyzeSql("SELECT COALESCE((SELECT MAX(rn) FROM (SELECT ROW_NUMBER() OVER (ORDER BY id) AS rn FROM sample_events) t1), 0) AS n", { dialectPreference });
    assert.equal(scalar.clauses.window, false);
  });
}

test("Hive resource and temporary-function setup have no result graph", () => {
  const analysis = analyzeSql("ADD JAR 'hdfs:///lib/sample.jar'; CREATE TEMPORARY FUNCTION sample_fn AS 'example.SampleFunction'; SELECT 1");
  for (const statement of analysis.statements.slice(0, 2)) {
    assert.equal(statement.statementType, "CONFIG");
    assert.deepEqual(statement.graph.nodes.map((node) => node.type), ["directive"]);
    assert.equal(statement.writes.length, 0);
  }
});

test("nine UNION branches preserve both nested LEFT JOIN scopes", () => {
  const branches = Array.from({ length: 9 }, (_, index) =>
    `SELECT id, SUM(value) AS total FROM sample_stage WHERE group_id = ${index + 1} GROUP BY id`,
  ).join(" UNION ALL ");
  const analysis = analyzeSql(`INSERT OVERWRITE TABLE sample_output
    SELECT t1.id, t2.day_name FROM (
      SELECT t1.id, NVL(t1.total, 0) AS total, RANK() OVER (ORDER BY t1.total DESC) AS rn
      FROM (${branches}) t1 LEFT OUTER JOIN sample_history t2 ON t1.id = t2.id
    ) t1 LEFT OUTER JOIN sample_calendar t2 ON t1.id = t2.id`);
  assert.equal(analysis.detectedDialect, "hive");
  assert.equal(analysis.parserEngine, "node");
  // The node AST keeps the first SELECT on its owner and the other eight as _next branches.
  assert.equal(analysis.graph.nodes.filter((node) => node.type === "union_branch").length + 1, 9);
  assert.equal(analysis.statements[0].logicalStatementType, "SELECT");
  assert.equal(analysis.writes[0].kind, "insert_overwrite");
  assert.deepEqual(analysis.reads.map((source) => source.name).sort(), ["sample_calendar", "sample_history", "sample_stage"]);
  assert.equal(analysis.graph.nodes.find((node) => node.id === "clause:join").label, "LEFT JOIN");
  const inner = analysis.graph.nodes.find((node) =>
    node.type === "inline_view" && node.meta.flowSequence.includes("WINDOW"),
  );
  assert.deepEqual(inner.meta.joinTypes, ["LEFT"]);
  assert.equal(analysis.clauses.window, false);
});

test("Hive expression lineage excludes functions, cast types and output aliases", () => {
  const analysis = analyzeSql(`WITH cleaned AS (
    SELECT NULLIF(TRIM(CAST(t1.raw_id AS STRING)), '') AS clean_id,
      CAST(t1.amount AS DECIMAL(12, 2)) total,
      COALESCE(t1.flag, 0) AS flag,
      'SUM(fake)' AS note,
      t1.\`odd name\` AS quoted_value,
      t1.string AS type_named_column
    FROM sample_input t1
  ) SELECT * FROM cleaned`, { dialectPreference: "hive" });
  const columns = analysis.graph.columns.filter((column) => column.nodeId === "cte:cleaned");
  assert.deepEqual(columns.map((column) => column.upstream.map((ref) => ref.columnName)),
    [["raw_id"], ["amount"], ["flag"], [], ["odd name"], ["string"]]);
  assert.ok(columns.flatMap((column) => column.upstream).every((ref) => ref.sourceNodeId === "source:sample_input"));
});

for (const dialectPreference of ["auto", "hive", "trino", "postgresql"]) {
  test(dialectPreference + ": UNION lineage keeps each branch alias scope and output position", () => {
    const sql = `WITH combined AS (
      SELECT t1.id AS item_id, t1.amount AS metric FROM sample_a t1
      UNION ALL SELECT t1.other_id, t1.value FROM sample_b t1
      UNION ALL SELECT t1.key_id, 0 FROM sample_c t1
    ) SELECT * FROM combined`;
    const analysis = analyzeSql(sql, { dialectPreference });
    const columns = analysis.graph.columns.filter((column) => column.nodeId === "cte:combined");
    assert.deepEqual(columns.map((column) => column.name), ["item_id", "metric"]);
    assert.deepEqual(columns[0].upstream.map((ref) => [ref.sourceName, ref.columnName]),
      [["sample_a", "id"], ["sample_b", "other_id"], ["sample_c", "key_id"]]);
    assert.deepEqual(columns[1].upstream.map((ref) => [ref.sourceName, ref.columnName]),
      [["sample_a", "amount"], ["sample_b", "value"]]);
    assert.equal(columns[0].spans.length, 3);
    assert.deepEqual(columns[0].spans.map((span) => sql.slice(span.start, span.end).trim()),
      ["t1.id AS item_id", "t1.other_id", "t1.key_id"]);
  });
}

test("UNION wildcard expansion preserves positional lineage", () => {
  const analysis = analyzeSql(`WITH a AS (SELECT id, amount FROM sample_a),
    b AS (SELECT other_id, value FROM sample_b),
    combined AS (SELECT * FROM a UNION ALL SELECT * FROM b)
    SELECT * FROM combined`, { dialectPreference: "trino" });
  const columns = analysis.graph.columns.filter((column) => column.nodeId === "cte:combined");
  assert.deepEqual(columns.map((column) => column.name), ["id", "amount"]);
  assert.deepEqual(columns[1].upstream.map((ref) => [ref.sourceName, ref.columnName]),
    [["a", "amount"], ["b", "value"]]);
});

test("LATERAL VIEW instances have scoped sources, column lineage and SQL focus", () => {
  const sql = `WITH a AS (
    SELECT t2.day_key FROM sample_a t1
    LATERAL VIEW EXPLODE(ARRAY(t1.dt, 'Total')) t2 AS day_key
  ), b AS (
    SELECT t2.day_key FROM sample_b t1
    LATERAL VIEW OUTER EXPLODE(ARRAY(t1.dt, 'Total')) t2 AS day_key
  ) SELECT a.day_key FROM a JOIN b ON a.day_key = b.day_key`;
  const analysis = analyzeSql(sql, { dialectPreference: "hive" });
  const graph = buildLogicalDisplayGraph(analysis.graph, false);
  const laterals = graph.nodes.filter((node) => node.type === "lateral_view");
  assert.equal(laterals.length, 2);
  for (const [index, name] of ["a", "b"].entries()) {
    const node = laterals.find((candidate) => candidate.meta.ownerNodeId === "cte:" + name);
    assert.ok(node);
    assert.ok(graph.edges.some((edge) => edge.source === "source:sample_" + name && edge.target === node.id));
    assert.deepEqual(graph.edges.filter((edge) => edge.source === node.id).map((edge) => edge.target), ["cte:" + name]);
    const column = graph.columns.find((candidate) => candidate.nodeId === "cte:" + name && candidate.name === "day_key");
    assert.equal(column.upstream[0].sourceNodeId, node.id);
    const generatedColumn = graph.columns.find((candidate) => candidate.nodeId === node.id && candidate.name === "day_key");
    assert.deepEqual(generatedColumn.upstream.map((ref) => [ref.sourceName, ref.columnName]), [["sample_" + name, "dt"]]);
    const selection = resolveGraphSelection(graph, node.id, null);
    assert.equal(selection.ranges.length, 1);
    assert.equal(sql.slice(selection.ranges[0].start, selection.ranges[0].end),
      `LATERAL VIEW ${index ? "OUTER " : ""}EXPLODE(ARRAY(t1.dt, 'Total')) t2 AS day_key`);
  }
});

test("chained LATERAL VIEW outputs resolve to their own generating instance", () => {
  const analysis = analyzeSql(`SELECT t2.pos, t3.item
    FROM sample_arrays t1
    LATERAL VIEW POSEXPLODE(t1.groups) t2 AS pos, items
    LATERAL VIEW EXPLODE(t2.items) t3 AS item`, { dialectPreference: "hive" });
  const graph = analysis.graph;
  const laterals = graph.nodes.filter((node) => node.type === "lateral_view");
  assert.equal(laterals.length, 2);
  assert.ok(graph.edges.some((edge) => edge.source === laterals[0].id && edge.target === laterals[1].id));
  assert.deepEqual(graph.columns.filter((column) => column.nodeId === "result:main")
    .map((column) => column.upstream[0].sourceNodeId), laterals.map((node) => node.id));
});

test("LATERAL VIEW lineage stays scoped across UNION branches sharing a table and alias", () => {
  const analysis = analyzeSql(`WITH combined AS (
    SELECT t2.item FROM sample_arrays t1 LATERAL VIEW EXPLODE(t1.items) t2 AS item
    UNION ALL
    SELECT t2.item FROM sample_arrays t1 LATERAL VIEW EXPLODE(t1.other_items) t2 AS item
  ) SELECT * FROM combined`, { dialectPreference: "hive" });
  const graph = analysis.graph;
  const laterals = graph.nodes.filter((node) => node.type === "lateral_view");
  assert.equal(laterals.length, 2);
  const output = graph.columns.find((column) => column.nodeId === "cte:combined");
  assert.deepEqual(output.upstream.map((ref) => ref.sourceNodeId), laterals.map((node) => node.id));
  assert.deepEqual(laterals.map((node) => graph.columns.find((column) => column.nodeId === node.id)
    .upstream.map((ref) => [ref.sourceName, ref.columnName])),
    [[["sample_arrays", "items"]], [["sample_arrays", "other_items"]]]);
});

test("parenthesized UNION branches preserve lineage and focus", () => {
  const sql = `WITH combined AS (
    (SELECT t1.id FROM sample_a t1) UNION ALL (SELECT t1.other_id FROM sample_b t1)
  ) SELECT * FROM combined`;
  const analysis = analyzeSql(sql, { dialectPreference: "trino" });
  const output = analysis.graph.columns.find((column) => column.nodeId === "cte:combined");
  assert.deepEqual(output.upstream.map((ref) => [ref.sourceName, ref.columnName]),
    [["sample_a", "id"], ["sample_b", "other_id"]]);
  assert.deepEqual(output.spans.map((span) => sql.slice(span.start, span.end)), ["t1.id", "t1.other_id"]);
});

test("heuristic tokens preserve real identifiers and omit comments, literals and grouping metadata", () => {
  const analysis = analyzeSql(`WITH grouped AS (
    SELECT t1.amount + t1.value AS total,
      CAST(t1.id AS VARCHAR(20)) AS string_id,
      CASE WHEN (GROUPING__ID & 1) = 1 THEN 'Total' ELSE t1.category END AS category,
      t1.\`odd.name\` AS quoted_dot,
      t1.amount /* SUM(fake) */ AS original_amount,
      1e3 AS constant
    FROM sample_input t1
    GROUP BY t1.id, t1.category, t1.amount, t1.value, t1.\`odd.name\`
  ) SELECT * FROM grouped`, { dialectPreference: "hive" });
  const columns = analysis.graph.columns.filter((column) => column.nodeId === "cte:grouped");
  assert.deepEqual(columns.map((column) => column.upstream.map((ref) => ref.columnName)),
    [["amount", "value"], ["id"], ["category"], ["odd.name"], ["amount"], []]);
});

// Cross-editor tab switching regression matrix (fictional SQL only).
const shortSql = "SELECT 2 AS current_query";
const longSql = "SELECT id FROM sample_old;\n".repeat(200).trim();

function editorPage(kind, { hiddenLong = false, focus = true } = {}) {
  const page = pageContext();
  const { context } = page;
  const roots = [new context.Element(), new context.Element()];
  const sqls = [shortSql, longSql];
  const selector = { ace: ".ace_editor", cm5: ".CodeMirror", cm6: ".cm-content", textarea: "textarea" }[kind];
  let active = 0;
  roots.forEach((element, index) => {
    element.tagName = kind === "textarea" ? "TEXTAREA" : "DIV";
    element.getBoundingClientRect = () => ({ width: index === active ? 600 : 0, height: index === active ? 300 : 0 });
    element.contains = (target) => target === element;
    element.matches = (value) => value.split(/,\s*/).includes(selector);
    Object.defineProperty(element, "textContent", { get: () => sqls[index] });
    if (kind === "textarea") Object.defineProperty(element, "value", { get: () => sqls[index] });
    if (kind === "cm5") element.CodeMirror = { getValue: () => sqls[index] };
  });
  context.document.activeElement = focus ? roots[active] : null;
  context.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  context.document.querySelectorAll = (value) => value === selector ? (hiddenLong ? roots : [roots[active]]) : [];
  if (kind === "ace") context.ace = { edit: (element) => ({
    getValue: () => sqls[roots.indexOf(element)],
    getSelectionRange: () => ({ start: { row: 0, column: 0 }, end: { row: 0, column: 0 } }),
    getSelectedText: () => "",
  }) };
  vm.runInContext(bridgeSource.replace("  const previousCollector =", `
    Object.assign(globalThis, { findBestSqlSnapshot });
    const previousCollector =`), context);
  vm.runInContext(contentSource, context);
  return {
    ...page, roots, sqls,
    switchTo(index, focused = focus) {
      active = index;
      context.document.activeElement = focused ? roots[index] : null;
    },
    snapshot: () => context.findBestSqlSnapshot()?.sql ?? "",
    domSnapshot: () => context.collectDomSqlSnapshot()?.sql ?? "",
  };
}

// CodeMirror 6 cases cover visible DOM, not its virtualized off-screen document.
for (const kind of ["ace", "cm5", "cm6", "textarea"]) {
  test(`${kind}: same-URL A→B→A with one mounted editor`, () => {
    const page = editorPage(kind);
    assert.equal(page.snapshot(), shortSql);
    page.switchTo(1);
    assert.equal(page.snapshot(), longSql);
    page.switchTo(0);
    assert.equal(page.snapshot(), shortSql);
  });
  for (const focus of [true, false]) {
    test(`${kind}: short active vs long hidden (focused=${focus})`, () => {
      const page = editorPage(kind, { hiddenLong: true, focus });
      assert.equal(page.snapshot(), shortSql);
      assert.equal(page.domSnapshot(), shortSql, "content DOM fallback must also exclude hidden editors");
    });
  }
  test(`${kind}: empty active tab cannot resurrect an old hidden query`, () => {
    const page = editorPage(kind, { hiddenLong: true });
    page.sqls[0] = "";
    assert.equal(page.snapshot(), "");
    assert.equal(page.domSnapshot(), "");
  });
}

test("Monaco: visible model swap A→B→A at the same URL", () => {
  const page = monacoPage();
  const initial = page.model.getValue();
  assert.equal(page.context.findBestSqlSnapshot().sql, initial);
  page.setSql(shortSql);
  assert.equal(page.context.findBestSqlSnapshot().sql, shortSql);
  page.setSql(initial);
  assert.equal(page.context.findBestSqlSnapshot().sql, initial);
});

test("Monaco: ignore hidden models even when the current editor loses focus", () => {
  const { context, model, editor } = monacoPage();
  const hidden = { getValue: () => longSql, getLanguageId: () => "sql" };
  context.document.activeElement = null;
  editor.hasTextFocus = () => false;
  context.monaco.editor.getModels = () => [hidden, model];
  context.monaco.editor.getEditors = () => [
    { getDomNode: () => null, getModel: () => hidden, hasTextFocus: () => false }, editor,
  ];
  assert.equal(context.findBestSqlSnapshot().sql, model.getValue());
});

test("SQL Lab: late execution response cannot replace the active worksheet", async () => {
  const { send, tab, data } = backgroundContext();
  const sender = { tab, url: tab.url };
  await send({ type: "SUPERSET_NETWORK_EVENT", event: {
    phase: "request", kind: "execute", request: { sql: "SELECT 1 AS query_a", queryId: "a" }, timestamp: 100,
  } }, sender);
  await send({ type: "PAGE_STATUS_UPDATED", url: tab.url, sql: shortSql }, sender);
  await send({ type: "SUPERSET_NETWORK_EVENT", event: {
    phase: "response", kind: "execute", request: { sql: "SELECT 1 AS query_a", queryId: "a" },
    response: { status: "success", ok: true, rowCount: 1, queryId: "a" }, timestamp: 200,
  } }, sender);
  assert.equal(data["tab:11"].activeSql, shortSql);
  assert.equal(data["tab:11"].execution, null);
});

for (const suffix of ["#anchor", "?active=second"]) {
  test(`unchanged full model survives history navigation ${suffix}`, async () => {
    const { context, messages, model, root } = monacoPage();
    root.textContent = "SELECT id FROM sample_events";
    vm.runInContext(contentSource, context);
    const window = vm.runInContext("window", context);
    let cursor = 0;
    const flush = () => {
      while (cursor < messages.length) {
        const data = messages[cursor++];
        if (data.source || data.target) context.dispatchEvent({ type: "message", source: window, data });
      }
    };
    flush();
    await context.sendPageStatus();
    context.history.replaceState({}, "", context.location.href + suffix);
    flush();
    await context.sendPageStatus();
    assert.equal(messages.filter((message) => message.type === "PAGE_STATUS_UPDATED").at(-1).sql, model.getValue());
  });
}

test("execution events accept live SPA URLs but reject old pages, foreign origins and child frames", async () => {
  const { send, tab, data } = backgroundContext();
  const initial = tab.url;
  tab.url += "?query=second";
  const event = { phase: "request", kind: "execute", request: { sql: "SELECT 2" } };
  await send({ type: "SUPERSET_NETWORK_EVENT", url: tab.url, event }, { tab, url: initial, frameId: 0 });
  assert.equal(data["tab:11"]?.execution?.status, "running");
  const before = structuredClone(data["tab:11"]);
  for (const [url, sender] of [
    [initial, { tab, url: initial, frameId: 0 }],
    [tab.url, { tab, url: "https://other.test/editor", frameId: 0 }],
    [tab.url, { tab, url: initial, frameId: 2 }],
  ]) {
    await send({ type: "SUPERSET_NETWORK_EVENT", url, event: { ...event, request: { sql: "SELECT 99" } } }, sender);
    assert.deepEqual(data["tab:11"], before);
  }
});

test("HTTP failures finish the current execution even without a JSON status field", async () => {
  for (const httpStatus of [400, 401, 500, 503]) {
    const { send, tab, data } = backgroundContext();
    const sender = { tab, url: tab.url };
    await send({ type: "SUPERSET_NETWORK_EVENT", event: { phase: "request", kind: "execute", request: { sql: "SELECT 1" }, timestamp: 100 } }, sender);
    await send({ type: "SUPERSET_NETWORK_EVENT", event: { phase: "response", kind: "execute", request: { sql: "SELECT 1" }, response: { ok: false, httpStatus }, timestamp: 200 } }, sender);
    assert.equal(data["tab:11"].execution.status, "failed");
    assert.equal(data["tab:11"].execution.finishedAt, 200);
    assert.equal(data["tab:11"].execution.durationMs, 100);
  }
});

test("selected SQL execution keeps the full worksheet and ignores older executions and unknown polling", async () => {
  const { send, tab, data } = backgroundContext();
  const sender = { tab, url: tab.url };
  const sql = "SELECT 1;\nSELECT 2;";
  await send({ type: "PAGE_STATUS_UPDATED", url: tab.url, sql, resultRowCount: null }, sender);
  for (const requestId of ["first", "second"]) {
    await send({ type: "SUPERSET_NETWORK_EVENT", event: { phase: "request", kind: "execute", requestId, request: { sql: "SELECT 2;" }, timestamp: 100 } }, sender);
    assert.equal(data["tab:11"].sql, sql);
  }
  await send({ type: "SUPERSET_NETWORK_EVENT", event: { phase: "response", kind: "execute", requestId: "first", request: { sql: "SELECT 2;" }, response: { ok: true, status: "success", rowCount: 99 } } }, sender);
  assert.equal(data["tab:11"].execution.status, "running");
  await send({ type: "SUPERSET_NETWORK_EVENT", event: { phase: "response", kind: "execute", requestId: "second", request: { sql: "SELECT 2;" }, response: { ok: true, status: "success", queryId: "current", rowCount: 2 } } }, sender);
  assert.equal(data["tab:11"].execution.rowCount, 2);
  for (const queryId of [null, "old"]) {
    await send({ type: "SUPERSET_NETWORK_EVENT", event: { phase: "response", kind: "results", response: { ok: true, queryId, rowCount: 99 } } }, sender);
    assert.equal(data["tab:11"].execution.rowCount, 2);
  }
  await send({ type: "SUPERSET_NETWORK_EVENT", event: { phase: "response", kind: "results", response: { ok: true, queryId: "current", rowCount: 3 } } }, sender);
  assert.equal(data["tab:11"].execution.rowCount, 3);
  await send({ type: "PAGE_STATUS_UPDATED", url: tab.url, sql: "", resultRowCount: null }, sender);
  assert.equal(data["tab:11"].execution, null);
  await send({ type: "SUPERSET_NETWORK_EVENT", event: { phase: "response", kind: "execute", requestId: "second", request: { sql: "SELECT 2;" }, response: { ok: true, status: "success" } } }, sender);
  assert.equal(data["tab:11"].sql, "");
  assert.equal(data["tab:11"].execution, null);
});

test("fetch requests retain their originating page URL and request identity until response", async () => {
  const { context, messages } = pageContext();
  const pending = deferred();
  context.fetch = () => pending.promise;
  vm.runInContext(bridgeSource, context);
  const initial = context.location.href;
  const request = context.fetch("/api/v1/sqllab/execute", { method: "POST", body: '{"sql":"SELECT 1"}' });
  context.location = new URL(initial + "?query=other");
  pending.resolve(new Response('{"status":"success"}', { headers: { "content-type": "application/json" } }));
  await request;
  const events = messages.filter((message) => message.type === "SUPERSET_NETWORK_EVENT").map((message) => message.payload);
  assert.equal(events.length, 2);
  assert.ok(events[0].requestId);
  assert.equal(events[0].requestId, events[1].requestId);
  assert.ok(events.every((event) => event.pageUrl === initial));
});

test("XHR responses retain request identity and the original page URL after navigation", () => {
  const { context, messages } = pageContext();
  const handlers = [];
  context.XMLHttpRequest.prototype.addEventListener = (_name, handler) => handlers.push(handler);
  vm.runInContext(bridgeSource, context);
  const initial = context.location.href;
  const xhr = new context.XMLHttpRequest();
  xhr.open("POST", "/superset/sql_json/");
  xhr.send('{"sql":"SELECT 1"}');
  context.location = new URL(initial + "?next=1");
  xhr.status = 500;
  xhr.responseText = '{"message":"Server error"}';
  handlers[0]();
  const events = messages.filter((message) => message.type === "SUPERSET_NETWORK_EVENT").map((message) => message.payload);
  assert.equal(events.length, 2);
  assert.ok(events[0].requestId);
  assert.equal(events[0].requestId, events[1].requestId);
  assert.ok(events.every((event) => event.pageUrl === initial));
  assert.equal(events[1].response.ok, false);
});

test("content relays the request page URL rather than relabeling a late response as the new page", async () => {
  const { context, messages } = pageContext();
  vm.runInContext(contentSource, context);
  const initial = context.location.href;
  context.location = new URL(initial + "?next=1");
  context.dispatchEvent({ type: "message", source: vm.runInContext("window", context), data: {
    source: "superset-query-visualizer", type: "SUPERSET_NETWORK_EVENT",
    payload: { pageUrl: initial, phase: "response", kind: "execute" },
  } });
  await tick();
  assert.equal(messages.find((message) => message.type === "SUPERSET_NETWORK_EVENT").url, initial);
});

test("Monaco empty editor cannot fall back to a hidden viewport", () => {
  const { context, root, setSql } = monacoPage();
  setSql("");
  root.textContent = "";
  const hidden = new context.Element();
  hidden.tagName = "DIV";
  hidden.textContent = longSql;
  hidden.matches = () => false;
  hidden.getBoundingClientRect = () => ({ width: 0, height: 0 });
  context.document.querySelectorAll = (selector) => selector === ".monaco-editor .view-lines" ? [hidden] : [];
  assert.equal(context.findBestSqlSnapshot(), null);
  vm.runInContext(contentSource, context);
  assert.equal(context.collectDomSqlSnapshot(), null);
});

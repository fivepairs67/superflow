import type {
  AnalysisRange,
  AnalysisStatement,
  GraphColumn,
  GraphNode,
  QueryGraph,
} from "../../../shared/types";

export interface StatementDisplayGroup {
  id: string;
  primaryIndex: number;
  statementIndexes: number[];
  shortLabel: string;
  title: string;
  statements: AnalysisStatement[];
  kind: "single" | "directive" | "rebuild";
  targetName?: string | null;
}

export function isDirectiveStatementType(statementType: string | undefined) {
  const normalized = String(statementType || "").trim().toUpperCase();
  return normalized === "SET" || normalized === "USE" || normalized === "CONFIG";
}

export function isDirectiveStatement(statement: AnalysisStatement | null | undefined) {
  return isDirectiveStatementType(statement?.statementType);
}

export function buildStatementDisplayGroups(statements: AnalysisStatement[] = []) {
  const groups: StatementDisplayGroup[] = [];

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];

    if (isDirectiveStatement(statement)) {
      const group = [statement];
      let nextIndex = index + 1;

      while (nextIndex < statements.length && isDirectiveStatement(statements[nextIndex])) {
        group.push(statements[nextIndex]);
        nextIndex += 1;
      }

      if (group.length === 1) {
        groups.push({
          id: statement.id,
          primaryIndex: statement.index,
          statementIndexes: [statement.index],
          shortLabel: `#${statement.index + 1}`,
          title: statement.title || `Statement ${statement.index + 1}`,
          statements: group,
          kind: "single",
        });
      } else {
        const first = group[0];
        const last = group[group.length - 1];
        groups.push({
          id: `statement-group:${first.index}-${last.index}`,
          primaryIndex: first.index,
          statementIndexes: group.map((entry) => entry.index),
          shortLabel: `#${first.index + 1}-${last.index + 1}`,
          title: buildDirectiveGroupTitle(group),
          statements: group,
          kind: "directive",
        });
      }

      index = nextIndex - 1;
      continue;
    }

    const nextStatement = statements[index + 1];
    const rebuildTarget = resolveRebuildTarget(statement, nextStatement);

    if (rebuildTarget) {
      groups.push({
        id: `statement-group:${statement.index}-${nextStatement.index}`,
        primaryIndex: statement.index,
        statementIndexes: [statement.index, nextStatement.index],
        shortLabel: `#${statement.index + 1}-${nextStatement.index + 1}`,
        title: buildRebuildGroupTitle(statement, nextStatement, rebuildTarget),
        statements: [statement, nextStatement],
        kind: "rebuild",
        targetName: rebuildTarget,
      });
      index += 1;
      continue;
    }

    groups.push({
      id: statement.id,
      primaryIndex: statement.index,
      statementIndexes: [statement.index],
      shortLabel: `#${statement.index + 1}`,
      title: statement.title || `Statement ${statement.index + 1}`,
      statements: [statement],
      kind: "single",
    });
  }

  return groups;
}

export function findStatementDisplayGroup(
  statements: AnalysisStatement[] = [],
  statementIndex: number | null | undefined,
) {
  if (typeof statementIndex !== "number") {
    return null;
  }

  return (
    buildStatementDisplayGroups(statements).find((group) =>
      group.statementIndexes.includes(statementIndex),
    ) || null
  );
}

export function buildDirectiveGroupTitle(group: AnalysisStatement[]) {
  const directiveCount = group.length;
  const firstIndex = group[0]?.index ?? 0;
  const lastIndex = group[group.length - 1]?.index ?? firstIndex;
  const statementTypes = Array.from(
    new Set(group.map((statement) => String(statement.statementType || "").toUpperCase()).filter(Boolean)),
  );

  if (statementTypes.length === 1 && statementTypes[0] === "SET") {
    return `#${firstIndex + 1}-${lastIndex + 1} SET block`;
  }

  return `#${firstIndex + 1}-${lastIndex + 1} Prelude config (${directiveCount})`;
}

export function buildDirectiveGroupStatement(
  group: StatementDisplayGroup,
  fullSql: string | undefined,
): AnalysisStatement {
  const { rangeStart, rangeEnd, sql } = resolveGroupedSql(group, fullSql);
  const nodeLabel = buildDirectiveGroupNodeLabel(group.statements);
  const directiveTitles = group.statements.map((statement) =>
    stripStatementOrdinal(statement.title || statement.statementType || "directive"),
  );

  return {
    id: group.id,
    index: group.primaryIndex,
    title: group.title,
    sql,
    sqlPreview: createSqlPreview(sql),
    rangeStart,
    rangeEnd,
    mode: "heuristic",
    parserDialect: null,
    parserEngine: null,
    parserAttempts: [],
    parserErrorMessage: null,
    normalizedSql: sql,
    statementType: "CONFIG",
    summary: {
      cteCount: 0,
      sourceCount: 0,
      joinCount: 0,
      clauseCount: 0,
      templateCount: group.statements.reduce(
        (count, statement) => count + Number(statement.summary?.templateCount || 0),
        0,
      ),
      statementType: "CONFIG",
    },
    clauses: {
      distinct: false,
      join: false,
      mergeOn: false,
      matched: false,
      notMatched: false,
      set: false,
      values: false,
      conflict: false,
      conflictAction: false,
      returning: false,
      where: false,
      groupBy: false,
      having: false,
      window: false,
      qualify: false,
      union: false,
      orderBy: false,
      limit: false,
      offset: false,
    },
    graph: {
      nodes: [
        {
          id: "directive:group",
          type: "directive",
          label: nodeLabel,
          meta: {
            directiveGroup: true,
            directiveCount: group.statements.length,
            directiveTitles,
            rangeStart: 0,
            rangeEnd: sql.length,
            ranges: [{ start: 0, end: sql.length }],
          },
        },
      ],
      edges: [],
      columns: [],
    },
    flowSequence: ["CONFIG"],
    ctes: [],
    sources: [],
    reads: [],
    writes: [],
    dependencies: [],
    dependents: [],
  };
}

export function buildStatementGroupStatement(
  group: StatementDisplayGroup,
  fullSql: string | undefined,
) {
  if (group.kind === "directive") {
    return buildDirectiveGroupStatement(group, fullSql);
  }

  if (group.kind === "rebuild") {
    return buildRebuildGroupStatement(group, fullSql);
  }

  return group.statements[0] || null;
}

function buildDirectiveGroupNodeLabel(group: AnalysisStatement[]) {
  const statementTypes = Array.from(
    new Set(group.map((statement) => String(statement.statementType || "").toUpperCase()).filter(Boolean)),
  );

  if (statementTypes.length === 1 && statementTypes[0] === "SET") {
    return "SET BLOCK";
  }

  return "PRELUDE CONFIG";
}

function stripStatementOrdinal(value: string) {
  return String(value || "").replace(/^#\d+(?:-\d+)?\s+/i, "").trim();
}

function resolveGroupedSql(group: StatementDisplayGroup, fullSql: string | undefined) {
  const first = group.statements[0];
  const last = group.statements[group.statements.length - 1];
  const rangeStart = typeof first?.rangeStart === "number" ? first.rangeStart : 0;
  const rangeEnd =
    typeof last?.rangeEnd === "number"
      ? last.rangeEnd
      : typeof first?.rangeEnd === "number"
        ? first.rangeEnd
        : rangeStart;
  const sql =
    typeof fullSql === "string" &&
    rangeEnd >= rangeStart &&
    rangeStart >= 0 &&
    rangeEnd <= fullSql.length
      ? fullSql.slice(rangeStart, rangeEnd)
      : group.statements
          .map((statement) => statement.sql || statement.normalizedSql || "")
          .filter(Boolean)
          .join("\n");

  return { rangeStart, rangeEnd, sql };
}

function buildRebuildGroupStatement(
  group: StatementDisplayGroup,
  fullSql: string | undefined,
): AnalysisStatement {
  const createStatement = group.statements[group.statements.length - 1];
  const { rangeStart, rangeEnd, sql } = resolveGroupedSql(group, fullSql);
  const createRangeStart =
    typeof createStatement?.rangeStart === "number" ? createStatement.rangeStart : rangeStart;
  const shiftDelta = createRangeStart - rangeStart;

  return {
    ...createStatement,
    id: group.id,
    index: group.primaryIndex,
    title: group.title,
    sql,
    sqlPreview: createSqlPreview(sql),
    rangeStart,
    rangeEnd,
    normalizedSql: sql,
    graph: shiftQueryGraph(createStatement.graph || null, shiftDelta),
    sources: shiftAnalysisSources(createStatement.sources || [], shiftDelta),
    reads: shiftAnalysisSources(createStatement.reads || [], shiftDelta),
    ctes: shiftStatementCtes(createStatement.ctes || [], shiftDelta),
  };
}

function resolveRebuildTarget(
  dropStatement: AnalysisStatement | undefined,
  createStatement: AnalysisStatement | undefined,
) {
  if (!dropStatement || !createStatement) {
    return null;
  }

  const dropTarget = extractDropTargetName(dropStatement.sql || dropStatement.normalizedSql || "");
  const createTarget = extractCreateTargetName(
    createStatement.sql || createStatement.normalizedSql || "",
  );

  if (!dropTarget || !createTarget) {
    return null;
  }

  return normalizeIdentifier(dropTarget) === normalizeIdentifier(createTarget)
    ? createTarget
    : null;
}

function extractDropTargetName(sql: string) {
  const match = stripLeadingComments(sql)
    .trim()
    .match(/^drop\s+table\s+(?:if\s+exists\s+)?([\s\S]+?)\s*;?\s*$/i);

  return match?.[1] ? stripIdentifierDecorators(match[1]) : null;
}

function extractCreateTargetName(sql: string) {
  const match = stripLeadingComments(sql)
    .trim()
    .match(
      /^create\s+(?:or\s+replace\s+)?(?:temporary\s+|temp\s+)?(?:external\s+)?table\s+(?:if\s+not\s+exists\s+)?([\s\S]+?)(?=\s+as\b|\s*\(|\s+comment\b|\s+partitioned\b|\s+stored\b|\s+location\b|\s+tblproperties\b|;|$)/i,
    );

  return match?.[1] ? stripIdentifierDecorators(match[1]) : null;
}

function buildRebuildGroupTitle(
  dropStatement: AnalysisStatement,
  createStatement: AnalysisStatement,
  targetName: string,
) {
  return `#${dropStatement.index + 1}-${createStatement.index + 1} REBUILD ${targetName}`;
}

function stripIdentifierDecorators(value: string) {
  return String(value || "").replace(/[;]+$/g, "").trim();
}

function normalizeIdentifier(value: string) {
  return stripIdentifierDecorators(value)
    .replace(/[`"\[\]]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function stripLeadingComments(sql: string) {
  let remaining = String(sql || "");
  let changed = true;

  while (changed) {
    changed = false;
    const trimmedLeading = remaining.match(/^\s*/)?.[0] || "";

    if (trimmedLeading) {
      remaining = remaining.slice(trimmedLeading.length);
      changed = true;
    }

    if (remaining.startsWith("--")) {
      const lineEnd = remaining.indexOf("\n");
      remaining = lineEnd >= 0 ? remaining.slice(lineEnd + 1) : "";
      changed = true;
      continue;
    }

    if (remaining.startsWith("/*")) {
      const blockEnd = remaining.indexOf("*/");
      remaining = blockEnd >= 0 ? remaining.slice(blockEnd + 2) : "";
      changed = true;
    }
  }

  return remaining;
}

function createSqlPreview(sql: string) {
  const normalized = String(sql || "").trim();

  if (!normalized) {
    return "";
  }

  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function shiftQueryGraph(graph: QueryGraph | null | undefined, delta: number): QueryGraph | null {
  if (!graph) {
    return null;
  }

  if (!delta) {
    return graph;
  }

  return {
    ...graph,
    nodes: (graph.nodes || []).map((node) => shiftGraphNode(node, delta)),
    columns: (graph.columns || []).map((column) => shiftGraphColumn(column, delta)),
  };
}

function shiftGraphNode(node: GraphNode, delta: number): GraphNode {
  const meta = node.meta || {};
  const nextMeta: Record<string, unknown> = { ...meta };

  if (typeof meta.rangeStart === "number") {
    nextMeta.rangeStart = meta.rangeStart + delta;
  }

  if (typeof meta.rangeEnd === "number") {
    nextMeta.rangeEnd = meta.rangeEnd + delta;
  }

  if (Array.isArray(meta.ranges)) {
    nextMeta.ranges = shiftRanges(meta.ranges as AnalysisRange[], delta);
  }

  return {
    ...node,
    meta: nextMeta,
  };
}

function shiftGraphColumn(column: GraphColumn, delta: number): GraphColumn {
  return {
    ...column,
    spans: Array.isArray(column.spans) ? shiftRanges(column.spans, delta) : column.spans,
  };
}

function shiftAnalysisSources<T extends { rangeStart?: number; rangeEnd?: number; ranges?: AnalysisRange[] }>(
  sources: T[],
  delta: number,
) {
  if (!delta) {
    return sources;
  }

  return (sources || []).map((source) => ({
    ...source,
    rangeStart:
      typeof source.rangeStart === "number" ? source.rangeStart + delta : source.rangeStart,
    rangeEnd: typeof source.rangeEnd === "number" ? source.rangeEnd + delta : source.rangeEnd,
    ranges: Array.isArray(source.ranges) ? shiftRanges(source.ranges, delta) : source.ranges,
  }));
}

function shiftStatementCtes(ctes: AnalysisStatement["ctes"], delta: number) {
  if (!delta) {
    return ctes;
  }

  return (ctes || []).map((cte) => ({
    ...cte,
    rangeStart: typeof cte.rangeStart === "number" ? cte.rangeStart + delta : cte.rangeStart,
    rangeEnd: typeof cte.rangeEnd === "number" ? cte.rangeEnd + delta : cte.rangeEnd,
    bodyRangeStart:
      typeof cte.bodyRangeStart === "number" ? cte.bodyRangeStart + delta : cte.bodyRangeStart,
    bodyRangeEnd:
      typeof cte.bodyRangeEnd === "number" ? cte.bodyRangeEnd + delta : cte.bodyRangeEnd,
    columns: Array.isArray(cte.columns)
      ? cte.columns.map((column) => shiftGraphColumn(column, delta))
      : cte.columns,
  }));
}

function shiftRanges(ranges: AnalysisRange[], delta: number) {
  return (ranges || []).map((range) => ({
    start: range.start + delta,
    end: range.end + delta,
  }));
}

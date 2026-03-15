import { HiveSQL, TrinoSQL } from "./vendor/dt-sql-parser-shim.js";
import nodeSqlParser from "node-sql-parser";

const CLAUSE_ORDER = [
  { key: "join", label: "JOIN" },
  { key: "mergeOn", label: "MATCH ON" },
  { key: "matched", label: "WHEN MATCHED" },
  { key: "notMatched", label: "WHEN NOT MATCHED" },
  { key: "set", label: "SET" },
  { key: "values", label: "VALUES" },
  { key: "conflict", label: "ON CONFLICT" },
  { key: "conflictAction", label: "DO UPDATE" },
  { key: "returning", label: "RETURNING" },
  { key: "where", label: "FILTER" },
  { key: "groupBy", label: "GROUP BY" },
  { key: "having", label: "HAVING" },
  { key: "window", label: "WINDOW" },
  { key: "qualify", label: "QUALIFY" },
  { key: "distinct", label: "DISTINCT" },
  { key: "union", label: "UNION" },
  { key: "orderBy", label: "ORDER BY" },
  { key: "limit", label: "LIMIT" },
  { key: "offset", label: "OFFSET" },
];

const MAX_SQL_PREVIEW_LENGTH = 260;
const { Parser } = nodeSqlParser;
const AST_PARSER = new Parser();
const DT_SQL_PARSERS = {
  hive: new HiveSQL(),
  trino: new TrinoSQL(),
};
const IDENTIFIER_PART_PATTERN = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[a-zA-Z0-9_-]+)';
const QUALIFIED_IDENTIFIER_PATTERN = `${IDENTIFIER_PART_PATTERN}(?:\\.${IDENTIFIER_PART_PATTERN})*`;
const DIALECT_PREFERENCE_VALUES = new Set(["auto", "postgresql", "hive", "trino", "oracle"]);
const HEURISTIC_ALIAS_STOP_WORDS = new Set([
  "on",
  "where",
  "group",
  "order",
  "having",
  "limit",
  "offset",
  "qualify",
  "union",
  "intersect",
  "except",
  "window",
  "join",
  "left",
  "right",
  "inner",
  "full",
  "cross",
  "when",
  "then",
  "using",
]);
const HEURISTIC_COLUMN_STOP_WORDS = new Set([
  "select",
  "from",
  "where",
  "group",
  "by",
  "having",
  "order",
  "limit",
  "offset",
  "qualify",
  "over",
  "partition",
  "asc",
  "desc",
  "and",
  "or",
  "not",
  "null",
  "as",
  "case",
  "when",
  "then",
  "else",
  "end",
  "distinct",
  "cast",
  "true",
  "false",
]);

export function analyzeSql(rawSql, options = {}) {
  const normalizedSql = normalizeSql(rawSql);
  const dialectPreference = normalizeDialectPreference(options?.dialectPreference);

  if (!normalizedSql) {
    return emptyAnalysis(dialectPreference);
  }

  const preprocessed = preprocessSql(normalizedSql);
  const dialectContext = buildDialectContext(preprocessed.sql || normalizedSql, dialectPreference);
  const statementParts = splitStatementsDetailed(normalizedSql);

  if (!statementParts.length) {
    return emptyAnalysis(dialectPreference);
  }

  const statements = statementParts.map((statementPart, index) =>
    analyzeStatement(statementPart, index, dialectContext),
  );
  const scriptDependencies = buildScriptDependencies(statements);
  const activeStatementIndex = pickActiveStatementIndex(statements, scriptDependencies);
  const activeStatement = statements[activeStatementIndex] || emptyStatement(0, normalizedSql);
  const analysisMode = buildAnalysisMode(statements);
  const activeParserStatement = statements[activeStatementIndex] || null;

  return {
    mode: analysisMode,
    isPartial: analysisMode !== "ast" && analysisMode !== "ast-script",
    generatedAt: Date.now(),
    dialectPreference,
    detectedDialect: dialectContext.detectedDialect,
    parserDialect: activeParserStatement?.parserDialect || null,
    parserEngine: activeParserStatement?.parserEngine || null,
    parserAttempts: activeParserStatement?.parserAttempts || [],
    parserErrorMessage: activeParserStatement?.parserErrorMessage || null,
    dialectConfidence: dialectContext.confidence,
    dialectSignals: dialectContext.signals,
    normalizedSql,
    preprocessedSql: preprocessed.sql,
    templates: preprocessed.templates,
    templateCount: preprocessed.templates.length,
    isMultiStatement: statements.length > 1,
    activeStatementIndex,
    statements,
    scriptDependencies,
    scriptSummary: summarizeScript(statements, scriptDependencies),
    statementType: activeStatement.statementType,
    clauses: activeStatement.clauses,
    flowSequence: activeStatement.flowSequence,
    graph: activeStatement.graph,
    ctes: activeStatement.ctes,
    sources: activeStatement.sources,
    reads: activeStatement.reads,
    writes: activeStatement.writes,
    summary: activeStatement.summary,
    errorMessage: activeStatement.errorMessage,
  };
}

function normalizeDialectPreference(value) {
  const normalized = String(value || "auto").toLowerCase();
  return DIALECT_PREFERENCE_VALUES.has(normalized) ? normalized : "auto";
}

function normalizeDetectedDialect(preference) {
  switch (preference) {
    case "postgresql":
      return "postgresql";
    case "hive":
      return "hive";
    case "trino":
      return "trino-like";
    case "oracle":
      return "oracle-like";
    default:
      return "generic";
  }
}

function buildDialectContext(sql, dialectPreference) {
  if (dialectPreference !== "auto") {
    return {
      preference: dialectPreference,
      detectedDialect: normalizeDetectedDialect(dialectPreference),
      confidence: 1,
      signals: [`manual:${dialectPreference}`],
      parserCandidates: parserCandidatesForPreference(dialectPreference),
    };
  }

  const inference = inferDialectFromSql(sql);
  return {
    preference: "auto",
    detectedDialect: inference.detectedDialect,
    confidence: inference.confidence,
    signals: inference.signals,
    parserCandidates: parserCandidatesForDetected(inference.detectedDialect),
  };
}

function inferDialectFromSql(sql) {
  const input = normalizeSql(sql).toLowerCase();
  const score = {
    postgresql: 0,
    hive: 0,
    "trino-like": 0,
    "oracle-like": 0,
  };
  const signals = [];

  addDialectSignals(input, score, signals, "postgresql", [
    { regex: /::\s*[a-z_][a-z0-9_]*/g, weight: 4, label: "cast-operator" },
    { regex: /\bilike\b/g, weight: 4, label: "ilike" },
    { regex: /\bto_char\s*\(/g, weight: 3, label: "to_char" },
    { regex: /\bdistinct\s+on\b/g, weight: 4, label: "distinct-on" },
    { regex: /\breturning\b/g, weight: 3, label: "returning" },
  ]);
  addDialectSignals(input, score, signals, "hive", [
    { regex: /\blateral\s+view\b/g, weight: 5, label: "lateral-view" },
    { regex: /\bexplode\s*\(/g, weight: 4, label: "explode" },
    { regex: /\bposexplode\s*\(/g, weight: 4, label: "posexplode" },
    { regex: /\bcollect_set\s*\(/g, weight: 4, label: "collect_set" },
    { regex: /\bfrom_unixtime\s*\(/g, weight: 4, label: "from_unixtime" },
    { regex: /\bcluster\s+by\b/g, weight: 4, label: "cluster-by" },
    { regex: /`[^`]+`/g, weight: 2, label: "backtick-ident" },
  ]);
  addDialectSignals(input, score, signals, "trino-like", [
    { regex: /\bcount_if\s*\(/g, weight: 5, label: "count_if" },
    { regex: /\bapprox_percentile\s*\(/g, weight: 5, label: "approx_percentile" },
    { regex: /\btry_cast\s*\(/g, weight: 5, label: "try_cast" },
    { regex: /\bunnest\s*\(/g, weight: 4, label: "unnest" },
    { regex: /\bdate_add\s*\(\s*'/g, weight: 4, label: "date_add" },
    { regex: /\bdate_diff\s*\(\s*'/g, weight: 4, label: "date_diff" },
    { regex: /\bregexp_like\s*\(/g, weight: 4, label: "regexp_like" },
    { regex: /\bat\s+time\s+zone\b/g, weight: 3, label: "at-time-zone" },
  ]);
  addDialectSignals(input, score, signals, "oracle-like", [
    { regex: /\bdecode\s*\(/g, weight: 5, label: "decode" },
    { regex: /\bnvl\s*\(/g, weight: 5, label: "nvl" },
    { regex: /\bconnect\s+by\b/g, weight: 6, label: "connect-by" },
    { regex: /\bstart\s+with\b/g, weight: 4, label: "start-with" },
    { regex: /\brownum\b/g, weight: 5, label: "rownum" },
    { regex: /\bdual\b/g, weight: 4, label: "dual" },
    { regex: /\bvarchar2\b/g, weight: 4, label: "varchar2" },
    { regex: /\bnumber\s*\(/g, weight: 3, label: "number-type" },
    { regex: /\bsysdate\b/g, weight: 5, label: "sysdate" },
  ]);

  const ranked = Object.entries(score).sort((left, right) => right[1] - left[1]);
  const [topDialect, topScore] = ranked[0] || ["generic", 0];
  const secondScore = ranked[1]?.[1] || 0;
  const total = ranked.reduce((sum, [, value]) => sum + value, 0);

  if (!topScore) {
    return {
      detectedDialect: "generic",
      confidence: 0.18,
      signals: [],
    };
  }

  return {
    detectedDialect: topDialect,
    confidence: Number(
      Math.max(0.32, Math.min(0.99, (topScore + Math.max(topScore - secondScore, 0)) / Math.max(total, 1))).toFixed(2),
    ),
    signals: signals.filter((signal) => signal.startsWith(`${topDialect}:`)).slice(0, 6),
  };
}

function addDialectSignals(input, score, signals, dialect, rules) {
  for (const rule of rules) {
    if (rule.regex.test(input)) {
      score[dialect] += rule.weight;
      signals.push(`${dialect}:${rule.label}`);
    }
  }
}

function parserCandidatesForPreference(preference) {
  switch (preference) {
    case "postgresql":
      return ["postgresql"];
    case "hive":
      return ["hive", "trino", "postgresql"];
    case "trino":
      return ["trino", "hive", "postgresql"];
    case "oracle":
      return ["postgresql", "hive"];
    default:
      return ["postgresql", "hive"];
  }
}

function parserCandidatesForDetected(detectedDialect) {
  switch (detectedDialect) {
    case "hive":
      return ["hive", "trino", "postgresql"];
    case "trino-like":
      return ["hive", "trino", "postgresql"];
    case "oracle-like":
      return ["postgresql", "hive"];
    case "postgresql":
      return ["postgresql", "hive"];
    default:
      return ["postgresql", "hive"];
  }
}

function toParserDatabaseName(parserDialect) {
  if (parserDialect === "hive") {
    return "Hive";
  }

  return "postgresql";
}

function emptyAnalysis(dialectPreference = "auto") {
  return {
    mode: "heuristic",
    isPartial: true,
    generatedAt: Date.now(),
    dialectPreference,
    detectedDialect: dialectPreference === "auto" ? "generic" : normalizeDetectedDialect(dialectPreference),
    parserDialect: null,
    parserEngine: null,
    parserAttempts: [],
    parserErrorMessage: null,
    dialectConfidence: dialectPreference === "auto" ? 0 : 1,
    dialectSignals: [],
    normalizedSql: "",
    preprocessedSql: "",
    templates: [],
    templateCount: 0,
    isMultiStatement: false,
    activeStatementIndex: 0,
    statementType: "unknown",
    clauses: emptyClauses(),
    flowSequence: [],
    graph: {
      nodes: [],
      edges: [],
      columns: [],
    },
    ctes: [],
    sources: [],
    reads: [],
    writes: [],
    statements: [],
    scriptDependencies: [],
    scriptSummary: {
      statementCount: 0,
      dependencyCount: 0,
      linkedStatementCount: 0,
      independentStatementCount: 0,
    },
    summary: {
      cteCount: 0,
      sourceCount: 0,
      joinCount: 0,
      clauseCount: 0,
      templateCount: 0,
      statementType: "unknown",
    },
  };
}

function emptyStatement(index, sql) {
  return {
    id: `statement:${index}`,
    index,
    title: `Statement ${index + 1}`,
    sql,
    sqlPreview: createSqlPreview(sql),
    rangeStart: 0,
    rangeEnd: sql.length,
    mode: "heuristic",
    normalizedSql: normalizeSql(sql),
    parserDialect: null,
    parserEngine: null,
    parserAttempts: [],
    parserErrorMessage: null,
    statementType: "UNKNOWN",
    clauses: emptyClauses(),
    flowSequence: [],
    graph: {
      nodes: [],
      edges: [],
      columns: [],
    },
    ctes: [],
    sources: [],
    reads: [],
    writes: [],
    dependencies: [],
    dependents: [],
    summary: {
      cteCount: 0,
      sourceCount: 0,
      joinCount: 0,
      clauseCount: 0,
      templateCount: 0,
      statementType: "UNKNOWN",
    },
  };
}

function analyzeStatement(statementInput, index, dialectContext) {
  const rawSql =
    typeof statementInput === "string" ? statementInput : normalizeSql(statementInput?.sql || "");
  const sql = normalizeSql(rawSql);
  const preprocessed = preprocessSql(sql);
  const analysisSql = preprocessed.sql || sql;
  const structuralSql = maskCommentsPreserveOffsets(sql);
  const scopeInfo = extractCtes(structuralSql);

  if (!sql) {
    return emptyStatement(index, rawSql);
  }

  const parseState = parseStatementAst(analysisSql, dialectContext);
  const astInfo = parseState.astInfo;
  const rootStatementType = astInfo?.rootStatementType || detectRootStatementType(analysisSql);
  const logicalSql = extractLogicalBodySql(structuralSql, rootStatementType);
  const logicalScopeInfo = extractCtes(logicalSql);
  const cteInfo = astInfo
    ? {
        ctes: mergeCteRanges(astInfo.ctes || [], scopeInfo.ctes?.length ? scopeInfo.ctes : logicalScopeInfo.ctes || []),
        mainStatement: logicalScopeInfo.mainStatement || logicalSql,
        mainStatementStart: logicalScopeInfo.mainStatementStart ?? scopeInfo.mainStatementStart ?? 0,
      }
    : logicalScopeInfo;
  const cteNames = cteInfo.ctes.map((cte) => cte.name);
  const logicalStatementType =
    astInfo?.logicalStatementType || detectStatementType(cteInfo.mainStatement || logicalSql);
  const scopedCtesForHeuristic =
    (scopeInfo.ctes?.length ? scopeInfo.ctes : logicalScopeInfo.ctes) || [];
  const heuristicCtes = analyzeHeuristicCtes(scopedCtesForHeuristic, cteNames);
  const heuristicStatementSources = extractSources(
    cteInfo.mainStatement || logicalSql,
    cteInfo.mainStatementStart ?? scopeInfo.mainStatementStart ?? 0,
  );
  const statementSources = astInfo
    ? mergeSourcesWithRanges(astInfo.statementSources || [], heuristicStatementSources)
    : heuristicStatementSources;
  const heuristicJoinTypes = extractJoinTypes(cteInfo.mainStatement || logicalSql);
  const statementJoins = astInfo
    ? Array.from(new Set([...(astInfo.statementJoins || []), ...heuristicJoinTypes]))
    : heuristicJoinTypes;
  const clauses =
    astInfo?.clauses || detectClauses(cteInfo.mainStatement || logicalSql, statementJoins);
  const ctes = astInfo ? mergeCteAnalysis(cteInfo.ctes, heuristicCtes) : heuristicCtes;
  const hydratedCtes = hydrateColumnSpansForCtes(ctes);
  const heuristicReads = extractExternalReads(statementSources, hydratedCtes, cteNames);
  const reads =
    astInfo?.reads?.length
      ? mergeSourcesWithRanges(astInfo.reads || [], heuristicReads)
      : heuristicReads;
  const sources = reads;
  const writes = astInfo?.writes?.length ? astInfo.writes : extractWrites(analysisSql);
  const statementColumns = applyColumnSpansToColumns(
    astInfo?.statementColumns || [],
    cteInfo.mainStatement || logicalSql,
    cteInfo.mainStatementStart ?? scopeInfo.mainStatementStart ?? 0,
  );
  const graph = buildGraph({
    statementType: logicalStatementType || rootStatementType,
    ctes: hydratedCtes,
    statementSources,
    statementColumns,
    statementSubqueries: astInfo?.statementSubqueries || [],
    writes,
    clauses,
    joinTypes: statementJoins,
    groupByKind: astInfo?.groupByKind || detectGroupByKind(cteInfo.mainStatement || logicalSql),
    distinctKind: astInfo?.distinctKind || detectDistinctKind(cteInfo.mainStatement || logicalSql),
    setOperatorKind:
      astInfo?.setOperatorKind || detectSetOperatorKind(cteInfo.mainStatement || logicalSql),
    valuesRowCount: astInfo?.valuesRowCount || detectValuesRowCount(cteInfo.mainStatement || logicalSql),
    conflictKind: astInfo?.conflictKind || detectConflictKind(cteInfo.mainStatement || logicalSql),
    mergeActionKinds: detectMergeActionKinds(cteInfo.mainStatement || logicalSql),
    mainStatementSql: cteInfo.mainStatement || logicalSql,
    mainStatementStart: cteInfo.mainStatementStart ?? scopeInfo.mainStatementStart ?? 0,
    statementRangeEnd: sql.length,
  });

  return {
    id: `statement:${index}`,
    index,
    title: buildStatementTitle(index, rootStatementType, hydratedCtes, writes),
    sql,
    sqlPreview: createSqlPreview(sql),
    rangeStart: typeof statementInput?.rangeStart === "number" ? statementInput.rangeStart : 0,
    rangeEnd:
      typeof statementInput?.rangeEnd === "number" ? statementInput.rangeEnd : sql.length,
    mode: astInfo ? "ast" : "heuristic",
    parserDialect: parseState.parserDialect,
    parserEngine: parseState.parserEngine,
    parserAttempts: parseState.parserAttempts,
    parserErrorMessage: parseState.parserErrorMessage,
    normalizedSql: sql,
    statementType: rootStatementType,
    logicalStatementType,
    clauses,
    joins: statementJoins,
    flowSequence: buildFlowSequence(
      logicalStatementType || rootStatementType,
      clauses,
      writes,
      astInfo?.groupByKind || detectGroupByKind(cteInfo.mainStatement || logicalSql),
      astInfo?.setOperatorKind || detectSetOperatorKind(cteInfo.mainStatement || logicalSql),
      astInfo?.conflictKind || detectConflictKind(cteInfo.mainStatement || logicalSql),
    ),
    graph,
    ctes: hydratedCtes,
    sources,
    reads,
    writes,
    dependencies: [],
    dependents: [],
    summary: {
      cteCount: hydratedCtes.length,
      sourceCount: sources.length,
      joinCount: statementJoins.length,
      clauseCount: Object.values(clauses).filter(Boolean).length,
      templateCount: 0,
      statementType: rootStatementType,
    },
  };
}

function buildAnalysisMode(statements) {
  const modes = Array.from(new Set(statements.map((statement) => statement.mode).filter(Boolean)));

  if (!modes.length) {
    return "heuristic";
  }

  if (modes.length === 1) {
    return statements.length > 1 ? `${modes[0]}-script` : modes[0];
  }

  return statements.length > 1 ? "mixed-script" : "mixed";
}

function summarizeScript(statements, dependencies) {
  const linkedIndexes = new Set();

  for (const edge of dependencies) {
    linkedIndexes.add(edge.sourceIndex);
    linkedIndexes.add(edge.targetIndex);
  }

  return {
    statementCount: statements.length,
    dependencyCount: dependencies.length,
    linkedStatementCount: linkedIndexes.size,
    independentStatementCount: Math.max(statements.length - linkedIndexes.size, 0),
  };
}

function buildScriptDependencies(statements) {
  const latestWriterByObject = new Map();
  const dependencies = [];

  for (const statement of statements) {
    const dependencyMap = new Map();

    for (const read of statement.reads || []) {
      const key = normalizeName(read.name);
      const writerIndex = latestWriterByObject.get(key);

      if (typeof writerIndex !== "number" || writerIndex >= statement.index) {
        continue;
      }

      if (!dependencyMap.has(writerIndex)) {
        dependencyMap.set(writerIndex, new Set());
      }

      dependencyMap.get(writerIndex).add(read.name);
    }

    statement.dependencies = Array.from(dependencyMap.keys()).sort((left, right) => left - right);

    for (const [sourceIndex, viaSet] of dependencyMap.entries()) {
      dependencies.push({
        id: `script:${sourceIndex}->${statement.index}`,
        sourceIndex,
        targetIndex: statement.index,
        via: Array.from(viaSet).sort(),
        type: "depends_on",
      });
    }

    for (const write of statement.writes || []) {
      latestWriterByObject.set(normalizeName(write.name), statement.index);
    }
  }

  const dependentsByIndex = new Map();

  for (const edge of dependencies) {
    if (!dependentsByIndex.has(edge.sourceIndex)) {
      dependentsByIndex.set(edge.sourceIndex, []);
    }

    dependentsByIndex.get(edge.sourceIndex).push(edge.targetIndex);
  }

  for (const statement of statements) {
    statement.dependents = (dependentsByIndex.get(statement.index) || []).sort(
      (left, right) => left - right,
    );
  }

  return dependencies;
}

function pickActiveStatementIndex(statements, dependencies) {
  if (!statements.length) {
    return 0;
  }

  if (dependencies.length) {
    const dependentTargets = new Set(dependencies.map((edge) => edge.targetIndex));
    const writerSources = new Set(dependencies.map((edge) => edge.sourceIndex));
    const terminal = statements
      .map((statement) => statement.index)
      .filter((index) => dependentTargets.has(index) && !writerSources.has(index));

    if (terminal.length) {
      return terminal[terminal.length - 1];
    }
  }

  return statements[statements.length - 1].index;
}

function parseStatementAst(sql, dialectContext) {
  const parserCandidates = dialectContext?.parserCandidates?.length
    ? dialectContext.parserCandidates
    : ["postgresql", "hive"];
  const parserAttempts = [];

  for (const parserDialect of parserCandidates) {
    const parserState = tryParserCandidate(sql, parserDialect);

    if (parserState.ok) {
      return {
        astInfo: parserState.astInfo,
        parserDialect: parserState.parserDialect,
        parserEngine: parserState.parserEngine,
        parserAttempts,
        parserErrorMessage: null,
      };
    }

    if (parserState.error) {
      parserAttempts.push(parserState.error);
    }
  }

  return {
    astInfo: null,
    parserDialect: null,
    parserEngine: null,
    parserAttempts,
    parserErrorMessage: parserAttempts[0] || null,
  };
}

function tryParserCandidate(sql, parserDialect) {
  if (parserDialect === "trino") {
    return tryDtParserCandidate(sql, "trino");
  }

  const nodeResult = tryNodeParserCandidate(sql, parserDialect);

  if (nodeResult.ok || parserDialect !== "hive") {
    return nodeResult;
  }

  const dtResult = tryDtParserCandidate(sql, "hive");

  if (dtResult.ok) {
    return dtResult;
  }

  const errorParts = [nodeResult.error, dtResult.error].filter(Boolean);
  return {
    ok: false,
    error: errorParts.join(" | "),
  };
}

function tryNodeParserCandidate(sql, parserDialect) {
  try {
    const parserSql = prepareSqlForParser(sql, parserDialect);
    const parsed = AST_PARSER.astify(parserSql, {
      database: toParserDatabaseName(parserDialect),
    });
    const ast = Array.isArray(parsed) ? parsed[0] : parsed;

    if (!ast || typeof ast !== "object") {
      return {
        ok: false,
        error: `node:${parserDialect}: empty AST`,
      };
    }

    const logicalAst = extractLogicalAst(ast);
    const mainStatementAst = extractAstMainStatement(logicalAst);
    const scopeInfo = extractCtes(maskCommentsPreserveOffsets(sql));
    const mainStatementSql = scopeInfo.mainStatement || sql;
    const cteInfo = extractAstCtes(logicalAst);
    const ctes = cteInfo.ctes || [];
    const cteNames = ctes.map((cte) => cte.name);
    const availableColumnsBySource = cteInfo.availableColumnsBySource || new Map();
    const statementSources = extractAstImmediateSources(mainStatementAst);
    const statementReadSources = extractAstAllSources(logicalAst);
    const statementJoins = extractAstJoinTypes(mainStatementAst);
    const clauses = detectAstClauses(mainStatementAst, statementJoins, mainStatementSql);
    const distinctKind = extractAstDistinctKind(mainStatementAst);
    const reads = extractExternalReads(statementReadSources, ctes, cteNames);
    const writes = extractAstWrites(ast);
    const statementColumns = extractAstOutputColumns(
      mainStatementAst,
      "result:main",
      cteNames,
      availableColumnsBySource,
    );
    const statementSubqueries = extractAstSubqueries(mainStatementAst, "statement:main", cteNames);

    return {
      ok: true,
      parserDialect,
      parserEngine: "node",
      astInfo: {
        parserDialect,
        rootStatementType: detectAstStatementType(ast),
        logicalStatementType: detectAstStatementType(mainStatementAst),
        statementSources,
        statementJoins,
        clauses,
        distinctKind,
        groupByKind: extractAstGroupByKind(mainStatementAst, mainStatementSql),
        setOperatorKind: extractSetOperatorKind(mainStatementAst, mainStatementSql),
        valuesRowCount: extractAstValuesRowCount(mainStatementAst),
        conflictKind: extractAstConflictKind(mainStatementAst, mainStatementSql),
        ctes,
        isRecursive: Boolean(cteInfo.isRecursive),
        reads,
        writes,
        statementColumns,
        statementSubqueries,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: `node:${parserDialect}: ${sanitizeParseError(error?.message)}`,
    };
  }
}

function tryDtParserCandidate(sql, parserDialect) {
  const parser = DT_SQL_PARSERS[parserDialect];

  if (!parser) {
    return {
      ok: false,
      error: `dt:${parserDialect}: unsupported`,
    };
  }

  try {
    parser.parse(sql);
    const entities = parser.getAllEntities(sql) || [];
    const astInfo = buildDtAstInfo(sql, parserDialect, entities);

    return {
      ok: true,
      parserDialect,
      parserEngine: "dt",
      astInfo,
    };
  } catch (error) {
    return {
      ok: false,
      error: `dt:${parserDialect}: ${sanitizeParseError(error?.message)}`,
    };
  }
}

function buildDtAstInfo(sql, parserDialect, entities) {
  const structuralSql = maskCommentsPreserveOffsets(sql);
  const rootStatementType = detectRootStatementType(sql);
  const logicalSql = extractLogicalBodySql(structuralSql, rootStatementType);
  const scopeInfo = extractCtes(structuralSql);
  const logicalScopeInfo = extractCtes(logicalSql);
  const mainStatementSql = logicalScopeInfo.mainStatement || logicalSql;
  const mainStatementStart = logicalScopeInfo.mainStatementStart ?? 0;
  const cteNames = (scopeInfo.ctes || []).map((cte) => cte.name);
  const availableColumnsBySource = new Map();
  const astCtes = [];

  for (const cte of scopeInfo.ctes || []) {
    const sources = extractSources(cte.body || "", cte.bodyRangeStart ?? 0);
    const readSources = sources;
    const subqueries = extractHeuristicSubqueries(
      cte.body || "",
      `cte:${cte.name}`,
      cte.bodyRangeStart ?? 0,
    );
    const dependencies = cteNames
      .filter((name) => normalizeName(name) !== normalizeName(cte.name))
      .filter((name) => readSources.some((source) => normalizeName(source.name) === normalizeName(name)));
    const columns = extractHeuristicOutputColumns(
      cte.body || "",
      `cte:${cte.name}`,
      0,
      cteNames,
      availableColumnsBySource,
    );

    astCtes.push({
      name: cte.name,
      sourceCount: sources.length,
      dependencies,
      sources,
      readSources,
      subqueries,
      joinTypes: extractJoinTypes(cte.body || ""),
      statementType: detectStatementType(cte.body || ""),
      columns,
    });

    if (cte.name) {
      availableColumnsBySource.set(normalizeName(cte.name), getExpandableColumns(columns));
    }
  }

  const resolvedCteNames = astCtes.map((cte) => cte.name);
  const statementSources = extractSources(mainStatementSql, mainStatementStart);
  const statementReadSources = extractDtSources(entities);
  const statementJoins = extractJoinTypes(mainStatementSql);
  const clauses = detectClauses(mainStatementSql, statementJoins);
  const distinctKind = detectDistinctKind(mainStatementSql);
  const groupByKind = detectGroupByKind(mainStatementSql);
  const setOperatorKind = detectSetOperatorKind(mainStatementSql);
  const valuesRowCount = detectValuesRowCount(mainStatementSql);
  const conflictKind = detectConflictKind(mainStatementSql);
  const writes = extractDtWrites(entities);
  const reads = extractExternalReads(statementReadSources, astCtes, resolvedCteNames);

  return {
    parserDialect,
    rootStatementType,
    logicalStatementType: detectStatementType(logicalSql),
    statementSources,
    statementJoins,
    clauses,
    distinctKind,
    groupByKind,
    setOperatorKind,
    valuesRowCount,
    conflictKind,
    ctes: astCtes,
    isRecursive: Boolean(scopeInfo.isRecursive),
    reads,
    writes,
    statementColumns: extractHeuristicOutputColumns(
      mainStatementSql,
      "result:main",
      mainStatementStart,
      resolvedCteNames,
      availableColumnsBySource,
    ),
    statementSubqueries: extractHeuristicSubqueries(
      mainStatementSql,
      "statement:main",
      mainStatementStart,
    ),
  };
}

function extractDtSources(entities) {
  const sources = [];
  const seen = new Set();

  for (const entity of entities || []) {
    const type = String(entity?.entityContextType || "");

    if (type !== "table" && type !== "view") {
      continue;
    }

    const name = normalizeSql(entity?.text || "");

    if (!name) {
      continue;
    }

    const key = `${type}:${normalizeName(name)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    sources.push({
      name,
      type: type === "view" ? "view" : "from",
    });
  }

  return sources;
}

function extractDtWrites(entities) {
  const writes = [];
  const seen = new Set();

  for (const entity of entities || []) {
    const type = String(entity?.entityContextType || "");
    const name = normalizeSql(entity?.text || "");

    if (!name) {
      continue;
    }

    let kind = null;

    if (type === "tableCreate") {
      kind = "create_table";
    } else if (type === "viewCreate") {
      kind = "create_view";
    }

    if (!kind) {
      continue;
    }

    const key = `${kind}:${normalizeName(name)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    writes.push({
      name,
      kind,
    });
  }

  return writes;
}

function sanitizeParseError(message) {
  const normalized = String(message || "parse failed")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "parse failed";
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function prepareSqlForParser(sql, parserDialect) {
  if (parserDialect === "hive") {
    return sanitizeHiveCreateTableForParser(sql);
  }

  return sql;
}

function sanitizeHiveCreateTableForParser(sql) {
  const normalized = normalizeSql(sql);

  if (!/^\s*create\s+(?:external\s+)?table\b/i.test(normalized)) {
    return sql;
  }

  const withoutExternal = sql.replace(/^(\s*create\s+)external(\s+table\b)/i, "$1$2");
  const createTableMatch = withoutExternal.match(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?[^\s(]+/i);

  if (!createTableMatch) {
    return withoutExternal;
  }

  const openParenIndex = withoutExternal.indexOf("(", createTableMatch[0].length);

  if (openParenIndex < 0) {
    return withoutExternal;
  }

  const balanced = readBalanced(withoutExternal, openParenIndex, "(", ")");

  if (!balanced) {
    return withoutExternal;
  }

  return withoutExternal.slice(0, balanced.endIndex + 1);
}

function extractLogicalAst(ast) {
  if (!ast || typeof ast !== "object") {
    return ast;
  }

  if (ast.type === "create" && ast.query_expr) {
    return ast.query_expr;
  }

  if (ast.type === "insert" && ast.select) {
    return ast.select;
  }

  return ast;
}

function extractAstMainStatement(ast) {
  if (!ast || typeof ast !== "object" || !ast.with) {
    return ast;
  }

  const mainStatement = { ...ast };
  delete mainStatement.with;
  return mainStatement;
}

function detectAstStatementType(ast) {
  const type = String(ast?.type || "").toUpperCase();
  return type || "UNKNOWN";
}

function extractAstCtes(ast) {
  const withList = Array.isArray(ast?.with) ? ast.with : [];
  const isRecursive = Boolean(
    ast?.with?.recursive || withList.recursive || withList.some((entry) => entry?.recursive),
  );

  if (!withList.length) {
    return {
      ctes: [],
      isRecursive: false,
    };
  }

  const names = withList.map((entry) => normalizeAstIdentifier(entry?.name)).filter(Boolean);
  const availableColumnsBySource = new Map();
  const ctes = [];

  for (const entry of withList) {
    const name = normalizeAstIdentifier(entry?.name);
    const stmtAst = entry?.stmt || entry?.query_expr || null;
    const sources = extractAstImmediateSources(stmtAst);
    const readSources = extractAstAllSources(stmtAst);
    const subqueries = extractAstSubqueries(stmtAst, `cte:${name}`, names);
    const joinTypes = extractAstJoinTypes(stmtAst);
    const clauses = detectAstClauses(stmtAst, joinTypes, "");
    const dependencies = names
      .filter((candidate) => normalizeName(candidate) !== normalizeName(name))
      .filter((candidate) =>
        readSources.some((source) => normalizeName(source.name) === normalizeName(candidate)),
      );
    const columns = extractAstOutputColumns(
      stmtAst,
      `cte:${name}`,
      names,
      availableColumnsBySource,
    );

    ctes.push({
      name,
      recursive: isRecursive,
      sources,
      readSources,
      subqueries,
      sourceCount: sources.length,
      dependencies,
      joinTypes,
      statementType: detectAstStatementType(stmtAst),
      flowSequence: buildFlowSequence(
        detectAstStatementType(stmtAst),
        clauses,
        [],
        extractAstGroupByKind(stmtAst, ""),
        extractSetOperatorKind(stmtAst, ""),
        extractAstConflictKind(stmtAst, ""),
      ),
      columns,
    });

    if (name) {
      availableColumnsBySource.set(normalizeName(name), getExpandableColumns(columns));
    }
  }

  return {
    ctes,
    isRecursive,
    availableColumnsBySource,
  };
}

function extractAstImmediateSources(ast) {
  const sources = [];
  const seen = new Set();

  for (const group of extractAstSourceGroups(ast)) {
    for (const entry of group.entries) {
      const name = buildAstObjectName(entry);
      const sourceType = entry?.join ? "join" : group.defaultType;

      if (!name) {
        continue;
      }

      const key = `${normalizeName(name)}:${sourceType}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      sources.push({
        name,
        type: sourceType,
        sampleKind: extractAstSampleKind(entry),
      });
    }
  }

  return uniqueByName(sources);
}

function extractAstAllSources(ast) {
  const sources = [];
  const seen = new Set();

  collectAstSourcesDeep(ast, sources, seen);

  return uniqueByName(sources);
}

function extractAstJoinTypes(ast) {
  const joinTypes = [];
  collectAstJoinTypes(ast, joinTypes);
  return Array.from(new Set(joinTypes.filter(Boolean)));
}

function collectAstSourcesDeep(node, sources, seen) {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectAstSourcesDeep(entry, sources, seen);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  for (const group of extractAstSourceGroups(node)) {
    for (const entry of group.entries) {
      const name = buildAstObjectName(entry);
      const sourceType = entry?.join ? "join" : group.defaultType;

      if (name) {
        const key = `${normalizeName(name)}:${sourceType}`;

        if (!seen.has(key)) {
          seen.add(key);
          sources.push({
            name,
            type: sourceType,
            sampleKind: extractAstSampleKind(entry),
          });
        }
      }

      collectAstSourcesDeep(
        extractAstWrapperAst(entry?.expr || entry?.stmt || entry?.query_expr),
        sources,
        seen,
      );
    }
  }

  if (node._next) {
    collectAstSourcesDeep(node._next, sources, seen);
  }

  for (const [key, value] of Object.entries(node)) {
    if (
      key === "from" ||
      key === "db" ||
      key === "schema" ||
      key === "table" ||
      key === "as" ||
      key === "name" ||
      key === "join"
    ) {
      continue;
    }

    if (value?.ast && typeof value.ast === "object") {
      collectAstSourcesDeep(value.ast, sources, seen);
      continue;
    }

    collectAstSourcesDeep(value, sources, seen);
  }
}

function collectAstJoinTypes(node, joinTypes) {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectAstJoinTypes(entry, joinTypes);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  for (const group of extractAstSourceGroups(node)) {
    if (group.defaultType === "using" && group.entries.length) {
      joinTypes.push("USING");
    }

    for (const entry of group.entries) {
      const joinType = String(entry?.join || "").trim().toUpperCase();

      if (joinType) {
        joinTypes.push(joinType);
      }

      collectAstJoinTypes(entry?.expr || entry?.stmt || entry?.query_expr, joinTypes);
    }
  }

  if (node._next) {
    collectAstJoinTypes(node._next, joinTypes);
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "from" || key === "join") {
      continue;
    }

    collectAstJoinTypes(value, joinTypes);
  }
}

function extractAstSubqueries(ast, ownerNodeId, cteNames = []) {
  const subqueries = [];
  const seenAsts = new WeakSet();
  let nextIndex = 1;

  walkAstNode(ast, ownerNodeId);
  return subqueries;

  function walkAstNode(node, currentOwnerNodeId) {
    if (!node) {
      return;
    }

    if (Array.isArray(node)) {
      for (const entry of node) {
        walkAstNode(entry, currentOwnerNodeId);
      }
      return;
    }

    if (typeof node !== "object") {
      return;
    }

    for (const group of extractAstSourceGroups(node)) {
      for (const entry of group.entries) {
        const wrapper = entry?.expr || entry?.stmt || entry?.query_expr;

        if (wrapper?.ast && typeof wrapper.ast === "object") {
          registerSubquery(wrapper.ast, "inline_view", currentOwnerNodeId);
          continue;
        }

        walkAstNode(wrapper, currentOwnerNodeId);
      }
    }

    const columns = Array.isArray(node.columns) ? node.columns : [];

    for (const column of columns) {
      const expr = column?.expr || null;

      if (expr?.ast && typeof expr.ast === "object") {
        registerSubquery(expr.ast, "scalar_subquery", currentOwnerNodeId);
        continue;
      }

      walkExpressionNode(expr, currentOwnerNodeId, "scalar_subquery");
    }

    walkExpressionNode(node.where, currentOwnerNodeId, "scalar_subquery");
    walkExpressionNode(node.having, currentOwnerNodeId, "scalar_subquery");
    walkExpressionNode(node.groupby, currentOwnerNodeId, "scalar_subquery");
    walkExpressionNode(node.orderby, currentOwnerNodeId, "scalar_subquery");
    walkExpressionNode(node.window, currentOwnerNodeId, "scalar_subquery");

    if (node._next) {
      registerSubquery(node._next, "union_branch", currentOwnerNodeId, {
        label: buildSetBranchLabel(node.set_op),
        setOperator: String(node.set_op || "").trim().toUpperCase() || "UNION",
      });
    }
  }

  function walkExpressionNode(node, currentOwnerNodeId, fallbackKind) {
    if (!node) {
      return;
    }

    if (Array.isArray(node)) {
      for (const entry of node) {
        walkExpressionNode(entry, currentOwnerNodeId, fallbackKind);
      }
      return;
    }

    if (typeof node !== "object") {
      return;
    }

    if (node.ast && typeof node.ast === "object") {
      registerSubquery(node.ast, fallbackKind, currentOwnerNodeId);
      return;
    }

    if (node.type === "function" && normalizeAstFunctionName(node).toUpperCase() === "EXISTS") {
      const values = Array.isArray(node.args?.value) ? node.args.value : [];

      for (const value of values) {
        if (value?.ast && typeof value.ast === "object") {
          registerSubquery(value.ast, "exists_subquery", currentOwnerNodeId);
          continue;
        }

        walkExpressionNode(value, currentOwnerNodeId, "exists_subquery");
      }

      return;
    }

    if (node.type === "binary_expr" && /\bin\b/i.test(String(node.operator || ""))) {
      walkExpressionNode(node.left, currentOwnerNodeId, fallbackKind);

      const values = Array.isArray(node.right?.value) ? node.right.value : [];
      let hasSubquery = false;

      for (const value of values) {
        if (value?.ast && typeof value.ast === "object") {
          registerSubquery(value.ast, "in_subquery", currentOwnerNodeId);
          hasSubquery = true;
          continue;
        }

        walkExpressionNode(value, currentOwnerNodeId, "in_subquery");
      }

      if (!hasSubquery) {
        walkExpressionNode(node.right, currentOwnerNodeId, "in_subquery");
      }

      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "as" || key === "from" || key === "columns") {
        continue;
      }

      walkExpressionNode(value, currentOwnerNodeId, fallbackKind);
    }
  }

  function registerSubquery(subAst, kind, currentOwnerNodeId, options = {}) {
    if (!subAst || typeof subAst !== "object" || seenAsts.has(subAst)) {
      return;
    }

    seenAsts.add(subAst);

    const subqueryNodeId = `${currentOwnerNodeId}:subquery:${nextIndex}`;
    nextIndex += 1;
    const sources = extractAstImmediateSources(subAst);
    const readSources = extractAstAllSources(subAst);
    const joinTypes = extractAstJoinTypes(subAst);
    const clauses = detectAstClauses(subAst, joinTypes, "");

    subqueries.push({
      id: subqueryNodeId,
      parentNodeId: currentOwnerNodeId,
      type: kind,
      label: options.label || buildSubqueryLabel(kind),
      statementType: detectAstStatementType(subAst),
      sources,
      readSources,
      joinTypes,
      clauses,
      sourceCount: sources.length,
      setOperator: options.setOperator || null,
    });

    walkAstNode(subAst, subqueryNodeId);
  }
}

function extractHeuristicSubqueries(sql, ownerNodeId, baseOffset = 0) {
  if (!sql) {
    return [];
  }

  const subqueries = [];
  const counters = new Map();
  walkSegment(sql, ownerNodeId, baseOffset);
  return subqueries;

  function walkSegment(segmentSql, currentOwnerNodeId, currentBaseOffset) {
    const maskedSql = maskCommentsPreserveOffsets(segmentSql);
    let index = 0;
    let mode = "normal";
    let dollarTag = null;

    while (index < maskedSql.length) {
      const char = maskedSql[index];
      const next = maskedSql[index + 1];

      if (mode === "single_quote") {
        if (char === "'" && next === "'") {
          index += 2;
          continue;
        }

        if (char === "'") {
          mode = "normal";
        }

        index += 1;
        continue;
      }

      if (mode === "double_quote") {
        if (char === '"') {
          mode = "normal";
        }

        index += 1;
        continue;
      }

      if (mode === "backtick") {
        if (char === "`") {
          mode = "normal";
        }

        index += 1;
        continue;
      }

      if (mode === "bracket") {
        if (char === "]") {
          mode = "normal";
        }

        index += 1;
        continue;
      }

      if (mode === "dollar_quote") {
        if (dollarTag && maskedSql.slice(index, index + dollarTag.length) === dollarTag) {
          index += dollarTag.length;
          mode = "normal";
          dollarTag = null;
          continue;
        }

        index += 1;
        continue;
      }

      if (char === "'") {
        mode = "single_quote";
        index += 1;
        continue;
      }

      if (char === '"') {
        mode = "double_quote";
        index += 1;
        continue;
      }

      if (char === "`") {
        mode = "backtick";
        index += 1;
        continue;
      }

      if (char === "[") {
        mode = "bracket";
        index += 1;
        continue;
      }

      if (char === "$") {
        const tagMatch = /^\$[a-zA-Z0-9_]*\$/.exec(maskedSql.slice(index));

        if (tagMatch) {
          dollarTag = tagMatch[0];
          mode = "dollar_quote";
          index += dollarTag.length;
          continue;
        }
      }

      if (char !== "(") {
        index += 1;
        continue;
      }

      const balanced = readBalanced(maskedSql, index, "(", ")");
      const innerSql = balanced.content;

      if (!/^\s*(with|select)\b/i.test(innerSql)) {
        index = Math.max(index + 1, balanced.nextIndex);
        continue;
      }

      const kind = inferHeuristicSubqueryKind(maskedSql, index);
      const subqueryNodeId = nextSubqueryId(currentOwnerNodeId);
      const sources = extractSources(innerSql, currentBaseOffset + index + 1);
      const joinTypes = extractJoinTypes(innerSql);
      const clauses = detectClauses(innerSql, joinTypes);
      const setOperatorKind = detectSetOperatorKind(innerSql);

      subqueries.push({
        id: subqueryNodeId,
        parentNodeId: currentOwnerNodeId,
        type: kind,
        label: buildSubqueryLabel(kind),
        statementType: detectStatementType(innerSql),
        sources,
        readSources: sources,
        joinTypes,
        clauses,
        sourceCount: sources.length,
        setOperator: setOperatorKind || null,
      });

      walkSegment(innerSql, subqueryNodeId, currentBaseOffset + index + 1);
      index = balanced.nextIndex;
    }
  }

  function nextSubqueryId(parentNodeId) {
    const nextIndex = (counters.get(parentNodeId) || 0) + 1;
    counters.set(parentNodeId, nextIndex);
    return `${parentNodeId}:subquery:${nextIndex}`;
  }
}

function inferHeuristicSubqueryKind(sql, openParenIndex) {
  const prefix = sql.slice(Math.max(0, openParenIndex - 48), openParenIndex).toLowerCase();

  if (/\bexists\s*$/.test(prefix)) {
    return "exists_subquery";
  }

  if (/\b(?:not\s+)?in\s*$/.test(prefix)) {
    return "in_subquery";
  }

  if (
    /\b(?:from|join|cross\s+join|left\s+join|right\s+join|inner\s+join|full\s+join)\s*$/.test(prefix)
  ) {
    return "inline_view";
  }

  return "scalar_subquery";
}

function extractAstWrapperAst(value) {
  if (value?.ast && typeof value.ast === "object") {
    return value.ast;
  }

  return value;
}

function buildSubqueryLabel(kind) {
  switch (kind) {
    case "inline_view":
      return "INLINE VIEW";
    case "exists_subquery":
      return "EXISTS";
    case "in_subquery":
      return "IN SUBQUERY";
    case "union_branch":
      return "UNION BRANCH";
    default:
      return "SCALAR SUBQUERY";
  }
}

function buildSetBranchLabel(setOperator) {
  const normalized = String(setOperator || "").trim().toUpperCase();

  if (!normalized) {
    return "UNION BRANCH";
  }

  return `${normalized} BRANCH`;
}

function detectAstClauses(ast, joinTypes, sql) {
  const heuristic = detectClauses(sql, joinTypes);
  const distinctKind = extractAstDistinctKind(ast);

  return {
    distinct: Boolean(distinctKind) || heuristic.distinct,
    join: joinTypes.length > 0 || hasAstJoinLikeClause(ast) || heuristic.join,
    mergeOn: Boolean(ast?.type === "merge") || heuristic.mergeOn,
    matched: heuristic.matched,
    notMatched: heuristic.notMatched,
    set: Boolean(ast?.type === "update" && Array.isArray(ast?.set) && ast.set.length) || heuristic.set,
    values:
      Boolean(ast?.type === "insert" && ast?.values?.type === "values") ||
      Boolean(ast?.type === "values") ||
      heuristic.values,
    conflict: Boolean(ast?.conflict) || heuristic.conflict,
    conflictAction: Boolean(ast?.conflict?.action) || heuristic.conflictAction,
    returning:
      Boolean(ast?.returning?.type === "returning" && Array.isArray(ast?.returning?.columns)) ||
      heuristic.returning,
    where: Boolean(ast?.where) || heuristic.where,
    groupBy: Boolean(ast?.groupby?.length) || heuristic.groupBy,
    having: Boolean(ast?.having) || heuristic.having,
    window: Boolean(ast?.window) || heuristic.window,
    qualify: Boolean(ast?.qualify) || heuristic.qualify,
    union: Boolean(ast?._next) || heuristic.union,
    orderBy: Boolean(ast?.orderby?.length) || heuristic.orderBy,
    limit:
      (Boolean(ast?.limit?.value?.length) &&
        String(ast?.limit?.seperator || "").trim().toLowerCase() !== "offset") ||
      (String(ast?.limit?.seperator || "").trim().toLowerCase() === "offset" &&
        Array.isArray(ast?.limit?.value) &&
        ast.limit.value.length > 1) ||
      heuristic.limit,
    offset:
      Boolean(
        ast?.limit?.seperator &&
          String(ast.limit.seperator || "").trim().toLowerCase() === "offset" &&
          ast?.limit?.value,
      ) || heuristic.offset,
  };
}

function extractAstGroupByKind(_ast, sql = "") {
  return detectGroupByKind(sql);
}

function extractAstValuesRowCount(ast) {
  if (ast?.type === "insert" && ast?.values?.type === "values") {
    return Array.isArray(ast.values.values) ? ast.values.values.length : 0;
  }

  if (ast?.type === "values") {
    return Array.isArray(ast.values) ? ast.values.length : 0;
  }

  return 0;
}

function extractAstConflictKind(ast, sql = "") {
  const conflictExprType = String(ast?.conflict?.action?.expr?.type || "").trim().toLowerCase();

  if (conflictExprType === "update") {
    return "DO UPDATE";
  }

  if (ast?.conflict) {
    return "DO NOTHING";
  }

  return detectConflictKind(sql);
}

function extractAstDistinctKind(ast) {
  const type = String(ast?.distinct?.type || "").trim().toUpperCase();
  return type || "";
}

function extractSetOperatorKind(ast, sql = "") {
  const astOperator = String(ast?.set_op || "").trim().toUpperCase();

  if (astOperator) {
    return astOperator;
  }

  return detectSetOperatorKind(sql);
}

function extractAstWrites(ast) {
  if (!ast || typeof ast !== "object") {
    return [];
  }

  if (ast.type === "create" && Array.isArray(ast.table)) {
    const name = buildAstObjectName(ast.table[0]);
    return name
      ? [
          {
            name,
            kind: ast.keyword === "view" ? "create_view" : "create_table",
          },
        ]
      : [];
  }

  if (ast.type === "insert") {
    const name = buildAstObjectName(ast.table?.[0] || ast.table);
    return name ? [{ name, kind: "insert_into" }] : [];
  }

  return [];
}

function normalizeAstIdentifier(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return stripIdentifierQuotes(value);
  }

  if (typeof value?.value === "string") {
    return stripIdentifierQuotes(value.value);
  }

  return "";
}

function buildAstObjectName(entry) {
  if (!entry) {
    return "";
  }

  if (typeof entry === "string") {
    return stripIdentifierQuotes(entry);
  }

  if (entry.db || entry.schema || entry.table) {
    return [entry.db, entry.schema, entry.table]
      .map((part) => stripIdentifierQuotes(part))
      .filter(Boolean)
      .join(".");
  }

  if (entry.table) {
    return stripIdentifierQuotes(entry.table);
  }

  return normalizeAstIdentifier(entry.name);
}

function extractAstSampleKind(entry) {
  const tablesampleExpr = entry?.tablesample?.expr || null;
  const functionName = normalizeAstFunctionName(tablesampleExpr).toUpperCase();

  if (!functionName) {
    return "";
  }

  return entry?.tablesample?.repeatable
    ? `TABLESAMPLE ${functionName} REPEATABLE`
    : `TABLESAMPLE ${functionName}`;
}

function extractAstOutputColumns(ast, nodeId, cteNames = [], availableColumnsBySource = new Map()) {
  const columns = Array.isArray(ast?.columns) ? ast.columns : [];
  const sources = extractAstImmediateSources(ast);
  const aliasMap = buildAstAliasMap(ast, sources);
  const cteNameSet = new Set((cteNames || []).map((name) => normalizeName(name)));
  const sourceNames = sources.map((source) => source.name);

  return columns.flatMap((column, index) => {
    const expr = column?.expr || null;
    const expandedColumns = expandAstWildcardColumns({
      expr,
      nodeId,
      selectItemIndex: index,
      aliasMap,
      sourceNames,
      cteNameSet,
      availableColumnsBySource,
    });

    if (expandedColumns.length) {
      return expandedColumns;
    }

    const name = deriveAstOutputColumnName(column, index);
    const upstream = uniqueColumnRefs(
      collectAstColumnRefs(expr).map((ref) =>
        resolveAstColumnRef(ref, aliasMap, sourceNames, cteNameSet),
      ),
    );

    return {
      id: `${nodeId}:column:${index}:${name}`,
      nodeId,
      name,
      label: name,
      selectItemIndex: index,
      role: detectAstColumnRole(expr),
      expressionType: String(expr?.type || "unknown"),
      upstream,
    };
  });
}

function applyColumnSpansToColumns(columns, sqlSegment, baseOffset = 0) {
  if (!columns?.length || !sqlSegment) {
    return columns || [];
  }

  const itemRanges = extractSelectItemRanges(maskCommentsPreserveOffsets(sqlSegment), baseOffset);

  return columns.map((column, index) => {
    const range = itemRanges[column.selectItemIndex ?? index];

    if (!range) {
      return column;
    }

    return {
      ...column,
      expressionSql: sqlSegment.slice(range.start - baseOffset, range.end - baseOffset).trim(),
      spans: [
        {
          start: range.start,
          end: range.end,
        },
      ],
    };
  });
}

function expandAstWildcardColumns({
  expr,
  nodeId,
  selectItemIndex,
  aliasMap,
  sourceNames,
  cteNameSet,
  availableColumnsBySource,
}) {
  if (expr?.type !== "column_ref" || normalizeAstColumnName(expr.column) !== "*") {
    return [];
  }

  const qualifier = normalizeAstIdentifier(expr.table) || null;
  const expansionSources = resolveWildcardExpansionSources(
    qualifier,
    aliasMap,
    sourceNames,
    availableColumnsBySource,
  );

  if (!expansionSources.length) {
    return [];
  }

  const expandedColumns = [];

  for (const sourceName of expansionSources) {
    const sourceColumns = getAvailableColumnsForSource(sourceName, availableColumnsBySource);
    const sourceNodeId = buildSourceNodeId(sourceName, cteNameSet);

    sourceColumns.forEach((sourceColumn, sourceColumnIndex) => {
      const columnName = String(sourceColumn.name || "").trim();

      if (!columnName) {
        return;
      }

      expandedColumns.push({
        id: `${nodeId}:column:${selectItemIndex}:${normalizeName(sourceName)}:${sourceColumnIndex}:${columnName}`,
        nodeId,
        name: columnName,
        label: sourceColumn.label || columnName,
        selectItemIndex,
        role: "source",
        expressionType: "column_ref",
        upstream: [
          {
            sourceNodeId,
            sourceName,
            qualifier,
            columnName,
          },
        ],
      });
    });
  }

  return expandedColumns;
}

function resolveWildcardExpansionSources(
  qualifier,
  aliasMap,
  sourceNames,
  availableColumnsBySource,
) {
  if (qualifier) {
    const resolvedSourceName = aliasMap.get(normalizeName(qualifier)) || qualifier;
    return getAvailableColumnsForSource(resolvedSourceName, availableColumnsBySource).length
      ? [resolvedSourceName]
      : [];
  }

  if (!sourceNames.length) {
    return [];
  }

  const knownSources = sourceNames.filter(
    (sourceName) => getAvailableColumnsForSource(sourceName, availableColumnsBySource).length > 0,
  );

  if (sourceNames.length === 1) {
    return knownSources;
  }

  return knownSources.length === sourceNames.length ? knownSources : [];
}

function getAvailableColumnsForSource(sourceName, availableColumnsBySource) {
  if (!sourceName) {
    return [];
  }

  return getExpandableColumns(availableColumnsBySource.get(normalizeName(sourceName)) || []);
}

function getExpandableColumns(columns) {
  const expandable = [];
  const seen = new Set();

  for (const column of columns || []) {
    const columnName = String(column?.name || "").trim();
    const normalizedColumnName = normalizeName(columnName);

    if (!normalizedColumnName || normalizedColumnName === "*" || column?.role === "wildcard") {
      continue;
    }

    if (seen.has(normalizedColumnName)) {
      continue;
    }

    seen.add(normalizedColumnName);
    expandable.push(column);
  }

  return expandable;
}

function buildSourceNodeId(sourceName, cteNameSet) {
  if (!sourceName) {
    return undefined;
  }

  return cteNameSet.has(normalizeName(sourceName)) ? `cte:${sourceName}` : `source:${sourceName}`;
}

function extractHeuristicOutputColumns(
  sql,
  nodeId,
  baseOffset = 0,
  cteNames = [],
  availableColumnsBySource = new Map(),
) {
  if (!sql) {
    return [];
  }

  const sources = extractSources(sql, 0);
  const aliasMap = buildHeuristicAliasMap(sql, sources);
  const cteNameSet = new Set((cteNames || []).map((name) => normalizeName(name)));
  const sourceNames = sources.map((source) => source.name);
  const itemRanges = extractSelectItemRanges(maskCommentsPreserveOffsets(sql), baseOffset);

  return itemRanges.flatMap((range, index) => {
    const expressionSql = sql.slice(range.start - baseOffset, range.end - baseOffset).trim();
    const expandedColumns = expandHeuristicWildcardColumns({
      expressionSql,
      nodeId,
      selectItemIndex: index,
      aliasMap,
      sourceNames,
      cteNameSet,
      availableColumnsBySource,
    });

    if (expandedColumns.length) {
      return expandedColumns.map((column) => ({
        ...column,
        expressionSql,
        spans: [
          {
            start: range.start,
            end: range.end,
          },
        ],
      }));
    }

    const name = deriveHeuristicOutputColumnName(expressionSql, index);
    const upstream = uniqueColumnRefs(
      collectHeuristicColumnRefs(expressionSql).map((ref) =>
        resolveAstColumnRef(ref, aliasMap, sourceNames, cteNameSet),
      ),
    );

    return [
      {
        id: `${nodeId}:column:${index}:${name}`,
        nodeId,
        name,
        label: name,
        selectItemIndex: index,
        role: detectHeuristicColumnRole(expressionSql),
        expressionType: "heuristic",
        expressionSql,
        spans: [
          {
            start: range.start,
            end: range.end,
          },
        ],
        upstream,
      },
    ];
  });
}

function buildHeuristicAliasMap(sql, sources) {
  const aliasMap = new Map();
  const sourceNames = (sources || []).map((source) => source.name).filter(Boolean);
  const uniqueLastPartMap = new Map();

  for (const sourceName of sourceNames) {
    const lastPart = sourceName.split(".").at(-1);
    const normalizedLastPart = normalizeName(lastPart);

    if (!normalizedLastPart) {
      continue;
    }

    if (!uniqueLastPartMap.has(normalizedLastPart)) {
      uniqueLastPartMap.set(normalizedLastPart, sourceName);
      continue;
    }

    uniqueLastPartMap.set(normalizedLastPart, null);
  }

  for (const source of sources || []) {
    const sourceName = source.name;
    const lastPart = sourceName.split(".").at(-1);
    const alias = readHeuristicSourceAlias(sql, source.rangeEnd ?? 0);

    if (alias && sourceName) {
      aliasMap.set(normalizeName(alias), sourceName);
    }

    if (sourceName) {
      aliasMap.set(normalizeName(sourceName), sourceName);
    }

    if (lastPart && uniqueLastPartMap.get(normalizeName(lastPart)) === sourceName) {
      aliasMap.set(normalizeName(lastPart), sourceName);
    }
  }

  return aliasMap;
}

function readHeuristicSourceAlias(sql, index) {
  let cursor = skipWhitespace(sql, index);

  if (startsWithWord(sql, cursor, "as")) {
    cursor = skipWhitespace(sql, cursor + 2);
  }

  const token = readIdentifier(sql, cursor);

  if (!token) {
    return "";
  }

  const normalized = normalizeName(token.value);

  if (!normalized || normalized.includes(".") || HEURISTIC_ALIAS_STOP_WORDS.has(normalized)) {
    return "";
  }

  return stripIdentifierQuotes(token.value);
}

function expandHeuristicWildcardColumns({
  expressionSql,
  nodeId,
  selectItemIndex,
  aliasMap,
  sourceNames,
  cteNameSet,
  availableColumnsBySource,
}) {
  const wildcardMatch = /^\s*(?:(?<qualifier>[a-zA-Z_][a-zA-Z0-9_$]*)\s*\.)?\s*\*\s*$/i.exec(
    expressionSql,
  );

  if (!wildcardMatch) {
    return [];
  }

  const qualifier = wildcardMatch.groups?.qualifier || null;
  const expansionSources = resolveWildcardExpansionSources(
    qualifier,
    aliasMap,
    sourceNames,
    availableColumnsBySource,
  );

  if (!expansionSources.length) {
    return [];
  }

  const expandedColumns = [];

  for (const sourceName of expansionSources) {
    const sourceColumns = getAvailableColumnsForSource(sourceName, availableColumnsBySource);
    const sourceNodeId = buildSourceNodeId(sourceName, cteNameSet);

    sourceColumns.forEach((sourceColumn, sourceColumnIndex) => {
      const columnName = String(sourceColumn.name || "").trim();

      if (!columnName) {
        return;
      }

      expandedColumns.push({
        id: `${nodeId}:column:${selectItemIndex}:${normalizeName(sourceName)}:${sourceColumnIndex}:${columnName}`,
        nodeId,
        name: columnName,
        label: sourceColumn.label || columnName,
        selectItemIndex,
        role: "source",
        expressionType: "column_ref",
        upstream: [
          {
            sourceNodeId,
            sourceName,
            qualifier,
            columnName,
          },
        ],
      });
    });
  }

  return expandedColumns;
}

function deriveHeuristicOutputColumnName(expressionSql, index) {
  const aliasMatch =
    /\bas\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[a-zA-Z_][a-zA-Z0-9_$]*))\s*$/i.exec(expressionSql) ||
    /(?:^|[)\]\s])((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[a-zA-Z_][a-zA-Z0-9_$]*))\s*$/i.exec(expressionSql);

  if (aliasMatch?.[1]) {
    const alias = stripIdentifierQuotes(aliasMatch[1]);
    const normalizedAlias = normalizeName(alias);

    if (normalizedAlias && !HEURISTIC_COLUMN_STOP_WORDS.has(normalizedAlias)) {
      return alias;
    }
  }

  const wildcardMatch = /^\s*(?:(?<qualifier>[a-zA-Z_][a-zA-Z0-9_$]*)\s*\.)?\s*\*\s*$/i.exec(
    expressionSql,
  );

  if (wildcardMatch) {
    return wildcardMatch.groups?.qualifier ? `${wildcardMatch.groups.qualifier}.*` : "*";
  }

  const simpleColumnMatch =
    /(?:^|[^a-zA-Z0-9_$])((?:[a-zA-Z_][a-zA-Z0-9_$]*\.)?[a-zA-Z_][a-zA-Z0-9_$]*)\s*$/.exec(
      expressionSql,
    );

  if (simpleColumnMatch?.[1]) {
    return simpleColumnMatch[1].split(".").at(-1) || `expr_${index + 1}`;
  }

  const functionMatch = /^\s*([a-zA-Z_][a-zA-Z0-9_$]*)\s*\(/.exec(expressionSql);

  if (functionMatch?.[1]) {
    return `${functionMatch[1].toLowerCase()}_${index + 1}`;
  }

  if (/\bcase\b/i.test(expressionSql)) {
    return `case_${index + 1}`;
  }

  return `expr_${index + 1}`;
}

function detectHeuristicColumnRole(expressionSql) {
  if (/^\s*(?:(?:[a-zA-Z_][a-zA-Z0-9_$]*)\s*\.)?\s*\*\s*$/i.test(expressionSql)) {
    return "wildcard";
  }

  if (/\bover\s*\(/i.test(expressionSql)) {
    return "window";
  }

  if (/^\s*[a-zA-Z_][a-zA-Z0-9_$]*\s*\(/.test(expressionSql)) {
    return /\b(count|sum|avg|min|max|approx_percentile|count_if)\s*\(/i.test(expressionSql)
      ? "aggregate"
      : "function";
  }

  if (/^\s*(?:[a-zA-Z_][a-zA-Z0-9_$]*\.)?[a-zA-Z_][a-zA-Z0-9_$]*\s*$/i.test(expressionSql)) {
    return "source";
  }

  return "derived";
}

function collectHeuristicColumnRefs(expressionSql) {
  const masked = maskQuotedStrings(expressionSql);
  const regex = /(?:^|[^a-zA-Z0-9_$])((?:[a-zA-Z_][a-zA-Z0-9_$]*\.)?[a-zA-Z_][a-zA-Z0-9_$]*)(?!\s*\()/g;
  const refs = [];
  let match = regex.exec(masked);

  while (match) {
    const token = match[1];
    const normalized = normalizeName(token);

    if (!HEURISTIC_COLUMN_STOP_WORDS.has(normalized)) {
      const [qualifier, columnName] = token.includes(".")
        ? token.split(/\.(?=[^.]+$)/)
        : [null, token];
      refs.push({
        qualifier: qualifier || null,
        columnName,
      });
    }

    match = regex.exec(masked);
  }

  return refs;
}

function maskQuotedStrings(sql) {
  return String(sql || "")
    .replace(/'([^']|'')*'/g, " ")
    .replace(/"([^"]|"")*"/g, " ")
    .replace(/`([^`]|``)*`/g, " ");
}

function extractSelectItemRanges(sql, baseOffset = 0) {
  const selectStart = findTopLevelKeyword(sql, "select", 0);

  if (selectStart < 0) {
    return [];
  }

  const listStart = selectStart + "select".length;
  const fromStart = findTopLevelKeyword(sql, "from", listStart);
  const listEnd = fromStart >= 0 ? fromStart : sql.length;
  const selectList = sql.slice(listStart, listEnd);
  const ranges = [];
  let itemStart = 0;
  let index = 0;
  let mode = "normal";
  let depth = 0;

  while (index < selectList.length) {
    const char = selectList[index];
    const next = selectList[index + 1] || "";

    if (mode === "single_quote") {
      if (char === "'" && next === "'") {
        index += 2;
        continue;
      }

      if (char === "'") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "double_quote") {
      if (char === '"') {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "backtick") {
      if (char === "`") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (char === "'") {
      mode = "single_quote";
      index += 1;
      continue;
    }

    if (char === '"') {
      mode = "double_quote";
      index += 1;
      continue;
    }

    if (char === "`") {
      mode = "backtick";
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === ")" && depth > 0) {
      depth -= 1;
      index += 1;
      continue;
    }

    if (char === "," && depth === 0) {
      const range = buildTrimmedRange(selectList, itemStart, index, baseOffset + listStart);

      if (range) {
        ranges.push(range);
      }

      itemStart = index + 1;
    }

    index += 1;
  }

  const lastRange = buildTrimmedRange(selectList, itemStart, selectList.length, baseOffset + listStart);

  if (lastRange) {
    ranges.push(lastRange);
  }

  return ranges;
}

function buildTrimmedRange(sql, start, end, offset) {
  const raw = sql.slice(start, end);
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const leftTrim = raw.indexOf(trimmed);
  return {
    start: offset + start + Math.max(leftTrim, 0),
    end: offset + start + Math.max(leftTrim, 0) + trimmed.length,
  };
}

function findTopLevelKeyword(sql, keyword, fromIndex = 0) {
  const input = String(sql || "");
  const lowerSql = input.toLowerCase();
  const needle = String(keyword || "").toLowerCase();
  let index = Math.max(0, fromIndex);
  let mode = "normal";
  let depth = 0;

  while (index < lowerSql.length) {
    const char = lowerSql[index];
    const next = lowerSql[index + 1] || "";

    if (mode === "single_quote") {
      if (char === "'" && next === "'") {
        index += 2;
        continue;
      }

      if (char === "'") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "double_quote") {
      if (char === '"') {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "backtick") {
      if (char === "`") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (char === "'") {
      mode = "single_quote";
      index += 1;
      continue;
    }

    if (char === '"') {
      mode = "double_quote";
      index += 1;
      continue;
    }

    if (char === "`") {
      mode = "backtick";
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === ")" && depth > 0) {
      depth -= 1;
      index += 1;
      continue;
    }

    if (
      depth === 0 &&
      lowerSql.slice(index, index + needle.length) === needle &&
      isWordBoundary(lowerSql[index - 1]) &&
      isWordBoundary(lowerSql[index + needle.length])
    ) {
      return index;
    }

    index += 1;
  }

  return -1;
}

function isWordBoundary(char) {
  return !char || !/[a-zA-Z0-9_]/.test(char);
}

function buildAstAliasMap(ast, sources) {
  const sourceEntries = extractAstSourceGroups(ast).flatMap((group) => group.entries);
  const aliasMap = new Map();
  const sourceNames = (sources || []).map((source) => source.name).filter(Boolean);
  const uniqueLastPartMap = new Map();

  for (const sourceName of sourceNames) {
    const lastPart = sourceName.split(".").at(-1);
    const normalizedLastPart = normalizeName(lastPart);

    if (!normalizedLastPart) {
      continue;
    }

    if (!uniqueLastPartMap.has(normalizedLastPart)) {
      uniqueLastPartMap.set(normalizedLastPart, sourceName);
      continue;
    }

    uniqueLastPartMap.set(normalizedLastPart, null);
  }

  for (const entry of sourceEntries) {
    const sourceName = buildAstObjectName(entry);
    const alias = normalizeAstIdentifier(entry?.as);
    const lastPart = sourceName.split(".").at(-1);

    if (alias && sourceName) {
      aliasMap.set(normalizeName(alias), sourceName);
    }

    if (sourceName) {
      aliasMap.set(normalizeName(sourceName), sourceName);
    }

    if (lastPart && uniqueLastPartMap.get(normalizeName(lastPart)) === sourceName) {
      aliasMap.set(normalizeName(lastPart), sourceName);
    }
  }

  return aliasMap;
}

function extractAstSourceGroups(node) {
  const groups = [];

  if (Array.isArray(node?.from) && node.from.length) {
    groups.push({
      entries: node.from,
      defaultType: "from",
    });
  }

  if (Array.isArray(node?.using) && node.using.length) {
    groups.push({
      entries: node.using,
      defaultType: "using",
    });
  }

  return groups;
}

function hasAstJoinLikeClause(ast) {
  if (!ast || typeof ast !== "object") {
    return false;
  }

  const fromList = Array.isArray(ast?.from) ? ast.from : [];
  const usingList = Array.isArray(ast?.using) ? ast.using : [];

  if (usingList.length > 0) {
    return true;
  }

  if (fromList.some((entry) => String(entry?.join || "").trim())) {
    return true;
  }

  if ((ast.type === "update" || ast.type === "delete") && fromList.length > 0) {
    return true;
  }

  return false;
}

function deriveAstOutputColumnName(column, index) {
  const alias = normalizeAstIdentifier(column?.as);

  if (alias) {
    return alias;
  }

  const expr = column?.expr || null;

  if (expr?.type === "column_ref") {
    const columnName = normalizeAstColumnName(expr.column);

    if (columnName === "*") {
      const qualifier = normalizeAstIdentifier(expr.table);
      return qualifier ? `${qualifier}.*` : "*";
    }

    return columnName || `column_${index + 1}`;
  }

  if (expr?.type === "aggr_func") {
    const functionName = normalizeAstFunctionName(expr);
    return functionName ? `${functionName.toLowerCase()}_${index + 1}` : `aggregate_${index + 1}`;
  }

  if (expr?.type === "function") {
    const functionName = normalizeAstFunctionName(expr);
    return functionName ? `${functionName.toLowerCase()}_${index + 1}` : `function_${index + 1}`;
  }

  if (expr?.type === "case") {
    return `case_${index + 1}`;
  }

  return `expr_${index + 1}`;
}

function detectAstColumnRole(expr) {
  const type = String(expr?.type || "");

  if (type === "column_ref") {
    return normalizeAstColumnName(expr?.column) === "*" ? "wildcard" : "source";
  }

  if (type === "aggr_func") {
    return "aggregate";
  }

  if (type === "function") {
    return expr?.over ? "window" : "function";
  }

  if (type === "window_func") {
    return "window";
  }

  return "derived";
}

function normalizeAstFunctionName(expr) {
  if (!expr?.name) {
    return "";
  }

  if (typeof expr.name === "string") {
    return expr.name;
  }

  if (typeof expr.name?.name === "string") {
    return expr.name.name;
  }

  if (Array.isArray(expr.name?.name)) {
    return expr.name.name
      .map((part) => normalizeAstIdentifier(part))
      .filter(Boolean)
      .join(".");
  }

  if (Array.isArray(expr.name)) {
    return expr.name.map((part) => normalizeAstIdentifier(part)).filter(Boolean).join(".");
  }

  return "";
}

function collectAstColumnRefs(node, refs = []) {
  if (!node) {
    return refs;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectAstColumnRefs(entry, refs);
    }

    return refs;
  }

  if (typeof node !== "object") {
    return refs;
  }

  if (node.type === "column_ref") {
    refs.push({
      qualifier: normalizeAstIdentifier(node.table) || null,
      columnName: normalizeAstColumnName(node.column) || undefined,
    });
    return refs;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "as") {
      continue;
    }

    collectAstColumnRefs(value, refs);
  }

  return refs;
}

function normalizeAstColumnName(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return stripIdentifierQuotes(value);
  }

  if (typeof value?.value === "string") {
    return stripIdentifierQuotes(value.value);
  }

  if (typeof value?.expr?.value === "string") {
    return stripIdentifierQuotes(value.expr.value);
  }

  if (typeof value?.column === "string") {
    return stripIdentifierQuotes(value.column);
  }

  return "";
}

function resolveAstColumnRef(ref, aliasMap, sourceNames, cteNameSet) {
  const normalizedQualifier = normalizeName(ref.qualifier);
  const resolvedSourceName = normalizedQualifier
    ? aliasMap.get(normalizedQualifier) || ref.qualifier
    : sourceNames.length === 1
      ? sourceNames[0]
      : undefined;
  const normalizedSourceName = normalizeName(resolvedSourceName);

  return {
    sourceNodeId: resolvedSourceName
      ? cteNameSet.has(normalizedSourceName)
        ? `cte:${resolvedSourceName}`
        : `source:${resolvedSourceName}`
      : undefined,
    sourceName: resolvedSourceName,
    qualifier: ref.qualifier || null,
    columnName: ref.columnName,
  };
}

function uniqueColumnRefs(refs) {
  const unique = [];
  const seen = new Set();

  for (const ref of refs || []) {
    const key = [
      normalizeName(ref?.sourceName),
      normalizeName(ref?.qualifier),
      normalizeName(ref?.columnName),
    ].join(":");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(ref);
  }

  return unique;
}

function mergeCteRanges(ctes, scopeCtes) {
  const rangeByName = new Map(
    (scopeCtes || []).map((cte) => [normalizeName(cte.name), cte]),
  );

  return (ctes || []).map((cte) => {
    const scoped = rangeByName.get(normalizeName(cte.name));

    if (!scoped) {
      return cte;
    }

    return {
      ...cte,
      recursive: typeof cte.recursive === "boolean" ? cte.recursive : scoped.recursive,
      rangeStart: scoped.rangeStart,
      rangeEnd: scoped.rangeEnd,
      bodyRangeStart: scoped.bodyRangeStart,
      bodyRangeEnd: scoped.bodyRangeEnd,
      body: scoped.body,
    };
  });
}

function mergeCteAnalysis(ctes, heuristicCtes) {
  const heuristicByName = new Map(
    (heuristicCtes || []).map((cte) => [normalizeName(cte.name), cte]),
  );

  return (ctes || []).map((cte) => {
    const heuristic = heuristicByName.get(normalizeName(cte.name));

    if (!heuristic) {
      return cte;
    }

    const dependencies =
      cte.dependencies?.length ? cte.dependencies : heuristic.dependencies || [];
    const sources = mergeSourcesWithRanges(cte.sources || [], heuristic.sources || []);
    const statementType =
      cte.statementType && cte.statementType !== "UNKNOWN"
        ? cte.statementType
        : heuristic.statementType || cte.statementType;
    const flowSequence =
      cte.flowSequence?.length &&
      cte.flowSequence[0] &&
      String(cte.flowSequence[0]).toUpperCase() !== "UNKNOWN"
        ? cte.flowSequence
        : heuristic.flowSequence || cte.flowSequence || [];

    return {
      ...cte,
      recursive: typeof cte.recursive === "boolean" ? cte.recursive : heuristic.recursive,
      rangeStart: typeof cte.rangeStart === "number" ? cte.rangeStart : heuristic.rangeStart,
      rangeEnd: typeof cte.rangeEnd === "number" ? cte.rangeEnd : heuristic.rangeEnd,
      sourceCount: countNonDependencySources(sources, dependencies),
      dependencies,
      sources,
      joinTypes: cte.joinTypes?.length ? cte.joinTypes : heuristic.joinTypes,
      statementType,
      bodyRangeStart:
        typeof cte.bodyRangeStart === "number" ? cte.bodyRangeStart : heuristic.bodyRangeStart,
      bodyRangeEnd:
        typeof cte.bodyRangeEnd === "number" ? cte.bodyRangeEnd : heuristic.bodyRangeEnd,
      body: cte.body || heuristic.body,
      columns: cte.columns?.length ? cte.columns : heuristic.columns || [],
      flowSequence,
    };
  });
}

function hydrateColumnSpansForCtes(ctes) {
  return (ctes || []).map((cte) => ({
    ...cte,
    columns: applyColumnSpansToColumns(cte.columns || [], cte.body || "", cte.bodyRangeStart ?? 0),
  }));
}

function mergeSourcesWithRanges(primarySources, rangedSources) {
  const merged = [];
  const rangedByName = new Map();

  for (const source of rangedSources || []) {
    const key = normalizeName(source.name);

    if (!key) {
      continue;
    }

    rangedByName.set(key, source);
  }

  for (const source of primarySources || []) {
    const ranged = rangedByName.get(normalizeName(source.name));

    if (!ranged) {
      merged.push(source);
      continue;
    }

    merged.push({
      ...source,
      type: preferSourceType(source.type, ranged.type),
      sampleKind: source.sampleKind || ranged.sampleKind || "",
      rangeStart: typeof source.rangeStart === "number" ? source.rangeStart : ranged.rangeStart,
      rangeEnd: typeof source.rangeEnd === "number" ? source.rangeEnd : ranged.rangeEnd,
      ranges: mergeRanges(source.ranges || [], ranged.ranges || []),
    });
  }

  for (const source of rangedSources || []) {
    const key = normalizeName(source.name);

    if (!key) {
      continue;
    }

    if (merged.some((candidate) => normalizeName(candidate.name) === key)) {
      continue;
    }

    merged.push(source);
  }

  return merged;
}

function preferSourceType(primaryType, rangedType) {
  const normalizedPrimary = String(primaryType || "").trim().toLowerCase();
  const normalizedRanged = String(rangedType || "").trim().toLowerCase();

  if (normalizedRanged === "unnest" || normalizedRanged === "lateral_view") {
    return normalizedRanged;
  }

  return primaryType || rangedType;
}

function preprocessSql(sql) {
  const templates = [];
  let nextTemplateId = 1;

  const templatedSql = sql
    .replace(/\{\{[\s\S]*?\}\}/g, (match) => {
      const placeholder = `__TPL_EXPR_${nextTemplateId}__`;
      templates.push({
        id: nextTemplateId,
        type: "expression",
        placeholder,
        raw: match,
      });
      nextTemplateId += 1;
      return placeholder;
    })
    .replace(/\{%[\s\S]*?%\}/g, (match) => {
      const placeholder = `__TPL_BLOCK_${nextTemplateId}__`;
      templates.push({
        id: nextTemplateId,
        type: "block",
        placeholder,
        raw: match,
      });
      nextTemplateId += 1;
      return placeholder;
    });

  const withoutBlockComments = templatedSql.replace(/\/\*[\s\S]*?\*\//g, " ");
  const withoutLineComments = withoutBlockComments.replace(/--.*$/gm, " ");

  return {
    sql: normalizeSql(withoutLineComments),
    templates,
  };
}

function maskCommentsPreserveOffsets(sql) {
  const input = String(sql || "");

  if (!input) {
    return "";
  }

  let index = 0;
  let mode = "normal";
  let dollarTag = null;
  let result = "";

  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1] || "";

    if (mode === "line_comment") {
      result += char === "\n" ? "\n" : " ";

      if (char === "\n") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "block_comment") {
      if (char === "*" && next === "/") {
        result += "  ";
        index += 2;
        mode = "normal";
        continue;
      }

      result += char === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    if (mode === "single_quote") {
      result += char;

      if (char === "'" && next === "'") {
        result += next;
        index += 2;
        continue;
      }

      if (char === "'") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "double_quote") {
      result += char;

      if (char === '"') {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "backtick") {
      result += char;

      if (char === "`") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "bracket") {
      result += char;

      if (char === "]") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "dollar_quote") {
      result += char;

      if (dollarTag && input.slice(index, index + dollarTag.length) === dollarTag) {
        result += input.slice(index + 1, index + dollarTag.length);
        index += dollarTag.length;
        mode = "normal";
        dollarTag = null;
        continue;
      }

      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      result += "  ";
      index += 2;
      mode = "line_comment";
      continue;
    }

    if (char === "/" && next === "*") {
      result += "  ";
      index += 2;
      mode = "block_comment";
      continue;
    }

    if (char === "'") {
      result += char;
      mode = "single_quote";
      index += 1;
      continue;
    }

    if (char === '"') {
      result += char;
      mode = "double_quote";
      index += 1;
      continue;
    }

    if (char === "`") {
      result += char;
      mode = "backtick";
      index += 1;
      continue;
    }

    if (char === "[") {
      result += char;
      mode = "bracket";
      index += 1;
      continue;
    }

    if (char === "$") {
      const tagMatch = /^\$[a-zA-Z0-9_]*\$/.exec(input.slice(index));

      if (tagMatch) {
        dollarTag = tagMatch[0];
        mode = "dollar_quote";
      }
    }

    result += char;
    index += 1;
  }

  return result;
}

function splitStatementsDetailed(sql) {
  const statements = [];
  const maskedSql = maskCommentsPreserveOffsets(sql);
  let start = 0;
  let index = 0;
  let mode = "normal";
  let dollarTag = null;

  while (index < maskedSql.length) {
    const char = maskedSql[index];
    const next = maskedSql[index + 1] || "";

    if (mode === "single_quote") {
      if (char === "'" && next === "'") {
        index += 2;
        continue;
      }

      if (char === "'") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "double_quote") {
      if (char === '"') {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "backtick") {
      if (char === "`") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "bracket") {
      if (char === "]") {
        mode = "normal";
      }

      index += 1;
      continue;
    }

    if (mode === "dollar_quote") {
      if (dollarTag && maskedSql.slice(index, index + dollarTag.length) === dollarTag) {
        index += dollarTag.length;
        mode = "normal";
        dollarTag = null;
        continue;
      }

      index += 1;
      continue;
    }

    if (char === "'") {
      mode = "single_quote";
      index += 1;
      continue;
    }

    if (char === '"') {
      mode = "double_quote";
      index += 1;
      continue;
    }

    if (char === "`") {
      mode = "backtick";
      index += 1;
      continue;
    }

    if (char === "[") {
      mode = "bracket";
      index += 1;
      continue;
    }

    if (char === "$") {
      const tagMatch = /^\$[a-zA-Z0-9_]*\$/.exec(maskedSql.slice(index));

      if (tagMatch) {
        dollarTag = tagMatch[0];
        mode = "dollar_quote";
        index += dollarTag.length;
        continue;
      }
    }

    if (char === ";") {
      const rawFragment = sql.slice(start, index);
      const fragment = normalizeSql(rawFragment);

      if (fragment) {
        const offset = rawFragment.indexOf(fragment);
        statements.push({
          sql: fragment,
          rangeStart: start + Math.max(offset, 0),
          rangeEnd: start + Math.max(offset, 0) + fragment.length,
        });
      }

      start = index + 1;
    }

    index += 1;
  }

  const rawLast = sql.slice(start);
  const last = normalizeSql(rawLast);

  if (last) {
    const offset = rawLast.indexOf(last);
    statements.push({
      sql: last,
      rangeStart: start + Math.max(offset, 0),
      rangeEnd: start + Math.max(offset, 0) + last.length,
    });
  }

  return statements;
}

function extractLogicalBodySql(sql, rootStatementType) {
  if (rootStatementType === "CREATE") {
    const asMatch = /\bas\b/i.exec(sql);

    if (asMatch) {
      return normalizeSql(sql.slice(asMatch.index + asMatch[0].length));
    }
  }

  if (rootStatementType === "INSERT") {
    const selectMatch = /\b(with|select)\b/i.exec(sql);

    if (selectMatch) {
      return normalizeSql(sql.slice(selectMatch.index));
    }
  }

  return sql;
}

function extractCtes(sql) {
  let index = skipWhitespace(sql, 0);
  let isRecursive = false;

  if (!startsWithWord(sql, index, "with")) {
    return {
      ctes: [],
      isRecursive: false,
      mainStatement: sql,
      mainStatementStart: 0,
    };
  }

  index += 4;
  index = skipWhitespace(sql, index);

  if (startsWithWord(sql, index, "recursive")) {
    isRecursive = true;
    index += "recursive".length;
  }

  const ctes = [];

  while (index < sql.length) {
    index = skipWhitespace(sql, index);

    const nameToken = readIdentifier(sql, index);

    if (!nameToken) {
      break;
    }

    index = skipWhitespace(sql, nameToken.nextIndex);

    if (sql[index] === "(") {
      const columns = readBalanced(sql, index, "(", ")");
      index = skipWhitespace(sql, columns.nextIndex);
    }

    if (!startsWithWord(sql, index, "as")) {
      break;
    }

    index += 2;
    index = skipWhitespace(sql, index);

    if (sql[index] !== "(") {
      break;
    }

    const bodyToken = readBalanced(sql, index, "(", ")");
    const body = bodyToken.content;
    const cteRangeEnd =
      sql[skipWhitespace(sql, bodyToken.nextIndex)] === ","
        ? Math.max(skipWhitespace(sql, bodyToken.nextIndex + 1) - 1, bodyToken.nextIndex - 1)
        : bodyToken.nextIndex - 1;
    ctes.push({
      name: stripIdentifierQuotes(nameToken.value),
      recursive: isRecursive,
      rangeStart: nameToken.startIndex,
      rangeEnd: cteRangeEnd,
      body,
      bodyRangeStart: bodyToken.startIndex + 1,
      bodyRangeEnd: bodyToken.nextIndex - 1,
    });

    index = skipWhitespace(sql, bodyToken.nextIndex);

    if (sql[index] !== ",") {
      break;
    }

    index += 1;
  }

  return {
    ctes,
    isRecursive,
    mainStatement: normalizeSql(sql.slice(index)),
    mainStatementStart: index,
  };
}

function analyzeCte(cte, cteNames) {
  const sources = extractSources(cte.body, cte.bodyRangeStart ?? 0);
  const dependencies = cteNames
    .filter((name) => normalizeName(name) !== normalizeName(cte.name))
    .filter((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(cte.body));
  const joinTypes = extractJoinTypes(cte.body);
  const clauses = detectClauses(cte.body, joinTypes);
  const statementType = detectStatementType(cte.body);

  return {
    name: cte.name,
    recursive: Boolean(cte.recursive),
    sources,
    sourceCount: countNonDependencySources(sources, dependencies),
    dependencies,
    rangeStart: cte.rangeStart,
    rangeEnd: cte.rangeEnd,
    bodyRangeStart: cte.bodyRangeStart,
    bodyRangeEnd: cte.bodyRangeEnd,
    joinTypes,
    statementType,
    flowSequence: buildFlowSequence(
      statementType,
      clauses,
      [],
      detectGroupByKind(cte.body),
      detectSetOperatorKind(cte.body),
      detectConflictKind(cte.body),
    ),
  };
}

function analyzeHeuristicCtes(ctes, cteNames) {
  const availableColumnsBySource = new Map();
  const analyzed = [];

  for (const cte of ctes || []) {
    const base = analyzeCte(cte, cteNames);
    const columns = extractHeuristicOutputColumns(
      cte.body || "",
      `cte:${cte.name}`,
      0,
      cteNames,
      availableColumnsBySource,
    );

    analyzed.push({
      ...base,
      columns,
    });

    if (cte.name) {
      availableColumnsBySource.set(normalizeName(cte.name), getExpandableColumns(columns));
    }
  }

  return analyzed;
}

function extractSources(sql, baseOffset = 0) {
  const results = [];
  const maskedSql = maskCommentsPreserveOffsets(sql);
  const regex = new RegExp(`\\b(from|join|using)\\s+(${QUALIFIED_IDENTIFIER_PATTERN})`, "gi");
  let match = regex.exec(maskedSql);

  while (match) {
    const rawName = match[2];

    if (rawName && !rawName.startsWith("(")) {
      const localStart = match.index + match[0].lastIndexOf(rawName);
      const localEnd = localStart + rawName.length;
      results.push({
        name: stripIdentifierQuotes(rawName),
        type: match[1].toLowerCase(),
        rangeStart: baseOffset + localStart,
        rangeEnd: baseOffset + localEnd,
        ranges: [
          {
            start: baseOffset + localStart,
            end: baseOffset + localEnd,
          },
        ],
      });
    }

    match = regex.exec(maskedSql);
  }

  const unnestRegex =
    /\b(?:from|join|cross\s+join|left\s+join|right\s+join|inner\s+join|full\s+join)\s+(unnest)\s*\(/gi;
  match = unnestRegex.exec(maskedSql);

  while (match) {
    const localStart = match.index + match[0].lastIndexOf(match[1]);
    const localEnd = localStart + match[1].length;
    results.push({
      name: "UNNEST",
      type: "unnest",
      rangeStart: baseOffset + localStart,
      rangeEnd: baseOffset + localEnd,
      ranges: [
        {
          start: baseOffset + localStart,
          end: baseOffset + localEnd,
        },
      ],
    });

    match = unnestRegex.exec(maskedSql);
  }

  const lateralViewRegex =
    /\blateral\s+view(?:\s+outer)?\s+([a-z_][a-z0-9_]*)\s*\(/gi;
  match = lateralViewRegex.exec(maskedSql);

  while (match) {
    const localStart = match.index;
    const localEnd = localStart + match[0].indexOf(match[1]) + match[1].length;
    results.push({
      name: "LATERAL VIEW",
      type: "lateral_view",
      rangeStart: baseOffset + localStart,
      rangeEnd: baseOffset + localEnd,
      ranges: [
        {
          start: baseOffset + localStart,
          end: baseOffset + localEnd,
        },
      ],
    });

    match = lateralViewRegex.exec(maskedSql);
  }

  return mergeSourceMatches(results);
}

function countNonDependencySources(sources, dependencies = []) {
  const dependencyNames = new Set((dependencies || []).map((name) => normalizeName(name)));
  return uniqueByName(sources || []).filter(
    (source) => !dependencyNames.has(normalizeName(source.name)),
  ).length;
}

function extractExternalReads(statementSources, ctes, cteNames) {
  const localCtes = new Set(cteNames.map((name) => normalizeName(name)));
  const cteReadSources = ctes.flatMap((cte) => cte.readSources || cte.sources);

  return uniqueByName(
    [...statementSources, ...cteReadSources].filter(
      (source) => !localCtes.has(normalizeName(source.name)),
    ),
  );
}

function extractWrites(sql) {
  const normalized = normalizeSql(sql);
  const patterns = [
    {
      kind: "create_table",
      regex: new RegExp(
        `^\\s*create\\s+(?:or\\s+replace\\s+)?(?:temporary\\s+|temp\\s+)?(?:external\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED_IDENTIFIER_PATTERN})`,
        "i",
      ),
    },
    {
      kind: "create_view",
      regex: new RegExp(
        `^\\s*create\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+)?view\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED_IDENTIFIER_PATTERN})`,
        "i",
      ),
    },
    {
      kind: "insert_into",
      regex: new RegExp(`^\\s*insert\\s+into\\s+(${QUALIFIED_IDENTIFIER_PATTERN})`, "i"),
    },
    {
      kind: "merge_into",
      regex: new RegExp(`^\\s*merge\\s+into\\s+(${QUALIFIED_IDENTIFIER_PATTERN})`, "i"),
    },
    {
      kind: "update",
      regex: new RegExp(`^\\s*update\\s+(${QUALIFIED_IDENTIFIER_PATTERN})`, "i"),
    },
    {
      kind: "delete_from",
      regex: new RegExp(`^\\s*delete\\s+from\\s+(${QUALIFIED_IDENTIFIER_PATTERN})`, "i"),
    },
  ];

  const writes = [];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);

    if (match?.[1]) {
      writes.push({
        name: stripIdentifierQuotes(match[1]),
        kind: pattern.kind,
      });
    }
  }

  return uniqueByName(writes);
}

function extractJoinTypes(sql) {
  const joins = [];
  const maskedSql = maskCommentsPreserveOffsets(sql);
  const regex = /\b((left|right|inner|full|cross)\s+)?join\b|\busing\b/gi;
  let match = regex.exec(maskedSql);

  while (match) {
    if (/^using$/i.test(match[0])) {
      joins.push("USING");
    } else {
      joins.push((match[1] || "join").trim().toUpperCase());
    }
    match = regex.exec(maskedSql);
  }

  return joins;
}

function detectClauses(sql, joinTypes) {
  const maskedSql = maskCommentsPreserveOffsets(sql);
  return {
    distinct: /^\s*select\s+distinct(?:\s+on)?\b/i.test(maskedSql),
    join: joinTypes.length > 0,
    mergeOn: /\bmerge\s+into\b[\s\S]*?\busing\b[\s\S]*?\bon\b/i.test(maskedSql),
    matched: /\bwhen\s+matched\b/i.test(maskedSql),
    notMatched: /\bwhen\s+not\s+matched\b/i.test(maskedSql),
    set: /^\s*update\b[\s\S]*?\bset\b/i.test(maskedSql),
    values: /\bvalues\s*\(/i.test(maskedSql),
    conflict: /\bon\s+conflict\b/i.test(maskedSql),
    conflictAction: /\bdo\s+(?:update|nothing)\b/i.test(maskedSql),
    returning: /\breturning\b/i.test(maskedSql),
    where: hasTopLevelKeyword(maskedSql, "where"),
    groupBy: hasTopLevelPhrase(maskedSql, "group", "by"),
    having: hasTopLevelKeyword(maskedSql, "having"),
    window: /\bover\s*\(|\bwindow\b/i.test(maskedSql),
    qualify: hasTopLevelKeyword(maskedSql, "qualify"),
    union: /\b(?:union(?:\s+all)?|intersect|except)\b/i.test(maskedSql),
    orderBy: hasTopLevelPhrase(maskedSql, "order", "by"),
    limit: hasTopLevelKeyword(maskedSql, "limit"),
    offset: hasTopLevelKeyword(maskedSql, "offset"),
  };
}

function hasTopLevelKeyword(sql, keyword) {
  return findTopLevelKeyword(sql, keyword, 0) >= 0;
}

function hasTopLevelPhrase(sql, firstKeyword, secondKeyword) {
  const firstIndex = findTopLevelKeyword(sql, firstKeyword, 0);

  if (firstIndex < 0) {
    return false;
  }

  const secondIndex = findTopLevelKeyword(sql, secondKeyword, firstIndex + firstKeyword.length);

  if (secondIndex < 0) {
    return false;
  }

  const between = sql.slice(firstIndex + firstKeyword.length, secondIndex);
  return /^\s*$/.test(between);
}

function detectGroupByKind(sql) {
  const maskedSql = maskCommentsPreserveOffsets(sql);

  if (/\bgroup\s+by\s+grouping\s+sets\s*\(/i.test(maskedSql)) {
    return "GROUPING SETS";
  }

  if (/\bgroup\s+by\s+rollup\s*\(/i.test(maskedSql)) {
    return "ROLLUP";
  }

  if (/\bgroup\s+by\s+cube\s*\(/i.test(maskedSql)) {
    return "CUBE";
  }

  return "";
}

function detectValuesRowCount(sql) {
  const maskedSql = maskCommentsPreserveOffsets(sql);
  const valuesIndex = maskedSql.search(/\bvalues\s*\(/i);

  if (valuesIndex < 0) {
    return 0;
  }

  let count = 0;
  let index = valuesIndex;

  while (index < maskedSql.length) {
    const openIndex = maskedSql.indexOf("(", index);

    if (openIndex < 0) {
      break;
    }

    const balanced = readBalanced(maskedSql, openIndex, "(", ")");

    if (!balanced) {
      break;
    }

    count += 1;
    index = skipWhitespace(maskedSql, balanced.nextIndex);

    if (maskedSql[index] !== ",") {
      break;
    }

    index += 1;
  }

  return count;
}

function emptyClauses() {
  return {
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
  };
}

function detectRootStatementType(sql) {
  const match = normalizeSql(sql).match(/^(with|select|insert|update|delete|create|merge)\b/i);

  if (!match) {
    return "UNKNOWN";
  }

  if (match[1].toUpperCase() === "WITH") {
    return "SELECT";
  }

  return match[1].toUpperCase();
}

function detectStatementType(sql) {
  const match = normalizeSql(sql).match(/^(with|select|insert|update|delete|create|merge)\b/i);

  if (!match) {
    return "UNKNOWN";
  }

  if (match[1].toUpperCase() === "WITH") {
    return "SELECT";
  }

  return match[1].toUpperCase();
}

function buildFlowSequence(
  statementType,
  clauses,
  writes = [],
  groupByKind = "",
  setOperatorKind = "",
  conflictKind = "",
) {
  const flow = [statementType];

  for (const clause of CLAUSE_ORDER) {
    if (clauses[clause.key]) {
      flow.push(
        clause.key === "union"
          ? buildSetOperatorLabel(setOperatorKind)
          : clause.key === "groupBy"
            ? buildGroupByLabel(groupByKind)
            : clause.key === "conflict"
              ? buildConflictLabel()
              : clause.key === "conflictAction"
                ? buildConflictActionLabel(conflictKind)
            : clause.label,
      );
    }
  }

  flow.push("RESULT");

  if (writes.length) {
    flow.push("WRITE");
  }

  return flow;
}

function extractClauseRanges(sql, baseOffset = 0) {
  const maskedSql = maskCommentsPreserveOffsets(sql);
  const patterns = [
    { key: "distinct", regex: /^\s*select\s+distinct(?:\s+on)?\b/i },
    { key: "join", regex: /\b((left|right|inner|full|cross)\s+)?join\b/i },
    { key: "mergeOn", regex: null },
    { key: "matched", regex: /\bwhen\s+matched\b/i },
    { key: "notMatched", regex: /\bwhen\s+not\s+matched\b/i },
    { key: "set", regex: /\bset\b/i },
    { key: "values", regex: /\bvalues\s*\(/i },
    { key: "conflict", regex: /\bon\s+conflict\b/i },
    { key: "conflictAction", regex: /\bdo\s+(?:update|nothing)\b/i },
    { key: "returning", regex: /\breturning\b/i },
    { key: "where", regex: /\bwhere\b/i },
    { key: "groupBy", regex: /\bgroup\s+by\b/i },
    { key: "having", regex: /\bhaving\b/i },
    { key: "window", regex: /\bover\s*\(|\bwindow\b/i },
    { key: "qualify", regex: /\bqualify\b/i },
    { key: "union", regex: /\b(?:union(?:\s+all)?|intersect|except)\b/i },
    { key: "orderBy", regex: /\border\s+by\b/i },
    { key: "limit", regex: /\blimit\b/i },
    { key: "offset", regex: /\boffset\b/i },
  ];
  const matches = patterns
    .map((pattern) => {
      if (pattern.key === "mergeOn") {
        const mergeOnIndex = findMergeOnIndex(maskedSql);

        if (mergeOnIndex < 0) {
          return null;
        }

        return {
          key: pattern.key,
          start: baseOffset + mergeOnIndex,
        };
      }

      const match = pattern.regex.exec(maskedSql);

      if (!match || typeof match.index !== "number") {
        return null;
      }

      return {
        key: pattern.key,
        start: baseOffset + match.index,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
  const ranges = new Map();

  matches.forEach((match, index) => {
    const next = matches[index + 1];
    ranges.set(match.key, {
      start: match.start,
      end: next ? next.start : baseOffset + maskedSql.length,
    });
  });

  return ranges;
}

function buildGraph({
  statementType,
  ctes,
  statementSources,
  statementColumns,
  statementSubqueries = [],
  writes,
  clauses,
  joinTypes = [],
  groupByKind = "",
  distinctKind = "",
  setOperatorKind = "",
  valuesRowCount = 0,
  conflictKind = "",
  mergeActionKinds = {},
  mainStatementSql,
  mainStatementStart,
  statementRangeEnd,
}) {
  const nodes = [];
  const edges = [];
  const sourceNodeMap = new Map();
  const cteNodeMap = new Map();
  const subqueryNodeMap = new Map();
  const clauseRanges = extractClauseRanges(mainStatementSql || "", mainStatementStart || 0);
  const sourceMetaByName = new Map();
  const graphSubqueries = [
    ...(statementSubqueries || []),
    ...ctes.flatMap((cte) => cte.subqueries || []),
  ];

  for (const cte of ctes) {
    const nodeId = `cte:${cte.name}`;
    cteNodeMap.set(normalizeName(cte.name), nodeId);
  }

  for (const source of [
    ...statementSources,
    ...ctes.flatMap((cte) => cte.sources || []),
    ...graphSubqueries.flatMap((subquery) => subquery.sources || []),
  ]) {
    const normalizedName = normalizeName(source.name);

    if (!sourceMetaByName.has(normalizedName)) {
      sourceMetaByName.set(normalizedName, {
        rangeStart: null,
        rangeEnd: null,
        ranges: [],
      });
    }

    const existing = sourceMetaByName.get(normalizedName);
    const nextRanges = mergeRanges(
      existing.ranges,
      source.ranges ||
        (typeof source.rangeStart === "number" && typeof source.rangeEnd === "number"
          ? [{ start: source.rangeStart, end: source.rangeEnd }]
          : []),
    );
    const primaryRange = nextRanges[0] || null;

    sourceMetaByName.set(normalizedName, {
      rangeStart: primaryRange?.start ?? existing.rangeStart,
      rangeEnd: primaryRange?.end ?? existing.rangeEnd,
      ranges: nextRanges,
    });
  }

  for (const cte of ctes) {
    const nodeId = cteNodeMap.get(normalizeName(cte.name));
    const referenceMeta = sourceMetaByName.get(normalizeName(cte.name));
    const cteRanges = mergeRanges(
      typeof cte.rangeStart === "number" && typeof cte.rangeEnd === "number"
        ? [{ start: cte.rangeStart, end: cte.rangeEnd }]
        : typeof cte.bodyRangeStart === "number" && typeof cte.bodyRangeEnd === "number"
          ? [{ start: cte.bodyRangeStart, end: cte.bodyRangeEnd }]
          : [],
      referenceMeta?.ranges || [],
    );

    nodes.push({
      id: nodeId,
      type: "cte",
      label: cte.name,
      meta: {
        sourceCount: cte.sourceCount,
        dependencyCount: cte.dependencies.length,
        recursive: Boolean(cte.recursive),
        rangeStart: cte.rangeStart ?? cte.bodyRangeStart ?? null,
        rangeEnd: cte.rangeEnd ?? cte.bodyRangeEnd ?? null,
        ranges: cteRanges,
        bodyRangeStart: cte.bodyRangeStart ?? null,
        bodyRangeEnd: cte.bodyRangeEnd ?? null,
        flowSequence: cte.flowSequence || [],
        statementType: cte.statementType || "",
      },
    });
  }

  for (const source of statementSources) {
    const normalizedName = normalizeName(source.name);

    if (cteNodeMap.has(normalizedName)) {
      continue;
    }

    if (!sourceNodeMap.has(normalizedName)) {
      const nodeId = `source:${source.name}`;
      const sourceNodeType = resolveSourceNodeType(source);
      const sourceMeta = sourceMetaByName.get(normalizedName);
      sourceNodeMap.set(normalizedName, nodeId);
      nodes.push({
        id: nodeId,
        type: sourceNodeType,
        label: source.name,
        meta: {
          sourceType: source.type || "from",
          sampleKind: source.sampleKind || "",
          rangeStart: sourceMeta?.rangeStart ?? null,
          rangeEnd: sourceMeta?.rangeEnd ?? null,
          ranges: sourceMeta?.ranges || [],
        },
      });
    }
  }

  for (const subquery of graphSubqueries) {
    subqueryNodeMap.set(subquery.id, subquery.id);
    nodes.push({
      id: subquery.id,
      type: subquery.type,
      label: subquery.label,
      meta: {
        sourceCount: subquery.sourceCount ?? subquery.sources?.length ?? 0,
        clauseCount: Object.values(subquery.clauses || {}).filter(Boolean).length,
        parentNodeId: subquery.parentNodeId || null,
        setOperator: subquery.setOperator || null,
      },
    });
  }

  const statementNodeId = "statement:main";
  nodes.push({
    id: statementNodeId,
    type: "statement",
    label: statementType,
    meta: {
      rangeStart: typeof mainStatementStart === "number" ? mainStatementStart : 0,
      rangeEnd: typeof statementRangeEnd === "number" ? statementRangeEnd : null,
    },
  });

  let previousNodeId = statementNodeId;

  for (const clause of CLAUSE_ORDER) {
    if (!clauses[clause.key]) {
      continue;
    }

    const clauseNodeId = `clause:${clause.key}`;
    const clauseRange = clauseRanges.get(clause.key) || null;
    const clauseConfig = buildClauseNodeConfig(
      clause.key,
      joinTypes,
      groupByKind,
      distinctKind,
      setOperatorKind,
      valuesRowCount,
      conflictKind,
      mergeActionKinds,
    );
    nodes.push({
      id: clauseNodeId,
      type: clauseConfig.type,
      label: clauseConfig.label,
      meta: {
        joinTypes: clauseConfig.joinTypes,
        groupByKind: clauseConfig.groupByKind || "",
        distinctKind: clauseConfig.distinctKind,
        setOperatorKind: clauseConfig.setOperatorKind || "",
        valuesRowCount: clauseConfig.valuesRowCount || 0,
        conflictKind: clauseConfig.conflictKind || "",
        mergeAction: clauseConfig.mergeAction || "",
        mergeActionKind: clauseConfig.mergeActionKind || "",
        rangeStart: clauseRange?.start ?? null,
        rangeEnd: clauseRange?.end ?? null,
        ranges: clauseRange ? [{ start: clauseRange.start, end: clauseRange.end }] : [],
      },
    });
    edges.push({
      id: `edge:${previousNodeId}->${clauseNodeId}`,
      source: previousNodeId,
      target: clauseNodeId,
      type: "transforms_to",
    });
    previousNodeId = clauseNodeId;
  }

  const resultNodeId = "result:main";
  nodes.push({
    id: resultNodeId,
    type: "result",
    label: "RESULT",
  });
  edges.push({
    id: `edge:${previousNodeId}->${resultNodeId}`,
    source: previousNodeId,
    target: resultNodeId,
    type: "feeds_result",
  });

  for (const [index, write] of (writes || []).entries()) {
    const writeNodeId = `write:${write.kind || "write"}:${normalizeName(write.name)}:${index}`;
    nodes.push({
      id: writeNodeId,
      type: "write_target",
      label: write.name,
      meta: {
        writeKind: write.kind || "write",
      },
    });
    edges.push({
      id: `edge:${resultNodeId}->${writeNodeId}`,
      source: resultNodeId,
      target: writeNodeId,
      type: "writes_to",
    });
  }

  for (const cte of ctes) {
    const targetNodeId = cteNodeMap.get(normalizeName(cte.name));

    for (const source of cte.sources) {
      const sourceName = normalizeName(source.name);

      if (cteNodeMap.has(sourceName)) {
        edges.push({
          id: `edge:${cteNodeMap.get(sourceName)}->${targetNodeId}`,
          source: cteNodeMap.get(sourceName),
          target: targetNodeId,
          type: "reads_from",
          sourceRole: normalizeEdgeSourceRole(source.type),
        });
      } else {
        let sourceNodeId = sourceNodeMap.get(sourceName);

        if (!sourceNodeId) {
          sourceNodeId = `source:${source.name}`;
          sourceNodeMap.set(sourceName, sourceNodeId);
          const sourceNodeType = resolveSourceNodeType(source);
          const sourceMeta = sourceMetaByName.get(sourceName);
          nodes.push({
            id: sourceNodeId,
            type: sourceNodeType,
            label: source.name,
            meta: {
              sourceType: source.type || "from",
              sampleKind: source.sampleKind || "",
              rangeStart: sourceMeta?.rangeStart ?? null,
              rangeEnd: sourceMeta?.rangeEnd ?? null,
              ranges: sourceMeta?.ranges || [],
            },
          });
        }

        edges.push({
          id: `edge:${sourceNodeId}->${targetNodeId}`,
          source: sourceNodeId,
          target: targetNodeId,
          type: "reads_from",
          sourceRole: normalizeEdgeSourceRole(source.type),
        });
      }
    }
  }

  for (const subquery of graphSubqueries) {
    const targetNodeId = subquery.id;

    for (const source of subquery.sources || []) {
      const sourceName = normalizeName(source.name);

      if (cteNodeMap.has(sourceName)) {
        edges.push({
          id: `edge:${cteNodeMap.get(sourceName)}->${targetNodeId}:subquery`,
          source: cteNodeMap.get(sourceName),
          target: targetNodeId,
          type: "reads_from",
          sourceRole: normalizeEdgeSourceRole(source.type),
        });
        continue;
      }

      let sourceNodeId = sourceNodeMap.get(sourceName);

      if (!sourceNodeId) {
        sourceNodeId = `source:${source.name}`;
        sourceNodeMap.set(sourceName, sourceNodeId);
        const sourceNodeType = resolveSourceNodeType(source);
        const sourceMeta = sourceMetaByName.get(sourceName);
        nodes.push({
          id: sourceNodeId,
          type: sourceNodeType,
          label: source.name,
          meta: {
            sourceType: source.type || "from",
            sampleKind: source.sampleKind || "",
            rangeStart: sourceMeta?.rangeStart ?? null,
            rangeEnd: sourceMeta?.rangeEnd ?? null,
            ranges: sourceMeta?.ranges || [],
          },
        });
      }

      edges.push({
        id: `edge:${sourceNodeId}->${targetNodeId}:subquery`,
        source: sourceNodeId,
        target: targetNodeId,
        type: "reads_from",
        sourceRole: normalizeEdgeSourceRole(source.type),
      });
    }

    const parentNodeId =
      subqueryNodeMap.get(subquery.parentNodeId) ||
      cteNodeMap.get(normalizeName(subquery.parentNodeId)) ||
      (subquery.parentNodeId === "statement:main" ? statementNodeId : null);

    if (parentNodeId) {
      edges.push({
        id: `edge:${targetNodeId}->${parentNodeId}:subquery-parent`,
        source: targetNodeId,
        target: parentNodeId,
        type: "subquery_for",
      });
    }
  }

  for (const source of statementSources) {
    const sourceName = normalizeName(source.name);
    const sourceNodeId = cteNodeMap.get(sourceName) || sourceNodeMap.get(sourceName);

    if (!sourceNodeId) {
      continue;
    }

    edges.push({
      id: `edge:${sourceNodeId}->${statementNodeId}:statement`,
      source: sourceNodeId,
      target: statementNodeId,
      type: "reads_from",
      sourceRole: normalizeEdgeSourceRole(source.type),
    });
  }

  return {
    nodes: uniqueById(nodes),
    edges: uniqueById(edges),
    columns: [
      ...ctes.flatMap((cte) => cte.columns || []),
      ...(statementColumns || []),
    ],
  };
}

function buildClauseNodeConfig(
  clauseKey,
  joinTypes,
  groupByKind,
  distinctKind,
  setOperatorKind = "",
  valuesRowCount = 0,
  conflictKind = "",
  mergeActionKinds = {},
) {
  if (clauseKey === "mergeOn") {
    return {
      type: "merge_match",
      label: "MATCH ON",
      joinTypes: [],
      distinctKind: "",
      setOperatorKind: "",
    };
  }

  if (clauseKey === "where") {
    return {
      type: "filter",
      label: "FILTER",
      joinTypes: [],
      distinctKind: "",
    };
  }

  if (clauseKey === "groupBy") {
    return {
      type: "aggregate",
      label: buildGroupByLabel(groupByKind),
      joinTypes: [],
      groupByKind,
      distinctKind: "",
    };
  }

  if (clauseKey === "join") {
    return {
      type: "join",
      label: buildJoinClauseLabel(joinTypes),
      joinTypes: joinTypes || [],
      distinctKind: "",
    };
  }

  if (clauseKey === "set") {
    return {
      type: "set",
      label: "SET",
      joinTypes: [],
      distinctKind: "",
      setOperatorKind: "",
    };
  }

  if (clauseKey === "values") {
    return {
      type: "values",
      label: valuesRowCount > 0 ? `VALUES (${valuesRowCount})` : "VALUES",
      joinTypes: [],
      distinctKind: "",
      setOperatorKind: "",
      valuesRowCount,
    };
  }

  if (clauseKey === "returning") {
    return {
      type: "returning",
      label: "RETURNING",
      joinTypes: [],
      distinctKind: "",
      setOperatorKind: "",
    };
  }

  if (clauseKey === "conflict") {
    return {
      type: "conflict",
      label: buildConflictLabel(),
      joinTypes: [],
      distinctKind: "",
      setOperatorKind: "",
      conflictKind,
    };
  }

  if (clauseKey === "conflictAction") {
    return {
      type: "conflict_action",
      label: buildConflictActionLabel(conflictKind),
      joinTypes: [],
      distinctKind: "",
      setOperatorKind: "",
      conflictKind,
    };
  }

  if (clauseKey === "matched" || clauseKey === "notMatched") {
    const mergeActionKind = String(
      clauseKey === "matched" ? mergeActionKinds.matched || "" : mergeActionKinds.notMatched || "",
    )
      .trim()
      .toLowerCase();
    const actionSuffix = mergeActionKind ? ` ${mergeActionKind.toUpperCase()}` : "";
    return {
      type: "merge_action",
      label: `${clauseKey === "matched" ? "WHEN MATCHED" : "WHEN NOT MATCHED"}${actionSuffix}`,
      joinTypes: [],
      distinctKind: "",
      mergeAction: clauseKey,
      mergeActionKind,
      setOperatorKind: "",
    };
  }

  if (clauseKey === "distinct") {
    return {
      type: "distinct",
      label: distinctKind === "DISTINCT ON" ? "DISTINCT ON" : "DISTINCT",
      joinTypes: [],
      distinctKind,
      setOperatorKind: "",
    };
  }

  if (clauseKey === "union") {
    return {
      type: "union",
      label: buildSetOperatorLabel(setOperatorKind),
      joinTypes: [],
      distinctKind: "",
      setOperatorKind,
    };
  }

  if (clauseKey === "offset") {
    return {
      type: "offset",
      label: "OFFSET",
      joinTypes: [],
      distinctKind: "",
      setOperatorKind: "",
    };
  }

  const definition = CLAUSE_ORDER.find((clause) => clause.key === clauseKey);
  return {
    type: clauseKey,
    label: definition?.label || String(clauseKey || "").toUpperCase(),
    joinTypes: [],
    distinctKind: "",
    setOperatorKind: "",
  };
}

function resolveSourceNodeType(source) {
  const sourceType = String(source?.type || "").trim().toLowerCase();

  if (sourceType === "unnest") {
    return "unnest_source";
  }

  if (sourceType === "lateral_view") {
    return "lateral_view";
  }

  return "source_table";
}

function detectSetOperatorKind(sql) {
  const maskedSql = maskCommentsPreserveOffsets(sql);
  const match = /\b(union(?:\s+all)?|intersect|except)\b/i.exec(maskedSql);

  return match ? String(match[1] || "").trim().toUpperCase() : "";
}

function buildSetOperatorLabel(setOperatorKind) {
  const normalized = String(setOperatorKind || "").trim().toUpperCase();
  return normalized || "UNION";
}

function buildConflictLabel() {
  return "ON CONFLICT";
}

function buildConflictActionLabel(conflictKind) {
  const normalized = String(conflictKind || "").trim().toUpperCase();
  return normalized || "DO UPDATE";
}

function buildGroupByLabel(groupByKind) {
  const normalized = String(groupByKind || "").trim().toUpperCase();
  return normalized || "GROUP BY";
}

function detectConflictKind(sql) {
  const maskedSql = maskCommentsPreserveOffsets(sql);

  if (/\bon\s+conflict\b[\s\S]*?\bdo\s+update\b/i.test(maskedSql)) {
    return "DO UPDATE";
  }

  if (/\bon\s+conflict\b[\s\S]*?\bdo\s+nothing\b/i.test(maskedSql)) {
    return "DO NOTHING";
  }

  return "";
}

function detectMergeActionKinds(sql) {
  const maskedSql = maskCommentsPreserveOffsets(sql);
  const result = {
    matched: "",
    notMatched: "",
  };

  const matchedBlock = /\bwhen\s+matched\b[\s\S]*?\bthen\b([\s\S]*?)(?=\bwhen\s+(?:not\s+)?matched\b|$)/i.exec(
    maskedSql,
  );
  const notMatchedBlock =
    /\bwhen\s+not\s+matched\b[\s\S]*?\bthen\b([\s\S]*?)(?=\bwhen\s+(?:not\s+)?matched\b|$)/i.exec(
      maskedSql,
    );

  result.matched = detectMergeBranchActionKind(matchedBlock?.[1] || "");
  result.notMatched = detectMergeBranchActionKind(notMatchedBlock?.[1] || "");

  return result;
}

function detectMergeBranchActionKind(sql) {
  const normalized = String(sql || "").trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (/\bupdate\b/.test(normalized)) {
    return "update";
  }

  if (/\bdelete\b/.test(normalized)) {
    return "delete";
  }

  if (/\binsert\b/.test(normalized) || /\bvalues\b/.test(normalized)) {
    return "insert";
  }

  return "action";
}

function buildJoinClauseLabel(joinTypes) {
  const uniqueJoinTypes = Array.from(new Set((joinTypes || []).map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)));

  if (!uniqueJoinTypes.length) {
    return "JOIN";
  }

  if (uniqueJoinTypes.length === 1) {
    return `${uniqueJoinTypes[0]} JOIN`;
  }

  return "MULTI JOIN";
}

function normalizeEdgeSourceRole(sourceType) {
  const value = String(sourceType || "").trim().toLowerCase();

  if (!value || value === "from") {
    return "from";
  }

  if (value === "join" || value === "using") {
    return "join";
  }

  if (value.includes("join")) {
    return "join";
  }

  return value;
}

function detectDistinctKind(sql) {
  if (/^\s*select\s+distinct\s+on\b/i.test(sql)) {
    return "DISTINCT ON";
  }

  if (/^\s*select\s+distinct\b/i.test(sql)) {
    return "DISTINCT";
  }

  return "";
}

function findMergeOnIndex(maskedSql) {
  const mergePrefixMatch = /\bmerge\s+into\b[\s\S]*?\busing\b[\s\S]*?\bon\b/i.exec(maskedSql);

  if (!mergePrefixMatch || typeof mergePrefixMatch.index !== "number") {
    return -1;
  }

  const usingMatch = /\busing\b/i.exec(mergePrefixMatch[0]);

  if (!usingMatch || typeof usingMatch.index !== "number") {
    return -1;
  }

  const afterUsing = mergePrefixMatch[0].slice(usingMatch.index + usingMatch[0].length);
  const onMatch = /\bon\b/i.exec(afterUsing);

  if (!onMatch || typeof onMatch.index !== "number") {
    return -1;
  }

  return mergePrefixMatch.index + usingMatch.index + usingMatch[0].length + onMatch.index;
}

function buildStatementTitle(index, rootStatementType, ctes, writes) {
  if (writes.length) {
    return `#${index + 1} ${rootStatementType} ${writes[0].name}`;
  }

  if (ctes.length) {
    const withPrefix = ctes.some((cte) => cte?.recursive) ? "WITH RECURSIVE" : "WITH";
    return `#${index + 1} ${withPrefix} ${ctes.map((cte) => cte.name).slice(0, 2).join(", ")}`;
  }

  return `#${index + 1} ${rootStatementType}`;
}

function mergeSourceMatches(items) {
  const merged = new Map();

  for (const item of items) {
    const key = normalizeName(item.name);

    if (!key) {
      continue;
    }

    if (!merged.has(key)) {
      merged.set(key, {
        ...item,
        ranges: mergeRanges(
          [],
          item.ranges ||
            (typeof item.rangeStart === "number" && typeof item.rangeEnd === "number"
              ? [{ start: item.rangeStart, end: item.rangeEnd }]
              : []),
        ),
      });
      continue;
    }

    const current = merged.get(key);
    const ranges = mergeRanges(
      current.ranges || [],
      item.ranges ||
        (typeof item.rangeStart === "number" && typeof item.rangeEnd === "number"
          ? [{ start: item.rangeStart, end: item.rangeEnd }]
          : []),
    );

    merged.set(key, {
      ...current,
      type: preferSourceType(current.type, item.type),
      rangeStart: ranges[0]?.start ?? current.rangeStart ?? item.rangeStart ?? null,
      rangeEnd: ranges[0]?.end ?? current.rangeEnd ?? item.rangeEnd ?? null,
      ranges,
    });
  }

  return Array.from(merged.values());
}

function mergeRanges(leftRanges, rightRanges) {
  const ranges = [...leftRanges, ...rightRanges]
    .filter((range) => typeof range?.start === "number" && typeof range?.end === "number")
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const unique = [];
  const seen = new Set();

  for (const range of ranges) {
    const key = `${range.start}:${range.end}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push({
      start: range.start,
      end: range.end,
    });
  }

  return unique;
}

function uniqueByName(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = normalizeName(item.name);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function uniqueById(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (!item?.id || seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    result.push(item);
  }

  return result;
}

function normalizeSql(sql) {
  if (typeof sql !== "string") {
    return "";
  }

  return sql.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function createSqlPreview(sql) {
  if (!sql) {
    return "";
  }

  if (sql.length <= MAX_SQL_PREVIEW_LENGTH) {
    return sql;
  }

  return `${sql.slice(0, MAX_SQL_PREVIEW_LENGTH)}\n...`;
}

function normalizeName(value) {
  return stripIdentifierQuotes(String(value || "")).toLowerCase();
}

function skipWhitespace(sql, index) {
  let cursor = index;

  while (cursor < sql.length && /\s/.test(sql[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function startsWithWord(sql, index, word) {
  const fragment = sql.slice(index, index + word.length);
  const before = index === 0 ? " " : sql[index - 1];
  const after = sql[index + word.length] || " ";
  return fragment.toLowerCase() === word.toLowerCase() && /\W/.test(before) && /\W/.test(after);
}

function readIdentifier(sql, index) {
  const start = skipWhitespace(sql, index);
  const char = sql[start];

  if (!char) {
    return null;
  }

  if (char === '"' || char === "`" || char === "[") {
    const closing = char === "[" ? "]" : char;
    const end = sql.indexOf(closing, start + 1);

    if (end === -1) {
      return null;
    }

    return {
      startIndex: start,
      value: sql.slice(start, end + 1),
      nextIndex: end + 1,
    };
  }

  const match = /^[a-zA-Z0-9_.-]+/.exec(sql.slice(start));

  if (!match) {
    return null;
  }

  return {
    startIndex: start,
    value: match[0],
    nextIndex: start + match[0].length,
  };
}

function readBalanced(sql, index, openChar, closeChar) {
  let depth = 0;
  let cursor = index;

  while (cursor < sql.length) {
    const char = sql[cursor];

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;

      if (depth === 0) {
        return {
          startIndex: index,
          endIndex: cursor,
          content: sql.slice(index + 1, cursor),
          nextIndex: cursor + 1,
        };
      }
    }

    cursor += 1;
  }

  return {
    startIndex: index,
    endIndex: sql.length - 1,
    content: sql.slice(index + 1),
    nextIndex: sql.length,
  };
}

function stripIdentifierQuotes(value) {
  return String(value || "").replace(/[`"\[\]]/g, "");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

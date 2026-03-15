export type AnalysisDialectPreference =
  | "auto"
  | "postgresql"
  | "hive"
  | "trino"
  | "oracle";

export type AnalysisDetectedDialect =
  | "generic"
  | "postgresql"
  | "hive"
  | "trino-like"
  | "oracle-like";

export interface GraphNode {
  id: string;
  type?: string;
  label?: string;
  meta?: Record<string, unknown>;
}

export interface GraphColumnRef {
  sourceNodeId?: string;
  sourceName?: string;
  qualifier?: string | null;
  columnName?: string;
}

export interface GraphColumn {
  id: string;
  nodeId: string;
  name: string;
  label?: string;
  selectItemIndex?: number;
  role?: "source" | "derived" | "aggregate" | "window" | "wildcard" | "function";
  expressionType?: string;
  expressionSql?: string;
  spans?: AnalysisRange[];
  upstream?: GraphColumnRef[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  sourceRole?: string;
}

export interface QueryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  columns?: GraphColumn[];
}

export interface AnalysisSummary {
  cteCount?: number;
  sourceCount?: number;
  joinCount?: number;
  clauseCount?: number;
  templateCount?: number;
  statementType?: string;
}

export interface AnalysisClauses {
  distinct?: boolean;
  join?: boolean;
  mergeOn?: boolean;
  matched?: boolean;
  notMatched?: boolean;
  set?: boolean;
  values?: boolean;
  conflict?: boolean;
  conflictAction?: boolean;
  returning?: boolean;
  where?: boolean;
  groupBy?: boolean;
  having?: boolean;
  window?: boolean;
  qualify?: boolean;
  union?: boolean;
  orderBy?: boolean;
  limit?: boolean;
  offset?: boolean;
}

export interface AnalysisCte {
  name: string;
  recursive?: boolean;
  sourceCount?: number;
  dependencies?: string[];
  rangeStart?: number;
  rangeEnd?: number;
  bodyRangeStart?: number;
  bodyRangeEnd?: number;
  columns?: GraphColumn[];
  flowSequence?: string[];
}

export interface AnalysisRange {
  start: number;
  end: number;
}

export interface AnalysisSource {
  name: string;
  type?: string;
  sampleKind?: string;
  rangeStart?: number;
  rangeEnd?: number;
  ranges?: AnalysisRange[];
}

export interface AnalysisWriteTarget {
  name: string;
  kind?: string;
}

export interface ScriptDependency {
  id: string;
  sourceIndex: number;
  targetIndex: number;
  via: string[];
  type?: string;
}

export interface ScriptSummary {
  statementCount?: number;
  dependencyCount?: number;
  linkedStatementCount?: number;
  independentStatementCount?: number;
}

export interface AnalysisStatement {
  id: string;
  index: number;
  title?: string;
  sql?: string;
  sqlPreview?: string;
  rangeStart?: number;
  rangeEnd?: number;
  mode?: string;
  parserDialect?: "postgresql" | "hive" | "trino" | null;
  parserEngine?: "node" | "dt" | null;
  parserAttempts?: string[];
  parserErrorMessage?: string | null;
  normalizedSql?: string;
  statementType?: string;
  summary?: AnalysisSummary | null;
  clauses?: AnalysisClauses | null;
  graph?: QueryGraph | null;
  flowSequence?: string[];
  ctes?: AnalysisCte[];
  sources?: AnalysisSource[];
  reads?: AnalysisSource[];
  writes?: AnalysisWriteTarget[];
  dependencies?: number[];
  dependents?: number[];
  errorMessage?: string;
}

export interface AnalysisResult {
  mode?: string;
  normalizedSql?: string;
  generatedAt?: number;
  dialectPreference?: AnalysisDialectPreference;
  detectedDialect?: AnalysisDetectedDialect;
  parserDialect?: "postgresql" | "hive" | "trino" | null;
  parserEngine?: "node" | "dt" | null;
  parserAttempts?: string[];
  parserErrorMessage?: string | null;
  dialectConfidence?: number;
  dialectSignals?: string[];
  isMultiStatement?: boolean;
  activeStatementIndex?: number;
  statementType?: string;
  summary?: AnalysisSummary | null;
  clauses?: AnalysisClauses | null;
  graph?: QueryGraph | null;
  flowSequence?: string[];
  ctes?: AnalysisCte[];
  sources?: AnalysisSource[];
  statements?: AnalysisStatement[];
  scriptDependencies?: ScriptDependency[];
  scriptSummary?: ScriptSummary | null;
  errorMessage?: string;
}

export interface ExecutionState {
  status?: string;
  queryId?: string | number | null;
  durationMs?: number | null;
  rowCount?: number | null;
  lastKind?: string | null;
  lastPhase?: string | null;
  errorMessage?: string | null;
}

export interface ExecutionEvent {
  at?: number;
  kind?: string;
  phase?: string;
  method?: string;
  httpStatus?: number | null;
  status?: string | null;
  rowCount?: number | null;
  queryId?: string | number | null;
  errorMessage?: string | null;
}

export interface TabSession {
  tabId: number;
  url?: string;
  title?: string;
  siteOrigin?: string;
  sitePermissionPattern?: string;
  siteAccessSupported?: boolean;
  siteAccessGranted?: boolean;
  isSupersetLike?: boolean;
  isSqlLab?: boolean;
  signals?: string[];
  bridgeReady?: boolean;
  hasSqlSnapshot?: boolean;
  sql?: string;
  sqlPreview?: string;
  sqlSource?: string;
  sqlLength?: number;
  sqlUpdatedAt?: number | null;
  capturedSql?: string;
  capturedSqlPreview?: string;
  capturedSqlSource?: string;
  capturedSqlLength?: number;
  capturedSqlUpdatedAt?: number | null;
  analysisInputMode?: "page" | "captured";
  activeSql?: string;
  activeSqlPreview?: string;
  activeSqlSource?: string;
  activeSqlLength?: number;
  sqlLabSidebarHidden?: boolean;
  sqlSelectionText?: string;
  sqlSelectionSource?: string;
  sqlSelectionUpdatedAt?: number | null;
  sqlSelectionStart?: number | null;
  sqlSelectionEnd?: number | null;
  resultRowCount?: number | null;
  analysisDialectPreference?: AnalysisDialectPreference;
  updatedAt?: number;
  execution?: ExecutionState | null;
  executionEvents?: ExecutionEvent[];
  analysis?: AnalysisResult | null;
}

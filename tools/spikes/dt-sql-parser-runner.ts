import { HiveSQL, PostgreSQL, TrinoSQL } from "dt-sql-parser";

type DialectName = "hive" | "postgresql" | "trino";

type Sample = {
  name: string;
  sql: string;
  dialects: DialectName[];
};

type DialectResult = {
  dialect: DialectName;
  validateErrorCount: number;
  validateMessages: string[];
  parseSuccess: boolean;
  parseError: string | null;
  splitCount: number | null;
};

type SampleResult = {
  name: string;
  dialectResults: DialectResult[];
};

const DIALECT_MAP = {
  hive: HiveSQL,
  postgresql: PostgreSQL,
  trino: TrinoSQL,
} as const;

export async function runDtSqlParserSamples(samples: Sample[]): Promise<SampleResult[]> {
  return samples.map((sample) => ({
    name: sample.name,
    dialectResults: sample.dialects.map((dialect) => runDialectSample(sample.sql, dialect)),
  }));
}

function runDialectSample(sql: string, dialect: DialectName): DialectResult {
  const ParserClass = DIALECT_MAP[dialect];
  const parser = new ParserClass();
  const validateErrors = withMutedConsole(() => parser.validate(sql) || []);
  let parseSuccess = false;
  let parseError: string | null = null;
  let splitCount: number | null = null;

  try {
    withMutedConsole(() => parser.parse(sql));
    parseSuccess = true;
  } catch (error) {
    parseError = normalizeError(error);
  }

  try {
    splitCount = withMutedConsole(() => (parser.splitSQLByStatement(sql) || []).length);
  } catch (_error) {
    splitCount = null;
  }

  return {
    dialect,
    validateErrorCount: validateErrors.length,
    validateMessages: validateErrors.slice(0, 3).map((error) => normalizeError(error?.message || error)),
    parseSuccess,
    parseError,
    splitCount,
  };
}

function normalizeError(error: unknown) {
  const message = String(error || "").replace(/\s+/g, " ").trim();

  if (!message) {
    return "unknown error";
  }

  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function withMutedConsole<T>(run: () => T): T {
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};

  try {
    return run();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

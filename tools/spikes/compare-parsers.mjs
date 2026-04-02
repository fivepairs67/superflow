import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import nodeSqlParser from "node-sql-parser";

import { analyzeSql } from "../../extension/sql-analysis.js";

const { Parser } = nodeSqlParser;
const NODE_AST_PARSER = new Parser();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "../..");
const FIXTURE_DIR = path.join(PROJECT_ROOT, "fixtures/sql");
const DT_RUNNER_ENTRY = path.join(PROJECT_ROOT, "tools/spikes/dt-sql-parser-runner.ts");

async function main() {
  const samples = await loadSamples();
  const dtRunner = await loadDtRunner();
  const dtResults = await dtRunner.runDtSqlParserSamples(samples);
  const nodeResults = runNodeSqlParserSamples(samples);

  const merged = samples.map((sample, index) => ({
    name: sample.name,
    currentAnalyzer: nodeResults[index],
    dtSqlParser: dtResults[index],
  }));

  printReport(merged);
}

async function loadSamples() {
  const fixtures = await fs.readdir(FIXTURE_DIR);
  const fixtureSamples = await Promise.all(
    fixtures
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map(async (name) => ({
        name: `fixture:${name}`,
        sql: await fs.readFile(path.join(FIXTURE_DIR, name), "utf8"),
        dialects: inferDtDialects(name),
      })),
  );

  return [
    ...fixtureSamples,
    {
      name: "sample:hive_external_table",
      sql: `DROP TABLE log4jLogs;
CREATE EXTERNAL TABLE log4jLogs (
    t1 string,
    t2 string,
    t3 string,
    t4 string,
    t5 string,
    t6 string,
    t7 string)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ' '
STORED AS TEXTFILE LOCATION '/example/data/';
SELECT t4 AS sev, COUNT(*) AS count FROM log4jLogs
    WHERE t4 = '[ERROR]' AND INPUT__FILE__NAME LIKE '%.log'
    GROUP BY t4;`,
      dialects: ["hive", "trino"],
    },
    {
      name: "sample:trino_functions",
      sql: `WITH src AS (
  SELECT user_id, amount, event_ts
  FROM sales
)
SELECT
  count_if(amount > 0) AS paid_cnt,
  approx_percentile(amount, 0.5) AS p50_amount,
  date_diff('day', date(event_ts), current_date) AS days_from_event
FROM src;`,
      dialects: ["trino", "hive", "postgresql"],
    },
    {
      name: "sample:oracle_like",
      sql: `SELECT NVL(sal, 0) AS sal_safe, DECODE(status, 'A', 'ACTIVE', 'INACTIVE') AS status_label
FROM emp
WHERE ROWNUM <= 10
START WITH mgr IS NULL
CONNECT BY PRIOR empno = mgr;`,
      dialects: ["postgresql", "hive", "trino"],
    },
  ];
}

function inferDtDialects(name) {
  if (name.includes("ddl") || name.includes("join") || name.includes("cte")) {
    return ["postgresql", "hive", "trino"];
  }

  if (name.includes("metadata")) {
    return ["postgresql", "trino"];
  }

  return ["postgresql", "hive", "trino"];
}

async function loadDtRunner() {
  const outfile = path.join(os.tmpdir(), `sqv-dt-spike-${Date.now()}.mjs`);

  await build({
    entryPoints: [DT_RUNNER_ENTRY],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });

  return import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
}

function runNodeSqlParserSamples(samples) {
  return samples.map((sample) => {
    const analyzerByPreference = {
      auto: summarizeAnalyzer(sample.sql, "auto"),
      postgresql: summarizeAnalyzer(sample.sql, "postgresql"),
      hive: summarizeAnalyzer(sample.sql, "hive"),
      trino: summarizeAnalyzer(sample.sql, "trino"),
      oracle: summarizeAnalyzer(sample.sql, "oracle"),
    };

    const rawParserAttempts = ["postgresql", "hive"].map((dialect) =>
      summarizeRawNodeParser(sample.sql, dialect),
    );

    return {
      analyzerByPreference,
      rawParserAttempts,
    };
  });
}

function summarizeAnalyzer(sql, dialectPreference) {
  const analysis = analyzeSql(sql, { dialectPreference });

  return {
    dialectPreference,
    detectedDialect: analysis.detectedDialect || null,
    parserDialect: analysis.parserDialect || null,
    mode: analysis.mode || null,
    statementModes: (analysis.statements || []).map((statement) => statement.mode || null),
    firstParserError:
      (analysis.statements || []).find((statement) => statement.parserErrorMessage)?.parserErrorMessage ||
      analysis.parserErrorMessage ||
      null,
  };
}

function summarizeRawNodeParser(sql, parserDialect) {
  try {
    NODE_AST_PARSER.astify(sql, {
      database: parserDialect === "hive" ? "Hive" : "postgresql",
    });

    return {
      parserDialect,
      parseSuccess: true,
      parseError: null,
    };
  } catch (error) {
    return {
      parserDialect,
      parseSuccess: false,
      parseError: normalizeError(error),
    };
  }
}

function normalizeError(error) {
  const message = String(error?.message || error || "").replace(/\s+/g, " ").trim();
  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
}

function printReport(results) {
  const lines = [];
  lines.push("== Parser Spike: node-sql-parser vs dt-sql-parser ==");
  lines.push("");

  for (const result of results) {
    lines.push(`## ${result.name}`);
    lines.push(
      `current auto -> detected=${result.currentAnalyzer.analyzerByPreference.auto.detectedDialect} parser=${result.currentAnalyzer.analyzerByPreference.auto.parserDialect} mode=${result.currentAnalyzer.analyzerByPreference.auto.mode}`,
    );

    if (result.currentAnalyzer.analyzerByPreference.auto.firstParserError) {
      lines.push(`current fallback -> ${result.currentAnalyzer.analyzerByPreference.auto.firstParserError}`);
    }

    lines.push(
      `node raw -> ${result.currentAnalyzer.rawParserAttempts
        .map((attempt) => `${attempt.parserDialect}:${attempt.parseSuccess ? "ok" : "fail"}`)
        .join(", ")}`,
    );

    for (const dialectResult of result.dtSqlParser.dialectResults) {
      lines.push(
        `dt ${dialectResult.dialect} -> validate=${dialectResult.validateErrorCount} parse=${dialectResult.parseSuccess ? "ok" : "fail"} split=${dialectResult.splitCount ?? "-"}`,
      );

      if (dialectResult.parseError) {
        lines.push(`  parseError: ${dialectResult.parseError}`);
      } else if (dialectResult.validateMessages.length) {
        lines.push(`  validate: ${dialectResult.validateMessages.join(" | ")}`);
      }
    }

    lines.push("");
  }

  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

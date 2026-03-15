import fs from "node:fs/promises";
import path from "node:path";

import { analyzeSql } from "../../extension/sql-analysis.js";

const PROJECT_ROOT = "/home/fivepairs/DEV/superset_query_visualizer";
const SPEC_PATH = path.join(PROJECT_ROOT, "fixtures/parser-fixtures.json");

async function main() {
  const spec = JSON.parse(await fs.readFile(SPEC_PATH, "utf8"));
  const fixtureSpecs = Array.isArray(spec?.fixtures) ? spec.fixtures : [];
  const failures = [];
  const lines = [];

  for (const fixtureSpec of fixtureSpecs) {
    const fixturePath = path.join(PROJECT_ROOT, fixtureSpec.file);
    const sql = await fs.readFile(fixturePath, "utf8");
    const analysis = withMutedConsole(() => analyzeSql(sql, fixtureSpec.options || {}));
    const fixtureFailures = [];

    assertAnalysis(analysis, fixtureSpec.expect || {}, fixtureFailures, fixtureSpec.file);

    for (const statementExpectation of fixtureSpec.statements || []) {
      const statement = (analysis.statements || []).find(
        (candidate) => candidate.index === statementExpectation.index,
      );

      if (!statement) {
        fixtureFailures.push(
          `${fixtureSpec.file}: missing statement index ${statementExpectation.index}`,
        );
        continue;
      }

      assertStatement(
        statement,
        statementExpectation,
        fixtureFailures,
        `${fixtureSpec.file}#${statementExpectation.index + 1}`,
      );
    }

    if (fixtureFailures.length) {
      failures.push(...fixtureFailures);
      lines.push(`FAIL ${fixtureSpec.file}`);
      fixtureFailures.forEach((failure) => lines.push(`  - ${failure}`));
      continue;
    }

    lines.push(
      `PASS ${fixtureSpec.file} (${analysis.mode || "unknown"}, ${(analysis.statements || []).length} statements)`,
    );
  }

  console.log(lines.join("\n"));

  if (failures.length) {
    process.exitCode = 1;
  }
}

function withMutedConsole(run) {
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

function assertAnalysis(analysis, expect, failures, label) {
  if (expect.mode && analysis.mode !== expect.mode) {
    failures.push(`${label}: expected mode=${expect.mode}, received ${analysis.mode}`);
  }

  if (expect.detectedDialect && analysis.detectedDialect !== expect.detectedDialect) {
    failures.push(
      `${label}: expected detectedDialect=${expect.detectedDialect}, received ${analysis.detectedDialect}`,
    );
  }

  if (
    typeof expect.statementCount === "number" &&
    (analysis.statements || []).length !== expect.statementCount
  ) {
    failures.push(
      `${label}: expected statementCount=${expect.statementCount}, received ${(analysis.statements || []).length}`,
    );
  }

  if (
    typeof expect.scriptDependencyCount === "number" &&
    (analysis.scriptDependencies || []).length !== expect.scriptDependencyCount
  ) {
    failures.push(
      `${label}: expected scriptDependencyCount=${expect.scriptDependencyCount}, received ${(analysis.scriptDependencies || []).length}`,
    );
  }

  if (
    typeof expect.cteCount === "number" &&
    (analysis.ctes || []).length !== expect.cteCount
  ) {
    failures.push(
      `${label}: expected cteCount=${expect.cteCount}, received ${(analysis.ctes || []).length}`,
    );
  }

  assertRecursiveCteNames(analysis.ctes || [], expect.recursiveCteNamesInclude || [], failures, label);

  if (expect.parserDialect && analysis.parserDialect !== expect.parserDialect) {
    failures.push(
      `${label}: expected parserDialect=${expect.parserDialect}, received ${analysis.parserDialect}`,
    );
  }

  if (expect.parserEngine && analysis.parserEngine !== expect.parserEngine) {
    failures.push(
      `${label}: expected parserEngine=${expect.parserEngine}, received ${analysis.parserEngine}`,
    );
  }

  if (Array.isArray(expect.flowSequenceEquals)) {
    const actualFlowSequence = analysis.flowSequence || [];

    if (JSON.stringify(actualFlowSequence) !== JSON.stringify(expect.flowSequenceEquals)) {
      failures.push(
        `${label}: expected flowSequence=${JSON.stringify(expect.flowSequenceEquals)}, received ${JSON.stringify(actualFlowSequence)}`,
      );
    }
  }

  if (
    typeof expect.sourceCountAtLeast === "number" &&
    (analysis.sources || []).length < expect.sourceCountAtLeast
  ) {
    failures.push(
      `${label}: expected sourceCountAtLeast=${expect.sourceCountAtLeast}, received ${(analysis.sources || []).length}`,
    );
  }

  assertSourceNames(analysis.sources || [], expect.sourceNamesInclude || [], failures, label);
  assertSourceSampleKinds(
    analysis.sources || [],
    expect.sourceSampleKindsInclude || [],
    failures,
    label,
  );
  assertGraph(analysis.graph, expect, failures, label);
}

function assertStatement(statement, expect, failures, label) {
  if (expect.mode && statement.mode !== expect.mode) {
    failures.push(`${label}: expected mode=${expect.mode}, received ${statement.mode}`);
  }

  if (expect.parserDialect && statement.parserDialect !== expect.parserDialect) {
    failures.push(
      `${label}: expected parserDialect=${expect.parserDialect}, received ${statement.parserDialect}`,
    );
  }

  if (expect.parserEngine && statement.parserEngine !== expect.parserEngine) {
    failures.push(
      `${label}: expected parserEngine=${expect.parserEngine}, received ${statement.parserEngine}`,
    );
  }

  if (Array.isArray(expect.flowSequenceEquals)) {
    const actualFlowSequence = statement.flowSequence || [];

    if (JSON.stringify(actualFlowSequence) !== JSON.stringify(expect.flowSequenceEquals)) {
      failures.push(
        `${label}: expected flowSequence=${JSON.stringify(expect.flowSequenceEquals)}, received ${JSON.stringify(actualFlowSequence)}`,
      );
    }
  }

  assertSourceNames(statement.sources || [], expect.sourceNamesInclude || [], failures, label);
  assertWrites(statement.writes || [], expect.writesInclude || [], failures, label);
  assertGraph(statement.graph, expect, failures, label);
}

function assertSourceNames(sources, expectedNames, failures, label) {
  const actual = new Set((sources || []).map((source) => normalizeName(source.name)));

  for (const expectedName of expectedNames || []) {
    if (!actual.has(normalizeName(expectedName))) {
      failures.push(`${label}: missing source ${expectedName}`);
    }
  }
}

function assertSourceSampleKinds(sources, expectedKinds, failures, label) {
  const actual = new Set(
    (sources || [])
      .map((source) => String(source.sampleKind || "").trim().toUpperCase())
      .filter(Boolean),
  );

  for (const expectedKind of expectedKinds || []) {
    if (!actual.has(String(expectedKind || "").trim().toUpperCase())) {
      failures.push(`${label}: missing source sample kind ${expectedKind}`);
    }
  }
}

function assertWrites(writes, expectedNames, failures, label) {
  const actual = new Set((writes || []).map((write) => normalizeName(write.name)));

  for (const expectedName of expectedNames || []) {
    if (!actual.has(normalizeName(expectedName))) {
      failures.push(`${label}: missing write target ${expectedName}`);
    }
  }
}

function assertGraph(graph, expect, failures, label) {
  const nodes = graph?.nodes || [];
  const columns = graph?.columns || [];

  for (const nodeType of expect.graphNodeTypesInclude || []) {
    if (!nodes.some((node) => String(node.type || "") === nodeType)) {
      failures.push(`${label}: missing graph node type ${nodeType}`);
    }
  }

  for (const nodeLabel of expect.graphNodeLabelsInclude || []) {
    if (!nodes.some((node) => String(node.label || "") === nodeLabel)) {
      failures.push(`${label}: missing graph node label ${nodeLabel}`);
    }
  }

  if (
    typeof expect.graphColumnCountAtLeast === "number" &&
    columns.length < expect.graphColumnCountAtLeast
  ) {
    failures.push(
      `${label}: expected graphColumnCountAtLeast=${expect.graphColumnCountAtLeast}, received ${columns.length}`,
    );
  }

  if (Array.isArray(expect.graphColumnNamesInclude) && expect.graphColumnNamesInclude.length) {
    const actualColumnNames = new Set(columns.map((column) => normalizeName(column?.name)));

    for (const expectedColumnName of expect.graphColumnNamesInclude) {
      if (!actualColumnNames.has(normalizeName(expectedColumnName))) {
        failures.push(`${label}: missing graph column ${expectedColumnName}`);
      }
    }
  }
}

function assertRecursiveCteNames(ctes, expectedNames, failures, label) {
  const actual = new Set(
    (ctes || [])
      .filter((cte) => cte?.recursive)
      .map((cte) => normalizeName(cte.name)),
  );

  for (const expectedName of expectedNames || []) {
    if (!actual.has(normalizeName(expectedName))) {
      failures.push(`${label}: missing recursive cte ${expectedName}`);
    }
  }
}

function normalizeName(value) {
  return String(value || "")
    .replace(/[`"\[\]]/g, "")
    .toLowerCase();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

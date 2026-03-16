import { useEffect, useRef, useState } from "react";

import type { AnalysisResult, AnalysisRange, AnalysisStatement } from "../shared/types";
import { PanelLayout } from "./app/layout";
import { AppProviders } from "./app/providers";
import { DiagnosticsPanel } from "./components/diagnostics/DiagnosticsPanel";
import { GraphCanvas } from "./components/graph/GraphCanvas";
import { Header } from "./components/shell/Header";
import { Section } from "./components/shell/Section";
import { DialectControls } from "./components/sql/DialectControls";
import { InputCaptureControls } from "./components/sql/InputCaptureControls";
import { StatementOutline } from "./components/sql/StatementOutline";
import { SqlSnapshot } from "./components/sql/SqlSnapshot";
import { getNodeSpans, normalizeGraphSpans } from "./features/graph/spans";
import {
  buildStatementGroupStatement,
  findStatementDisplayGroup,
} from "./features/sql/statement-groups";
import { useTabSession } from "./hooks/useTabSession";
import { useGraphStore } from "./state/graph-store";

export function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}

function AppContent() {
  const { session, error, tabId } = useTabSession();
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [schemaTogglePending, setSchemaTogglePending] = useState(false);
  const [siteAccessPending, setSiteAccessPending] = useState(false);
  const {
    selectedStatementIndex,
    selectedNodeId,
    selectedColumnId,
    selectionSource,
    viewMode,
  } = useGraphStore();
  const activeStatement = getActiveStatement(session?.analysis, selectedStatementIndex);
  const lastHighlightSignatureRef = useRef("");

  useEffect(() => {
    const tabId = session?.tabId;

    if (typeof tabId !== "number") {
      return;
    }

    const ranges =
      selectionSource === "panel"
        ? buildEditorHighlightRanges(activeStatement, selectedNodeId, selectedColumnId)
        : [];
    const signature = buildHighlightSignature(tabId, ranges);

    if (signature === lastHighlightSignatureRef.current) {
      return;
    }

    lastHighlightSignatureRef.current = signature;

    void chrome.tabs
      .sendMessage(tabId, {
        type: "APPLY_EDITOR_HIGHLIGHT",
        ranges,
      })
      .catch(() => {
        // Content script might not be ready yet.
      });
  }, [activeStatement, selectedColumnId, selectedNodeId, selectionSource, session?.tabId]);

  return (
    <PanelLayout>
      <Header
        isSqlLab={session?.isSqlLab}
        siteAccessSupported={session?.siteAccessSupported}
        siteAccessGranted={session?.siteAccessGranted}
        siteAccessPending={siteAccessPending}
        isSchemaPanelHidden={session?.sqlLabSidebarHidden}
        onEnableSiteAccess={
          session?.siteAccessSupported &&
          !session?.siteAccessGranted &&
          typeof tabId === "number" &&
          !siteAccessPending
            ? () => void handleEnableSiteAccess()
            : null
        }
        onDisableSiteAccess={
          session?.siteAccessSupported &&
          session?.siteAccessGranted &&
          typeof tabId === "number" &&
          !siteAccessPending
            ? () => void handleDisableSiteAccess()
            : null
        }
        onToggleSchemaPanel={
          session?.isSqlLab && typeof tabId === "number" && !schemaTogglePending
            ? () => void handleToggleSchemaPanel()
            : null
        }
      />

      <Section
        eyebrow="Main View"
        title={viewMode === "script" ? "Script View" : "Logical Graph"}
        action={
          <button
            type="button"
            className="section-toggle-button"
            onClick={() => setControlsCollapsed((current) => !current)}
            aria-pressed={controlsCollapsed}
          >
            {controlsCollapsed ? "Show Controls" : "Hide Controls"}
          </button>
        }
      >
        {viewMode === "logical" ? (
          <StatementOutline
            analysis={session?.analysis}
            sqlSelectionText={session?.sqlSelectionText}
            sqlSelectionStart={session?.sqlSelectionStart}
            sqlSelectionEnd={session?.sqlSelectionEnd}
          />
        ) : null}
        {!controlsCollapsed ? (
          <div className="main-utility-strip">
            <InputCaptureControls tabId={tabId} session={session} />
            <DialectControls session={session} />
          </div>
        ) : null}
        <GraphCanvas
          analysis={session?.analysis}
          statement={activeStatement}
          execution={session?.execution}
          isSqlLab={Boolean(session?.isSqlLab)}
          sqlSelectionText={session?.sqlSelectionText}
          sqlSelectionStart={session?.sqlSelectionStart}
          sqlSelectionEnd={session?.sqlSelectionEnd}
          controlsCollapsed={controlsCollapsed}
        />
      </Section>

      <Section eyebrow="SQL" title="Snapshot">
        <SqlSnapshot
          session={session}
          statement={activeStatement}
          selectedNodeId={selectedNodeId}
          selectedColumnId={selectedColumnId}
        />
      </Section>

      <Section eyebrow="Diagnostics" title="Current Tab">
        <DiagnosticsPanel session={session} statement={activeStatement} error={error} />
      </Section>
    </PanelLayout>
  );

  async function handleToggleSchemaPanel() {
    if (typeof tabId !== "number") {
      return;
    }

    setSchemaTogglePending(true);

    try {
      await chrome.runtime.sendMessage({
        type: "SET_SQLLAB_SCHEMA_PANEL_HIDDEN",
        tabId,
        hidden: !session?.sqlLabSidebarHidden,
      });
    } catch (_error) {
      // noop
    } finally {
      setSchemaTogglePending(false);
    }
  }

  async function handleEnableSiteAccess() {
    if (typeof tabId !== "number" || !session?.sitePermissionPattern) {
      return;
    }

    setSiteAccessPending(true);

    try {
      const granted = await chrome.permissions.request({
        origins: [session.sitePermissionPattern],
      });

      if (!granted) {
        return;
      }

      await chrome.runtime.sendMessage({
        type: "ENABLE_SITE_ACCESS",
        tabId,
      });
    } catch (_error) {
      // noop
    } finally {
      setSiteAccessPending(false);
    }
  }

  async function handleDisableSiteAccess() {
    if (typeof tabId !== "number") {
      return;
    }

    setSiteAccessPending(true);

    try {
      await chrome.runtime.sendMessage({
        type: "DISABLE_SITE_ACCESS",
        tabId,
      });
    } catch (_error) {
      // noop
    } finally {
      setSiteAccessPending(false);
    }
  }
}

function buildHighlightSignature(tabId: number, ranges: AnalysisRange[]) {
  return `${tabId}:${ranges.map((range) => `${range.start}-${range.end}`).join("|")}`;
}

function buildEditorHighlightRanges(
  statement: AnalysisStatement | null,
  selectedNodeId: string | null,
  selectedColumnId: string | null,
): AnalysisRange[] {
  if (!statement || typeof statement.rangeStart !== "number") {
    return [];
  }

  const baseOffset = statement.rangeStart;
  const selectedColumn =
    selectedColumnId && statement.graph?.columns?.length
      ? statement.graph.columns.find((column) => column.id === selectedColumnId) || null
      : null;

  const localRanges =
    selectedColumn?.spans?.length
      ? selectedColumn.spans
      : selectedNodeId
        ? getNodeSpans(
            statement.graph?.nodes?.find((node) => node.id === selectedNodeId) || null,
          )
        : [];

  return normalizeGraphSpans(localRanges)
    .map((range) => ({
      start: baseOffset + range.start,
      end: baseOffset + range.end,
    }))
    .filter((range) => range.end >= range.start);
}

function getActiveStatement(
  analysis: AnalysisResult | null | undefined,
  selectedStatementIndex: number | null,
): AnalysisStatement | null {
  const statements = analysis?.statements || [];

  if (!statements.length) {
    if (!analysis) {
      return null;
    }

    return {
      id: "statement:single",
      index: analysis.activeStatementIndex || 0,
      title: analysis.statementType || "Statement",
      mode: analysis.mode,
      parserDialect: analysis.parserDialect,
      parserEngine: analysis.parserEngine,
      parserAttempts: analysis.parserAttempts,
      parserErrorMessage: analysis.parserErrorMessage,
      normalizedSql: analysis.normalizedSql,
      statementType: analysis.statementType,
      summary: analysis.summary,
      clauses: analysis.clauses,
      graph: analysis.graph,
      flowSequence: analysis.flowSequence,
      ctes: analysis.ctes,
      sources: analysis.sources,
      errorMessage: analysis.errorMessage,
    };
  }

  const fallbackIndex = analysis?.activeStatementIndex ?? statements.length - 1;
  const index = typeof selectedStatementIndex === "number" ? selectedStatementIndex : fallbackIndex;
  const selectedGroup = findStatementDisplayGroup(statements, index);

  if (selectedGroup && selectedGroup.kind !== "single" && selectedGroup.statements.length > 1) {
    return buildStatementGroupStatement(selectedGroup, analysis?.normalizedSql);
  }

  return (
    statements.find((statement) => statement.index === index) ||
    statements[fallbackIndex] ||
    statements[0] ||
    null
  );
}

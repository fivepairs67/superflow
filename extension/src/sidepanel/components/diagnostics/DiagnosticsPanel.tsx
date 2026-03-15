import type { AnalysisStatement, TabSession } from "../../../shared/types";

interface DiagnosticsPanelProps {
  session: TabSession | null;
  statement: AnalysisStatement | null;
  error: string | null;
}

export function DiagnosticsPanel({ session, statement, error }: DiagnosticsPanelProps) {
  const signals = session?.analysis?.dialectSignals?.join(", ") || "-";
  const parserAttempts = statement?.parserAttempts?.join(" / ") || session?.analysis?.parserAttempts?.join(" / ") || "-";
  const parserErrorMessage = statement?.parserErrorMessage || session?.analysis?.parserErrorMessage || "-";
  const parserEngine = statement?.parserEngine || session?.analysis?.parserEngine || "-";

  return (
    <dl className="definition-grid">
      <div>
        <dt>Title</dt>
        <dd>{session?.title || "-"}</dd>
      </div>
      <div>
        <dt>URL</dt>
        <dd>{session?.url || "-"}</dd>
      </div>
      <div>
        <dt>Site Access</dt>
        <dd>
          {session?.siteAccessSupported
            ? session?.siteAccessGranted
              ? "enabled"
              : "not enabled"
            : "n/a"}
        </dd>
      </div>
      <div>
        <dt>Superset</dt>
        <dd>{session?.isSupersetLike ? "yes" : "no"}</dd>
      </div>
      <div>
        <dt>SQL Lab</dt>
        <dd>{session?.isSqlLab ? "yes" : "no"}</dd>
      </div>
      <div>
        <dt>Signals</dt>
        <dd>{session?.signals?.join(", ") || "-"}</dd>
      </div>
      <div>
        <dt>Dialect Pref</dt>
        <dd>{session?.analysis?.dialectPreference || session?.analysisDialectPreference || "-"}</dd>
      </div>
      <div>
        <dt>Detected</dt>
        <dd>{session?.analysis?.detectedDialect || "-"}</dd>
      </div>
      <div>
        <dt>Parser</dt>
        <dd>{statement?.parserDialect || session?.analysis?.parserDialect || "-"}</dd>
      </div>
      <div>
        <dt>Parser Engine</dt>
        <dd>{parserEngine}</dd>
      </div>
      <div>
        <dt>Parser Tries</dt>
        <dd>{parserAttempts}</dd>
      </div>
      <div>
        <dt>Fallback</dt>
        <dd>{parserErrorMessage}</dd>
      </div>
      <div>
        <dt>Dialect Signals</dt>
        <dd>{signals}</dd>
      </div>
      <div>
        <dt>Hook Error</dt>
        <dd>{error || "-"}</dd>
      </div>
    </dl>
  );
}

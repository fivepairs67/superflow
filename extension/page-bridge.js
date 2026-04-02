(function () {
  const SOURCE = "superset-query-visualizer";
  const SQL_KEYWORD_REGEX = /\b(with|select|insert|update|delete|create|merge)\b/i;
  const SQL_COLLECT_INTERVAL_MS = 1000;
  const MAX_RESPONSE_TEXT_LENGTH = 100000;
  const EDITOR_HIGHLIGHT_CLASS = "sqv-editor-highlight";
  const DOM_SQL_SNAPSHOT_SELECTORS = [
    "textarea",
    ".cm-content",
    ".cm-editor",
    ".CodeMirror",
    ".CodeMirror-code",
    ".monaco-editor textarea",
    ".monaco-editor .view-lines",
    "[contenteditable='plaintext-only']",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true']",
    "[role='code']",
    "pre code",
  ];
  const STRUCTURED_CODE_CONTAINER_SELECTORS = [
    "[data-testid*='code-view']",
    "[data-testid*='source-view']",
    "[data-testid*='file-content']",
    "[data-testid*='diff-view']",
    "[data-qa*='code-view']",
    "[data-qa*='source-view']",
    "[data-qa*='file-content']",
    "[data-qa*='diff-view']",
    "[class*='code-view']",
    "[class*='CodeView']",
    "[class*='source-view']",
    "[class*='SourceView']",
    "[class*='file-content']",
    "[class*='FileContent']",
    "[class*='react-code']",
    "[class*='blob-code']",
    "[class*='diff-view']",
    "[class*='DiffView']",
  ];
  const STRUCTURED_CODE_LINE_SELECTORS = [
    "[data-testid*='code-line']",
    "[data-qa*='code-line']",
    "[data-testid*='source-line']",
    "[data-qa*='source-line']",
    ".react-code-text",
    ".blob-code-inner",
    ".diff-line-pre",
  ];
  let lastSqlSignature = "";
  let activeAceMarkers = [];
  let hasHighlightStyles = false;
  let lastEditorHighlightSignature = "";

  function post(type, payload) {
    window.postMessage(
      {
        source: SOURCE,
        type,
        payload,
      },
      "*",
    );
  }

  function normalizeSql(sql) {
    if (typeof sql !== "string") {
      return "";
    }

    return sql.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
  }

  function resolveUrl(input) {
    if (typeof input === "string") {
      return input;
    }

    if (input?.url) {
      return input.url;
    }

    return "";
  }

  function resolveMethod(input, init) {
    return String(init?.method || input?.method || "GET").toUpperCase();
  }

  function isSupersetRequest(url) {
    return /\/api\/v1\/sqllab\/|\/superset\/sql_json\/|\/api\/v1\/query\//i.test(url);
  }

  function classifyRequest(url) {
    if (/\/sqllab\/execute\b/i.test(url) || /\/superset\/sql_json\/?/i.test(url)) {
      return "execute";
    }
    if (/\/sqllab\/estimate\b/i.test(url)) {
      return "estimate";
    }
    if (/\/sqllab\/results?\b/i.test(url)) {
      return "results";
    }
    if (/\/sqllab\/status\b|\/sqllab\/queries\//i.test(url)) {
      return "status";
    }
    if (/\/sqllab\/stop\b|\/sqllab\/cancel\b/i.test(url)) {
      return "cancel";
    }
    return "unknown";
  }

  function parseBody(body) {
    if (!body) {
      return null;
    }

    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch (_error) {
        try {
          return Object.fromEntries(new URLSearchParams(body).entries());
        } catch (_paramsError) {
          return null;
        }
      }
    }

    if (body instanceof URLSearchParams) {
      return Object.fromEntries(body.entries());
    }

    if (typeof FormData !== "undefined" && body instanceof FormData) {
      return Object.fromEntries(body.entries());
    }

    return null;
  }

  function summarizeRequestBody(body) {
    const parsed = parseBody(body);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const sql = normalizeSql(parsed.sql || parsed.query || "");

    return {
      sql,
      sqlLength: sql.length,
      schema: parsed.schema || parsed.schema_name || null,
      databaseId: parsed.database_id || parsed.databaseId || null,
      queryId: parsed.query_id || parsed.queryId || null,
      clientId: parsed.client_id || parsed.clientId || null,
      keys: Object.keys(parsed).slice(0, 12),
    };
  }

  function extractValueByPath(input, path) {
    let current = input;

    for (const key of path) {
      if (!current || typeof current !== "object") {
        return null;
      }

      current = current[key];
    }

    return current ?? null;
  }

  function pickFirst(...values) {
    for (const value of values) {
      if (value !== null && value !== undefined && value !== "") {
        return value;
      }
    }

    return null;
  }

  function toNumericCount(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }

    if (Array.isArray(value)) {
      return value.length;
    }

    return null;
  }

  function extractRowCount(parsed) {
    const direct = pickFirst(
      toNumericCount(parsed.rowcount),
      toNumericCount(parsed.row_count),
      toNumericCount(parsed.num_rows),
      toNumericCount(parsed.resultSet),
      toNumericCount(parsed.results),
      toNumericCount(parsed.result?.rowcount),
      toNumericCount(parsed.result?.row_count),
      toNumericCount(parsed.result?.num_rows),
      toNumericCount(parsed.result?.resultSet),
      toNumericCount(parsed.query?.rowcount),
      toNumericCount(parsed.query?.row_count),
      toNumericCount(parsed.count),
      toNumericCount(parsed.total_rows),
      toNumericCount(parsed.data),
      toNumericCount(parsed.result?.data),
      toNumericCount(parsed.result?.results),
      toNumericCount(parsed.payload?.results),
      toNumericCount(parsed.payload?.result),
      toNumericCount(parsed.query?.data),
      toNumericCount(extractValueByPath(parsed, ["payload", "data"])),
    );

    if (typeof direct === "number") {
      return direct;
    }

    return null;
  }

  function summarizeParsedPayload(parsed, httpStatus, ok) {
    return {
      httpStatus,
      ok,
      queryId: pickFirst(
        parsed.query_id,
        parsed.queryId,
        parsed.id,
        parsed.result?.query_id,
        parsed.result?.queryId,
        parsed.result?.id,
        parsed.query?.query_id,
        parsed.query?.queryId,
      ),
      status: pickFirst(
        parsed.status,
        parsed.state,
        parsed.job_state,
        parsed.result?.status,
        parsed.result?.state,
        parsed.query?.status,
        parsed.job_status,
        parsed.payload?.status,
      ),
      rowCount: extractRowCount(parsed),
      errorMessage: pickFirst(
        parsed.error,
        parsed.errors?.[0]?.message,
        parsed.message,
        parsed.msg,
        parsed.result?.error,
        parsed.result?.message,
        parsed.payload?.message,
      ),
    };
  }

  async function summarizeResponse(response) {
    const contentType = response.headers.get("content-type") || "";

    if (!/json/i.test(contentType)) {
      return {
        httpStatus: response.status,
        ok: response.ok,
      };
    }

    try {
      const text = await response.text();
      const safeText = text.slice(0, MAX_RESPONSE_TEXT_LENGTH);
      const parsed = JSON.parse(safeText);
      return summarizeParsedPayload(parsed, response.status, response.ok);
    } catch (_error) {
      return {
        httpStatus: response.status,
        ok: response.ok,
      };
    }
  }

  function emitNetworkEvent(payload) {
    post("SUPERSET_NETWORK_EVENT", payload);
  }

  function scoreCandidate(candidate) {
    let score = Math.min(candidate.sql.length, 4000);

    if (SQL_KEYWORD_REGEX.test(candidate.sql)) {
      score += 5000;
    }
    if (candidate.sql.includes("\n")) {
      score += 250;
    }
    if (candidate.source.startsWith("bridge:monaco")) {
      score += 1500;
    }
    if (candidate.source.startsWith("bridge:ace")) {
      score += 1800;
    }
    if (candidate.source.startsWith("bridge:textarea")) {
      score += 700;
    }
    if (candidate.source.startsWith("bridge:structured-code")) {
      score += 1200;
    }
    if (typeof candidate.selectionStart === "number" || typeof candidate.selectionEnd === "number") {
      score += 600;
    }
    if (normalizeSelectedText(candidate.selectedText)) {
      score += 500;
    }
    if (candidate.isVisible) {
      score += 2200;
    }
    if (candidate.isFocused) {
      score += 3200;
    }

    return score;
  }

  function isElementVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }

    const style = window.getComputedStyle?.(element);
    if (!style || style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isElementFocused(element) {
    if (!element) {
      return false;
    }

    const active = document.activeElement;
    return Boolean(active && (active === element || element.contains?.(active)));
  }

  function normalizeSelectedText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
  }

  function readDomSelectedText() {
    return normalizeSelectedText(window.getSelection?.()?.toString() || "");
  }

  function queryAllBySelector(selector) {
    const directMatches = Array.from(document.querySelectorAll(selector));

    if (directMatches.length) {
      return directMatches;
    }

    const shadowRoots = collectOpenShadowRoots();

    if (!shadowRoots.length) {
      return [];
    }

    return queryAllBySelectorInRoots(shadowRoots, selector);
  }

  function queryAllBySelectors(selectors) {
    const matches = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const element of queryAllBySelector(selector)) {
        pushUniqueElement(matches, seen, element);
      }
    }

    return matches;
  }

  function collectOpenShadowRoots() {
    const roots = [];
    const seen = new Set();
    const stack = [];

    if (document.documentElement) {
      stack.push(document.documentElement);
    }

    while (stack.length) {
      const current = stack.pop();

      if (!(current instanceof Element)) {
        continue;
      }

      if (current.shadowRoot && !seen.has(current.shadowRoot)) {
        seen.add(current.shadowRoot);
        roots.push(current.shadowRoot);

        for (const nestedElement of current.shadowRoot.querySelectorAll("*")) {
          stack.push(nestedElement);
        }
      }

      for (const child of current.children || []) {
        stack.push(child);
      }
    }

    return roots;
  }

  function queryAllBySelectorInRoots(roots, selector) {
    const matches = [];
    const seen = new Set();

    for (const root of roots) {
      for (const element of root.querySelectorAll(selector)) {
        pushUniqueElement(matches, seen, element);
      }
    }

    return matches;
  }

  function pushUniqueElement(list, seen, element) {
    if (!(element instanceof Element) || seen.has(element)) {
      return;
    }

    seen.add(element);
    list.push(element);
  }

  function positionToOffset(sql, row, column) {
    if (typeof sql !== "string") {
      return null;
    }

    const lines = sql.split("\n");
    let offset = 0;

    for (let index = 0; index < lines.length; index += 1) {
      if (index === row) {
        return offset + Math.max(0, Math.min(column, lines[index].length));
      }

      offset += lines[index].length + 1;
    }

    return sql.length;
  }

  function offsetToPosition(sql, offset) {
    if (typeof sql !== "string") {
      return { row: 0, column: 0 };
    }

    const lines = sql.split("\n");
    const targetOffset = Math.max(0, Math.min(offset, sql.length));
    let consumed = 0;

    for (let row = 0; row < lines.length; row += 1) {
      const line = lines[row];
      const lineEnd = consumed + line.length;

      if (targetOffset <= lineEnd) {
        return {
          row,
          column: targetOffset - consumed,
        };
      }

      consumed = lineEnd + 1;
    }

    return {
      row: Math.max(lines.length - 1, 0),
      column: lines.at(-1)?.length || 0,
    };
  }

  function ensureHighlightStyles() {
    if (hasHighlightStyles || document.getElementById("sqv-editor-highlight-style")) {
      hasHighlightStyles = true;
      return;
    }

    const style = document.createElement("style");
    style.id = "sqv-editor-highlight-style";
    style.textContent = `
      .${EDITOR_HIGHLIGHT_CLASS} {
        position: absolute;
        pointer-events: none;
        background: rgba(97, 122, 145, 0.1);
        border-radius: 4px;
        box-shadow: inset 0 0 0 1px rgba(97, 122, 145, 0.18);
      }

      .ace_editor .ace_cursor {
        color: #111827 !important;
        border-left-color: #111827 !important;
        opacity: 1 !important;
      }

      .ace_editor .ace_cursor-layer,
      .ace_editor .ace_cursor-layer .ace_cursor,
      .monaco-editor .cursors-layer,
      .monaco-editor .cursors-layer .cursor,
      .cm-editor .cm-cursorLayer,
      .cm-editor .cm-cursor,
      .CodeMirror-cursors,
      .CodeMirror-cursor {
        mix-blend-mode: normal !important;
        filter: none !important;
        opacity: 1 !important;
      }

      .monaco-editor .cursors-layer .cursor {
        background-color: #111827 !important;
        border-color: #111827 !important;
      }

      .cm-editor .cm-cursor,
      .CodeMirror-cursor {
        border-left-color: #111827 !important;
        border-right-color: #111827 !important;
      }

      .ace_editor textarea.ace_text-input,
      .monaco-editor textarea,
      .monaco-editor input,
      .cm-editor textarea,
      .CodeMirror textarea,
      [data-test='sql-editor'] textarea,
      [data-test='code-editor'] textarea,
      textarea.sql-editor {
        caret-color: #111827 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    hasHighlightStyles = true;
  }

  function collectAceEditors() {
    const editors = [];

    if (!window.ace?.edit) {
      return editors;
    }

    for (const editorRoot of queryAllBySelector(".ace_editor")) {
      try {
        const editor = window.ace.edit(editorRoot);
        const sql = normalizeSql(editor?.getValue?.());

        if (!sql) {
          continue;
        }

        editors.push({
          editor,
          sql,
          source: "bridge:ace:api",
          score: scoreCandidate({
            sql,
            source: "bridge:ace:api",
            selectedText: "",
            selectionStart: null,
            selectionEnd: null,
          }),
        });
      } catch (_error) {
        // Ignore invalid editor roots.
      }
    }

    return editors.sort((left, right) => right.score - left.score);
  }

  function clearAceHighlights() {
    for (const marker of activeAceMarkers) {
      try {
        marker.session.removeMarker(marker.id);
      } catch (_error) {
        // Marker already gone.
      }
    }

    activeAceMarkers = [];
  }

  function applyEditorHighlight(ranges) {
    const validRanges = Array.isArray(ranges)
      ? ranges.filter(
          (range) =>
            typeof range?.start === "number" &&
            typeof range?.end === "number" &&
            range.end >= range.start,
        )
      : [];
    const signature = validRanges
      .map((range) => `${range.start}:${range.end}`)
      .join("|");

    if (signature === lastEditorHighlightSignature) {
      return;
    }

    lastEditorHighlightSignature = signature;
    clearAceHighlights();

    if (!validRanges.length) {
      return;
    }

    const targetEditor = collectAceEditors()[0];

    if (!targetEditor?.editor || !targetEditor?.sql) {
      return;
    }

    ensureHighlightStyles();

    let RangeConstructor = null;

    try {
      RangeConstructor = window.ace.require("ace/range").Range;
    } catch (_error) {
      RangeConstructor = null;
    }

    if (!RangeConstructor) {
      return;
    }

    const session = targetEditor.editor.getSession?.();

    if (!session?.addMarker) {
      return;
    }

    for (const range of validRanges) {
      const start = offsetToPosition(targetEditor.sql, range.start);
      const end = offsetToPosition(targetEditor.sql, range.end);
      const markerId = session.addMarker(
        new RangeConstructor(start.row, start.column, end.row, end.column),
        EDITOR_HIGHLIGHT_CLASS,
        "text",
        false,
      );

      activeAceMarkers.push({
        session,
        id: markerId,
      });
    }

    const firstRange = validRanges[0];
    const firstPosition = offsetToPosition(targetEditor.sql, firstRange.start);
    targetEditor.editor.scrollToLine?.(firstPosition.row, true, true, () => {});
  }

  function readAceSelection(editor, sql) {
    try {
      const selectedText = normalizeSelectedText(editor?.getSelectedText?.());
      const range = editor?.getSelectionRange?.();

      if (!range?.start || !range?.end) {
        return {
          selectedText,
          selectionStart: null,
          selectionEnd: null,
        };
      }

      return {
        selectedText,
        selectionStart: positionToOffset(sql, range.start.row, range.start.column),
        selectionEnd: positionToOffset(sql, range.end.row, range.end.column),
      };
    } catch (_error) {
      return {
        selectedText: "",
        selectionStart: null,
        selectionEnd: null,
      };
    }
  }

  function readElementSelection(element) {
    if (!element) {
      return {
        selectedText: "",
        selectionStart: null,
        selectionEnd: null,
      };
    }

    if (typeof element.selectionStart === "number" && typeof element.selectionEnd === "number") {
      const value = typeof element.value === "string" ? element.value : element.textContent || "";
      return {
        selectedText: normalizeSelectedText(value.slice(element.selectionStart, element.selectionEnd)),
        selectionStart: element.selectionStart,
        selectionEnd: element.selectionEnd,
      };
    }

    return {
      selectedText: readDomSelectedText(),
      selectionStart: null,
      selectionEnd: null,
    };
  }

  function collectAceSnapshots() {
    const candidates = [];

    if (window.ace?.edit) {
      for (const editorRoot of queryAllBySelector(".ace_editor")) {
        try {
          const editor = window.ace.edit(editorRoot);
          const sql = normalizeSql(editor?.getValue?.());
          const selection = readAceSelection(editor, sql);

          if (!sql) {
            continue;
          }

          candidates.push({
            sql,
            source: "bridge:ace:api",
            selectedText: selection.selectedText,
            selectionStart: selection.selectionStart,
            selectionEnd: selection.selectionEnd,
            isVisible: isElementVisible(editorRoot),
            isFocused: isElementFocused(editorRoot),
          });
        } catch (_error) {
          // Fall back to DOM extraction below.
        }
      }
    }

    for (const editorRoot of queryAllBySelector(".ace_editor")) {
      const lines = Array.from(editorRoot.querySelectorAll(".ace_line"))
        .map((line) => normalizeSql(line.textContent || ""))
        .filter(Boolean);

      if (!lines.length) {
        continue;
      }

      candidates.push({
        sql: lines.join("\n"),
        source: "bridge:ace:dom",
        selectedText: readDomSelectedText(),
        selectionStart: null,
        selectionEnd: null,
        isVisible: isElementVisible(editorRoot),
        isFocused: isElementFocused(editorRoot),
      });
    }

    return candidates;
  }

  function findBestSqlSnapshot() {
    const candidates = [...collectAceSnapshots()];

    if (window.monaco?.editor?.getModels) {
      try {
        for (const model of window.monaco.editor.getModels()) {
          const sql = normalizeSql(model.getValue?.());

          if (!sql) {
            continue;
          }

          const languageId = model.getLanguageId?.() || "unknown";
          candidates.push({
            sql,
            source: `bridge:monaco:${languageId}`,
            selectedText: readDomSelectedText(),
            selectionStart: null,
            selectionEnd: null,
            isVisible: false,
            isFocused: false,
          });
        }
      } catch (error) {
        console.debug("Superset Query Visualizer: unable to inspect monaco models", error);
      }
    }

    for (const element of queryAllBySelectors(DOM_SQL_SNAPSHOT_SELECTORS)) {
      const value =
        typeof element.value === "string"
          ? element.value
          : element.matches?.(".CodeMirror")
            ? element.CodeMirror?.getValue?.() || element.textContent || ""
            : element.textContent || "";
      const sql = normalizeSql(value);
      const selection = readElementSelection(element);

      if (!sql) {
        continue;
      }

      candidates.push({
        sql,
        source: `bridge:${describeElementSource(element)}`,
        selectedText: selection.selectedText,
        selectionStart: selection.selectionStart,
        selectionEnd: selection.selectionEnd,
        isVisible: isElementVisible(element),
        isFocused: isElementFocused(element),
      });
    }

    if (!candidates.some((candidate) => SQL_KEYWORD_REGEX.test(candidate.sql))) {
      candidates.push(...collectStructuredCodeSnapshots());
    }

    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => scoreCandidate(right) - scoreCandidate(left));
    const primaryCandidate = candidates[0];
    const selectedCandidate =
      candidates.find(
        (candidate) =>
          candidate.sql === primaryCandidate.sql && normalizeSelectedText(candidate.selectedText),
      ) || primaryCandidate;

    return {
      sql: primaryCandidate.sql,
      source: primaryCandidate.source,
      selectedText: selectedCandidate.selectedText || primaryCandidate.selectedText || "",
      selectionStart: selectedCandidate.selectionStart ?? primaryCandidate.selectionStart ?? null,
      selectionEnd: selectedCandidate.selectionEnd ?? primaryCandidate.selectionEnd ?? null,
      capturedAt: Date.now(),
    };
  }

  function describeElementSource(element) {
    if (!element) {
      return "dom";
    }

    if (element.matches?.(".CodeMirror, .CodeMirror-code")) {
      return "codemirror";
    }

    if (element.matches?.(".cm-editor, .cm-content")) {
      return "codemirror6";
    }

    if (element.matches?.(".monaco-editor textarea, .monaco-editor .view-lines")) {
      return "monaco:dom";
    }

    if (element.matches?.("pre code")) {
      return "pre-code";
    }

    return element.tagName.toLowerCase();
  }

  function collectStructuredCodeSnapshots() {
    const containers = [];
    const seen = new Set();

    for (const selector of STRUCTURED_CODE_CONTAINER_SELECTORS) {
      for (const element of queryAllBySelector(selector)) {
        pushUniqueElement(containers, seen, element);
      }
    }

    if (!containers.length) {
      for (const selector of ["table", "[role='table']", "ol"]) {
        for (const element of queryAllBySelector(selector)) {
          if (looksLikeStructuredCodeContainer(element)) {
            pushUniqueElement(containers, seen, element);
          }
        }
      }
    }

    return containers
      .map((container) => {
        const sql = normalizeSql(extractStructuredCodeText(container));

        if (!isLikelyStructuredSql(sql)) {
          return null;
        }

        return {
          sql,
          source: describeStructuredCodeSource(container),
          selectedText: readDomSelectedText(),
          selectionStart: null,
          selectionEnd: null,
          isVisible: isElementVisible(container),
          isFocused: isElementFocused(container),
        };
      })
      .filter(Boolean);
  }

  function looksLikeStructuredCodeContainer(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();

    if (rect.width < 180 || rect.height < 60) {
      return false;
    }

    const descriptor = [
      element.id,
      element.className,
      element.getAttribute("data-testid"),
      element.getAttribute("data-qa"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      /code|source|diff|file/.test(descriptor) ||
      Boolean(element.querySelector("code, pre, .react-code-text, .blob-code-inner, .diff-line-pre"))
    );
  }

  function extractStructuredCodeText(container) {
    const preferredLines = collectStructuredLineTexts(container, STRUCTURED_CODE_LINE_SELECTORS);

    if (preferredLines.length >= 3) {
      return preferredLines.join("\n");
    }

    const rowLines = collectStructuredRowTexts(container);

    if (rowLines.length >= 3) {
      return rowLines.join("\n");
    }

    return "";
  }

  function collectStructuredLineTexts(container, selectors) {
    const lines = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const element of container.querySelectorAll(selector)) {
        if (seen.has(element)) {
          continue;
        }

        seen.add(element);
        const text = normalizeStructuredLineText(element.textContent || "");

        if (text) {
          lines.push(text);
        }
      }
    }

    return lines;
  }

  function collectStructuredRowTexts(container) {
    const lines = [];

    for (const row of container.querySelectorAll("tr, [role='row'], li")) {
      const codeCell =
        row.querySelector(
          ".react-code-text, .blob-code-inner, .diff-line-pre, code, pre, td:last-child, [role='cell']:last-child",
        ) || row;
      const text = normalizeStructuredLineText(codeCell.textContent || "");

      if (text) {
        lines.push(text);
      }
    }

    return lines;
  }

  function normalizeStructuredLineText(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\u00a0/g, " ")
      .split("\n")
      .map((line) => line.replace(/\s+$/g, ""))
      .join("\n")
      .trim();
  }

  function isLikelyStructuredSql(sql) {
    if (!sql || sql.length < 24) {
      return false;
    }

    const lineCount = sql.split("\n").filter(Boolean).length;
    return lineCount >= 3 && SQL_KEYWORD_REGEX.test(sql);
  }

  function describeStructuredCodeSource(element) {
    const descriptor = [
      element.getAttribute("data-testid"),
      element.getAttribute("data-qa"),
      element.className,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (descriptor.includes("diff")) {
      return "bridge:structured-code:diff";
    }

    if (descriptor.includes("source")) {
      return "bridge:structured-code:source";
    }

    if (descriptor.includes("file")) {
      return "bridge:structured-code:file";
    }

    return "bridge:structured-code";
  }

  function emitSqlSnapshotIfChanged() {
    const snapshot = findBestSqlSnapshot();
    const signature = snapshot
      ? `${snapshot.source}:${snapshot.sql}:${snapshot.selectedText || ""}:${snapshot.selectionStart ?? ""}:${snapshot.selectionEnd ?? ""}`
      : "";

    if (signature === lastSqlSignature) {
      return;
    }

    lastSqlSignature = signature;
    post("SQL_SNAPSHOT", snapshot);
  }

  const rawFetch = window.fetch;
  window.fetch = async function sqvFetch(input, init) {
    const url = resolveUrl(input);
    const method = resolveMethod(input, init);
    const isTracked = isSupersetRequest(url);
    const kind = classifyRequest(url);
    const requestSummary = summarizeRequestBody(init?.body);

    if (isTracked) {
      emitNetworkEvent({
        source: "fetch",
        phase: "request",
        kind,
        url,
        method,
        request: requestSummary,
        timestamp: Date.now(),
      });
    }

    try {
      const response = await rawFetch.apply(this, arguments);

      if (isTracked) {
        const responseSummary = await summarizeResponse(response.clone());
        emitNetworkEvent({
          source: "fetch",
          phase: "response",
          kind,
          url,
          method,
          request: requestSummary,
          response: responseSummary,
          timestamp: Date.now(),
        });
      }

      return response;
    } catch (error) {
      if (isTracked) {
        emitNetworkEvent({
          source: "fetch",
          phase: "error",
          kind,
          url,
          method,
          request: requestSummary,
          errorMessage: String(error),
          timestamp: Date.now(),
        });
      }

      throw error;
    }
  };

  const rawOpen = XMLHttpRequest.prototype.open;
  const rawSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function sqvOpen(method, url) {
    this.__sqvMeta = {
      method: String(method || "GET").toUpperCase(),
      url: String(url || ""),
    };
    return rawOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function sqvSend(body) {
    const meta = this.__sqvMeta || {
      method: "GET",
      url: "",
    };
    const isTracked = isSupersetRequest(meta.url);
    const kind = classifyRequest(meta.url);
    const requestSummary = summarizeRequestBody(body);

    if (isTracked) {
      emitNetworkEvent({
        source: "xhr",
        phase: "request",
        kind,
        url: meta.url,
        method: meta.method,
        request: requestSummary,
        timestamp: Date.now(),
      });
    }

    if (isTracked) {
      this.addEventListener(
        "loadend",
        () => {
          let responseSummary = {
            httpStatus: this.status,
            ok: this.status >= 200 && this.status < 400,
          };

          if (typeof this.responseText === "string" && this.responseText) {
            try {
              const parsed = JSON.parse(this.responseText.slice(0, MAX_RESPONSE_TEXT_LENGTH));
              responseSummary = summarizeParsedPayload(
                parsed,
                this.status,
                this.status >= 200 && this.status < 400,
              );
            } catch (_error) {
              responseSummary = {
                httpStatus: this.status,
                ok: this.status >= 200 && this.status < 400,
              };
            }
          }

          emitNetworkEvent({
            source: "xhr",
            phase: "response",
            kind,
            url: meta.url,
            method: meta.method,
            request: requestSummary,
            response: responseSummary,
            timestamp: Date.now(),
          });
        },
        { once: true },
      );
    }

    return rawSend.apply(this, arguments);
  };

  if (window.__SQV_BRIDGE_READY__) {
    post("BRIDGE_READY", {
      href: window.location.href,
      title: document.title,
      sqlSnapshot: findBestSqlSnapshot(),
    });
    return;
  }

  window.__SQV_BRIDGE_READY__ = true;

  const rawPushState = history.pushState;
  const rawReplaceState = history.replaceState;

  history.pushState = function pushState(...args) {
    const result = rawPushState.apply(this, args);
    post("LOCATION_CHANGED", { href: window.location.href, title: document.title });
    emitSqlSnapshotIfChanged();
    return result;
  };

  history.replaceState = function replaceState(...args) {
    const result = rawReplaceState.apply(this, args);
    post("LOCATION_CHANGED", { href: window.location.href, title: document.title });
    emitSqlSnapshotIfChanged();
    return result;
  };

  window.addEventListener("popstate", () => {
    post("LOCATION_CHANGED", { href: window.location.href, title: document.title });
    emitSqlSnapshotIfChanged();
  });

  document.addEventListener("input", () => {
    emitSqlSnapshotIfChanged();
  });

  document.addEventListener("selectionchange", () => {
    window.clearTimeout(window.__SQV_SELECTION_TIMER__);
    window.__SQV_SELECTION_TIMER__ = window.setTimeout(() => {
      emitSqlSnapshotIfChanged();
    }, 60);
  });

  document.addEventListener("mouseup", () => {
    emitSqlSnapshotIfChanged();
  });

  document.addEventListener("keyup", () => {
    emitSqlSnapshotIfChanged();
  });

  document.addEventListener(
    "scroll",
    () => {
      window.clearTimeout(window.__SQV_SCROLL_TIMER__);
      window.__SQV_SCROLL_TIMER__ = window.setTimeout(() => {
        emitSqlSnapshotIfChanged();
      }, 40);
    },
    true,
  );

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      !event.data ||
      event.data.target !== `${SOURCE}:page-bridge`
    ) {
      return;
    }

    if (event.data.type === "APPLY_EDITOR_HIGHLIGHT") {
      applyEditorHighlight(event.data.payload?.ranges || []);
    }
  });

  window.setInterval(() => {
    emitSqlSnapshotIfChanged();
  }, SQL_COLLECT_INTERVAL_MS);

  post("BRIDGE_READY", {
    href: window.location.href,
    title: document.title,
    sqlSnapshot: findBestSqlSnapshot(),
  });
  emitSqlSnapshotIfChanged();
  window.setTimeout(() => emitSqlSnapshotIfChanged(), 120);
  window.setTimeout(() => emitSqlSnapshotIfChanged(), 500);
  window.setTimeout(() => emitSqlSnapshotIfChanged(), 1200);
})();

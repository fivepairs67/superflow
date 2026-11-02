// Offsets always refer to the original SQL, including comments and templates.
function tokenize(sql) {
  const tokens = [];
  const stack = [];
  let index = 0;

  while (index < sql.length) {
    const start = index;
    const char = sql[index];
    const pair = sql.slice(index, index + 2);
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (pair === "--") {
      const end = sql.indexOf("\n", index + 2);
      index = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (pair === "/*") {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth) {
        const next = sql.slice(index, index + 2);
        if (next === "/*" || next === "*/") {
          depth += next === "/*" ? 1 : -1;
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }

    let kind = "symbol";
    const templateEnd = { "{{": "}}", "{%": "%}", "${": "}" }[pair];
    const dollarTag = char === "$" ? /^\$(?:[a-zA-Z_][\w]*)?\$/.exec(sql.slice(index))?.[0] : null;
    if (templateEnd || dollarTag) {
      const delimiter = templateEnd || dollarTag;
      const end = sql.indexOf(delimiter, index + (templateEnd ? 2 : dollarTag.length));
      index = end < 0 ? sql.length : end + delimiter.length;
      kind = "literal";
    } else if (["'", '"', "`", "["].includes(char)) {
      const close = char === "[" ? "]" : char;
      kind = char === "'" ? "literal" : "identifier";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "\\" && char === "'") {
          index += 2;
        } else if (sql[index] === close && sql[index + 1] === close) {
          index += 2;
        } else if (sql[index++] === close) {
          break;
        }
      }
    } else if (/[a-zA-Z_\u0080-\uffff]/.test(char)) {
      kind = "word";
      index += 1;
      while (index < sql.length && /[\w$\u0080-\uffff]/.test(sql[index])) index += 1;
    } else {
      index += 1;
    }

    const token = { start, end: Math.min(index, sql.length), kind,
      word: kind === "word" ? sql.slice(start, index).toLowerCase() : "",
      value: sql.slice(start, index), depth: stack.length, pair: null };
    if (char === ")" && kind === "symbol" && stack.length) {
      const open = stack.pop();
      token.depth = stack.length;
      token.pair = open;
      tokens[open].pair = tokens.length;
    }
    tokens.push(token);
    if (char === "(" && kind === "symbol") stack.push(tokens.length - 1);
  }
  return tokens;
}

function isKeyword(tokens, index, word) {
  return tokens[index]?.word === word && tokens[index - 1]?.value !== "." && tokens[index + 1]?.value !== ".";
}

function isIdentifier(token) {
  return token?.kind === "word" || token?.kind === "identifier";
}

function windowExpression(tokens, index) {
  let previous = index - 1;
  if (tokens[previous]?.word === "nulls" && ["ignore", "respect"].includes(tokens[previous - 1]?.word)) previous -= 2;
  let open = tokens[previous]?.value === ")" ? tokens[previous].pair : null;
  if (open === null) return null;
  // FILTER belongs to the aggregate, not to the query's WHERE clause.
  if (tokens[open - 1]?.word === "filter") {
    previous = open - 2;
    open = tokens[previous]?.value === ")" ? tokens[previous].pair : null;
  }
  if (open === null || !isIdentifier(tokens[open - 1])) return null;
  let start = open - 1;
  while (tokens[start - 1]?.value === "." && isIdentifier(tokens[start - 2])) start -= 2;
  const next = tokens[index + 1];
  const end = next?.value === "(" && next.pair !== null ? tokens[next.pair].end
    : isIdentifier(next) ? next.end : null;
  return end === null ? null : { start: tokens[start].start, end };
}

function scanSqlClauses(sql, baseOffset = 0) {
  const tokens = tokenize(String(sql || ""));
  let first = 0;
  let last = tokens.length - 1;
  while (tokens[last]?.value === ";") last -= 1;
  while (tokens[first]?.value === "(" && tokens[first].pair === last) {
    first += 1;
    last -= 1;
  }
  const depth = tokens[first]?.depth || 0;
  const root = [];
  for (let i = first; i <= last; i += 1) {
    if (tokens[i].depth === depth) root.push(i);
  }
  const markers = [];
  const joins = [];
  const result = new Map();
  const add = (key, start, end) => {
    if (!key || end <= start) return;
    const range = { start: baseOffset + start, end: baseOffset + end };
    const entry = result.get(key);
    if (entry) entry.ranges.push(range);
    else result.set(key, { ...range, ranges: [range] });
  };
  const hasMerge = root.some((i) => isKeyword(tokens, i, "merge"));
  const hasDelete = root.some((i) => isKeyword(tokens, i, "delete"));
  const hasUpdate = root.some((i) => isKeyword(tokens, i, "update"));
  let caseDepth = 0;
  let mergeUsingSeen = false;
  let mergeOnSeen = false;

  for (let r = 0; r < root.length; r += 1) {
    const index = root[r];
    const token = tokens[index];
    const word = token.word;
    if (token.value === ";") {
      markers.push({ start: token.start, index });
      continue;
    }
    if (!word || !isKeyword(tokens, index, word)) continue;
    if (word === "case") caseDepth += 1;
    if (word === "end") caseDepth = Math.max(0, caseDepth - 1);
    if (caseDepth) continue;
    const next = tokens[index + 1];
    let key = null;
    let start = token.start;
    let end = null;
    let boundary = false;

    if (["select", "from"].includes(word)) boundary = true;
    if (["where", "having", "qualify", "limit", "offset", "returning"].includes(word)) key = word;
    if (["group", "order"].includes(word) && next?.word === "by") key = `${word}By`;
    if (word === "fetch" && ["first", "next"].includes(next?.word)) key = "limit";
    if (word === "window" && isIdentifier(next) && tokens[index + 2]?.word === "as") key = "window";
    if (word === "distinct" && tokens[index - 1]?.word === "select") {
      key = "distinct";
      end = next?.word === "on" && tokens[index + 2]?.value === "(" && tokens[index + 2].pair !== null
        ? tokens[tokens[index + 2].pair].end : token.end;
    }
    if (["union", "intersect", "except"].includes(word)) {
      key = "union";
      end = ["all", "distinct"].includes(next?.word) ? next.end : token.end;
    }
    if (word === "join") {
      key = "join";
      let type = "INNER";
      let cursor = r - 1;
      while (cursor >= 0 && ["left", "right", "full", "inner", "outer", "cross", "semi", "anti", "natural"].includes(tokens[root[cursor]].word)) {
        const modifier = tokens[root[cursor]].word;
        if (["left", "right", "full", "inner", "cross"].includes(modifier)) type = modifier.toUpperCase();
        start = tokens[root[cursor--]].start;
      }
      joins.push({ type, start: baseOffset + start, end: baseOffset + token.end });
    }
    if (word === "using" && (hasMerge || hasDelete) && !joins.length) {
      key = "join";
      joins.push({ type: "USING", start: baseOffset + start, end: baseOffset + token.end });
    }
    if (word === "using" && hasMerge) mergeUsingSeen = true;
    if (word === "on" && hasMerge && mergeUsingSeen && !mergeOnSeen) {
      key = "mergeOn";
      mergeOnSeen = true;
    }
    if (word === "when" && hasMerge) {
      if (next?.word === "matched") key = "matched";
      if (next?.word === "not" && tokens[index + 2]?.word === "matched") key = "notMatched";
    }
    if (word === "set" && (hasUpdate || hasMerge)) key = "set";
    if (word === "values" && next?.value === "(") key = "values";
    if (word === "on" && next?.word === "conflict") key = "conflict";
    if (word === "do" && ["update", "nothing"].includes(next?.word)) key = "conflictAction";
    if (key || boundary) markers.push({ key, start, end, index });
  }

  markers.sort((a, b) => a.start - b.start);
  markers.forEach((marker, index) => {
    // End at the last SQL token, not at trailing comments or the next clause's whitespace.
    const nextIndex = markers[index + 1]?.index ?? last + 1;
    let endIndex = nextIndex - 1;
    const boundary = markers[index + 1]?.start ?? Infinity;
    while (endIndex >= marker.index && tokens[endIndex].end > boundary) endIndex -= 1;
    add(marker.key, marker.start, marker.end ?? tokens[endIndex]?.end ?? marker.start);
  });

  for (let i = first; i <= last; i += 1) {
    const token = tokens[i];
    if (token.value === "(" && token.pair !== null) {
      let inner = i + 1;
      let close = token.pair - 1;
      while (tokens[inner]?.value === "(" && tokens[inner].pair === close) {
        inner += 1;
        close -= 1;
      }
      if (["select", "with"].includes(tokens[inner]?.word)) {
        i = token.pair;
        continue;
      }
    }
    if (isKeyword(tokens, i, "over")) {
      const range = windowExpression(tokens, i);
      if (range) add("window", range.start, range.end);
    }
  }
  for (const entry of result.values()) {
    entry.ranges.sort((a, b) => a.start - b.start);
    entry.start = entry.ranges[0].start;
    entry.end = entry.ranges[0].end;
  }
  return { ranges: result, joins };
}

export function extractClauseRanges(sql, baseOffset = 0) {
  return scanSqlClauses(sql, baseOffset).ranges;
}

export function extractTopLevelJoinMatches(sql) {
  return scanSqlClauses(sql).joins;
}

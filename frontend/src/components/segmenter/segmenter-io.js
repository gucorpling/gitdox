/**
 * SocialCalc <-> segmentation boundary conversion for the Segmenter widget.
 *
 * Each configured layer is a spreadsheet column whose cells (with rowspans) mark spans of tokens.
 * A layer's boundaries are the token indices at which a span starts (token 0 is always a boundary).
 */

export const CELL_RE = /^cell:([A-Z]+)(\d+):(.*)$/;
export const HEADER_FORMAT = 'f:2:bgcolor:#f3f4f6';

export const unescapeSC = (s) => String(s).replace(/\\([cnb])/g, (_, c) => (c === 'c' ? ':' : c === 'n' ? '\n' : '\\'));
export const escapeSC = (s) => String(s).replace(/\\/g, '\\b').replace(/:/g, '\\c').replace(/\n/g, '\\n');

export const colToIndex = (col) => col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const indexToCol = (idx) => {
  let col = '';
  for (let n = idx; n > 0; n = Math.floor((n - 1) / 26)) col = String.fromCharCode(65 + ((n - 1) % 26)) + col;
  return col;
};

/** Returns the decoded text value (t: or v:) of a cell's attribute string. */
const cellText = (rest) => {
  const parts = rest.split(':');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i] === 't' || parts[i] === 'v') return unescapeSC(parts[i + 1]);
  }
  return '';
};

/**
 * Normalizes config.layers, which may be a mapping {name: [sep, color, style]} (as in the YAML config)
 * or a list of single-key objects [{name: [sep, color, style]}].
 */
export function normalizeLayers(config) {
  const raw = config?.layers;
  const entries = Array.isArray(raw)
    ? raw.flatMap((item) => Object.entries(item || {}))
    : Object.entries(raw || {});
  return entries
    .filter(([, spec]) => Array.isArray(spec))
    .map(([name, spec]) => ({
      name: name.trim(),
      separator: spec[0] ?? '|',
      color: spec[1] ?? 'gray',
      style: spec[2] === undefined || spec[2] === null ? 'sequential' : String(spec[2])
    }));
}

export const isNesting = (config) => config?.nesting === true || String(config?.nesting).toLowerCase() === 'true';

/**
 * In nesting mode every break of a layer must also be a break of all smaller (later-declared) layers.
 * Layers without any spans (`empty`) are not yet edited and never conflict.
 */
export function validateNesting(boundaries, layers, tokens = [], empty = new Set()) {
  for (let i = 0; i < layers.length - 1; i++) {
    if (empty.has(layers[i].name)) continue;
    for (const idx of boundaries[layers[i].name]) {
      for (let j = i + 1; j < layers.length; j++) {
        if (empty.has(layers[j].name)) continue;
        if (!boundaries[layers[j].name].has(idx)) {
          throw new Error(
            `Nesting violation: "${layers[i].name}" starts at token ${idx + 1}` +
            `${tokens[idx] ? ` ("${tokens[idx].text}")` : ''} but "${layers[j].name}" does not. ` +
            `Layers must nest in the order declared in the config (largest first).`
          );
        }
      }
    }
  }
}

export function parseSocialCalc(scString, config) {
  const layers = normalizeLayers(config);
  const rawLines = String(scString || '').split(/\r?\n/);
  const cells = {};
  const colByName = {};
  let maxRow = 1;
  let maxCol = 0;

  rawLines.forEach((line) => {
    const m = line.match(CELL_RE);
    if (m) {
      const [, col, row, rest] = m;
      const r = parseInt(row, 10);
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, colToIndex(col));
      (cells[r] ||= {})[col] = rest;
      // First column wins when header names are repeated
      if (r === 1) {
        const name = cellText(rest);
        if (name && !(name in colByName)) colByName[name] = col;
      }
      return;
    }
    const sheet = line.match(/^sheet:c:(\d+):r:(\d+)/);
    if (sheet) {
      maxCol = Math.max(maxCol, parseInt(sheet[1], 10));
      maxRow = Math.max(maxRow, parseInt(sheet[2], 10));
    }
  });

  // A token is one cell of the words column: a merged cell covering several rows is a single token
  const wordCol = colByName[config?.words];
  const tokens = [];
  const rowToToken = {};
  for (let r = 2; r <= maxRow; ) {
    const rest = cells[r]?.[wordCol];
    const span = Math.max(1, parseInt(rest?.match(/:rowspan:(\d+)/)?.[1], 10) || 1);
    for (let k = r; k < r + span; k++) rowToToken[k] = tokens.length;
    tokens.push({ row: r, span, text: rest !== undefined ? cellText(rest) : '' });
    r += span;
  }

  const boundaries = {};
  const layerValues = {};
  const empty = new Set();
  layers.forEach(({ name }) => {
    boundaries[name] = new Set();
    layerValues[name] = {};
    const col = colByName[name];
    if (col) {
      for (let r = 2; r <= maxRow; r++) {
        if (cells[r]?.[col] !== undefined && rowToToken[r] !== undefined) {
          boundaries[name].add(rowToToken[r]);
          layerValues[name][rowToToken[r]] = cellText(cells[r][col]);
        }
      }
    }
    if (boundaries[name].size === 0) empty.add(name);
    if (tokens.length > 0) boundaries[name].add(0);
  });

  if (isNesting(config)) {
    validateNesting(boundaries, layers, tokens, empty);
    // An unedited layer inherits the breaks of all larger layers, so later edits stay consistent
    layers.forEach(({ name }, j) => {
      if (!empty.has(name)) return;
      layers.slice(0, j).forEach((larger) => boundaries[larger.name].forEach((idx) => boundaries[name].add(idx)));
    });
  }
  return { colByName, tokens, boundaries, layerValues, rawLines, maxCol, layers };
}

export function serializeSocialCalc(parsedData, boundaries, config) {
  const { colByName, tokens, rawLines, layerValues } = parsedData;
  const layers = normalizeLayers(config);
  const colMap = { ...colByName };
  let nextColIdx = parsedData.maxCol;
  const newHeaders = [];

  const layerCols = {};
  layers.forEach(({ name }) => {
    if (!colMap[name]) {
      colMap[name] = indexToCol(++nextColIdx);
      newHeaders.push(`cell:${colMap[name]}1:t:${escapeSC(name)}:${HEADER_FORMAT}`);
    }
    layerCols[name] = colMap[name];
  });
  const managedCols = new Set(Object.values(layerCols));

  const newCells = [];
  layers.forEach(({ name, style }) => {
    const col = layerCols[name];
    const starts = Array.from(boundaries[name] || []).filter((i) => i >= 0 && i < tokens.length).sort((a, b) => a - b);
    if (starts.length === 0 || starts[0] !== 0) starts.unshift(0);
    let seq = 1;

    starts.forEach((startIdx, i) => {
      const endIdx = i + 1 < starts.length ? starts[i + 1] : tokens.length;
      let val;
      if (style === 'sequential') val = String(seq++);
      else if (style === 'words') val = tokens.slice(startIdx, endIdx).map((t) => t.text).join(' ');
      else val = layerValues?.[name]?.[startIdx] || style; // fixed default, existing values are preserved

      let cell = `t:${escapeSC(val)}:f:1:tvf:1`;
      const rows = tokens[endIdx - 1].row + tokens[endIdx - 1].span - tokens[startIdx].row;
      if (rows > 1) cell += `:rowspan:${rows}`;
      newCells.push({ row: tokens[startIdx].row, col, line: `cell:${col}${tokens[startIdx].row}:${cell}` });
    });
  });
  newCells.sort((a, b) => a.row - b.row || colToIndex(a.col) - colToIndex(b.col));

  // Drop old cells of managed columns (but never the header row)
  const output = rawLines.filter((line) => {
    const m = line.match(CELL_RE);
    return !(m && parseInt(m[2], 10) > 1 && managedCols.has(m[1]));
  });

  let insertAt = output.findIndex((l) => l.startsWith('sheet:'));
  if (insertAt < 0) insertAt = output.length;
  output.splice(insertAt, 0, ...newHeaders, ...newCells.map((c) => c.line));

  // Keep the sheet dimensions in sync with any newly created columns
  const sheetIdx = output.findIndex((l) => l.startsWith('sheet:'));
  if (sheetIdx >= 0 && newHeaders.length > 0) {
    output[sheetIdx] = output[sheetIdx].replace(/^sheet:c:\d+/, `sheet:c:${nextColIdx}`);
  }

  return output.join('\n');
}

/**
 * SocialCalc <-> RST/eRST model conversion for the rstWeb widget.
 *
 * Model: {
 *   edus:      [{ id, start, end, parent, relname }]   EDUs in document order; id === index + 1; start/end are
 *                                                       0-based word token indices (end exclusive)
 *   groups:    [{ id, kind, parent, relname }]          kind 'span' | 'multinuc'; ids continue after the last EDU
 *   secedges:  [{ source, target, relname }]            secondary (eRST) edges between any two nodes
 *   signals:   [{ source, target?, type, subtype, tokens }]  target is set when the signal belongs to a secondary
 *                                                       edge; tokens are 1-based word token numbers, possibly empty
 * }
 * A node without a parent is a root (relname null).
 *
 * Spreadsheet encoding (one row per word token, header names configurable via rst-config.js):
 *   edu      one cell per EDU spanning its tokens: "2:joint-list:5" (id:relname:parent) or "3" for a root EDU
 *   node     any number of columns with the same header, one cell per group spanning its tokens, packed
 *            shortest-first so spans nest: "5:multinuc:causal-cause:1" or "7:span" for a root
 *   secedge  cell on the first row of the source node: "src-trg:relname". Several columns of this name are used
 *            when secedges start on the same row (one entry per cell)
 *   signal   cell on the first row of the signalled token: "source[-target]:type:subtype:tokens". Several columns of
 *            this name are used when signals start on the same row
 * Surplus columns of a repeated name that end up empty are deleted when writing (the first one is kept once present).
 * The tree is defined entirely by the ids and parents in the cells: rowspans and node column order are only for
 * readability and are ignored when reading. EDU boundaries (owned by the Segmenter) are the cell starts of the
 * edu column; on reading, EDUs are renumbered by position and all references remapped, so segmentation edits
 * that split or merge EDUs leave a consistent tree. When an EDU is split the earlier part keeps the old EDU (id,
 * parent, relation) and the later part becomes a new unattached root. References to vanished EDUs are dropped
 * with a warning. A word token is one cell of the words column (merged cells count once), as in the Segmenter.
 */

import { CELL_RE, HEADER_FORMAT, escapeSC, unescapeSC, colToIndex, indexToCol } from '../segmenter/segmenter-io.js';
import { normalizeRstConfig } from './rst-config.js';

const GROUP_KINDS = new Set(['span', 'multinuc']);
const isInt = (s) => /^\d+$/.test(s);

const parseCell = (rest) => {
  const parts = rest.split(':');
  const attrs = {};
  for (let i = 0; i + 1 < parts.length; i += 2) attrs[parts[i]] = parts[i + 1];
  const raw = attrs.t ?? attrs.v;
  return { text: raw === undefined ? '' : unescapeSC(raw), rowspan: Math.max(1, parseInt(attrs.rowspan, 10) || 1) };
};

/** Reads the raw sheet structure: cells, header columns and word tokens (a token is a cell of the words column) */
export function readSheet(scString, cfg) {
  const rawLines = String(scString || '').split(/\r?\n/);
  const cells = {};
  const headers = [];
  let maxRow = 1;
  let maxCol = 0;

  rawLines.forEach((line) => {
    const m = line.match(CELL_RE);
    if (m) {
      const [, col, row, rest] = m;
      const r = parseInt(row, 10);
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, colToIndex(col));
      const cell = parseCell(rest);
      (cells[r] ||= {})[col] = cell;
      if (r === 1 && cell.text) headers.push({ col, name: cell.text });
      return;
    }
    const sheet = line.match(/^sheet:c:(\d+):r:(\d+)/);
    if (sheet) {
      maxCol = Math.max(maxCol, parseInt(sheet[1], 10));
      maxRow = Math.max(maxRow, parseInt(sheet[2], 10));
    }
  });
  headers.sort((a, b) => colToIndex(a.col) - colToIndex(b.col));
  const colsNamed = (name) => headers.filter((h) => h.name === name).map((h) => h.col);

  const wordCol = colsNamed(cfg.words)[0];
  const tokens = [];
  const rowToToken = {};
  if (wordCol) {
    let coveredUntil = 1;
    for (let r = 2; r <= maxRow; r++) {
      if (r <= coveredUntil) continue;
      const cell = cells[r]?.[wordCol];
      const span = cell ? cell.rowspan : 1;
      for (let k = r; k < r + span; k++) rowToToken[k] = tokens.length;
      tokens.push({ row: r, span, text: cell ? cell.text : '' });
      coveredUntil = r + span - 1;
    }
  }

  return {
    rawLines, cells, maxRow, maxCol, tokens, rowToToken,
    cols: { edu: colsNamed(cfg.edu)[0], node: colsNamed(cfg.node), secedge: colsNamed(cfg.secedge), signal: colsNamed(cfg.signal) }
  };
}

const rowsOf = (sheet, col) => Object.keys(sheet.cells).map(Number).sort((a, b) => a - b)
  .filter((r) => r > 1 && sheet.cells[r][col]);

const parseNodeRef = (s) => (isInt(s) ? parseInt(s, 10) : null);

export function parseSocialCalc(scString, config) {
  const cfg = normalizeRstConfig(config);
  const sheet = readSheet(scString, cfg);
  const warnings = [];
  const { tokens, rowToToken, cols } = sheet;

  // EDUs: the starts of the edu column cells (token 0 always starts one)
  const eduStarts = new Map();
  if (cols.edu) {
    rowsOf(sheet, cols.edu).forEach((r) => {
      const t = rowToToken[r];
      if (t !== undefined && !eduStarts.has(t)) eduStarts.set(t, sheet.cells[r][cols.edu].text.trim());
    });
  }
  if (eduStarts.size === 0 && tokens.length > 0) warnings.push('No EDU segmentation found');
  else if (!eduStarts.has(0) && tokens.length > 0) eduStarts.set(0, '');

  const starts = [...eduStarts.keys()].sort((a, b) => a - b);
  const edus = starts.map((start, i) => {
    const [idStr = '', rel = '', parentStr = ''] = eduStarts.get(start).split(':');
    if (idStr && !isInt(idStr)) warnings.push(`EDU at token ${start + 1} has an invalid id "${idStr}"`);
    return {
      id: i + 1, start, end: i + 1 < starts.length ? starts[i + 1] : tokens.length,
      oldId: parseNodeRef(idStr), oldParent: parseNodeRef(parentStr), relname: rel || null
    };
  });

  const groupsRaw = [];
  cols.node.forEach((col) => rowsOf(sheet, col).forEach((r) => {
    const text = sheet.cells[r][col].text.trim();
    if (!text) return;
    const [idStr, kind, rel = '', parentStr = ''] = text.split(':');
    if (!isInt(idStr) || !GROUP_KINDS.has(kind)) {
      warnings.push(`Ignored malformed node cell "${text}" in row ${r}`);
      return;
    }
    groupsRaw.push({ oldId: parseInt(idStr, 10), kind, oldParent: parseNodeRef(parentStr), relname: rel || null });
  }));

  // Renumber: EDUs by position, groups continue after them in their previous order
  const oldToNew = new Map();
  const seen = new Set();
  edus.forEach((e) => {
    if (e.oldId === null) return;
    if (seen.has(e.oldId)) {
      warnings.push(`Duplicate node id ${e.oldId}, EDU ${e.id} treated as new`);
      return;
    }
    seen.add(e.oldId);
    oldToNew.set(e.oldId, e.id);
  });
  const uniqueGroups = groupsRaw.filter((g) => {
    if (seen.has(g.oldId)) {
      warnings.push(`Duplicate node id ${g.oldId}, ignored`);
      return false;
    }
    seen.add(g.oldId);
    return true;
  }).sort((a, b) => a.oldId - b.oldId);
  const groups = uniqueGroups.map((g, j) => {
    const id = edus.length + 1 + j;
    oldToNew.set(g.oldId, id);
    return { id, kind: g.kind, oldParent: g.oldParent, relname: g.relname };
  });

  const byId = new Map();
  [...edus, ...groups].forEach((n) => {
    byId.set(n.id, n);
    n.parent = null;
    if (n.oldParent !== null) {
      const p = oldToNew.get(n.oldParent);
      if (p === undefined || p === n.id) warnings.push(`Node ${n.id} refers to missing parent ${n.oldParent}, detached`);
      else n.parent = p;
    }
    if (n.parent === null) n.relname = null;
  });
  byId.forEach((node) => {
    const visited = new Set();
    for (let cur = node; cur && cur.parent !== null; cur = byId.get(cur.parent)) {
      if (visited.has(cur.id)) {
        warnings.push(`Cycle in the tree at node ${cur.id}, detached`);
        cur.parent = null;
        cur.relname = null;
        break;
      }
      visited.add(cur.id);
    }
  });
  edus.forEach((e) => { delete e.oldId; delete e.oldParent; });
  groups.forEach((g) => delete g.oldParent);

  const secedges = [];
  if (cols.secedge.length) {
    cols.secedge.flatMap((col) => rowsOf(sheet, col).map((r) => sheet.cells[r][col])).forEach((cell) => cell.text.split('\n').forEach((line) => {
      if (!line.trim()) return;
      const [id = '', rel = ''] = line.trim().split(':');
      const [s, t] = id.split('-').map(parseNodeRef);
      const source = oldToNew.get(s);
      const target = oldToNew.get(t);
      if (source === undefined || target === undefined) warnings.push(`Dropped secondary edge "${line.trim()}": node missing`);
      else if (!secedges.some((e) => e.source === source && e.target === target)) secedges.push({ source, target, relname: rel });
    }));
  }

  const signals = [];
  if (cols.signal.length) {
    cols.signal.flatMap((col) => rowsOf(sheet, col).map((r) => sheet.cells[r][col])).forEach((cell) => cell.text.split('\n').forEach((line) => {
      if (!line.trim()) return;
      const [id = '', type = '', subtype = '', tokenStr = ''] = line.trim().split(':');
      const [s, t] = id.split('-').map(parseNodeRef);
      const source = oldToNew.get(s);
      const target = t === undefined ? undefined : oldToNew.get(t);
      const isEdge = id.includes('-');
      const valid = source !== undefined && (!isEdge || (target !== undefined && secedges.some((e) => e.source === source && e.target === target)));
      const signalTokens = tokenStr.split(',').filter(Boolean).map(Number);
      if (!valid) {
        warnings.push(`Dropped signal "${line.trim()}": source missing`);
        return;
      }
      if (signalTokens.some((n) => !Number.isInteger(n) || n < 1 || n > tokens.length)) {
        warnings.push(`Dropped signal "${line.trim()}": token out of range`);
        return;
      }
      signals.push({ source, ...(isEdge ? { target } : {}), type, subtype, tokens: signalTokens });
    }));
  }

  return { model: { edus, groups, secedges, signals }, sheet, warnings };
}

/** Token ranges [start, end) of every node: EDUs as segmented, groups as the hull of their descendant EDUs */
export function nodeExtents(model) {
  const children = new Map();
  [...model.edus, ...model.groups].forEach((n) => {
    if (n.parent !== null) (children.get(n.parent) || children.set(n.parent, []).get(n.parent)).push(n.id);
  });
  const extents = new Map(model.edus.map((e) => [e.id, [e.start, e.end]]));
  const visiting = new Set();
  const extentOf = (id) => {
    if (extents.has(id)) return extents.get(id);
    if (visiting.has(id)) return null;
    visiting.add(id);
    let range = null;
    (children.get(id) || []).forEach((c) => {
      const r = extentOf(c);
      if (r) range = range ? [Math.min(range[0], r[0]), Math.max(range[1], r[1])] : [...r];
    });
    visiting.delete(id);
    if (range) extents.set(id, range);
    return range;
  };
  model.groups.forEach((g) => extentOf(g.id));
  return extents;
}

/** Assigns groups to node columns, shortest first, so each column holds non-overlapping spans and spans nest outward */
function packGroups(model, extents) {
  const items = model.groups.filter((g) => extents.has(g.id))
    .sort((a, b) => {
      const [as, ae] = extents.get(a.id);
      const [bs, be] = extents.get(b.id);
      return (ae - as) - (be - bs) || as - bs || a.id - b.id;
    });
  const columns = [];
  items.forEach((g) => {
    const [s, e] = extents.get(g.id);
    let col = columns.find((c) => c.every(([cs, ce]) => e <= cs || s >= ce));
    if (!col) columns.push(col = []);
    col.push([s, e, g]);
  });
  return columns.map((c) => c.map(([, , g]) => g));
}

/**
 * Returns the sheet with `words` filled into the words column (created if missing), for a document that has no text
 * yet. A value without any sheet gets a fresh skeleton. Used when an rs4 file is imported into an empty document.
 */
export function withWords(scString, words, config) {
  const cfg = normalizeRstConfig(config);
  const wordLine = (col, i, w) => `cell:${col}${i + 2}:t:${escapeSC(w)}:f:1:tvf:1`;
  const headerLine = (col) => `cell:${col}1:t:${escapeSC(cfg.words)}:${HEADER_FORMAT}`;
  const lines = String(scString || '').split(/\r?\n/);
  const rows = words.length + 1;

  if (!lines.some((l) => l.startsWith('sheet:'))) {
    return [
      'socialcalc:version:1.0', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
      '--SocialCalcSpreadsheetControlSave', 'Content-type: text/plain; charset=UTF-8', '',
      '# SocialCalc Spreadsheet Control Save', 'version:1.0', 'part:sheet', 'part:edit', 'part:audit',
      '--SocialCalcSpreadsheetControlSave', 'Content-type: text/plain; charset=UTF-8', '',
      'version:1.5', headerLine('A'), ...words.map((w, i) => wordLine('A', i, w)),
      `sheet:c:1:r:${rows}:tvf:2`, 'font:1:* * Antinoou', 'font:2:normal bold * *', 'valueformat:1:text-plain',
      '--SocialCalcSpreadsheetControlSave', 'Content-type: text/plain; charset=UTF-8', '',
      'version:1.0', 'rowpane:0:1:1', 'colpane:0:1:1', 'ecell:A1',
      '--SocialCalcSpreadsheetControlSave', 'Content-type: text/plain; charset=UTF-8', '',
      '--SocialCalcSpreadsheetControlSave--'
    ].join('\n');
  }

  const sheet = readSheet(scString, cfg);
  let col = Object.entries(sheet.cells[1] || {}).find(([, c]) => c.text === cfg.words)?.[0];
  let maxCol = sheet.maxCol;
  const added = [];
  if (!col) {
    col = indexToCol(++maxCol);
    added.push(headerLine(col));
  }
  // Blank cells left in the words column are replaced
  const output = lines.filter((l) => {
    const m = l.match(CELL_RE);
    return !(m && m[1] === col && parseInt(m[2], 10) > 1);
  });
  added.push(...words.map((w, i) => wordLine(col, i, w)));
  const sheetIdx = output.findIndex((l) => l.startsWith('sheet:'));
  output.splice(sheetIdx, 0, ...added);
  output[sheetIdx + added.length] = output[sheetIdx + added.length]
    .replace(/^sheet:c:\d+:r:\d+/, `sheet:c:${maxCol}:r:${Math.max(sheet.maxRow, rows)}`);
  return output.join('\n');
}

export function serializeSocialCalc(sheet, model, config) {
  const cfg = normalizeRstConfig(config);
  const { tokens, rawLines } = sheet;
  const extents = nodeExtents(model);
  const columns = packGroups(model, extents);
  const written = new Set([...model.edus.map((e) => e.id), ...columns.flat().map((g) => g.id)]);

  const secedges = model.secedges.filter((e) => written.has(e.source) && written.has(e.target));
  const signals = model.signals.filter((s) => written.has(s.source) && (s.target === undefined || secedges.some((e) => e.source === s.source && e.target === s.target)));

  // Entries of the same kind that start on the same row go to successive columns, one entry per cell
  const placeBySlot = (entries) => {
    const perRow = new Map();
    return entries.map((entry) => {
      const slot = perRow.get(entry.row) || 0;
      perRow.set(entry.row, slot + 1);
      return { ...entry, slot };
    });
  };
  const secedgeCells = placeBySlot(secedges.slice().sort((a, b) => a.source - b.source || a.target - b.target)
    .map((e) => ({ row: tokens[extents.get(e.source)[0]].row, text: `${e.source}-${e.target}:${e.relname ?? ''}` })));
  const signalCells = placeBySlot(signals.map((s, i) => {
    const first = s.tokens.length ? Math.min(...s.tokens) - 1 : extents.get(s.source)[0];
    const id = s.target === undefined ? `${s.source}` : `${s.source}-${s.target}`;
    return { i, row: tokens[first].row, text: `${id}:${s.type}:${s.subtype}:${s.tokens.join(',')}` };
  }).sort((a, b) => a.row - b.row || a.i - b.i));
  const slotsNeeded = (cells) => cells.reduce((n, c) => Math.max(n, c.slot + 1), 0);

  // Existing columns are reused in order; surplus ones are deleted, but the first column of a layer is kept once present
  const plan = (existing, needed) => {
    const count = Math.max(needed, Math.min(existing.length, 1));
    return { used: existing.slice(0, count), fresh: Math.max(0, count - existing.length), dropped: existing.slice(count) };
  };
  const plans = {
    node: plan(sheet.cols.node, columns.length),
    secedge: plan(sheet.cols.secedge, slotsNeeded(secedgeCells)),
    signal: plan(sheet.cols.signal, slotsNeeded(signalCells))
  };
  const eduNeeded = model.edus.length > 0 && !sheet.cols.edu;

  const dropped = new Set(Object.values(plans).flatMap((p) => p.dropped).map(colToIndex));
  const shift = (idx) => idx - [...dropped].filter((d) => d < idx).length;
  const finalCol = (letter) => indexToCol(shift(colToIndex(letter)));
  let nextColIdx = sheet.maxCol - dropped.size;
  const newHeaders = [];
  const freshCol = (name) => {
    const col = indexToCol(++nextColIdx);
    newHeaders.push(`cell:${col}1:t:${escapeSC(name)}:${HEADER_FORMAT}`);
    return col;
  };

  const eduCol = sheet.cols.edu ? finalCol(sheet.cols.edu) : (eduNeeded ? freshCol(cfg.edu) : null);
  const finalCols = (kind, name) => [...plans[kind].used.map(finalCol), ...Array.from({ length: plans[kind].fresh }, () => freshCol(name))];
  const nodeCols = finalCols('node', cfg.node);
  const secedgeCols = finalCols('secedge', cfg.secedge);
  const signalCols = finalCols('signal', cfg.signal);
  const rewritten = new Set([sheet.cols.edu, ...plans.node.used, ...plans.secedge.used, ...plans.signal.used].filter(Boolean));

  const rowSpan = (s, e) => tokens[e - 1].row + tokens[e - 1].span - tokens[s].row;
  const cell = (col, row, text, span = 1) => ({
    row, col, line: `cell:${col}${row}:t:${escapeSC(text)}:f:1:tvf:1${span > 1 ? `:rowspan:${span}` : ''}`
  });
  const link = (n) => (n.parent === null ? '' : `:${n.relname ?? ''}:${n.parent}`);
  const newCells = [];

  model.edus.forEach((e) => newCells.push(cell(eduCol, tokens[e.start].row, `${e.id}${link(e)}`, rowSpan(e.start, e.end))));
  columns.forEach((groups, i) => groups.forEach((g) => {
    const [s, e] = extents.get(g.id);
    newCells.push(cell(nodeCols[i], tokens[s].row, `${g.id}:${g.kind}${link(g)}`, rowSpan(s, e)));
  }));
  secedgeCells.forEach((c) => newCells.push(cell(secedgeCols[c.slot], c.row, c.text)));
  signalCells.forEach((c) => newCells.push(cell(signalCols[c.slot], c.row, c.text)));
  newCells.sort((a, b) => a.row - b.row || colToIndex(a.col) - colToIndex(b.col));

  // Rebuild the sheet: drop deleted columns and the old content of ours, close the gaps left by deleted columns
  const COL_RE = /^(cell|col):([A-Z]+)(\d*)(:.*)?$/;
  const output = [];
  rawLines.forEach((line) => {
    const m = line.match(COL_RE);
    if (!m) {
      output.push(line);
      return;
    }
    const [, kind, letter, row, rest = ''] = m;
    const idx = colToIndex(letter);
    if (dropped.has(idx)) return;
    if (kind === 'cell' && rewritten.has(letter) && parseInt(row, 10) > 1) return;
    output.push(`${kind}:${finalCol(letter)}${row}${rest}`);
  });

  let insertAt = output.findIndex((l) => l.startsWith('sheet:'));
  if (insertAt < 0) insertAt = output.length;
  output.splice(insertAt, 0, ...newHeaders, ...newCells.map((c) => c.line));

  const sheetIdx = output.findIndex((l) => l.startsWith('sheet:'));
  if (sheetIdx >= 0) output[sheetIdx] = output[sheetIdx].replace(/^sheet:c:\d+/, `sheet:c:${Math.max(nextColIdx, 1)}`);

  return output.join('\n');
}


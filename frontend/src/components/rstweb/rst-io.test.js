import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSocialCalc, serializeSocialCalc, nodeExtents, withWords } from './rst-io.js';
import { parseRs4, serializeRs4, fitRs4Import } from './rs4.js';
import { normalizeRstConfig, checkSegmenterConflict } from './rst-config.js';
import { parseSocialCalc as parseSeg, serializeSocialCalc as serializeSeg } from '../segmenter/segmenter-io.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'examples');
const read = (name) => readFileSync(join(dir, name), 'utf8');
const EXAMPLES = ['simple', 'multinuc', 'signals'];
const CONFIG = {};

const key = (o) => JSON.stringify(o);
const canon = (model, { extents = true } = {}) => ({
  edus: model.edus.map((e) => ({ id: e.id, parent: e.parent, relname: e.relname, ...(extents ? { start: e.start, end: e.end } : {}) })),
  groups: model.groups.map((g) => ({ ...g })).sort((a, b) => a.id - b.id),
  secedges: model.secedges.map((e) => ({ ...e })).sort((a, b) => key(a).localeCompare(key(b))),
  signals: model.signals.map((s) => ({ ...s })).sort((a, b) => key(a).localeCompare(key(b)))
});

/** Gives an rs4 model the EDU token ranges of a spreadsheet, since rs4 text tokenization may differ */
const withSheetExtents = (model, sheetModel) => ({
  ...model,
  edus: model.edus.map((e, i) => ({ ...e, start: sheetModel.edus[i].start, end: sheetModel.edus[i].end }))
});

for (const name of EXAMPLES) {
  test(`${name}: rs4 model survives a spreadsheet round trip`, () => {
    const mock = parseSocialCalc(read(`${name}.socialcalc`), CONFIG);
    const { model: rs4 } = parseRs4(read(`${name}.rs4`));
    const model = withSheetExtents(rs4, mock.model);

    const sc = serializeSocialCalc(mock.sheet, model, CONFIG);
    const again = parseSocialCalc(sc, CONFIG);
    assert.deepEqual(again.warnings, []);
    assert.deepEqual(canon(again.model), canon(model));

    // Writing is stable once canonical
    assert.equal(serializeSocialCalc(again.sheet, again.model, CONFIG), sc);
  });

  test(`${name}: rs4 export/import round trip`, () => {
    const { model, relations, signalTypes } = parseRs4(read(`${name}.rs4`));
    const words = model.edus.flatMap((e) => Array.from({ length: e.end - e.start }, (_, i) => `w${e.start + i}`));
    const xml = serializeRs4(model, words, { relations, signalTypes });
    const again = parseRs4(xml);
    assert.deepEqual(canon(again.model), canon(model));
    assert.deepEqual(again.relations, relations);
    assert.deepEqual(again.signalTypes, signalTypes);
  });
}

test('rs4 import is fitted to the document words and EDUs', () => {
  const imported = parseRs4(read('signals.rs4'));
  const doc = parseSocialCalc(read('signals.socialcalc'), CONFIG);
  const texts = doc.sheet.tokens.map((t) => t.text);
  const fit = fitRs4Import(imported, texts, doc.model);
  assert.equal(fit.error, undefined);
  assert.deepEqual(fit.model.edus.map((e) => [e.start, e.end]), doc.model.edus.map((e) => [e.start, e.end]));
  assert.deepEqual(fit.model.groups, imported.model.groups);
  assert.equal(fit.model.signals.length, imported.model.signals.length);
  assert.ok(fit.model.signals.every((s) => s.tokens.every((t) => t >= 1 && t <= texts.length)));
  assert.match(fitRs4Import(imported, ['x', ...texts.slice(1)], doc.model).error, /text/);
});

test('rs4 import into an empty document or over conflicting EDUs', () => {
  const imported = parseRs4(read('signals.rs4'));
  const doc = parseSocialCalc(read('signals.socialcalc'), CONFIG);
  const reSegmented = { ...doc.model, edus: doc.model.edus.slice(1) };
  assert.equal(fitRs4Import(imported, doc.sheet.tokens.map((t) => t.text), reSegmented).conflict, true);
  const adopted = fitRs4Import(imported, doc.sheet.tokens.map((t) => t.text), reSegmented, { adoptEdus: true });
  assert.deepEqual(adopted.model.edus.map((e) => [e.start, e.end]), doc.model.edus.map((e) => [e.start, e.end]));

  for (const start of ['', null]) {
    const filled = parseSocialCalc(withWords(start, imported.words, CONFIG), CONFIG);
    assert.equal(filled.sheet.tokens.length, imported.words.length);
    const fit = fitRs4Import(imported, filled.sheet.tokens.map((t) => t.text), filled.model, { adoptEdus: true });
    assert.equal(fit.error, undefined);
    const back = parseSocialCalc(serializeSocialCalc(filled.sheet, fit.model, CONFIG), CONFIG);
    assert.equal(back.model.edus.length, imported.model.edus.length);
    assert.deepEqual(back.model.groups, imported.model.groups);
  }
});

test('simple and multinuc mock-ups agree with their rs4 files', () => {
  for (const name of ['simple', 'multinuc']) {
    const mock = parseSocialCalc(read(`${name}.socialcalc`), CONFIG);
    assert.deepEqual(mock.warnings, [], name);
    assert.deepEqual(canon(mock.model, { extents: false }), canon(parseRs4(read(`${name}.rs4`)).model, { extents: false }), name);
  }
});

test('multinuc and eRST layers are written in the expected cells', () => {
  const mock = parseSocialCalc(read('signals.socialcalc'), CONFIG);
  const model = withSheetExtents(parseRs4(read('signals.rs4')).model, mock.model);
  const lines = serializeSocialCalc(mock.sheet, model, CONFIG).split('\n');
  const cellText = (ref) => lines.find((l) => l.startsWith(`cell:${ref}:`))?.split(':')[3];
  assert.equal(cellText('C2'), '1\\cspan\\c5');
  assert.equal(cellText('C12'), '3\\cjoint-list\\c6');
  assert.equal(cellText('G12'), '3-2\\cjoint-sequence');
  // Two signals on the same token row share one cell
  assert.match(lines.find((l) => l.startsWith('cell:H2:')), /^cell:H2:t:6\\creference\\cpersonal_reference\\c1,6:/);
  assert.equal(cellText('H6'), '6\\cdm\\cdm\\c5');
  // Spans nest short to long and compact into few columns
  const nodeCols = new Set(lines.filter((l) => /^cell:[A-Z]+1:t:node:/.test(l)).map((l) => l.split(':')[1]));
  assert.ok(nodeCols.size <= 3, `expected at most 3 node columns, got ${nodeCols.size}`);
});

test('node extents are the hull of descendant EDUs', () => {
  const mock = parseSocialCalc(read('multinuc.socialcalc'), CONFIG);
  const ext = nodeExtents(mock.model);
  const root = mock.model.groups.find((g) => g.parent === null);
  assert.deepEqual(ext.get(root.id), [0, mock.sheet.tokens.length]);
});

test('mangled node cells, missing parents and cycles produce warnings, not exceptions', () => {
  const base = read('multinuc.socialcalc');
  const bad = base
    .replace('5\\cmultinuc\\ccausal-cause\\c1', '5\\cmultinuc\\ccausal-cause\\c99')
    .replace('6\\cspan\\cspan\\c7', 'junk')
    .replace('7\\cspan', '7\\cspan\\cspan\\c6');
  const { model, warnings } = parseSocialCalc(bad, CONFIG);
  assert.ok(warnings.some((w) => /missing parent 99/.test(w)));
  assert.ok(warnings.some((w) => /malformed node cell/.test(w)));
  model.groups.forEach((g) => assert.ok(g.parent === null || model.groups.some((p) => p.id === g.parent) || model.edus.some((p) => p.id === g.parent)));
});

test('a document without RST columns reads as an empty model and can be given a first tree', () => {
  const sc = read('simple.socialcalc').split('\n').filter((l) => !/^cell:[C-Z]/.test(l)).join('\n');
  const { model, sheet } = parseSocialCalc(sc, CONFIG);
  assert.equal(model.edus.length, 0);
  assert.equal(parseSocialCalc(serializeSocialCalc(sheet, model, CONFIG), CONFIG).sheet.cols.edu, undefined);
});

// Segmenter owns the EDU boundaries (and writes an empty value for new ones), the RST reader reconciles
const SEG_CONFIG = { words: 'tok', layers: { edu: ['|', 'green', ''] } };
const reSegment = (sc, edit) => {
  const seg = parseSeg(sc, SEG_CONFIG);
  const boundaries = { edu: new Set(seg.boundaries.edu) };
  edit(boundaries.edu);
  return serializeSeg(seg, boundaries, SEG_CONFIG);
};

test('splitting an EDU in the Segmenter renumbers ids and keeps all references intact', () => {
  const sc = read('signals.socialcalc');
  const before = parseSocialCalc(sc, CONFIG).model;
  const split = parseSocialCalc(reSegment(sc, (b) => b.add(6)), CONFIG);
  assert.deepEqual(split.warnings, []);
  const { model } = split;
  assert.equal(model.edus.length, before.edus.length + 1);
  assert.deepEqual(model.edus.map((e) => e.id), [1, 2, 3, 4, 5]);
  assert.equal(model.edus[2].parent, null); // the new EDU is an unattached root
  // old EDU 3 -> 4, old groups 5,6,7 -> 6,7,8
  assert.equal(model.edus[3].parent, before.edus[2].parent + 1);
  assert.deepEqual(model.secedges, before.secedges.map((e) => ({ ...e, source: e.source + 1 })));
  assert.deepEqual(model.signals.map((s) => s.source).sort(), before.signals.map((s) => (s.source > 2 ? s.source + 1 : s.source)).sort());
  assert.ok(model.groups.every((g) => g.id > 5));
});

test('merging EDUs in the Segmenter drops references to the vanished EDU with warnings', () => {
  const sc = read('signals.socialcalc');
  const merged = parseSocialCalc(reSegment(sc, (b) => b.delete(10)), CONFIG);
  assert.equal(merged.model.edus.length, 3);
  assert.deepEqual(merged.model.secedges, []);
  assert.ok(merged.warnings.some((w) => /secondary edge/.test(w)));
  assert.ok(merged.warnings.some((w) => /Dropped signal/.test(w)));
});

test('normalizeRstConfig supplies column defaults and inventories', () => {
  const cfg = normalizeRstConfig({ words: 'word', relations: { rst: ['a'], multinuc: 'b;c' }, signal_types: { dm: ['dm'] } });
  assert.equal(cfg.words, 'word');
  assert.equal(cfg.edu, 'edu');
  assert.deepEqual(cfg.relations, { rst: ['a'], multinuc: ['b', 'c'] });
  assert.deepEqual(cfg.signalTypes, { dm: ['dm'] });
});

test('layers can be switched off by flags or empty column names', () => {
  const base = { signal_types: { dm: ['dm'] } };
  const on = normalizeRstConfig(base);
  assert.deepEqual([on.useSecedge, on.useSignals, on.disableSpans, on.disableMultinucs], [true, true, false, false]);
  const off = normalizeRstConfig({ ...base, disable_secedge: true, use_signals: false, disable_spans: true, disable_multinucs: true });
  assert.deepEqual([off.useSecedge, off.useSignals, off.disableSpans, off.disableMultinucs], [false, false, true, true]);
  const empty = normalizeRstConfig({ ...base, secedge: '', signal: '' });
  assert.deepEqual([empty.useSecedge, empty.useSignals], [false, false]);

  // Switched-off layers are neither read nor touched
  const sc = read('signals.socialcalc');
  const parsed = parseSocialCalc(sc, { secedge: '', signal: '' });
  assert.deepEqual([parsed.model.secedges.length, parsed.model.signals.length], [0, 0]);
  assert.equal(serializeSocialCalc(parsed.sheet, parsed.model, { secedge: '', signal: '' }).includes('secedge'), true);
});

test('signals without tokens are kept at the first token of their node', () => {
  const mock = parseSocialCalc(read('signals.socialcalc'), CONFIG);
  const model = withSheetExtents(parseRs4(read('signals.rs4')).model, mock.model);
  const group = model.groups[0];
  model.signals.push({ source: group.id, type: 'genre', subtype: 'layout', tokens: [] });

  const sc = serializeSocialCalc(mock.sheet, model, CONFIG);
  const again = parseSocialCalc(sc, CONFIG);
  assert.deepEqual(again.warnings, []);
  assert.ok(again.model.signals.some((s) => s.type === 'genre' && s.subtype === 'layout' && s.tokens.length === 0));
  assert.equal(serializeSocialCalc(again.sheet, again.model, CONFIG), sc);
});

test('signals and secondary edges starting on the same row get their own columns', () => {
  const mock = parseSocialCalc(read('signals.socialcalc'), CONFIG);
  const model = withSheetExtents(parseRs4(read('signals.rs4')).model, mock.model);
  model.signals.push({ source: 3, type: 'lexical', subtype: 'indicative_word', tokens: [12, 13] });
  model.signals.push({ source: 4, type: 'graphical', subtype: 'colon', tokens: [12] });
  model.secedges.push({ source: 3, target: 1, relname: 'joint-list' });

  const sc = serializeSocialCalc(mock.sheet, model, CONFIG);
  const again = parseSocialCalc(sc, CONFIG);
  assert.deepEqual(again.warnings, []);
  assert.deepEqual(canon(again.model), canon(model));
  assert.equal(again.sheet.cols.signal.length, 3); // token 12 starts three signals
  assert.equal(again.sheet.cols.secedge.length, 2);
  assert.equal(serializeSocialCalc(again.sheet, again.model, CONFIG), sc);
  // Each cell holds one entry
  assert.ok(!sc.split('\n').some((l) => /^cell:[A-Z]+\d+:t:.*\\n/.test(l)));
});

test('empty surplus columns are deleted and later columns shift left', () => {
  const mock = parseSocialCalc(read('signals.socialcalc'), CONFIG);
  const model = withSheetExtents(parseRs4(read('signals.rs4')).model, mock.model);
  // Moving group 7's children up makes the tree shallower, so fewer node columns are needed
  const flat = { ...model, groups: model.groups.filter((g) => g.id !== 7).map((g) => (g.parent === 7 ? { ...g, parent: null, relname: null } : g)) };
  flat.edus = flat.edus.map((e) => (e.parent === 7 ? { ...e, parent: null, relname: null } : e));
  const lines = serializeSocialCalc(mock.sheet, flat, CONFIG).split('\n');
  const headers = lines.filter((l) => /^cell:[A-Z]+1:/.test(l)).map((l) => l.split(':').slice(1, 4).join(':'));
  assert.deepEqual(headers, ['A1:t:tok', 'B1:t:pos', 'C1:t:edu', 'D1:t:node', 'E1:t:node', 'F1:t:secedge', 'G1:t:signal']);
  const again = parseSocialCalc(lines.join('\n'), CONFIG);
  assert.deepEqual(again.warnings, []);
  assert.deepEqual(canon(again.model), canon(flat));
  assert.equal(lines.find((l) => l.startsWith('sheet:')).split(':')[2], String(headers.length));
  // Tokens and POS are untouched
  assert.equal(lines.filter((l) => /^cell:[AB]\d+:/.test(l)).length, 46);
});

test('a layer without any content keeps one empty column, extra ones are removed', () => {
  const mock = parseSocialCalc(read('signals.socialcalc'), CONFIG);
  const model = { edus: mock.model.edus.map((e) => ({ ...e, parent: null, relname: null })), groups: [], secedges: [], signals: [] };
  const out = serializeSocialCalc(mock.sheet, model, CONFIG);
  const again = parseSocialCalc(out, CONFIG);
  assert.equal(again.sheet.cols.node.length, 1);
  assert.equal(again.sheet.cols.secedge.length, 1);
  assert.equal(again.sheet.cols.signal.length, 1);
});

test('merged word cells count as one token in both the Segmenter and rstWeb', () => {
  const sc = [
    'version:1.5',
    'cell:A1:t:tok', 'cell:B1:t:edu',
    'cell:A2:t:a', 'cell:A3:t:b b:rowspan:2', 'cell:A5:t:c',
    'sheet:c:2:r:5'
  ].join('\n');
  const seg = parseSeg(sc, SEG_CONFIG);
  assert.deepEqual(seg.tokens.map((t) => t.text), ['a', 'b b', 'c']);
  const out = serializeSeg(seg, { edu: new Set([0, 1]) }, SEG_CONFIG);
  assert.ok(out.includes('cell:B2:'));
  assert.match(out, /cell:B3:t::f:1:tvf:1:rowspan:3/);
  const rst = parseSocialCalc(out, CONFIG);
  assert.deepEqual(rst.model.edus.map((e) => [e.start, e.end]), [[0, 1], [1, 3]]);
});

test('segmenter layer sharing the rstweb EDU column must not use words/sequential styles', () => {
  const layers = (style) => ({ layers: { edu: ['|', 'green', ...(style === undefined ? [] : [style])] } });
  assert.match(checkSegmenterConflict({}, layers('words')) ?? 'none', /none/);
  assert.match(checkSegmenterConflict({ edu: 'edu' }, layers('words')), /Configuration error/);
  assert.match(checkSegmenterConflict({ edu: 'edu' }, layers('sequential')), /Configuration error/);
  assert.match(checkSegmenterConflict({ edu: 'edu' }, layers(undefined)), /Configuration error/);
  assert.equal(checkSegmenterConflict({ edu: 'edu' }, layers('')), null);
  assert.equal(checkSegmenterConflict({ edu: 'edu' }, { layers: { sentence: ['||', 'blue', 'sequential'] } }), null);
  assert.equal(checkSegmenterConflict({ edu: 'unit' }, layers('words')), null);
});

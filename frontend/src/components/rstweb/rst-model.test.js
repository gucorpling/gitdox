import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseRs4 } from './rs4.js';
import { normalizeRstConfig } from './rst-config.js';
import {
  attachNode, unlinkNode, insertParent, setRelation, addSecedge, removeSecedge, setSignals, removeSignalsAtToken,
  getNode, childrenOf, computeLayout
} from './rst-model.js';
import { createRstState, makeRstReducer, canUndo, canRedo } from './rst-state.js';
import { buildEdgeSpecs, relationOptions, newSignal, signalColorIndex } from './rst-edges.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'examples');
const load = (name) => parseRs4(readFileSync(join(dir, `${name}.rs4`), 'utf8'));

const examplesCfg = (name) => {
  const { relations } = load(name);
  return normalizeRstConfig({ relations });
};

const edu = (id, parent = null, relname = null) => ({ id, start: id, end: id, parent, relname });
const base = (extra = {}) => ({ edus: [edu(1), edu(2), edu(3)], groups: [], secedges: [], signals: [], ...extra });
const C = normalizeRstConfig({ relations: { rst: ['elaboration', 'evidence'], multinuc: ['joint', 'sequence'] } });

test('layout of multinuc example matches the legacy rendered geometry', () => {
  const { model } = load('multinuc');
  const { nodes } = computeLayout(model, examplesCfg('multinuc'));
  const g = (id) => nodes.get(id);
  assert.deepEqual([g(5).x, g(5).width, g(5).y, g(5).anchorX], [100, 196, 200, 164]);
  assert.deepEqual([g(6).width, g(6).y], [296, 140]);
  assert.deepEqual([g(7).width, g(7).y], [396, 80]);
  assert.deepEqual([1, 2, 3, 4].map((i) => g(i).y), [200, 260, 260, 140]);
});

test('layout of simple example: group geometry as a set', () => {
  const { model } = load('simple');
  const { nodes } = computeLayout(model, examplesCfg('simple'));
  const groups = model.groups.map((x) => nodes.get(x.id)).map((n) => [n.width, n.y]).sort();
  assert.deepEqual(groups, [[196, 140], [296, 80]]);
  assert.deepEqual([1, 2, 3].map((i) => nodes.get(i).y), [200, 200, 140]);
});

test('attach sets default relation, rejects cycles, and is a no-op when unchanged', () => {
  const r = attachNode(base(), C, 1, 2);
  assert.equal(r.error, undefined);
  assert.equal(getNode(r.model, 1).relname, 'elaboration');
  assert.equal(attachNode(r.model, C, 2, 1).error !== undefined, true);
  assert.equal(attachNode(r.model, C, 1, 2).model, r.model);
});

test('insertParent span/multinuc and relation handling', () => {
  let m = attachNode(base(), C, 1, 2).model;
  m = insertParent(m, C, 2, 'span').model;
  const span = m.groups[0];
  assert.equal(getNode(m, 2).parent, span.id);
  assert.equal(getNode(m, 2).relname, 'span');
  const mn = insertParent(base(), C, 1, 'multinuc').model;
  assert.equal(getNode(mn, 1).relname, C.defaultMultinuc);
  assert.equal(setRelation(mn, C, 1, 'elaboration').error !== undefined, true);
  assert.equal(setRelation(mn, C, 1, 'span').error !== undefined, true);
});

test('multinuc relation change propagates to siblings', () => {
  let m = insertParent(base(), C, 1, 'multinuc').model;
  const mid = m.groups[0].id;
  m = attachNode(m, C, 2, mid).model;
  m = setRelation(m, C, 2, 'sequence').model;
  assert.deepEqual(childrenOf(m, mid).map((n) => n.relname), ['sequence', 'sequence']);
});

test('unlinking the only nucleus prunes the span and orphans satellites', () => {
  let m = attachNode(base(), C, 1, 2).model;
  m = insertParent(m, C, 2, 'span').model;
  const spanId = m.groups[0].id;
  m = attachNode(m, C, 3, spanId).model; // span nucleus 2? 3 gets span-compatible relation
  m = unlinkNode(m, C, 2).model;
  assert.equal(getNode(m, 1).parent, 2);
  const m2 = unlinkNode(insertParent(base(), C, 1, 'span').model, C, 1).model;
  assert.equal(m2.groups.length, 0);
});

test('secedges: add, reject same start, remove with signals', () => {
  const m = base();
  assert.equal(addSecedge(m, C, 1, 1).error !== undefined, true);
  const a = addSecedge(m, C, 1, 3, 'evidence').model;
  assert.equal(a.secedges.length, 1);
  const s = setSignals(a, 1, 3, [{ type: 'dm', subtype: 'dm', tokens: [2, 1] }]).model;
  assert.deepEqual(s.signals[0].tokens, [1, 2]);
  assert.equal(removeSecedge(s, 1, 3).model.signals.length, 0);
  assert.equal(removeSignalsAtToken(s, 2).model.signals.length, 0);
});

test('reducer: undo, redo, errors do not enter history', () => {
  const reduce = makeRstReducer(C);
  let st = createRstState(base());
  st = reduce(st, { type: 'attach', id: 1, parent: 2 });
  assert.ok(canUndo(st));
  st = reduce(st, { type: 'attach', id: 2, parent: 1 });
  assert.ok(st.error);
  assert.equal(st.past.length, 1);
  st = reduce(st, { type: 'undo' });
  assert.equal(getNode(st.present, 1).parent, null);
  assert.ok(canRedo(st));
  st = reduce(st, { type: 'redo' });
  assert.equal(getNode(st.present, 1).parent, 2);
});

test('edge specs: kinds, curvature of secondary edges, and dropdown options', () => {
  const { model } = load('signals');
  const c = examplesCfg('signals');
  const specs = buildEdgeSpecs(model, c, computeLayout(model, c));
  const kinds = (k) => specs.filter((s) => s.kind === k);
  assert.equal(kinds('secedge').length, model.secedges.length);
  assert.equal(specs.length, model.edus.filter((e) => e.parent !== null).length + model.groups.filter((g) => g.parent !== null).length + model.secedges.length);
  assert.ok(kinds('span').every((s) => s.relname === 'span'));
  assert.ok(new Set(specs.map((s) => s.key)).size === specs.length);

  const labelled = normalizeRstConfig({ relations: { rst: ['b-two', 'a-one'], multinuc: ['joint', 'same-unit'] }, relation_labels: { 'b-two': 'two' } });
  assert.deepEqual(relationOptions(labelled, 'rst').map((o) => o.label), ['a-one', 'two']);
  assert.ok(relationOptions(labelled, 'multinuc').some((o) => o.label === '(satellite...)' && o.value === labelled.defaultRst));
  assert.ok(!relationOptions(labelled, 'secedge').some((o) => o.value === 'same-unit'));
});

test('signal helpers: default signal and colour index follow the inventory order', () => {
  const cfg = normalizeRstConfig({ signal_types: { dm: ['dm', 'other'], graphical: ['colon'] } });
  assert.deepEqual(newSignal(cfg, [3]), { type: 'dm', subtype: 'dm', tokens: [3] });
  assert.equal(signalColorIndex(cfg, 'dm'), 1);
  assert.equal(signalColorIndex(cfg, 'graphical'), 2);
  assert.equal(signalColorIndex(cfg, 'unknown'), 0);
});

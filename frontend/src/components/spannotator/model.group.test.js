import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStateInvariants, createInitialAnnotationState, spannotatorReducer } from './model.js';

function buildState(words, config = { GROUP_TYPES: ['coref'], EDGE_TYPES: ['bridge'] }) {
  let state = createInitialAnnotationState(words.join(' '), config);
  const tids = state.tokens.map((t) => t.tid);
  tids.forEach((tid) => {
    state = spannotatorReducer(state, { type: 'ADD_ENTITY', tokenIds: [tid], entityType: 'person' });
  });
  return { state, ids: tids.map((tid) => `${tid}-${tid}`) };
}

function connect(state, ids, groupType = 'bridge') {
  const selected = spannotatorReducer(state, {
    type: 'SET_UI_STATE',
    patch: { selectedEntities: new Set(ids) }
  });
  return spannotatorReducer(selected, { type: 'GROUP_SELECTED', groupType });
}

function edgeConfig(firstIn, edgeType = 'bridge') {
  const edge = {};
  if (firstIn !== undefined) edge.anaphor_is_first_in = firstIn;
  return {
    colors: {
      groups: { coref: ['chain', 'anytype'], split: ['star', 'anytype'] },
      edges: { [edgeType]: edge }
    }
  };
}

function assign(state, entityId, newGroup) {
  return spannotatorReducer(state, { type: 'ASSIGN_GROUP', groupType: 'coref', entityId, newGroup });
}

test('merging clusters of two mentions keeps groups consistent', () => {
  const { state: base, ids } = buildState(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  let state = base;
  state = assign(state, ids[0], 1);
  state = assign(state, ids[1], 1);
  state = assign(state, ids[2], 2);
  state = assign(state, ids[3], 2);
  state = assign(state, ids[4], 3);
  state = assign(state, ids[5], 3);

  const selected = [ids[0], ids[2], ids[4]];
  state = spannotatorReducer(state, { type: 'SET_UI_STATE', patch: { selectedEntities: new Set(selected) } });
  state = spannotatorReducer(state, { type: 'GROUP_SELECTED', groupType: 'coref' });

  assert.deepEqual(assertStateInvariants(state, { throwOnError: false }).errors, []);
  ids.slice(0, 6).forEach((id) => assert.equal(state.entitiesById[id].groups.coref, 1));
  assert.deepEqual([...state.groupsByType.coref[1]].sort(), ids.slice(0, 6).sort());
  assert.deepEqual(Object.keys(state.groupsByType.coref).sort(), ['0', '1']);
  assert.deepEqual(state.groupsByType.coref[0], [ids[6]]);
});

test('configured edges reject non-initial anaphors atomically regardless of selection order', () => {
  let { state, ids } = buildState(['a', 'b', 'c', 'd'], edgeConfig('coref'));
  state = assign(state, ids[1], 1);
  state = assign(state, ids[3], 1);
  const before = state;
  state = connect(state, [ids[3], ids[0]]);
  assert.match(state.uiState.mutationWarning, /bridge.*first member.*coref/);
  assert.deepEqual(state.entitiesById, before.entitiesById);
  assert.deepEqual(state.groupsByType, before.groupsByType);
  assert.deepEqual(state.assignedColors, before.assignedColors);
  assert.deepEqual([...state.uiState.selectedEntities], [ids[3], ids[0]]);
});

test('configured edges allow first cluster members and unrelated singletons', () => {
  let { state, ids } = buildState(['a', 'b', 'c', 'd', 'e'], edgeConfig('coref'));
  state = assign(state, ids[1], 1);
  state = assign(state, ids[3], 1);
  state = connect(state, [ids[1], ids[0], ids[4]]);
  assert.equal(state.uiState.mutationWarning, '');
  assert.equal(state.entitiesById[ids[1]].antecedents.bridge, ids[0]);
  assert.equal(state.entitiesById[ids[4]].antecedents.bridge, ids[0]);
  assert.deepEqual(assertStateInvariants(state, { throwOnError: false }).errors, []);
});

test('multi-endpoint edge creation rejects the entire operation if any anaphor is non-initial', () => {
  let { state, ids } = buildState(['a', 'b', 'c', 'd', 'e'], edgeConfig('coref'));
  state = assign(state, ids[1], 1);
  state = assign(state, ids[3], 1);
  const before = state;
  state = connect(state, [ids[0], ids[2], ids[3]]);
  assert.match(state.uiState.mutationWarning, /first member/);
  assert.deepEqual(state.entitiesById, before.entitiesById);
  assert.deepEqual(state.groupsByType, before.groupsByType);
});

test('a rejected edge leaves existing edge groups and antecedents unchanged', () => {
  let { state, ids } = buildState(['a', 'b', 'c', 'd'], edgeConfig('coref'));
  state = connect(state, [ids[0], ids[1]]);
  state = assign(state, ids[2], 1);
  state = assign(state, ids[3], 1);
  const before = state;
  state = connect(state, [ids[1], ids[3]]);
  assert.match(state.uiState.mutationWarning, /first member/);
  assert.deepEqual(state.entitiesById, before.entitiesById);
  assert.deepEqual(state.groupsByType, before.groupsByType);
  assert.deepEqual(state.assignedColors, before.assignedColors);
});

test('the earlier endpoint need not be the first member of its group', () => {
  let { state, ids } = buildState(['a', 'b', 'c'], edgeConfig('coref'));
  state = assign(state, ids[0], 1);
  state = assign(state, ids[1], 1);
  state = connect(state, [ids[2], ids[1]]);
  assert.equal(state.uiState.mutationWarning, '');
  assert.equal(state.entitiesById[ids[2]].antecedents.bridge, ids[1]);
});

test('missing or empty setting leaves edge creation unrestricted', () => {
  for (const setting of [undefined, '', '  ']) {
    let { state, ids } = buildState(['a', 'b', 'c'], edgeConfig(setting));
    state = assign(state, ids[1], 1);
    state = assign(state, ids[2], 1);
    state = connect(state, [ids[0], ids[2]]);
    assert.equal(state.uiState.mutationWarning, '');
    assert.equal(state.entitiesById[ids[2]].antecedents.bridge, ids[0]);
  }
});

test('the configured group and edge types are used rather than hardcoded coreference or bridging', () => {
  let { state, ids } = buildState(['a', 'b', 'c'], edgeConfig('split', 'relation'));
  state = spannotatorReducer(state, { type: 'ASSIGN_GROUP', groupType: 'split', entityId: ids[1], newGroup: 1 });
  state = spannotatorReducer(state, { type: 'ASSIGN_GROUP', groupType: 'split', entityId: ids[2], newGroup: 1 });
  state = connect(state, [ids[0], ids[2]], 'relation');
  assert.match(state.uiState.mutationWarning, /relation.*split/);
  state = connect(state, [ids[0], ids[1]], 'relation');
  assert.equal(state.entitiesById[ids[1]].antecedents.relation, ids[0]);
});

test('invalid configured group names and values produce explicit warnings', () => {
  for (const setting of ['missing', 42]) {
    const { state: base, ids } = buildState(['a', 'b'], edgeConfig(setting));
    const state = connect(base, ids);
    assert.match(state.uiState.mutationWarning, /Cannot create bridge edges/);
    assert.deepEqual(state.entitiesById, base.entitiesById);
  }
});

test('nested mentions with the same start use the existing outer-first text order', () => {
  let state = createInitialAnnotationState('a b c', edgeConfig('coref'));
  const [a, b, c] = state.tokens.map((token) => token.tid);
  for (const tokenIds of [[a, b], [a], [c]]) {
    state = spannotatorReducer(state, { type: 'ADD_ENTITY', tokenIds, entityType: 'person' });
  }
  const outer = `${a}-${b}`;
  const inner = `${a}-${a}`;
  const later = `${c}-${c}`;
  state = assign(state, outer, 1);
  state = assign(state, inner, 1);
  state = connect(state, [inner, outer]);
  assert.match(state.uiState.mutationWarning, /first member/);
  state = connect(state, [outer, later]);
  assert.equal(state.uiState.mutationWarning, '');
});

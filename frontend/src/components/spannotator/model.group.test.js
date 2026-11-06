import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStateInvariants, createInitialAnnotationState, spannotatorReducer } from './model.js';

function buildState(words) {
  let state = createInitialAnnotationState(words.join(' '), { GROUP_TYPES: ['coref'], EDGE_TYPES: ['bridge'] });
  const tids = state.tokens.map((t) => t.tid);
  tids.forEach((tid) => {
    state = spannotatorReducer(state, { type: 'ADD_ENTITY', tokenIds: [tid], entityType: 'person' });
  });
  return { state, ids: tids.map((tid) => `${tid}-${tid}`) };
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

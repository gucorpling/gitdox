/**
 * Editor state with in-memory undo/redo for the rstWeb widget, as a reducer for React's useReducer.
 *
 * state: { present: model, past: [model], future: [model], error: string | null, lastAction: object | null }
 * Models are immutable, so history is a stack of snapshots. Failed actions leave the model untouched and set `error`
 * (rstWeb showed these as alerts). `load` replaces the model (e.g. after an external edit) and clears the history.
 */

import {
  attachNode, unlinkNode, insertParent, setRelation, addSecedge, removeSecedge, setSecedgeRelation, setSignals, removeSignalsAtToken
} from './rst-model.js';

const MAX_HISTORY = 200;

export const createRstState = (model) => ({ present: model, past: [], future: [], error: null, lastAction: null });

const apply = (state, cfg, action) => {
  switch (action.type) {
    case 'attach': return attachNode(state.present, cfg, action.id, action.parent);
    case 'unlink': return unlinkNode(state.present, cfg, action.id);
    case 'insertSpan': return insertParent(state.present, cfg, action.id, 'span');
    case 'insertMultinuc': return insertParent(state.present, cfg, action.id, 'multinuc');
    case 'setRelation': return setRelation(state.present, cfg, action.id, action.relname);
    case 'addSecedge': return addSecedge(state.present, cfg, action.source, action.target, action.relname);
    case 'removeSecedge': return removeSecedge(state.present, action.source, action.target);
    case 'setSecedgeRelation': return setSecedgeRelation(state.present, action.source, action.target, action.relname);
    case 'setSignals': return setSignals(state.present, action.source, action.target, action.signals);
    case 'removeSignalsAtToken': return removeSignalsAtToken(state.present, action.token);
    case 'replace': return { model: action.model };
    default: return { model: state.present, error: `Unknown action "${action.type}"` };
  }
};

export const makeRstReducer = (cfg) => (state, action) => {
  switch (action.type) {
    case 'load':
      return createRstState(action.model);
    case 'clearError':
      return state.error ? { ...state, error: null } : state;
    case 'undo': {
      if (state.past.length === 0) return state;
      const past = state.past.slice(0, -1);
      return { ...state, present: state.past[state.past.length - 1], past, future: [state.present, ...state.future], error: null, lastAction: action };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...future] = state.future;
      return { ...state, present: next, past: [...state.past, state.present], future, error: null, lastAction: action };
    }
    default: {
      const result = apply(state, cfg, action);
      if (result.error) return { ...state, error: result.error };
      if (result.model === state.present) return state.error ? { ...state, error: null } : state;
      return {
        present: result.model,
        past: [...state.past, state.present].slice(-MAX_HISTORY),
        future: [],
        error: null,
        lastAction: action
      };
    }
  }
};

export const canUndo = (state) => state.past.length > 0;
export const canRedo = (state) => state.future.length > 0;

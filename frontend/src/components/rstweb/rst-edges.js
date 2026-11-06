/**
 * Pure description of the edges drawn between RST nodes, and of the relation dropdown options on them.
 * The jsPlumb drawing itself lives in edge-layer.js; keeping the decisions here makes them testable without a DOM.
 *
 * Edge kinds, as in legacy rstWeb:
 *   span       nucleus -> its span group: straight line, no label
 *   multinuc   child -> multinuc group: straight line with a relation dropdown
 *   rst        satellite -> nucleus (or EDU/group): curved arrow with a relation dropdown
 *   secedge    secondary (eRST) edge: blue curved arrow, curving the other way depending on direction
 */

import { relTypeOf, relationLabel } from './rst-config.js';
import { allNodes } from './rst-model.js';

/** Multinuc relations that make no sense as secondary edges (legacy excluded them from that dropdown) */
export const SECEDGE_EXCLUDED = ['same-unit'];

export const SATELLITE_CHOICE = '(satellite...)';

/**
 * All edges of a model. `layout` is the result of computeLayout: it decides the curvature of secondary edges.
 * Returns [{ key, kind, source, target, relname, curviness? }] with source/target node ids (source is the child).
 */
export function buildEdgeSpecs(model, cfg, layout) {
  const nodes = new Map(allNodes(model).map((n) => [n.id, n]));
  const edges = [];
  allNodes(model).forEach((n) => {
    if (n.parent === null || !nodes.has(n.parent)) return;
    const parent = nodes.get(n.parent);
    let kind = 'rst';
    if (n.relname === 'span') kind = 'span';
    else if (parent.kind === 'multinuc' && relTypeOf(cfg, n.relname) === 'multinuc') kind = 'multinuc';
    edges.push({ key: `e${n.id}>${n.parent}`, kind, source: n.id, target: n.parent, relname: n.relname });
  });
  model.secedges.forEach((e) => {
    if (!nodes.has(e.source) || !nodes.has(e.target)) return;
    const rtl = layout.nodes.get(e.target).left > layout.nodes.get(e.source).left;
    edges.push({ key: `s${e.source}>${e.target}`, kind: 'secedge', source: e.source, target: e.target, relname: e.relname, curviness: rtl ? 10 : -10 });
  });
  return edges;
}

/** Options of a relation dropdown as [{ value, label }], sorted by label like rstWeb */
export function relationOptions(cfg, kind) {
  let names;
  if (kind === 'multinuc') names = cfg.relations.multinuc;
  else if (kind === 'secedge') names = [...cfg.relations.multinuc.filter((r) => !SECEDGE_EXCLUDED.includes(r)), ...cfg.relations.rst];
  else names = cfg.relations.rst;
  const options = names.map((value) => ({ value, label: relationLabel(cfg, value) }));
  // A multinuc child can be turned into a satellite, which is selected by giving it the default satellite relation
  if (kind === 'multinuc') options.push({ value: cfg.defaultRst, label: SATELLITE_CHOICE });
  return options.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** A new, empty signal of the first type and subtype of the inventory (as in the legacy drawer) */
export function newSignal(cfg, tokens = []) {
  const [type = '', subtypes = []] = Object.entries(cfg.signalTypes)[0] || [];
  return { type, subtype: subtypes[0] ?? '', tokens: [...tokens] };
}

const COLORS = 20;

/** 1-based colour index (legacy signal-type-N css classes) of a signal type, by its position in the inventory */
export function signalColorIndex(cfg, type) {
  const index = Object.keys(cfg.signalTypes).indexOf(type);
  return index < 0 ? 0 : (index % COLORS) + 1;
}

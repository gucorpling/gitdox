/**
 * Pure RST/eRST editing model, ported from the DOM-bound logic of legacy rstWeb structure.js.
 *
 * All functions take the plain model of rst-io.js ({ edus, groups, secedges, signals }) and the normalized config
 * of rst-config.js, never mutate their input, and return { model } or { model, error } (model unchanged on error).
 * Rendering geometry is computed by computeLayout() with the same constants and formulas as rstWeb, so the React
 * view can position nodes exactly like the old tool.
 *
 * Conventions: node ids are numbers; EDU ids are 1..n in document order; a root has parent null and relname null.
 * A node's relation to its parent has a type: 'span' (relname "span": nucleus of a span group), 'multinuc'
 * (child of a multinuc group) or 'rst' (satellite of any node); the type is derived from the relname via the
 * relation inventory, as the legacy "_m" suffix convention is not used.
 */

import { relTypeOf } from './rst-config.js';

export const LAYOUT = { topSpacing: 20, layerSpacing: 60, columnWidth: 100, eduWidth: 96 };

const fail = (model, error) => ({ model, error });

/* ---------- Graph helpers ---------- */

/** All nodes as { id, kind: 'edu' | 'span' | 'multinuc', parent, relname }, EDUs first, in id order */
export function allNodes(model) {
  return [
    ...model.edus.map((e) => ({ id: e.id, kind: 'edu', parent: e.parent, relname: e.relname })),
    ...model.groups.map((g) => ({ id: g.id, kind: g.kind, parent: g.parent, relname: g.relname }))
  ];
}

export const getNode = (model, id) => allNodes(model).find((n) => n.id === id);
export const childrenOf = (model, id) => allNodes(model).filter((n) => n.parent === id);
export const nextNodeId = (model) => allNodes(model).reduce((max, n) => Math.max(max, n.id), 0) + 1;

/** True if `ancestorId` is a (strict) ancestor of `nodeId` */
export function isAncestor(model, ancestorId, nodeId) {
  const byId = new Map(allNodes(model).map((n) => [n.id, n]));
  const seen = new Set();
  for (let cur = byId.get(nodeId)?.parent; cur !== null && cur !== undefined && !seen.has(cur); cur = byId.get(cur)?.parent) {
    if (cur === ancestorId) return true;
    seen.add(cur);
  }
  return false;
}

const patchNode = (model, id, patch) => ({
  ...model,
  edus: model.edus.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  groups: model.groups.map((g) => (g.id === id ? { ...g, ...patch } : g))
});

/** The multinuc relation a multinuc group currently applies to its children, or the default one */
export function multinucRelation(model, cfg, multinucId, excludeId = null) {
  const sibling = childrenOf(model, multinucId).find((n) => n.id !== excludeId && relTypeOf(cfg, n.relname) === 'multinuc');
  return sibling ? sibling.relname : cfg.defaultMultinuc;
}

/* ---------- Tree editing ---------- */

/** Removes a group: its remaining children become roots, and secondary edges and signals pointing to it are dropped */
function removeGroup(model, id) {
  const secedges = model.secedges.filter((e) => e.source !== id && e.target !== id);
  return {
    ...model,
    edus: model.edus.map((e) => (e.parent === id ? { ...e, parent: null, relname: null } : e)),
    groups: model.groups.filter((g) => g.id !== id).map((g) => (g.parent === id ? { ...g, parent: null, relname: null } : g)),
    secedges,
    signals: model.signals.filter((s) => s.source !== id && s.target !== id)
  };
}

/**
 * After a node lost a child: a group without children, a span without a nucleus (span) child, or a multinuc without
 * a multinuc child is meaningless and is removed, which can cascade upwards. EDUs are never removed.
 */
function pruneFrom(model, cfg, id) {
  let current = model;
  let cur = id;
  while (cur !== null && cur !== undefined) {
    const node = getNode(current, cur);
    if (!node || node.kind === 'edu') break;
    const kids = childrenOf(current, cur);
    const dead = kids.length === 0
      || (node.kind === 'span' && !kids.some((k) => k.relname === 'span'))
      || (node.kind === 'multinuc' && !kids.some((k) => relTypeOf(cfg, k.relname) === 'multinuc'));
    if (!dead) break;
    current = removeGroup(current, cur);
    cur = node.parent;
  }
  return current;
}

/** The relation a node gets when moved below a new parent: it keeps its relation where that remains meaningful */
function relationForNewParent(model, cfg, node, parent) {
  if (parent.kind === 'multinuc') return multinucRelation(model, cfg, parent.id, node.id);
  const type = relTypeOf(cfg, node.relname);
  if (parent.kind === 'span' && (type === 'span' || type === 'rst')) return node.relname;
  if (parent.kind === 'edu' && type === 'rst') return node.relname;
  return cfg.defaultRst;
}

/** Attaches `id` below `parentId`, or unlinks it (making it a root) if parentId is null */
export function attachNode(model, cfg, id, parentId = null) {
  const node = getNode(model, id);
  if (!node) return fail(model, `Node ${id} does not exist`);
  const parent = parentId === null ? null : getNode(model, parentId);
  if (parentId !== null) {
    if (!parent) return fail(model, `Node ${parentId} does not exist`);
    if (parentId === id || isAncestor(model, id, parentId)) return fail(model, 'A node cannot be attached to itself or to one of its own descendants');
  }
  if (node.parent === parentId) return { model };

  const relname = parent ? relationForNewParent(model, cfg, node, parent) : null;
  return { model: pruneFrom(patchNode(model, id, { parent: parentId, relname }), cfg, node.parent) };
}

export const unlinkNode = (model, cfg, id) => attachNode(model, cfg, id, null);

/** Inserts a new span or multinuc group between a node and its parent; the group takes over the node's relation */
export function insertParent(model, cfg, id, kind) {
  const node = getNode(model, id);
  if (!node) return fail(model, `Node ${id} does not exist`);
  if (kind !== 'span' && kind !== 'multinuc') return fail(model, `Unknown group kind "${kind}"`);
  const groupId = nextNodeId(model);
  const next = patchNode(model, id, { parent: groupId, relname: kind === 'span' ? 'span' : cfg.defaultMultinuc });
  return { model: { ...next, groups: [...next.groups, { id: groupId, kind, parent: node.parent, relname: node.relname }] } };
}

/** Changes the relation of a node to its parent, keeping multinuc siblings on the same relation */
export function setRelation(model, cfg, id, relname) {
  const node = getNode(model, id);
  if (!node) return fail(model, `Node ${id} does not exist`);
  if (node.parent === null) return fail(model, 'A root node has no relation');
  const parent = getNode(model, node.parent);
  const type = relTypeOf(cfg, relname);
  if (!relname) return fail(model, 'A relation name is required');
  if (type === 'span' && parent.kind !== 'span') return fail(model, 'Only children of a span can have the relation "span"');
  if (type === 'multinuc' && parent.kind !== 'multinuc') return fail(model, 'Multinuclear relations are only possible below a multinuc');
  if (node.relname === relname) return { model };

  const siblings = childrenOf(model, parent.id).filter((n) => n.id !== id && relTypeOf(cfg, n.relname) === 'multinuc');
  if (parent.kind === 'multinuc' && relTypeOf(cfg, node.relname) === 'multinuc' && type === 'rst' && siblings.length === 0) {
    return fail(model, 'Unable to change the last multinuc child of a multinuc to a satellite relation!');
  }

  let next = patchNode(model, id, { relname });
  if (type === 'multinuc') siblings.forEach((s) => { next = patchNode(next, s.id, { relname }); });
  return { model: next };
}

/* ---------- Secondary edges and signals ---------- */

/** Adds (or replaces) the secondary edge source -> target. Nodes starting at the same token cannot be linked */
export function addSecedge(model, cfg, source, target, relname = null) {
  if (!getNode(model, source) || !getNode(model, target)) return fail(model, 'Secondary edge endpoints must be existing nodes');
  if (source === target) return fail(model, 'A secondary edge needs two different nodes');
  const { nodes } = computeLayout(model, cfg);
  if (nodes.get(source).left === nodes.get(target).left) return fail(model, 'A secondary edge cannot connect nodes that start at the same position');
  const edge = { source, target, relname: relname ?? cfg.defaultRst };
  const rest = model.secedges.filter((e) => !(e.source === source && e.target === target));
  return { model: { ...model, secedges: [...rest, edge] } };
}

export function removeSecedge(model, source, target) {
  return {
    model: {
      ...model,
      secedges: model.secedges.filter((e) => !(e.source === source && e.target === target)),
      signals: model.signals.filter((s) => !(s.source === source && s.target === target))
    }
  };
}

export function setSecedgeRelation(model, source, target, relname) {
  if (!model.secedges.some((e) => e.source === source && e.target === target)) return fail(model, 'No such secondary edge');
  return { model: { ...model, secedges: model.secedges.map((e) => (e.source === source && e.target === target ? { ...e, relname } : e)) } };
}

const sameKey = (s, source, target) => s.source === source && s.target === target;

export const signalsFor = (model, source, target) => model.signals.filter((s) => sameKey(s, source, target));

/** Replaces all signals of a node (target undefined) or of a secondary edge with `signals` ({ type, subtype, tokens }) */
export function setSignals(model, source, target, signals) {
  const exists = target === undefined
    ? getNode(model, source)
    : model.secedges.some((e) => e.source === source && e.target === target);
  if (!exists) return fail(model, 'Signals need an existing node or secondary edge');
  const clean = signals.map((s) => ({
    source, ...(target === undefined ? {} : { target }), type: s.type, subtype: s.subtype, tokens: [...s.tokens].sort((a, b) => a - b)
  }));
  const kept = model.signals.filter((s) => !sameKey(s, source, target));
  return { model: { ...model, signals: [...kept, ...clean] } };
}

/** Deletes every signal that uses the (1-based) token number, as rstWeb's quick delete does */
export function removeSignalsAtToken(model, tokenNumber) {
  return { model: { ...model, signals: model.signals.filter((s) => !s.tokens.includes(tokenNumber)) } };
}

/* ---------- Layout ---------- */

/**
 * Computes the geometry of every node as rstWeb does: `depth` counts the span/multinuc levels above a node, `left`
 * and `right` are the EDU positions it covers through its nucleus chain, and `anchorX` is the x of the node's
 * number box. Pixel fields: x/y/width describe the box (EDU or group box), z the stacking order.
 */
export function computeLayout(model, cfg) {
  const list = allNodes(model);
  const nodes = new Map(list.map((n) => [n.id, {
    ...n, reltype: relTypeOf(cfg, n.relname), depth: 0, left: 0, right: 0
  }]));
  const parentOf = (n) => (n.parent === null ? undefined : nodes.get(n.parent));
  const limit = list.length + 1;

  // Depth: span/multinuc levels between a node and its root (satellite links to EDUs and plain RST links do not count)
  nodes.forEach((n) => {
    let probe = n;
    for (let steps = 0; steps < limit; steps++) {
      const parent = parentOf(probe);
      if (!parent) break;
      if (parent.kind !== 'edu' && (probe.relname === 'span' || (parent.kind === 'multinuc' && probe.reltype === 'multinuc'))) n.depth += 1;
      probe = parent;
    }
  });

  // Left/right: every EDU pushes its range up the tree, updating the groups it is a nucleus/multinuc child of
  model.edus.forEach((e, i) => { const n = nodes.get(e.id); n.left = i + 1; n.right = i + 1; });
  const propagate = (start) => {
    let node = start;
    let minLeft = 0;
    let maxRight = 0;
    for (let steps = 0; steps < limit; steps++) {
      const parent = parentOf(node);
      if (!parent) break;
      if ((minLeft > node.left || minLeft === 0) && node.left !== 0) minLeft = node.left;
      if (maxRight < node.right || maxRight === 0) maxRight = node.right;
      const extends_ = (node.relname === 'span' && parent.kind === 'span')
        || (node.relname !== 'span' && parent.kind === 'multinuc' && node.reltype === 'multinuc');
      if (extends_) {
        if (parent.left > minLeft || parent.left === 0) parent.left = minLeft;
        if (parent.right < maxRight) parent.right = maxRight;
      }
      node = parent;
    }
  };
  model.edus.forEach((e) => propagate(nodes.get(e.id)));

  // A group that no nucleus reached (only possible in malformed trees) falls back to the hull of its descendants
  nodes.forEach((n) => {
    if (n.kind === 'edu' || n.left !== 0) return;
    const covered = [...nodes.values()].filter((d) => d.kind === 'edu' && (d.id === n.id || isAncestor(model, n.id, d.id)));
    n.left = covered.length ? Math.min(...covered.map((d) => d.left)) : 1;
    n.right = covered.length ? Math.max(...covered.map((d) => d.right)) : 1;
  });

  const width = (n) => (n.right - n.left + 1) * LAYOUT.columnWidth - 4;
  const anchors = new Map();
  const multinucKids = (id) => [...nodes.values()].filter((n) => n.parent === id && n.reltype === 'multinuc');
  const extremes = (id) => {
    let left = 10000;
    let right = 0;
    let leftId = null;
    let rightId = null;
    multinucKids(id).forEach((n) => {
      if (n.left < left) { left = n.left; leftId = n.id; }
      if (n.right > right) { right = n.right; rightId = n.id; }
    });
    return { left, right, leftId, rightId };
  };

  // Anchors are the relative x position of a node's number box over its box, derived from the nucleus below
  [...nodes.values()].sort((a, b) => b.depth - a.depth).forEach((node) => {
    if (node.kind === 'edu') anchors.set(node.id, 0.5);
    const parent = parentOf(node);
    if (!parent) return;
    const parentWidth = width(parent);
    const childWidth = width(node);
    if (node.relname === 'span') {
      const childAnchor = anchors.has(node.id) ? anchors.get(node.id) : 0.5;
      anchors.set(parent.id, ((node.left - parent.left) * LAYOUT.columnWidth) / parentWidth + childAnchor * (childWidth / parentWidth));
    } else if (node.reltype === 'multinuc' && parent.kind === 'multinuc') {
      const ext = extremes(parent.id);
      if (anchors.has(ext.leftId) && anchors.has(ext.rightId)) {
        const l = nodes.get(ext.leftId);
        const r = nodes.get(ext.rightId);
        const lenLeft = l.right - l.left + 1;
        const lenRight = r.right - r.left + 1;
        anchors.set(parent.id, ((anchors.get(l.id) * lenLeft * 100 + anchors.get(r.id) * lenRight * 100 + (r.left - parent.left) * 100) / 2) / parentWidth);
      } else {
        anchors.set(parent.id, (Math.floor((ext.left + ext.right) / 2) - parent.left + 1) / (parent.right - parent.left + 1));
      }
    } else if (!anchors.has(parent.id)) {
      anchors.set(parent.id, 0.5);
    }
  });

  const out = new Map();
  let maxDepth = 0;
  nodes.forEach((n) => {
    maxDepth = Math.max(maxDepth, n.depth);
    const y = LAYOUT.topSpacing + LAYOUT.layerSpacing + n.depth * LAYOUT.layerSpacing;
    const anchor = anchors.has(n.id) ? anchors.get(n.id) : 0.5;
    out.set(n.id, {
      id: n.id,
      kind: n.kind,
      depth: n.depth,
      left: n.left,
      right: n.right,
      x: n.left * LAYOUT.columnWidth - LAYOUT.columnWidth,
      y,
      width: n.kind === 'edu' ? LAYOUT.eduWidth : width(n),
      z: 200 - (n.right - n.left),
      anchorX: Math.trunc(3 + n.left * 100 - 100 - 39 + anchor * width(n)),
      anchorY: y + 4
    });
  });

  return {
    nodes: out,
    width: model.edus.length * LAYOUT.columnWidth,
    height: LAYOUT.topSpacing + LAYOUT.layerSpacing * (maxDepth + 2) + 60
  };
}

/**
 * Config normalization for the rstWeb widget (the `rstweb:` section of the YAML config).
 *
 * Column keys name the spreadsheet header cells the widget reads/writes; `relations` and `signal_types`
 * hold the single relation / signal inventory of the project.
 */

const DEFAULT_COLUMNS = { words: 'tok', edu: 'edu', node: 'node', secedge: 'secedge', signal: 'signal' };

const RESERVED = ['span', 'multinuc'];

const toList = (v) => {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  return [];
};

export function normalizeRstConfig(config) {
  // An explicitly empty column name (e.g. `secedge: ""`) switches that layer off; a missing key means the default name
  const hasEmpty = (key) => typeof config?.[key] === 'string' && config[key].trim() === '';
  const column = (key) => (typeof config?.[key] === 'string' && config[key].trim()) || DEFAULT_COLUMNS[key];
  const flag = (key, fallback) => (typeof config?.[key] === 'boolean' ? config[key] : fallback);
  // "span" (nucleus-to-span link) and "multinuc" are part of the format itself, so they can never be inventory labels
  const labels = (v) => toList(v).filter((name) => !RESERVED.includes(name));
  const relations = { rst: labels(config?.relations?.rst), multinuc: labels(config?.relations?.multinuc) };
  const chosen = (key, list) => (typeof config?.[key] === 'string' && list.includes(config[key]) ? config[key] : [...list].sort()[0]);
  const signalTypes = Object.fromEntries(Object.entries(config?.signal_types || {}).map(([t, subs]) => [t, toList(subs)]));
  const useSecedge = !flag('disable_secedge', false) && !hasEmpty('secedge');
  const useSignals = flag('use_signals', true) && !hasEmpty('signal');
  return {
    words: column('words'),
    edu: column('edu'),
    node: column('node'),
    // '' (never a header name) when the layer is off, so no column is read, written or deleted for it
    secedge: useSecedge ? column('secedge') : '',
    signal: useSignals ? column('signal') : '',
    useSecedge,
    useSignals,
    // The signal buttons also need a signal inventory to choose from
    signalUi: useSignals && Object.keys(signalTypes).length > 0,
    disableSpans: flag('disable_spans', false),
    disableMultinucs: flag('disable_multinucs', false),
    relations,
    // Relation given to new satellites / multinuc children unless chosen otherwise; alphabetically first as in rstWeb
    defaultRst: chosen('default_rst', relations.rst) ?? 'elaboration-additional',
    defaultMultinuc: chosen('default_multinuc', relations.multinuc) ?? 'joint-other',
    signalTypes,
    // Optional short names shown in the relation dropdowns, e.g. { "elaboration-additional": "elab.-additional" }
    labels: Object.fromEntries(Object.entries(config?.relation_labels || {}).map(([k, v]) => [k, String(v)]))
  };
}

export const relationLabel = (cfg, name) => cfg.labels[name] ?? name;

/** 'multinuc' if the relation is a multinuclear one in the inventory, otherwise 'rst' */
export const relationType = (cfg, name) => (cfg.relations.multinuc.includes(name) ? 'multinuc' : 'rst');

/** Type of the relation a node has to its parent: 'span' (nucleus of a span), 'multinuc', 'rst' (satellite) or null for roots */
export const relTypeOf = (cfg, name) => (name === null || name === undefined ? null : name === 'span' ? 'span' : relationType(cfg, name));

/**
 * The Segmenter and rstWeb share the EDU column: its cells hold node ids and relations, so the Segmenter must
 * not manage them as "words" or "sequential" values. Returns an error message, or null if the combination is fine.
 */
export function checkSegmenterConflict(rstConfig, segmenterConfig) {
  if (!rstConfig || Object.keys(rstConfig).length === 0) return null;
  const { edu } = normalizeRstConfig(rstConfig);
  const raw = segmenterConfig?.layers;
  const entries = Array.isArray(raw) ? raw.flatMap((item) => Object.entries(item || {})) : Object.entries(raw || {});
  const layer = entries.find(([name]) => name.trim() === edu);
  if (!layer) return null;
  const style = Array.isArray(layer[1]) ? layer[1][2] : undefined;
  if (style === undefined || style === null || style === 'words' || style === 'sequential') {
    return `Configuration error: segmenter layer "${edu}" is also the EDU column of rstweb, whose cells hold RST node ids and relations. ` +
      `Its style must be an empty default (e.g. ${edu}: ["|", "green", ""]), not "${style ?? 'sequential'}", which would overwrite them.`;
  }
  return null;
}

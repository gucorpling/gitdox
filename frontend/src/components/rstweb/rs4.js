/**
 * rstWeb .rs4 XML import/export, using the rst-io.js model.
 *
 * <segment> elements are EDUs (text = space-joined word tokens), <group> elements are span/multinuc nodes,
 * <secedges> and <signals> carry the eRST layers and <header> holds the relation and signal inventories.
 * A small tag scanner is used instead of DOMParser so that the code also runs under node (tests).
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);
const encode = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const parseAttrs = (s) => {
  const attrs = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = decode(m[2]);
  return attrs;
};
const optInt = (v) => (v === undefined || v === '' ? null : parseInt(v, 10));

/**
 * Returns { model, relations, signalTypes, words }. EDU token ranges are derived from whitespace-separated words in the
 * segment text, which only matches the document tokens if the text was tokenized the same way.
 */
export function parseRs4(xml) {
  const relations = { rst: [], multinuc: [] };
  const signalTypes = {};
  const edus = [];
  const groups = [];
  const secedges = [];
  const signals = [];
  const words = [];
  let segment = null;
  let wordCount = 0;

  for (const m of String(xml).matchAll(/<(\/?)([A-Za-z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, tag, attrStr, selfClosing, text] = m;
    if (text !== undefined) {
      if (segment) segment.text += text;
      continue;
    }
    if (closing) {
      if (tag === 'segment' && segment) {
        const segmentWords = decode(segment.text).trim().split(/\s+/).filter(Boolean);
        const count = segmentWords.length;
        words.push(...segmentWords);
        edus.push({ id: segment.id, start: wordCount, end: wordCount + count, parent: segment.parent, relname: segment.relname });
        wordCount += count;
        segment = null;
      }
      continue;
    }
    const a = parseAttrs(attrStr);
    const parent = optInt(a.parent);
    switch (tag) {
      case 'rel': (a.type === 'multinuc' ? relations.multinuc : relations.rst).push(a.name); break;
      case 'sig': signalTypes[a.type] = (a.subtypes || '').split(';').filter(Boolean); break;
      case 'segment':
        segment = { id: parseInt(a.id, 10), parent, relname: parent === null ? null : (a.relname ?? null), text: '' };
        if (selfClosing) {
          edus.push({ id: segment.id, start: wordCount, end: wordCount, parent, relname: segment.relname });
          segment = null;
        }
        break;
      case 'group':
        groups.push({ id: parseInt(a.id, 10), kind: a.type, parent, relname: parent === null ? null : (a.relname ?? null) });
        break;
      case 'secedge': secedges.push({ source: parseInt(a.source, 10), target: parseInt(a.target, 10), relname: a.relname ?? '' }); break;
      case 'signal': {
        const [source, target] = a.source.split('-').map(Number);
        signals.push({
          source, ...(a.source.includes('-') ? { target } : {}), type: a.type, subtype: a.subtype,
          tokens: (a.tokens || '').split(',').filter(Boolean).map(Number)
        });
        break;
      }
      default:
    }
  }
  return { model: { edus, groups, secedges, signals }, relations, signalTypes, words };
}

/**
 * Fits a parsed rs4 file to the document. EDU texts must match with whitespace ignored (EDUs belong to the Segmenter),
 * but the rs4 tokenization may differ from the sheet's, so signal word numbers are mapped through character offsets.
 * With `adoptEdus` the EDU segmentation of the rs4 file replaces the document's (it must fall on document word
 * boundaries); otherwise the EDUs must agree with the document's.
 * Returns { error } or { model } with the document's EDU token ranges. `conflict` is set on the error when only the
 * EDUs differ (the text is the same), so the caller may offer to adopt the file's EDUs.
 */
export function fitRs4Import(imported, tokenTexts, model, { adoptEdus = false } = {}) {
  const squash = (s) => String(s).replace(/\s+/g, '');
  const ends = (texts) => texts.reduce((acc, t) => [...acc, (acc.at(-1) ?? 0) + squash(t).length], []);
  const docEnds = ends(tokenTexts);
  const rsEnds = ends(imported.words);
  if (docEnds.at(-1) !== rsEnds.at(-1) || squash(imported.words.join('')) !== squash(tokenTexts.join(''))) {
    return { error: 'The text of the rs4 file differs from the text of the document.' };
  }
  // 1-based rs4 word number -> 1-based document token number, by the character offset of the word's first character
  const toDoc = (n) => {
    const offset = n >= 2 ? rsEnds[n - 2] : 0;
    return docEnds.findIndex((end) => end > offset) + 1;
  };
  let edus;
  if (adoptEdus) {
    // A boundary after rs4 word k (a character offset) must coincide with the end of a document word
    const docTokenAt = (offset) => (offset === 0 ? 0 : docEnds.indexOf(offset) + 1);
    edus = [];
    for (const e of imported.model.edus) {
      const start = e.start > 0 ? rsEnds[e.start - 1] : 0;
      const end = e.end > 0 ? rsEnds[e.end - 1] : 0;
      const [s, t] = [docTokenAt(start), docTokenAt(end)];
      if ((start > 0 && s === 0) || (end > 0 && t === 0)) {
        return { error: `EDU ${e.id} of the rs4 file starts or ends inside a word of the document, so it cannot be used.` };
      }
      edus.push({ ...e, start: s, end: t });
    }
  } else {
    if (imported.model.edus.length !== model.edus.length) {
      return { conflict: true, error: `The rs4 file has ${imported.model.edus.length} EDUs, but the document has ${model.edus.length}.` };
    }
    const boundary = (ends, from, to) => (to > from && to > 0 ? ends[to - 1] : (from > 0 ? ends[from - 1] : 0));
    for (let i = 0; i < model.edus.length; i++) {
      const rs = imported.model.edus[i];
      const doc = model.edus[i];
      if (boundary(rsEnds, rs.start, rs.end) !== boundary(docEnds, doc.start, doc.end)) {
        return { conflict: true, error: `EDU ${doc.id} ends at a different place in the rs4 file.` };
      }
    }
    edus = imported.model.edus.map((e, i) => ({ ...e, start: model.edus[i].start, end: model.edus[i].end }));
  }
  return {
    model: {
      ...imported.model,
      edus,
      signals: imported.model.signals.map((s) => ({ ...s, tokens: [...new Set(s.tokens.map(toDoc))] }))
    }
  };
}

/** `tokens` are the document's word texts; `relations` / `signalTypes` as returned by parseRs4 or normalizeRstConfig */
export function serializeRs4(model, tokens, { relations = { rst: [], multinuc: [] }, signalTypes = {} } = {}) {
  const attr = (name, v) => (v === null || v === undefined ? '' : ` ${name}="${encode(v)}"`);
  const link = (n) => attr('parent', n.parent) + (n.parent === null ? '' : attr('relname', n.relname ?? ''));
  const out = ['<rst>', '\t<header>', '\t\t<relations>'];
  relations.rst.forEach((r) => out.push(`\t\t\t<rel name="${encode(r)}" type="rst"/>`));
  relations.multinuc.forEach((r) => out.push(`\t\t\t<rel name="${encode(r)}" type="multinuc"/>`));
  out.push('\t\t</relations>', '\t\t<sigtypes>');
  Object.entries(signalTypes).forEach(([t, subs]) => out.push(`\t\t\t<sig type="${encode(t)}" subtypes="${encode(subs.join(';'))}"/>`));
  out.push('\t\t</sigtypes>', '\t</header>', '\t<body>');
  model.edus.forEach((e) => {
    const text = encode(tokens.slice(e.start, e.end).join(' '));
    out.push(`\t\t<segment id="${e.id}"${link(e)}>${text}</segment>`);
  });
  model.groups.forEach((g) => out.push(`\t\t<group id="${g.id}" type="${g.kind}"${link(g)}${g.parent === null ? ' ' : ''}/>`));
  if (model.secedges.length) {
    out.push('\t\t<secedges>');
    model.secedges.forEach((e) => out.push(`\t\t\t<secedge id="${e.source}-${e.target}" source="${e.source}" target="${e.target}" relname="${encode(e.relname)}"/>`));
    out.push('\t\t</secedges>');
  }
  if (model.signals.length) {
    out.push('\t\t<signals>');
    model.signals.forEach((s) => {
      const source = s.target === undefined ? s.source : `${s.source}-${s.target}`;
      out.push(`\t\t\t<signal source="${source}" type="${encode(s.type)}" subtype="${encode(s.subtype)}" tokens="${s.tokens.join(',')}"/>`);
    });
    out.push('\t\t</signals>');
  }
  out.push('\t</body>', '</rst>');
  return out.join('\n');
}

export const parseEdeps = (depsStr) => {
  if (!depsStr || depsStr === '_') return [];
  return depsStr.split('|').map(edge => {
    const parts = edge.split(':');
    const external = parts[0] === 'ext';
    return { head: external ? parts.slice(0, 2).join(':') : parts[0], deprel: parts.slice(external ? 2 : 1).join(':') };
  }).filter(e => e.head && e.deprel);
};

export const stringifyEdeps = (edepsArray) => {
  if (!edepsArray || edepsArray.length === 0) return '_';
  return [...edepsArray].sort((a, b) => parseInt(a.head) - parseInt(b.head)).map(e => `${e.head}:${e.deprel}`).join('|');
};

export const hasAnnotationData = (sent, annName) => sent.tokens.some(t => {
  const ann = t.annotations[annName];
  return ann && (ann.head !== '_' || ann.deprel !== '_' || (ann.deps && ann.deps !== '_'));
});

export const getAvailableAnns = (sent, defaultAnn) => {
  const set = new Set();
  if (sent.activeAnnotator) set.add(sent.activeAnnotator);
  sent.tokens.forEach(t => Object.keys(t.annotations || {}).forEach(a => set.add(a)));
  if (set.size === 0) set.add(defaultAnn);
  return Array.from(set).sort();
};

export const getDisplayableAnns = (sentence, defaultAnnotator) =>
  getAvailableAnns(sentence, defaultAnnotator).filter(ann => {
    if (!hasAnnotationData(sentence, ann)) return false;
    if (ann === defaultAnnotator || !hasAnnotationData(sentence, defaultAnnotator)) return true;
    return sentence.tokens.some(t => {
      const a = t.annotations[ann] || { head: '_', deprel: '_', deps: '_' };
      const d = t.annotations[defaultAnnotator] || { head: '_', deprel: '_', deps: '_' };
      return a.head !== d.head || a.deprel !== d.deprel || a.deps !== d.deps;
    });
  });

export const getDisplayedAnnotator = (sentence, defaultAnnotator, perUserMode) => {
  if (!perUserMode) return defaultAnnotator;
  const displayable = getDisplayableAnns(sentence, defaultAnnotator);
  const active = sentence.activeAnnotator || defaultAnnotator;
  return displayable.includes(active) ? active
    : (displayable.includes(defaultAnnotator) ? defaultAnnotator : (displayable[0] || defaultAnnotator));
};

export const buildFallbackText = (tokens, mwts) => {
  const mwtMap = {};
  (mwts || []).forEach(m => {
    const [start, end] = m.id.split('-');
    mwtMap[start] = { ...m, endId: parseInt(end) };
  });

  let out = "";
  let skipUntil = -1;
  const sortedTokens = [...(tokens || [])]
    .filter(t => !String(t.id).includes('.'))
    .sort((a, b) => parseInt(a.id) - parseInt(b.id));
  for (const t of sortedTokens) {
    const idNum = parseInt(t.id);
    if (idNum <= skipUntil) continue;
    let form = t.form;
    let hasSpace = true;
    if (mwtMap[t.id]) {
      const mwt = mwtMap[t.id];
      form = mwt.form;
      skipUntil = mwt.endId;
      const lastToken = sortedTokens.find(tok => parseInt(tok.id) === skipUntil);
      if ((mwt.misc || '').includes('SpaceAfter=No') || (lastToken && (lastToken.misc || '').includes('SpaceAfter=No'))) {
        hasSpace = false;
      }
    } else if ((t.misc || '').includes('SpaceAfter=No')) {
      hasSpace = false;
    }
    out += form + (hasSpace ? ' ' : '');
  }
  return out.trimEnd();
};

export const mergeSentences = (first, second, { currentUser, defaultAnnotator, perUserMode, textCol }) => {
  const offset = first.tokens.reduce((max, token) => {
    const id = String(token.id);
    return id.includes('.') ? max : Math.max(max, Number(id) || 0);
  }, 0);
  const shiftId = id => String(id).replace(/^\d+/, n => String(Number(n) + offset));
  const makeIds = (sentence, shift) => {
    const ids = new Map();
    const heads = new Map();
    sentence.tokens.filter(token => !String(token.id).includes('.')).forEach(token => {
      const id = String(token.id);
      const newId = shift ? shiftId(id) : id;
      ids.set(id, newId);
      heads.set(id, newId);
    });
    sentence.tokens.filter(token => String(token.id).includes('.')).forEach(token => {
      const id = String(token.id);
      const [globalBase, sub] = String(token._originalGlobalId || id).split('.');
      const base = sentence.tokens.find(t => !String(t.id).includes('.') && String(t._originalGlobalId) === globalBase);
      const localId = base ? `${base.id}.${sub}` : id;
      const newId = shift ? shiftId(localId) : localId;
      ids.set(id, newId);
      heads.set(localId, newId);
    });
    return { ids, heads };
  };
  const firstIds = makeIds(first, false);
  const secondIds = makeIds(second, true);
  const globalIds = new Map();
  for (const [sent, ids] of [[first, firstIds], [second, secondIds]]) {
    for (const token of sent.tokens) {
      if (!token._originalGlobalId) continue;
      const globalId = String(token._originalGlobalId);
      const localId = ids.ids.get(String(token.id));
      globalIds.set(globalId, globalIds.has(globalId) ? null : localId);
    }
  }

  const transformSentence = (sentence, ids) => {
    const selected = getDisplayedAnnotator(sentence, defaultAnnotator, perUserMode);
    const copyForUser = perUserMode && !hasAnnotationData(sentence, currentUser);
    const mapHead = head => {
      const value = String(head);
      if (value.startsWith('ext:')) return globalIds.get(value.slice(4)) || value;
      return ids.heads.get(value) || value;
    };
    const tokens = sentence.tokens.map(token => {
      const annotations = { ...token.annotations };
      if (copyForUser) {
        annotations[currentUser] = { ...(annotations[selected] || { head: '_', deprel: '_', deps: '_' }) };
      }
      for (const [name, ann] of Object.entries(annotations)) {
        annotations[name] = {
          ...ann,
          head: mapHead(ann.head),
          deps: ann.deps && ann.deps !== '_'
            ? stringifyEdeps(parseEdeps(ann.deps).map(edge => ({ ...edge, head: mapHead(edge.head) })))
            : ann.deps,
        };
      }
      return { ...token, id: ids.ids.get(String(token.id)) || token.id, annotations };
    });
    const mwts = (sentence.mwts || []).map(mwt => ({
      ...mwt,
      id: String(mwt.id).split('-').map(id => ids.ids.get(id) || id).join('-'),
    }));
    return { tokens, mwts };
  };

  const left = transformSentence(first, firstIds);
  const right = transformSentence(second, secondIds);
  const metadata = { ...first.metadata };
  if (textCol) metadata[textCol] = [first.text, second.text].filter(Boolean).join(' ');
  const tokens = [...left.tokens, ...right.tokens];
  const mwts = [...left.mwts, ...right.mwts];
  return {
    ...first, metadata, tokens, mwts,
    comments: [...first.comments, ...second.comments],
    text: textCol ? metadata[textCol] : buildFallbackText(tokens, mwts),
    activeAnnotator: perUserMode ? currentUser : defaultAnnotator,
  };
};

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Save, Upload, Download, Search, Settings, X, Plus, ChevronLeft, Info, Users, GitBranch } from 'lucide-react';

const DEFAULT_ANNOTATOR = '<anonymous>';
const COLORS = ['#94a3b8', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16', '#6366f1', '#f43f5e', '#14b8a6', '#d946ef', '#f97316'];

// --- Data Formatting Helpers ---

const parseEdeps = (depsStr) => {
  if (!depsStr || depsStr === '_') return [];
  return depsStr.split('|').map(edge => {
    const parts = edge.split(':');
    return { head: parts[0], deprel: parts.slice(1).join(':') };
  }).filter(e => e.head && e.deprel);
};

const stringifyEdeps = (edepsArray) => {
  if (!edepsArray || edepsArray.length === 0) return '_';
  return [...edepsArray].sort((a, b) => parseInt(a.head) - parseInt(b.head)).map(e => `${e.head}:${e.deprel}`).join('|');
};

const parseFeatures = (str) => {
  if (!str || str === '_') return [];
  return str.split('|').map(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return { key: pair, value: '' };
    return { key: pair.substring(0, idx), value: pair.substring(idx + 1) };
  });
};

const stringifyFeatures = (arr) => {
  const valid = arr.filter(item => item.key.trim() !== '');
  if (valid.length === 0) return '_';
  const seen = new Set();
  const deduped = valid.filter(item => { const k = item.key.trim(); if (seen.has(k)) return false; seen.add(k); return true; });
  return deduped.sort((a, b) => a.key.trim().localeCompare(b.key.trim())).map(item => item.value.trim() ? `${item.key.trim()}=${item.value.trim()}` : item.key.trim()).join('|');
};

const colToInt = (colStr) => { let n = 0; for(let i=0; i<colStr.length; i++) n = n*26 + (colStr.charCodeAt(i)-64); return n; };
const intToCol = (num) => { let s=''; while(num>0) { let r=(num-1)%26; s=String.fromCharCode(65+r)+s; num=Math.floor((num-1)/26); } return s; };

// --- Sentence Analysis & Text Synthesis ---

const hasAnnotationData = (sent, annName) => {
  return sent.tokens.some(t => {
    const ann = t.annotations[annName];
    return ann && (ann.head !== '_' || ann.deprel !== '_' || (ann.deps && ann.deps !== '_'));
  });
};

const getAvailableAnns = (sent, defaultAnn) => {
  const set = new Set();
  if (sent.activeAnnotator) set.add(sent.activeAnnotator);
  sent.tokens.forEach(t => {
    Object.keys(t.annotations || {}).forEach(a => set.add(a));
  });
  if (set.size === 0) set.add(defaultAnn);
  return Array.from(set).sort();
};

const getFallbackAnnotator = (sent, preferred, defaultAnn) => {
  const available = getAvailableAnns(sent, defaultAnn);
  if (available.includes(preferred) && hasAnnotationData(sent, preferred)) return preferred;
  for (let ann of available) {
    if (hasAnnotationData(sent, ann)) return ann;
  }
  return available.length > 0 ? available[0] : preferred;
};

const buildFallbackText = (tokens, mwts) => {
  const mwtMap = {};
  (mwts || []).forEach(m => {
    const [start, end] = m.id.split('-');
    mwtMap[start] = { ...m, endId: parseInt(end) };
  });
  
  let out = "";
  let skipUntil = -1;
  
  const sortedTokens = [...(tokens || [])]
    .filter(t => !String(t.id).includes('.'))
    .sort((a,b) => parseInt(a.id) - parseInt(b.id));
    
  for (let i = 0; i < sortedTokens.length; i++) {
    const t = sortedTokens[i];
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
    } else {
      if ((t.misc || '').includes('SpaceAfter=No')) hasSpace = false;
    }
    
    out += form + (hasSpace ? ' ' : '');
  }
  return out.trimEnd();
};

// --- Color Pipeline ---

const generateColorMap = (sents) => {
  const counts = {};
  sents.forEach(sent => {
    sent.tokens.forEach(t => {
      Object.values(t.annotations || {}).forEach(ann => {
        if (ann.deprel && ann.deprel !== '_' && ann.deprel !== 'root') {
          counts[ann.deprel] = (counts[ann.deprel] || 0) + 1;
        }
        if (ann.deps && ann.deps !== '_') {
          parseEdeps(ann.deps).forEach(e => {
            if (e.deprel && e.deprel !== '_' && e.deprel !== 'root') {
              counts[e.deprel] = (counts[e.deprel] || 0) + 1;
            }
          });
        }
      });
    });
  });

  const sortedLabels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const map = { '_': COLORS[0], 'root': COLORS[1] };

  let colorIndex = 2;
  sortedLabels.forEach(label => {
    if (colorIndex < COLORS.length) map[label] = COLORS[colorIndex++];
  });
  return map;
};

const getColorForLabel = (label, colorMap) => {
  if (colorMap[label]) return colorMap[label]; 
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = label.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash * 137.508) % 360;
  return `hsl(${hue}, 75%, 42%)`;
};


// --- Embeddable Tree Editor Component ---

export function Dendroid({
  initialData = '',
  initialFormat = 'conllu',
  currentUser = 'Yun',
  defaultAnnotator = '<anonymous>',
  perUserMode = true,
  textCol = 'text',
  sentBoundCol = 'sent_id',
  sentenceAnnotations = ['text', 'sent_id'],
  colMappings = {
    id: 'word_id', form: 'word', lemma: 'lemma', upos: 'upos', xpos: 'xpos',
    feats: 'feats', head: 'head', deprel: 'deprel', deps: 'deps', misc: 'misc',
    annotator: 'dendroid:annotator'
  },
  features = {
    mwt: true, ellipsis: true, edeps: true, feats: true, misc: true
  },
  tagsets = {
    upos: ["NOUN", "PUNCT", "VERB", "ADP", "PRON", "DET", "ADJ", "AUX", "PROPN", "ADV", "CCONJ", "PART", "NUM", "SCONJ", "INTJ", "X", "SYM"].sort(),
    xpos: ["NN", "IN", "DT", "JJ", "NNP", "PRP", ",", ".", "RB", "NNS", "VB", "CC", "VBP", "VBD", "VBZ", "VBN", "CD", "VBG", "TO", "PRP$", "MD", "UH", ":", "WDT", "-LRB-", "-RRB-", "WRB", "HYPH", "RP", "''", "``", "WP", "POS", "NNPS", "JJR", "RBR", "EX", "JJS", "FW", "SYM", "PDT", "RBS", "LS", "$", "WP$", "GW"].sort(),
    deprel: ["punct", "case", "det", "nsubj", "root", "advmod", "amod", "obj", "obl", "nmod", "conj", "cc", "mark", "compound", "aux", "cop", "advcl", "nmod:poss", "xcomp", "acl:relcl", "flat", "acl", "discourse", "ccomp", "aux:pass", "parataxis", "nsubj:pass", "nummod", "appos", "compound:prt", "obl:unmarked", "fixed", "expl", "dep", "reparandum", "nmod:unmarked", "iobj", "obl:agent", "csubj", "advcl:relcl", "nmod:desc", "det:predet", "vocative", "list", "orphan", "cc:preconj", "dislocated", "goeswith", "csubj:pass"].sort(),
    edeprel: ["punct", "case", "det", "nsubj", "root", "advmod", "amod", "obj", "obl", "nmod", "conj", "cc", "mark", "compound", "aux", "cop", "advcl", "nmod:poss", "xcomp", "acl:relcl", "flat", "acl", "discourse", "ccomp", "aux:pass", "parataxis", "nsubj:pass", "nummod", "appos", "compound:prt", "obl:unmarked", "fixed", "expl", "dep", "reparandum", "nmod:unmarked", "iobj", "obl:agent", "csubj", "advcl:relcl", "nmod:desc", "det:predet", "vocative", "list", "orphan", "cc:preconj", "dislocated", "goeswith", "csubj:pass", "nsubj:xsubj"].sort()
  },
  onChange
}) {

  const [sentences, setSentences] = useState([]);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [rawData, setRawData] = useState(initialData);
  const [viewMode, setViewMode] = useState('editor'); 
  const [showHelp, setShowHelp] = useState(false);
  const [globalPreferredAnnotator, setGlobalPreferredAnnotator] = useState('LATEST');
  const [colorMap, setColorMap] = useState({});

  // --- GitDOX Integration Helper ---
  const notifyChange = (nextSents) => {
    if (!onChange) return;
    const set = new Set();
    nextSents.forEach(s => {
      if (s.activeAnnotator && perUserMode) set.add(s.activeAnnotator);
      s.tokens.forEach(t => { Object.keys(t.annotations || {}).forEach(a => set.add(a)); });
    });
    if (set.size === 0) set.add(defaultAnnotator);
    
    onChange(exportSocialCalc(nextSents, Array.from(set).sort()));
  };

  // --- Parsers ---

  const parseCoNLLU = (text) => {
    const sents = [];
    const blocks = text.trim().split(/\n\s*\n/);
  
    blocks.forEach((block, index) => {
      const lines = block.split('\n');
      const sentence = {
        id: `sent_${index}`, text: '', metadata: {}, comments: [],
        tokens: [], mwts: [], activeAnnotator: null
      };
  
      const rawTokens = [];
  
      lines.forEach(line => {
        line = line.trim();
        if (!line) return;
  
        if (line.startsWith('#')) {
          const match = line.match(/^#\s*([^=]+?)\s*=\s*(.*)$/);
          if (match) {
            const key = match[1].trim();
            const val = match[2].trim();
            if (key === 'annotator' && perUserMode) {
              sentence.activeAnnotator = val;
            } else {
              sentence.metadata[key] = val;
            }
          } else {
            sentence.comments.push(line);
          }
        } else {
          const cols = line.split('\t');
          if (cols.length >= 10) rawTokens.push(cols);
        }
      });
      
      if (!sentence.activeAnnotator) sentence.activeAnnotator = defaultAnnotator;
  
      rawTokens.forEach(cols => {
        const id = cols[0];
        const tokenData = {
          id, _originalGlobalId: id,
          form: cols[1], lemma: cols[2], upos: cols[3], xpos: cols[4],
          feats: cols[5], misc: cols[9], _subRows: [], _rowspan: 1,
          annotations: {
            [sentence.activeAnnotator]: { head: cols[6], deprel: cols[7], deps: cols[8] }
          }
        };
        
        if (id.includes('-') && features.mwt) sentence.mwts.push(tokenData);
        else sentence.tokens.push(tokenData);
      });
      
      if (sentence.tokens.length > 0 || sentence.mwts.length > 0) {
        sentence.text = (textCol && sentence.metadata[textCol]) ? sentence.metadata[textCol] : buildFallbackText(sentence.tokens, sentence.mwts);
        sents.push(sentence);
      }
    });
    return sents;
  };

  const parseSocialCalc = (text) => {
    const sents = [];
    if (!text || !text.trim()) return sents;
    const lines = text.split('\n');
    const cells = {};
    let maxRow = 1, maxCol = 1;
  
    lines.forEach(line => {
      const match = line.match(/^cell:([A-Z]+)(\d+):(.*?)$/);
      if (match) {
        const row = parseInt(match[2], 10), col = colToInt(match[1]);
        const parts = match[3].split(':');
        let val = '';
        if (parts[0] === 't' || parts[0] === 'v') val = parts[1] ? parts[1].replace(/\\c/g, ':').replace(/\\n/g, '\n') : '';
        let rowspan = 1;
        for (let i=2; i<parts.length; i+=2) if (parts[i] === 'rowspan') rowspan = parseInt(parts[i+1], 10);
        cells[`${row},${col}`] = { v: val, rowspan };
        if (row > maxRow) maxRow = row;
        if (col > maxCol) maxCol = col;
      }
    });
  
    for (let r=1; r<=maxRow; r++) {
      for (let c=1; c<=maxCol; c++) {
        const cell = cells[`${r},${c}`];
        if (cell && cell.rowspan > 1 && !cell.isPropagated) {
          cell.spanOrigin = r;
          cell.originalRowspan = cell.rowspan;
          for (let i=1; i<cell.rowspan; i++) {
            cells[`${r+i},${c}`] = { ...cell, rowspan: 1, isPropagated: true, spanOrigin: r, originalRowspan: cell.rowspan };
          }
        } else if (cell && !cell.isPropagated) {
          cell.spanOrigin = r;
          cell.originalRowspan = 1;
        }
      }
    }
  
    const rawHeaders = {};
    for (let c=1; c<=maxCol; c++) {
      if (cells[`1,${c}`]) rawHeaders[cells[`1,${c}`].v] = c;
    }
  
    if (Object.keys(rawHeaders).length === 0) return sents;
  
    const annotationCols = {};
    const coreCols = {};
    const unknownColsList = [];
    const invMap = Object.entries(colMappings).reduce((acc, [k,v]) => ({...acc, [v.toLowerCase()]: k}), {});
    const metaColNamesLower = new Set([sentBoundCol, textCol, ...sentenceAnnotations].filter(Boolean).map(s => s.toLowerCase()));
  
    Object.keys(rawHeaders).forEach(h => {
      const lower = h.toLowerCase();
      let base = lower;
      let ann = defaultAnnotator;
      
      if (h.includes(':') && perUserMode) {
        const parts = h.split(':');
        const candidateBase = parts[0].toLowerCase();
        if (['head', 'deprel', 'deps'].includes(invMap[candidateBase])) {
          base = invMap[candidateBase];
          ann = parts.slice(1).join(':');
        }
      } else {
        if (invMap[lower]) base = invMap[lower];
      }
  
      if (['head', 'deprel', 'deps'].includes(base)) {
        if (!annotationCols[ann]) annotationCols[ann] = {};
        annotationCols[ann][base] = rawHeaders[h];
      } else if (Object.keys(colMappings).includes(base)) {
        coreCols[base] = rawHeaders[h];
      } else {
        if (!metaColNamesLower.has(lower)) unknownColsList.push(h);      
      }
    });

    const boundColKey = Object.keys(rawHeaders).find(k => k.toLowerCase() === sentBoundCol.toLowerCase());
    if (!boundColKey) throw new Error(`Required sentence boundary column '${sentBoundCol}' not found in spreadsheet.`);
    const boundColIdx = rawHeaders[boundColKey];
  
    const colMap = {
      id: coreCols.id, form: coreCols.form, lemma: coreCols.lemma, upos: coreCols.upos, xpos: coreCols.xpos,
      feats: coreCols.feats, misc: coreCols.misc, annotator: coreCols.annotator
    };
  
    let currentSent = null, lastBoundVal = null, lastSpanOrigin = null, lastBoundCell = null;
    let currentTokenRow = null;
    let currentTokenRowSpanEnd = 0;
    const tempSentences = [];
  
    for (let r=2; r<=maxRow; r++) {
      let rowHasData = false;
      for (let c=1; c<=maxCol; c++) {
        if (cells[`${r},${c}`]) { rowHasData = true; break; }
      }
      if (!rowHasData) continue;

      let idCell = colMap.id ? cells[`${r},${colMap.id}`] : null;
      let idVal = idCell ? idCell.v : null;
      const formCell = colMap.form ? cells[`${r},${colMap.form}`] : null;
      const formVal = formCell ? formCell.v : null;
      const annotatorVal = perUserMode && colMap.annotator && cells[`${r},${colMap.annotator}`] ? cells[`${r},${colMap.annotator}`].v : null;
      
      if (r > currentTokenRowSpanEnd) {
        if (!idVal || idVal === '') {
          idVal = `__TEMP_ID_${r}__`;
        }
      }

      const boundCell = cells[`${r},${boundColIdx}`];
      const boundVal = boundCell?.v;
      const currentSpanOrigin = boundCell?.spanOrigin;

      let effectiveBoundVal = boundVal !== undefined ? boundVal : lastBoundVal;
      if (!effectiveBoundVal) effectiveBoundVal = 'sent_1';
  
      let isNewSent = false;
      if (boundVal !== undefined && boundVal !== lastBoundVal) {
        isNewSent = true;
      } else if (currentSpanOrigin !== lastSpanOrigin) {
        if ((boundCell && boundCell.originalRowspan > 1) || (lastBoundCell && lastBoundCell.originalRowspan > 1)) {
           isNewSent = true;
        }
      }

      if (isNewSent || !currentSent) {
        lastBoundVal = boundVal !== undefined ? boundVal : effectiveBoundVal;
        lastSpanOrigin = currentSpanOrigin;
        lastBoundCell = boundCell;
        currentTokenRow = null;
        currentTokenRowSpanEnd = 0;
        
        const meta = {};
        if (textCol) {
           const textIdx = rawHeaders[Object.keys(rawHeaders).find(k => k.toLowerCase() === textCol.toLowerCase())];
           meta[textCol] = (textIdx && cells[`${r},${textIdx}`]) ? cells[`${r},${textIdx}`].v : '';
        }
        meta[sentBoundCol] = effectiveBoundVal;
        sentenceAnnotations.forEach(sa => {
           const idx = rawHeaders[Object.keys(rawHeaders).find(k => k.toLowerCase() === sa.toLowerCase())];
           if (idx) meta[sa] = cells[`${r},${idx}`]?.v || '';
        });

        currentSent = { 
          id: `sent_${tempSentences.length}`, metadata: meta, comments: [], 
          tokens: [], mwts: [], activeAnnotator: annotatorVal || null, globalRows: [] 
        };
        tempSentences.push(currentSent);
      }
  
      if (idVal && (!currentTokenRow || currentTokenRow.id !== idVal)) {
        const tokenRowspan = formCell ? (formCell.originalRowspan || 1) : (idCell ? (idCell.originalRowspan || 1) : 1);
        currentTokenRowSpanEnd = r + tokenRowspan - 1;

        const safeGet = (colIndex) => {
          if (!colIndex || !cells[`${r},${colIndex}`]) return '_';
          const v = cells[`${r},${colIndex}`].v;
          return (v === undefined || v === null || v === '') ? '_' : v;
        };
        
        const rowAnnotations = {};
        Object.keys(annotationCols).forEach(ann => {
          rowAnnotations[ann] = {
            head: safeGet(annotationCols[ann].head),
            deprel: safeGet(annotationCols[ann].deprel),
            deps: safeGet(annotationCols[ann].deps)
          };
        });
  
        currentTokenRow = {
          id: idVal, _originalGlobalId: idVal,
          form: safeGet(colMap.form), lemma: safeGet(colMap.lemma), upos: safeGet(colMap.upos), xpos: safeGet(colMap.xpos),
          feats: safeGet(colMap.feats), misc: safeGet(colMap.misc), annotations: rowAnnotations,
          _rowspan: tokenRowspan, _subRows: []
        };
        currentSent.globalRows.push(currentTokenRow);
      }

      if (currentTokenRow) {
        const unk = {};
        const unkMeta = {};
        unknownColsList.forEach(u => {
          const colIdx = rawHeaders[u];
          const rawCell = colIdx ? cells[`${r},${colIdx}`] : null;
          unk[u] = rawCell ? rawCell.v : '';
          unkMeta[u] = rawCell
            ? { isContinuation: !!rawCell.isPropagated, rowspan: rawCell.originalRowspan || rawCell.rowspan || 1 }
            : { isContinuation: false, rowspan: 1 };
        });
        currentTokenRow._subRows.push({ unk, unkMeta });
      }
    }
  
    const validAnns = Object.keys(annotationCols).sort();
  
    tempSentences.forEach(sent => {
      if (!sent.activeAnnotator || sent.activeAnnotator === '') sent.activeAnnotator = validAnns.length > 0 ? validAnns[0] : defaultAnnotator;
      const globalToLocal = { '0': '0', '_': '_' };
      let localCounter = 1;
      const standardTokens = [], ellipsisTokens = [], mwtTokens = [];
  
      sent.globalRows.forEach(row => {
        if (String(row.id).includes('-')) mwtTokens.push(row);
        else if (String(row.id).includes('.')) ellipsisTokens.push(row);
        else standardTokens.push(row);
      });
  
      standardTokens.forEach(row => {
        const localId = String(localCounter++);
        globalToLocal[row.id] = localId;
        sent.tokens.push({ ...row, id: localId, _originalGlobalId: row._originalGlobalId });
      });
  
      ellipsisTokens.forEach(row => {
        const [base, sub] = String(row.id).split('.');
        const localBase = globalToLocal[base] || '1'; 
        const localId = `${localBase}.${sub}`;
        globalToLocal[row.id] = localId;
        if (features.ellipsis) sent.tokens.push({ ...row, id: localId, _originalGlobalId: row._originalGlobalId });
        else sent.tokens.push({ ...row, id: row.id, _originalGlobalId: row._originalGlobalId }); 
      });
  
      mwtTokens.forEach(row => {
        const [start, end] = String(row.id).split('-');
        const localStart = globalToLocal[start] || start;
        const localEnd = globalToLocal[end] || end;
        const localId = `${localStart}-${localEnd}`;
        globalToLocal[row.id] = localId;
        if (features.mwt) sent.mwts.push({ ...row, id: localId, _originalGlobalId: row._originalGlobalId });
      });
  
      sent.tokens.forEach(token => {
        Object.keys(token.annotations).forEach(annName => {
          const ann = token.annotations[annName];
          if (ann.head !== '0' && ann.head !== '_') {
            ann._originalGlobalHead = ann.head;
            ann.head = globalToLocal[ann.head] || `ext:${ann.head}`;
          }
          if (ann.deps && ann.deps !== '_') {
            const edeps = parseEdeps(ann.deps);
            const mappedEdeps = edeps.map(e => ({ 
                ...e, 
                _originalGlobalHead: e.head,
                head: globalToLocal[e.head] || `ext:${e.head}` 
            })).filter(e => e.head !== '_');
            ann.deps = stringifyEdeps(mappedEdeps);
          }
        });
      });
      delete sent.globalRows;
      
      sent.text = (textCol && sent.metadata[textCol]) ? sent.metadata[textCol] : buildFallbackText(sent.tokens, sent.mwts);
      sents.push(sent);
    });
    return sents;
  };


  // --- Exporters ---

  const exportCoNLLU = (sents, preferredMode, globalAnns) => {
    return sents.map(sent => {
      const exportAnn = preferredMode === 'LATEST' ? sent.activeAnnotator : getFallbackAnnotator(sent, preferredMode, defaultAnnotator);
      let comments = [...sent.comments];
      
      if (perUserMode) comments.push(`# annotator = ${exportAnn}`);
      
      sentenceAnnotations.forEach(sa => {
         if (sent.metadata[sa] !== undefined && sent.metadata[sa] !== null) {
            comments.push(`# ${sa} = ${sent.metadata[sa]}`);
         }
      });
      
      let out = comments.join('\n') + '\n';
      
      const allLines = [...sent.tokens, ...sent.mwts];
      allLines.sort((a, b) => {
        const aNum = parseFloat(String(a.id).split('-')[0]);
        const bNum = parseFloat(String(b.id).split('-')[0]);
        if (aNum === bNum) return String(a.id).includes('-') ? -1 : (String(b.id).includes('-') ? 1 : 0);
        return aNum - bNum;
      });
  
      out += allLines.map(t => {
        if (String(t.id).includes('-')) return [t.id, t.form, t.lemma, t.upos, t.xpos, t.feats, '_', '_', '_', t.misc].join('\t');
        const ann = t.annotations[exportAnn] || { head: '_', deprel: '_', deps: '_' };
        let outHead = ann.head;
        if (String(outHead).startsWith('ext:')) outHead = outHead.substring(4);
        return [t.id, t.form, t.lemma, t.upos, t.xpos, t.feats, outHead, ann.deprel, ann.deps, t.misc].join('\t');
      }).join('\n');
      return out;
    }).join('\n\n') + '\n\n';
  };

  const exportSocialCalc = (sents, globalAnns) => {
    let out = `socialcalc:version:1.0\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave\n--SocialCalcSpreadsheetControlSave\nContent-type: text/plain; charset=UTF-8\n\n# SocialCalc Spreadsheet Control Save\nversion:1.0\npart:sheet\npart:edit\npart:audit\n--SocialCalcSpreadsheetControlSave\nContent-type: text/plain; charset=UTF-8\n\nversion:1.5\n`;
    const escapeSC = (str) => String(str).replace(/:/g, '\\c').replace(/\n/g, '\\n');
    
    const allUnknowns = new Set();
    sents.forEach(s => {
       const lines = [...(s.tokens || []), ...(s.mwts || [])];
       lines.forEach(t => {
          (t._subRows || []).forEach(sr => Object.keys(sr.unk || {}).forEach(k => allUnknowns.add(k)));
       });
    });
    const unknownList = Array.from(allUnknowns);

    const tokenFields = ['id', 'form', 'lemma', 'upos', 'xpos', 'feats'].filter(f => colMappings[f]);
    const depFields = ['head', 'deprel', 'deps'].filter(f => colMappings[f]);

    const headers = [...tokenFields.map(f => colMappings[f])];

    if (perUserMode) {
      globalAnns.forEach(ann => {
        const suffix = ann === defaultAnnotator ? '' : `:${ann}`;
        depFields.forEach(f => headers.push(`${colMappings[f]}${suffix}`));
      });
    } else {
      depFields.forEach(f => headers.push(colMappings[f]));
    }
    
    headers.push(...unknownList);

    const metaColsSet = new Set([sentBoundCol]);
    if (textCol) metaColsSet.add(textCol);
    sentenceAnnotations.forEach(sa => metaColsSet.add(sa));
    const metaCols = Array.from(metaColsSet);

    headers.push(...metaCols);

    if (perUserMode) headers.push(colMappings.annotator || 'dendroid:annotator');
    if (colMappings.misc) headers.push(colMappings.misc);
  
    const generatedCells = [];
    const addCell = (r, c, type, val, extras = '') => {
      if (val !== undefined && val !== null && (val !== '' || extras !== '')) {
        generatedCells.push({ r, c, str: `cell:${intToCol(c)}${r}:${type}:${escapeSC(val)}${extras}\n` });
      }
    };

    headers.forEach((h, i) => { addCell(1, i + 1, 't', h, ':f:1'); });
  
    let currentRow = 2, globalIdCounter = 1;
    const oldGlobalToNewGlobal = {};

    sents.forEach(sent => {
      sent.tokens.filter(t => !String(t.id).includes('.')).forEach(t => { 
        const newG = String(globalIdCounter++);
        if (t._originalGlobalId) oldGlobalToNewGlobal[t._originalGlobalId] = newG;
        t._newGlobalId = newG;
      });
      sent.tokens.filter(t => String(t.id).includes('.')).forEach(t => {
        const [base, sub] = String(t.id).split('.');
        const baseG = sent.tokens.find(bt => bt.id === base)?._newGlobalId || base;
        const newG = `${baseG}.${sub}`;
        if (t._originalGlobalId) oldGlobalToNewGlobal[t._originalGlobalId] = newG;
        t._newGlobalId = newG;
      });
      (sent.mwts || []).forEach(mwt => {
        const [start, end] = String(mwt.id).split('-');
        const startG = sent.tokens.find(t => t.id === start)?._newGlobalId || start;
        const endG = sent.tokens.find(t => t.id === end)?._newGlobalId || end;
        const newG = `${startG}-${endG}`;
        if (mwt._originalGlobalId) oldGlobalToNewGlobal[mwt._originalGlobalId] = newG;
        mwt._newGlobalId = newG;
      });
    });

    sents.forEach(sent => {
      const localToGlobal = { '0': '0', '_': '_' };
      sent.tokens.forEach(t => { localToGlobal[t.id] = t._newGlobalId; });
      (sent.mwts || []).forEach(mwt => { localToGlobal[mwt.id] = mwt._newGlobalId; });
  
      const allLines = [...sent.tokens, ...(sent.mwts || [])];
      allLines.sort((a, b) => {
        const aNum = parseFloat(String(a.id).split('-')[0]);
        const bNum = parseFloat(String(b.id).split('-')[0]);
        if (aNum === bNum) return String(a.id).includes('-') ? -1 : (String(b.id).includes('-') ? 1 : 0);
        return aNum - bNum;
      });

      const sentSubRows = [];
      allLines.forEach(t => {
          const span = t._rowspan || 1;
          const subRows = t._subRows || [];
          const exactSubRows = subRows.slice(0, span);
          while(exactSubRows.length < span) exactSubRows.push({ unk: {}, unkMeta: {} });
          exactSubRows.forEach(sr => sentSubRows.push(sr));
      });
      const rowSpan = sentSubRows.length;
      
      metaCols.forEach(mc => {
        const idx = headers.indexOf(mc) + 1;
        const val = (mc === textCol && !sent.metadata[mc]) ? sent.text : (sent.metadata[mc] || '');
        if (rowSpan > 0) addCell(currentRow, idx, 't', val, rowSpan > 1 ? `:rowspan:${rowSpan}` : '');
      });

      if (perUserMode && rowSpan > 0 && sent.activeAnnotator) {
        addCell(currentRow, headers.indexOf(colMappings.annotator || 'dendroid:annotator') + 1, 't', sent.activeAnnotator, rowSpan > 1 ? `:rowspan:${rowSpan}` : '');
      }
  
      unknownList.forEach(colName => {
        const colIdx = headers.indexOf(colName) + 1;
        let i = 0;
        while (i < sentSubRows.length) {
          const sr = sentSubRows[i];
          const meta = (sr.unkMeta && sr.unkMeta[colName]) || { isContinuation: false, rowspan: 1 };
          const span = Math.max(1, Math.min(meta.rowspan || 1, sentSubRows.length - i));
          const val = sr.unk ? sr.unk[colName] : '';
          
          if (!meta.isContinuation) {
            addCell(currentRow + i, colIdx, 't', val, span > 1 ? `:rowspan:${span}` : '');
          }
          i += span;
        }
      });
  
      let tokenRowOffset = 0;
      allLines.forEach(t => {
        const span = t._rowspan || 1;
        const globalId = localToGlobal[t.id] || t.id;
        const tokenFieldValues = { id: globalId, form: t.form, lemma: t.lemma, upos: t.upos, xpos: t.xpos, feats: t.feats };
  
        const cellWrites = {};
        tokenFields.forEach(f => {
            const idx = headers.indexOf(colMappings[f]) + 1;
            if (idx > 0) cellWrites[idx] = tokenFieldValues[f];
        });

        const pushDepFields = (ann, annName) => {
          let globalHead = ann.head;
          if (ann.head !== '0' && ann.head !== '_') {
            if (String(ann.head).startsWith('ext:')) {
              const oldG = ann.head.substring(4);
              globalHead = oldGlobalToNewGlobal[oldG] || oldG;
            } else {
              globalHead = localToGlobal[ann.head] || ann.head;
            }
          }
          let globalDeps = ann.deps;
          if (ann.deps && ann.deps !== '_') {
            const edeps = parseEdeps(ann.deps);
            globalDeps = stringifyEdeps(edeps.map(e => {
              let eHead = e.head;
              if (String(e.head).startsWith('ext:')) {
                const oldG = e.head.substring(4);
                eHead = oldGlobalToNewGlobal[oldG] || oldG;
              } else {
                eHead = localToGlobal[e.head] || e.head;
              }
              return { ...e, head: eHead };
            }));
          }
          const depFieldValues = { head: globalHead, deprel: ann.deprel, deps: globalDeps };
          depFields.forEach(f => {
              const suffix = (!perUserMode || annName === defaultAnnotator) ? '' : `:${annName}`;
              const headerName = `${colMappings[f]}${suffix}`;
              const idx = headers.indexOf(headerName) + 1;
              if (idx > 0) cellWrites[idx] = depFieldValues[f];
          });
        };

        if (String(t.id).includes('-')) {
          const blankAnn = { head: '_', deprel: '_', deps: '_' };
          if (perUserMode) globalAnns.forEach(a => pushDepFields(blankAnn, a));
          else pushDepFields(blankAnn, defaultAnnotator);
        } else {
          if (perUserMode) {
            globalAnns.forEach(annName => {
              const ann = t.annotations[annName] || { head: '_', deprel: '_', deps: '_' };
              pushDepFields(ann, annName);
            });
          } else {
            const ann = t.annotations[defaultAnnotator] || { head: '_', deprel: '_', deps: '_' };
            pushDepFields(ann, defaultAnnotator);
          }
        }
        
        if (colMappings.misc) {
            const idx = headers.indexOf(colMappings.misc) + 1;
            if (idx > 0) cellWrites[idx] = t.misc;
        }

        Object.keys(cellWrites).forEach(colIdx => {
            const val = cellWrites[colIdx];
            if (val !== undefined && val !== null) {
                addCell(currentRow + tokenRowOffset, parseInt(colIdx), 't', val, span > 1 ? `:rowspan:${span}` : '');
            }
        });
        
        tokenRowOffset += span;
      });
      
      currentRow += rowSpan;
    });
  
    generatedCells.sort((a, b) => a.r !== b.r ? a.r - b.r : a.c - b.c);
    
    out += generatedCells.map(c => c.str).join('');
    out += `sheet:c:${headers.length}:r:${currentRow - 1}:tvf:1\nfont:1:normal bold * *\nvalueformat:1:text-wiki\n--SocialCalcSpreadsheetControlSave\nContent-type: text/plain; charset=UTF-8\n\nversion:1.0\nrowpane:0:1:1\ncolpane:0:1:1\necell:A1\n--SocialCalcSpreadsheetControlSave\nContent-type: text/plain; charset=UTF-8\n\n--SocialCalcSpreadsheetControlSave--\n`;
    return out;
  };

  // --- Initialization & Global State ---

  const globalAllAnnotators = useMemo(() => {
     const set = new Set();
     sentences.forEach(s => {
       if (s.activeAnnotator && perUserMode) set.add(s.activeAnnotator);
       s.tokens.forEach(t => { Object.keys(t.annotations || {}).forEach(a => set.add(a)); });
     });
     if (set.size === 0) set.add(defaultAnnotator);
     return Array.from(set).sort();
  }, [sentences, defaultAnnotator, perUserMode]);

  useEffect(() => {
    try {
      const parsed = initialFormat === 'conllu' ? parseCoNLLU(initialData) : parseSocialCalc(initialData);
      setSentences(parsed);
      setColorMap(generateColorMap(parsed));
      if (parsed.length > 0 && expandedIds.size === 0) setExpandedIds(new Set([parsed[0].id]));
    } catch (e) { alert(e.message); console.error("Failed to parse initial data", e); }
  }, [initialData, initialFormat, defaultAnnotator, perUserMode]); 

  const applyRawData = () => {
    try {
      const parsed = viewMode === 'conllu' ? parseCoNLLU(rawData) : parseSocialCalc(rawData);
      setSentences(parsed);
      setColorMap(generateColorMap(parsed));
      setViewMode('editor');
      notifyChange(parsed);
    } catch (e) { alert(`Parse Error:\n${e.message}`); console.error(e); }
  };

  const handleUpdateSentence = (newSentence, isViewOnly = false) => {
    if (!textCol || !newSentence.metadata[textCol]) {
      newSentence.text = buildFallbackText(newSentence.tokens, newSentence.mwts);
    }
    const next = sentences.map(sent => sent.id === newSentence.id ? newSentence : sent);
    setSentences(next);
    if (!isViewOnly) notifyChange(next);
  };

  // --- Sub-components ---

  const FeaturesModal = ({ token, onClose, onSave }) => {
    const [activeTab, setActiveTab] = useState('feats');
    const [data, setData] = useState({ feats: [...parseFeatures(token.feats), { key: '', value: '' }], misc: [...parseFeatures(token.misc), { key: '', value: '' }] });
  
    const cleanupRows = (rows) => {
      const filtered = rows.filter((r, i) => r.key.trim() !== '' || r.value.trim() !== '' || i === rows.length - 1);
      const last = filtered[filtered.length - 1];
      if (!last || last.key.trim() !== '' || last.value.trim() !== '') filtered.push({ key: '', value: '' });
      return filtered;
    };
  
    const handleChange = (tab, index, field, val) => { const newData = [...data[tab]]; newData[index][field] = val; setData({ ...data, [tab]: cleanupRows(newData) }); };
    const handleDelete = (tab, index) => { const newData = [...data[tab]]; newData.splice(index, 1); setData({ ...data, [tab]: cleanupRows(newData) }); };
  
    useEffect(() => {
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter') { e.preventDefault(); onSave(stringifyFeatures(data.feats), stringifyFeatures(data.misc)); }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [data, onClose, onSave]);
  
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-[520px] max-w-[95vw] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <h3 className="font-semibold text-gray-800">Edit Annotations <span className="text-gray-400 font-mono text-xs ml-2">[{token.form}]</span></h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors"><X size={20} /></button>
          </div>
          
          <div className="flex border-b border-gray-200 px-5 pt-3 gap-6 bg-white">
            {features.feats && <button className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'feats' ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`} onClick={() => setActiveTab('feats')}>Features (FEATS)</button>}
            {features.misc && <button className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'misc' ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`} onClick={() => setActiveTab('misc')}>Miscellaneous (MISC)</button>}
          </div>
  
          <div className="p-5 bg-white max-h-[50vh] overflow-y-auto">
            <div className="grid grid-cols-[1fr_1fr_32px] gap-2 px-1 mb-2">
              <div className="text-xs font-semibold text-gray-500 uppercase">Key</div>
              <div className="text-xs font-semibold text-gray-500 uppercase">Value (Optional)</div>
              <div></div>
            </div>
            {data[activeTab].map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center mb-2">
                <input type="text" value={row.key} onChange={(e) => handleChange(activeTab, i, 'key', e.target.value)} className="w-full px-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded outline-none focus:border-indigo-500 transition-all font-mono" />
                <input type="text" value={row.value} onChange={(e) => handleChange(activeTab, i, 'value', e.target.value)} className="w-full px-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded outline-none focus:border-indigo-500 transition-all font-mono" />
                <button onClick={() => handleDelete(activeTab, i)} disabled={i === data[activeTab].length - 1 && row.key === '' && row.value === ''} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-0"><X size={16} /></button>
              </div>
            ))}
          </div>
  
          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
            <button onClick={() => onSave(stringifyFeatures(data.feats), stringifyFeatures(data.misc))} className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm">Save</button>
          </div>
        </div>
      </div>
    );
  };

  const DependencyGraph = ({ sentence, activeAnn, onUpdateSentence, isCompareMode, compareUsers, annotatorColors }) => {
    const containerRef = useRef(null);
    const scrollRef = useRef(null);
    const scrollInterval = useRef(null);
    const latestMousePos = useRef({ x: 0, y: 0 });
    
    const BASE_Y = 260; 
    const WORD_SPACING = 30; 
    const CHAR_WIDTH_ESTIMATE = 8.5; 
    const MAX_ARC_HEIGHT = 160;
    
    const [dragState, setDragState] = useState({ active: false, sourceId: null, startX: 0, startY: 0, currentX: 0, currentY: 0, hoveredTargetId: null, isEdep: false });
    const [lassoState, setLassoState] = useState({ active: false, startX: 0, currentX: 0 });
    const [inlineEditor, setInlineEditor] = useState(null);
    const [featuresModalTokenId, setFeaturesModalTokenId] = useState(null);
  
    const displayAnnName = activeAnn;
  
    const hasEdepsData = useMemo(() => {
      if (!features.edeps) return false;
      return sentence.tokens.some(t => {
        const usersToCheck = isCompareMode ? compareUsers : [displayAnnName];
        return usersToCheck.some(u => {
            const ann = t.annotations[u];
            return ann && ann.deps && ann.deps !== '_';
        });
      });
    }, [sentence.tokens, displayAnnName, features.edeps, isCompareMode, compareUsers]);
    
    const showEdepsArea = hasEdepsData || dragState.isEdep;
    const svgHeight = showEdepsArea ? 560 : 380;
  
    const layout = useMemo(() => {
      let currentX = 40; 
      const nodePositions = {};
      const nodes = sentence.tokens.map(token => {
        const wordWidth = token.form.length * CHAR_WIDTH_ESTIMATE;
        const posWidth = Math.max((token.upos || '').length, (token.xpos || '').length) * CHAR_WIDTH_ESTIMATE * 0.8;
        const totalWidth = Math.max(30, Math.max(wordWidth, posWidth)) + 20;
        const node = { ...token, x: currentX + (totalWidth / 2), y: BASE_Y, width: totalWidth };
        nodePositions[token.id] = node;
        currentX += totalWidth + WORD_SPACING;
        return node;
      });
  
      const activeUsers = isCompareMode ? compareUsers : [displayAnnName];
      const edgesMap = new Map();
      const edepsMap = new Map();

      nodes.forEach(node => {
        activeUsers.forEach(user => {
          const ann = node.annotations[user] || { head: '_', deprel: '_', deps: '_' };
          if (!String(node.id).includes('.') && ann.head && ann.head !== '_') {
            const key = `${ann.head}->${node.id}`;
            if (!edgesMap.has(key)) edgesMap.set(key, { source: ann.head, target: node.id, labels: [] });
            edgesMap.get(key).labels.push({ user, rel: ann.deprel });
          }
          if (features.edeps) {
            parseEdeps(ann.deps).forEach(edep => {
              const key = `${edep.head}->${node.id}`;
              if (!edepsMap.has(key)) edepsMap.set(key, { source: edep.head, target: node.id, labels: [] });
              edepsMap.get(key).labels.push({ user, rel: edep.deprel });
            });
          }
        });
      });

      const processEdgesMap = (map) => {
        const arr = [];
        map.forEach((data) => {
            const isUniversal = isCompareMode && activeUsers.length > 1 &&
                                data.labels.length === activeUsers.length &&
                                data.labels.every(l => l.rel === data.labels[0].rel);

            if (isUniversal) {
                arr.push({ ...data, isUniversal: true, rels: [{ rel: data.labels[0].rel, color: '#94a3b8' }] });
            } else {
                // Do not deduplicate since each annotator can have partially overlapping annotations. 
                // Identical labels should stack and identical paths generate dashed stripe arcs.
                const rels = data.labels.map(l => ({ 
                    rel: l.rel, 
                    color: isCompareMode ? annotatorColors[l.user] : getColorForLabel(l.rel, colorMap), 
                    user: l.user 
                }));
                arr.push({ ...data, isUniversal: false, rels });
            }
        });
        return arr;
      };

      const edges = processEdgesMap(edgesMap);
      const edeps = processEdgesMap(edepsMap);
      
      const mwts = (sentence.mwts || []).map(mwt => {
        const [startId, endId] = String(mwt.id).split('-');
        const startNode = nodePositions[startId], endNode = nodePositions[endId];
        if (!startNode || !endNode) return null;
        const left = startNode.x - (startNode.width / 2) - 5, right = endNode.x + (endNode.width / 2) + 5;
        return { ...mwt, left, right, top: BASE_Y - 55, width: right - left };
      }).filter(Boolean);
  
      const processStacking = (edgeList) => {
        const incoming = {}, processed = [];
        edgeList.forEach(e => {
          const tNode = nodePositions[e.target];
          const sNode = e.source === '0' ? { x: tNode.x } : nodePositions[e.source];
          if (!sNode || !tNode) return;
          const distance = Math.abs(tNode.x - sNode.x);
          if (!incoming[e.target]) incoming[e.target] = [];
          incoming[e.target].push({ ...e, distance, isLeft: sNode.x < tNode.x, sNode, tNode });
        });
        Object.values(incoming).forEach(list => {
          list.sort((a, b) => a.distance !== b.distance ? a.distance - b.distance : (b.isLeft ? 1 : 0) - (a.isLeft ? 1 : 0));
          list.forEach((e, i) => processed.push({ ...e, stackIndex: i }));
        });
        return processed;
      };
  
      return { nodes, nodePositions, mwts, totalWidth: Math.max(800, currentX + 40), standardEdges: processStacking(edges), enhancedEdges: processStacking(edeps) };
    }, [sentence.tokens, sentence.mwts, displayAnnName, features.edeps, isCompareMode, compareUsers, annotatorColors, colorMap]);
  
    const allArrowColors = useMemo(() => {
      const s = new Set(['#94a3b8']);
      layout.standardEdges.forEach(e => e.rels.forEach(r => {
          if (r.color) s.add(r.color);
      }));
      layout.enhancedEdges.forEach(e => e.rels.forEach(r => {
          if (r.color) s.add(r.color);
      }));
      return Array.from(s);
    }, [layout]);

    const startAutoScroll = (direction) => { if (scrollInterval.current) return; scrollInterval.current = setInterval(() => { if (scrollRef.current) { scrollRef.current.scrollLeft += direction * 10; if (dragState.active || lassoState.active) updateDragPos(latestMousePos.current.x, latestMousePos.current.y); } }, 16); };
    const stopAutoScroll = () => { if (scrollInterval.current) { clearInterval(scrollInterval.current); scrollInterval.current = null; } };
    useEffect(() => () => stopAutoScroll(), []);
  
    const updateDragPos = (clientX, clientY, e = null) => {
      latestMousePos.current = { x: clientX, y: clientY };
      if (!dragState.active && !lassoState.active) return;
      if (e) e.preventDefault(); 
      if (!containerRef.current) return;
  
      const svgRect = containerRef.current.getBoundingClientRect();
      const x = clientX - svgRect.left, y = clientY - svgRect.top;
  
      if (lassoState.active) return setLassoState(prev => ({ ...prev, currentX: x }));
  
      let hoveredId = null;
      if (dragState.sourceId) {
          const hoveredNode = layout.nodes.find(n => {
             return x >= (n.x - (n.width / 2) - 10) && x <= (n.x + (n.width / 2) + 10) && y >= (BASE_Y - 60) && y <= (BASE_Y + 80);
          });
          if (hoveredNode && hoveredNode.id !== dragState.sourceId) hoveredId = hoveredNode.id;
      }
  
      setDragState(prev => ({
        ...prev, currentX: x, currentY: y, hoveredTargetId: hoveredId,
        isEdep: features.edeps && (prev.sourceId === '0' ? prev.startY > BASE_Y : ((e ? e.ctrlKey : prev.isEdep) || String(prev.sourceId).includes('.')))
      }));
    };
  
    const handleSvgMouseUp = (e) => {
      if (isCompareMode) return;
      if (lassoState.active) {
        const minX = Math.min(lassoState.startX, lassoState.currentX), maxX = Math.max(lassoState.startX, lassoState.currentX);
        const selected = layout.nodes.filter(n => !String(n.id).includes('.') && n.x >= minX && n.x <= maxX);
        
        if (selected.length >= 2) {
          const newId = `${selected[0].id}-${selected[selected.length - 1].id}`;
          if (!(sentence.mwts || []).find(m => m.id === newId)) {
            const newMwt = { id: newId, form: selected.map(s => s.form).join(''), lemma: '_', upos: '_', xpos: '_', feats: '_', head: '_', deprel: '_', deps: '_', misc: '_' };
            handleSaveAction((newTokens) => ({ mwts: [...(sentence.mwts || []), newMwt] }));
          }
        }
        return setLassoState({ active: false, startX: 0, currentX: 0 });
      }
  
      if (dragState.active) {
        if (dragState.hoveredTargetId) {
          const targetId = dragState.hoveredTargetId;
          if (!dragState.isEdep && (String(targetId).includes('.') || String(dragState.sourceId).includes('.'))) {
             return setDragState({ active: false, sourceId: null, startX: 0, startY: 0, currentX: 0, currentY: 0, hoveredTargetId: null, isEdep: false });
          }
  
          const targetNode = layout.nodePositions[targetId];
          const currentToken = sentence.tokens.find(t => t.id === targetId);
          const sourceNode = dragState.sourceId === '0' ? {x: targetNode.x} : layout.nodePositions[dragState.sourceId];
          
          let existingVal = '';
          const ann = currentToken.annotations[displayAnnName] || { head: '_', deprel: '_', deps: '_' };
  
          if (dragState.isEdep) {
            const edeps = parseEdeps(ann.deps);
            const existing = edeps.find(ed => ed.head === dragState.sourceId);
            if (existing) existingVal = existing.deprel;
          } else {
            if (ann.head === dragState.sourceId) existingVal = ann.deprel;
          }
  
          setInlineEditor({
            active: true, type: 'select', field: dragState.isEdep ? 'edeprel' : 'deprel', tokenId: targetId, sourceId: dragState.sourceId, value: existingVal,
            x: dragState.sourceId === '0' ? targetNode.x : (sourceNode.x + targetNode.x) / 2,
            y: dragState.sourceId === '0' ? (dragState.isEdep ? (BASE_Y + MAX_ARC_HEIGHT/2 + 10) : (BASE_Y / 2)) : (dragState.isEdep ? BASE_Y + 50 + (Math.min(MAX_ARC_HEIGHT, 30 + (Math.abs(targetNode.x - sourceNode.x) * 0.2)) * 0.75) + 12 : BASE_Y - 35 - (Math.min(MAX_ARC_HEIGHT, 30 + (Math.abs(targetNode.x - sourceNode.x) * 0.2)) * 0.75) - 5),
            options: dragState.isEdep ? tagsets.edeprel : tagsets.deprel
          });
        }
        setDragState({ active: false, sourceId: null, startX: 0, startY: 0, currentX: 0, currentY: 0, hoveredTargetId: null, isEdep: false });
      }
    };
  
    const handleWordMouseDown = (e, tokenId) => {
      e.stopPropagation(); e.preventDefault();
      if (isCompareMode) return;
      if (inlineEditor) setInlineEditor(null);
      
      const isEllipsis = String(tokenId).includes('.');
      const svgRect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - svgRect.left;
      const y = e.clientY - svgRect.top;
      
      setDragState({
        active: true, sourceId: tokenId, startX: layout.nodePositions[tokenId]?.x || x, startY: y,
        currentX: x, currentY: y, hoveredTargetId: null, isEdep: features.edeps && (e.ctrlKey || isEllipsis)
      });
    };
  
    const handleRootMouseDown = (e, isBottomRoot = false) => {
      e.stopPropagation(); e.preventDefault();
      if (isCompareMode) return;
      if (inlineEditor) setInlineEditor(null);
      
      const svgRect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - svgRect.left;
      const y = e.clientY - svgRect.top;
      
      setDragState({
        active: true, sourceId: '0', startX: x, startY: isBottomRoot ? svgHeight - 20 : 20,
        currentX: x, currentY: y, hoveredTargetId: null, isEdep: features.edeps && (e.ctrlKey || isBottomRoot)
      });
    };
  
    const openTextEditor = (e, entity, field, yOffset, isMwt = false) => {
      e.stopPropagation();
      if (isCompareMode) return;
      const x = isMwt ? entity.left + entity.width/2 : layout.nodePositions[entity.id].x;
      setInlineEditor({
        active: true, type: 'text', field: field, tokenId: entity.id, isMwt,
        value: entity[field] || '', x: x, y: BASE_Y + yOffset
      });
    };
  
    const openSelectEditor = (e, token, field, yOffset, options) => {
      e.stopPropagation();
      if (isCompareMode) return;
      setInlineEditor({
        active: true, type: 'select', field: field, tokenId: token.id,
        value: token[field] || '', x: layout.nodePositions[token.id].x, y: BASE_Y + yOffset, options: options
      });
    };
  
    const handleSaveAction = (applyUpdatesToSent) => {
      let newTokens = [...sentence.tokens];
      const targetUser = perUserMode ? currentUser : defaultAnnotator;
      
      const availableAnns = getAvailableAnns(sentence, defaultAnnotator);
      if (perUserMode && (!availableAnns.includes(targetUser) || !hasAnnotationData(sentence, targetUser))) {
         newTokens = newTokens.map(t => {
           const updatedAnns = { ...t.annotations };
           updatedAnns[targetUser] = t.annotations[displayAnnName] ? { ...t.annotations[displayAnnName] } : { head: '_', deprel: '_', deps: '_' };
           return { ...t, annotations: updatedAnns };
         });
      }
  
      const updates = applyUpdatesToSent(newTokens, targetUser);
      onUpdateSentence({ ...sentence, tokens: newTokens, activeAnnotator: targetUser, ...updates }, false);
      setInlineEditor(null);
    };
  
    const handleSaveInline = (val) => {
      if (!inlineEditor) return;
      if (inlineEditor.isMwt) {
        handleSaveAction((tokens, user) => {
           const newMwts = (sentence.mwts || []).map(m => m.id === inlineEditor.tokenId ? { ...m, [inlineEditor.field]: val || '_' } : m);
           return { mwts: newMwts };
        });
        return;
      }
  
      handleSaveAction((tokens, user) => {
        const tokenIdx = tokens.findIndex(t => t.id === inlineEditor.tokenId);
        const t = tokens[tokenIdx];
        
        if (inlineEditor.field === 'edeprel' || inlineEditor.field === 'deprel') {
          const updatedAnns = { ...t.annotations };
          const currentAnn = updatedAnns[user] || { head: '_', deprel: '_', deps: '_' };
          
          if (inlineEditor.field === 'edeprel') {
            let edeps = parseEdeps(currentAnn.deps);
            if (val === '_') edeps = edeps.filter(e => e.head !== inlineEditor.sourceId);
            else {
              const existing = edeps.find(e => e.head === inlineEditor.sourceId);
              if (existing) existing.deprel = val; else edeps.push({ head: inlineEditor.sourceId, deprel: val });
            }
            updatedAnns[user] = { ...currentAnn, deps: stringifyEdeps(edeps) };
          } else {
            updatedAnns[user] = { ...currentAnn, head: val === '_' ? '_' : inlineEditor.sourceId, deprel: val || '_' };
          }
          tokens[tokenIdx] = { ...t, annotations: updatedAnns };
        } else {
          tokens[tokenIdx] = { ...t, [inlineEditor.field]: val || '_' }; 
        }
        return {};
      });
    };
  
    const getArcPath = (sourceX, targetX, isRoot, stackIndex, isEdep) => {
      const startOffset = isEdep ? 50 : -35, stackSpacing = 10; 
      if (isRoot) return `M ${targetX} ${isEdep ? BASE_Y + MAX_ARC_HEIGHT : 20} L ${targetX} ${BASE_Y + startOffset + (isEdep ? (stackIndex * stackSpacing) : -(stackIndex * stackSpacing))}`;
      const distance = Math.abs(targetX - sourceX), direction = targetX > sourceX ? 1 : -1, heightOffset = Math.min(MAX_ARC_HEIGHT, 30 + (distance * 0.2)); 
      return `M ${sourceX + (direction * 5)} ${BASE_Y + startOffset} C ${sourceX + (direction * 5) + (direction * distance * 0.25)} ${isEdep ? (BASE_Y + 50 + heightOffset) : (BASE_Y - 35 - heightOffset)}, ${targetX} ${isEdep ? (BASE_Y + 50 + heightOffset) : (BASE_Y - 35 - heightOffset)}, ${targetX} ${BASE_Y + startOffset + (isEdep ? (stackIndex * stackSpacing) : -(stackIndex * stackSpacing))}`;
    };
  
    return (
      <div className="relative w-full border border-gray-200 rounded-lg bg-gray-50 shadow-inner overflow-hidden group/graph" onMouseLeave={handleSvgMouseUp} onMouseUp={handleSvgMouseUp} onMouseMove={(e) => updateDragPos(e.clientX, e.clientY, e)}>
        <div className="absolute left-0 top-0 bottom-0 w-12 z-20 opacity-0 group-hover/graph:opacity-100 transition-opacity flex items-center justify-start cursor-pointer" onPointerDown={() => startAutoScroll(-1)} onPointerUp={stopAutoScroll} onPointerLeave={stopAutoScroll} onMouseEnter={() => { if (dragState.active || lassoState.active) startAutoScroll(-1); }} onMouseLeave={stopAutoScroll}><div className="bg-white/90 h-full w-8 shadow-[2px_0_8px_rgba(0,0,0,0.15)] flex items-center justify-center hover:bg-gray-100"><ChevronLeft size={24} className="text-gray-500" /></div></div>
        <div className="absolute right-0 top-0 bottom-0 w-12 z-20 opacity-0 group-hover/graph:opacity-100 transition-opacity flex items-center justify-end cursor-pointer" onPointerDown={() => startAutoScroll(1)} onPointerUp={stopAutoScroll} onPointerLeave={stopAutoScroll} onMouseEnter={() => { if (dragState.active || lassoState.active) startAutoScroll(1); }} onMouseLeave={stopAutoScroll}><div className="bg-white/90 h-full w-8 shadow-[-2px_0_8px_rgba(0,0,0,0.15)] flex items-center justify-center hover:bg-gray-100"><ChevronRight size={24} className="text-gray-500" /></div></div>
  
        <div ref={scrollRef} className="w-full overflow-x-auto hide-scrollbar relative">
          <div className="relative transition-all duration-300" style={{ height: `${svgHeight}px`, width: layout.totalWidth }}>
            <svg ref={containerRef} className="absolute inset-0 select-none w-full h-full" onMouseDown={(e) => { setInlineEditor(null); if (e.shiftKey && features.mwt && !isCompareMode) setLassoState({ active: true, startX: e.clientX - containerRef.current.getBoundingClientRect().left, currentX: e.clientX - containerRef.current.getBoundingClientRect().left }); }}>
            <defs>
              {allArrowColors.map(color => (
                  <marker key={`arrow-${color}`} id={`arrowhead-${color.replace(/[^a-zA-Z0-9]/g, '')}`} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill={color} />
                  </marker>
              ))}
              <marker id="arrowhead-drag" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#ec4899" /></marker>
            </defs>
  
            <rect x="0" y="0" width="100%" height="40" fill="white" fillOpacity="0" className={isCompareMode ? '' : 'cursor-crosshair'} onMouseDown={e => handleRootMouseDown(e, false)} />
            {!isCompareMode && <text x="60" y="25" className="text-[11px] fill-gray-400 font-medium pointer-events-none">Drag from here to assign ROOT</text>}
  
            {showEdepsArea && (
              <><rect x="0" y={svgHeight - 40} width="100%" height="40" fill="white" fillOpacity="0" className={isCompareMode ? '' : 'cursor-crosshair'} onMouseDown={e => handleRootMouseDown(e, true)} />
              {!isCompareMode && <text x="60" y={svgHeight - 15} className="text-[11px] fill-indigo-400/80 font-medium pointer-events-none">Drag from here to assign E-ROOT</text>}</>
            )}
  
            {/* PASS 1: Render all arcs first so they stay in the background under the deprel labels */}
            {[...layout.standardEdges.map(e => ({ ...e, isEdep: false })), ...layout.enhancedEdges.map(e => ({ ...e, isEdep: true }))].map((edge, idx) => {
              const isRoot = edge.source === '0', headNode = layout.nodePositions[edge.source], targetNode = layout.nodePositions[edge.target];
              if (!isRoot && !headNode) return null;
              
              const sourceX = isRoot ? targetNode.x : headNode.x, targetX = targetNode.x;
              const pathD = getArcPath(sourceX, targetX, isRoot, edge.stackIndex, edge.isEdep);

              return (
                <g key={`arc-${edge.isEdep ? 'enh' : 'std'}-${edge.target}-${edge.source}-${idx}`} className="group">
                  <path d={pathD} stroke="transparent" strokeWidth="15" fill="none" />
                  
                  {edge.isUniversal ? (
                      <path d={pathD} stroke="#94a3b8" strokeWidth="1.5" fill="none" markerEnd={`url(#arrowhead-94a3b8)`} className="transition-all duration-200" />
                  ) : (
                      edge.rels.map((relObj, i) => {
                          const arcColor = relObj.color;
                          const dashLength = 10;
                          const gapLength = dashLength * (edge.rels.length - 1);
                          const dashArray = edge.rels.length > 1 ? `${dashLength} ${gapLength}` : 'none';
                          const dashOffset = edge.rels.length > 1 ? `-${i * dashLength}` : '0';

                          return (
                              <path key={`path-${i}`} d={pathD} stroke={arcColor} strokeWidth="1.5" fill="none" strokeDasharray={dashArray} strokeDashoffset={dashOffset} markerEnd={`url(#arrowhead-${arcColor.replace(/[^a-zA-Z0-9]/g, '')})`} className="transition-all duration-200" />
                          );
                      })
                  )}
                </g>
              );
            })}

            {/* PASS 2: Render all labels second so they sit above all arcs and remain clickable */}
            {[...layout.standardEdges.map(e => ({ ...e, isEdep: false })), ...layout.enhancedEdges.map(e => ({ ...e, isEdep: true }))].map((edge, idx) => {
              const isRoot = edge.source === '0', headNode = layout.nodePositions[edge.source], targetNode = layout.nodePositions[edge.target];
              if (!isRoot && !headNode) return null;
              
              const sourceX = isRoot ? targetNode.x : headNode.x, targetX = targetNode.x;
              const textX = isRoot ? targetX + 5 : (sourceX + targetX) / 2;
              const heightOffset = Math.min(MAX_ARC_HEIGHT, 30 + (Math.abs(targetX - sourceX) * 0.2));
              const baseTextY = isRoot ? (edge.isEdep ? BASE_Y + (MAX_ARC_HEIGHT / 2) + 10 : (BASE_Y / 2)) : (edge.isEdep ? BASE_Y + 50 + (heightOffset * 0.75) + 12 : BASE_Y - 35 - (heightOffset * 0.75) - 5);

              return (
                <g key={`labels-${edge.isEdep ? 'enh' : 'std'}-${edge.target}-${edge.source}-${idx}`} className="group">
                  {edge.rels.map((relObj, i) => {
                      const stackOffset = (i - (edge.rels.length - 1) / 2) * 16;
                      const textY = baseTextY + stackOffset;
                      const displayColor = edge.isUniversal ? '#64748b' : relObj.color;

                      return (
                          <g key={`label-${i}`}>
                              <rect x={textX - (relObj.rel.length * 4)} y={textY - 10} width={relObj.rel.length * 8} height="14" fill="#f9fafb" rx="4" className={isCompareMode ? '' : 'cursor-pointer'} onClick={(e) => {
                                  e.stopPropagation();
                                  if (isCompareMode) return;
                                  setInlineEditor({ active: true, type: 'select', field: edge.isEdep ? 'edeprel' : 'deprel', tokenId: edge.target, sourceId: edge.source, value: relObj.rel, x: textX, y: textY, options: edge.isEdep ? tagsets.edeprel : tagsets.deprel });
                              }} />
                              <text x={textX} y={textY} textAnchor="middle" fill={displayColor} className={`text-[11px] font-semibold ${isCompareMode ? '' : 'cursor-pointer hover:font-bold hover:underline'} transition-all`} onClick={(e) => {
                                  e.stopPropagation();
                                  if (isCompareMode) return;
                                  setInlineEditor({ active: true, type: 'select', field: edge.isEdep ? 'edeprel' : 'deprel', tokenId: edge.target, sourceId: edge.source, value: relObj.rel, x: textX, y: textY, options: edge.isEdep ? tagsets.edeprel : tagsets.deprel });
                              }}>{relObj.rel}</text>
                          </g>
                      )
                  })}
                </g>
              );
            })}
  
            {layout.mwts.map(mwt => (
              <g key={`mwt-${mwt.id}`} className="group">
                <rect x={mwt.left} y={mwt.top} width={mwt.width} height="110" stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" fill="transparent" rx="6" className="pointer-events-none" />
                <text x={mwt.left + mwt.width/2} y={mwt.top - 5} textAnchor="middle" className={`text-xs font-semibold fill-gray-500 ${isCompareMode ? '' : 'cursor-text hover:fill-indigo-600'} transition-colors`} onDoubleClick={(e) => openTextEditor(e, mwt, 'form', -70, true)}>{mwt.form}</text>
                {!isCompareMode && (
                  <g onClick={() => handleSaveAction(() => ({ mwts: sentence.mwts.filter(m => m.id !== mwt.id) }))} className="cursor-pointer opacity-70 hover:opacity-100 transition-opacity">
                    <circle cx={mwt.left + mwt.width} cy={mwt.top} r="8" fill="#ef4444" className="hover:fill-red-600" /><text x={mwt.left + mwt.width} y={mwt.top + 3} textAnchor="middle" fill="white" fontSize="9" className="pointer-events-none font-bold">X</text>
                  </g>
                )}
              </g>
            ))}
  
            {dragState.active && (
              <g><path d={(() => { const sY = dragState.sourceId === '0' ? dragState.startY : (dragState.isEdep ? BASE_Y + 50 : BASE_Y - 35); const arcQ = dragState.sourceId === '0' ? (sY + dragState.currentY) / 2 : (dragState.isEdep ? Math.max(sY, dragState.currentY) + 60 : Math.min(sY, dragState.currentY) - 60); return `M ${dragState.startX} ${sY} Q ${(dragState.startX + dragState.currentX) / 2} ${arcQ}, ${dragState.currentX} ${dragState.currentY}`; })()} stroke="#ec4899" strokeWidth="2" strokeDasharray="4 4" fill="none" markerEnd="url(#arrowhead-drag)" className="pointer-events-none" /></g>
            )}
  
            {lassoState.active && <rect x={Math.min(lassoState.startX, lassoState.currentX)} y={BASE_Y - 60} width={Math.abs(lassoState.currentX - lassoState.startX)} height="120" fill="#818cf8" fillOpacity="0.2" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 4" className="pointer-events-none" />}
  
            {layout.nodes.map(node => {
              const isEllipsis = features.ellipsis && String(node.id).includes('.');
              return (
                <g key={`node-${node.id}`} transform={`translate(${node.x}, ${BASE_Y})`} onMouseDown={(e) => handleWordMouseDown(e, node.id)}>
                  {dragState.active && dragState.hoveredTargetId === node.id && <rect x={-(node.width/2) - 10} y={dragState.isEdep ? "-20" : "-45"} width={node.width + 20} height="100" fill="#fbcfe8" opacity="0.4" rx="8" className="pointer-events-none" />}
                  
                  <text y="-15" textAnchor="middle" className={`text-[15px] ${isCompareMode ? '' : 'cursor-text hover:fill-indigo-600 hover:underline'} ${dragState.sourceId === node.id ? 'font-bold fill-pink-600' : (isEllipsis ? 'fill-blue-500 font-medium' : 'fill-gray-900')} transition-colors select-none`} onDoubleClick={(e) => openTextEditor(e, node, 'form', -15)}>{node.form}</text>
                  <text y="5" textAnchor="middle" className={`text-[12px] fill-indigo-600 font-medium select-none ${isCompareMode ? '' : 'cursor-pointer hover:underline'}`} onClick={(e) => openSelectEditor(e, node, 'upos', 5, tagsets.upos)}>{node.upos}</text>
                  <text y="20" textAnchor="middle" className={`text-[11px] fill-teal-600 font-medium select-none ${isCompareMode ? '' : 'cursor-pointer hover:underline'}`} onClick={(e) => openSelectEditor(e, node, 'xpos', 20, tagsets.xpos)}>{node.xpos}</text>
                  <text y="35" textAnchor="middle" className={`text-[11px] fill-gray-500 italic select-none ${isCompareMode ? '' : 'cursor-text hover:underline hover:fill-indigo-500'}`} onDoubleClick={(e) => openTextEditor(e, node, 'lemma', 35)}>{node.lemma}</text>
                  
                  {(features.feats || features.misc) && !isCompareMode && (
                    <g transform="translate(0, 48)" className="cursor-pointer opacity-60 hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setFeaturesModalTokenId(node.id); }}>
                      <rect x="-14" y="-8" width="28" height="14" rx="4" fill="#cbd5e1" /><circle cx="-6" cy="-1" r="1.5" fill="#475569" /><circle cx="0" cy="-1" r="1.5" fill="#475569" /><circle cx="6" cy="-1" r="1.5" fill="#475569" />
                    </g>
                  )}
                </g>
              );
            })}
            </svg>
  
            {inlineEditor && (
              <div className="absolute z-50 flex flex-col shadow-xl bg-white rounded-md border border-indigo-200" style={{ left: inlineEditor.x, top: inlineEditor.y, transform: 'translate(-50%, -50%)', minWidth: inlineEditor.type === 'select' ? '140px' : '100px' }} onMouseDown={(e) => e.stopPropagation()} onMouseMove={(e) => e.stopPropagation()}>
                {inlineEditor.type === 'text' ? (
                  <input type="text" autoFocus defaultValue={inlineEditor.value} className="w-full px-2 py-1 text-sm bg-white text-gray-900 outline-none rounded-md focus:ring-2 focus:ring-indigo-500 font-medium text-center border border-gray-200 shadow-sm" onBlur={(e) => handleSaveInline(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveInline(e.target.value); if (e.key === 'Escape') setInlineEditor(null); }} />
                ) : (
                  <select autoFocus size={6} defaultValue={inlineEditor.value} className="w-full px-1 py-1 text-sm outline-none rounded-md bg-white text-gray-700" onBlur={(e) => handleSaveInline(e.target.value)} onClick={(e) => { if (e.target.tagName === 'OPTION') handleSaveInline(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Escape') setInlineEditor(null); if (e.key === 'Enter') handleSaveInline(e.target.value); }}>
                    <option value="_">_ (remove edge)</option>
                    {[...inlineEditor.options].sort((a, b) => a.localeCompare(b)).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}
              </div>
            )}
  
            {featuresModalTokenId && (
              <FeaturesModal 
                 token={sentence.tokens.find(t => t.id === featuresModalTokenId)}
                 onClose={() => setFeaturesModalTokenId(null)}
                 onSave={(feats, misc) => { handleSaveAction((tokens) => { const idx = tokens.findIndex(t => t.id === featuresModalTokenId); tokens[idx] = { ...tokens[idx], feats, misc }; return {}; }); setFeaturesModalTokenId(null); }}
              />
            )}
          </div>
        </div>
      </div>
    );
  };
  
  const SentenceEditor = ({ sentence, index, isExpanded, onToggle, onUpdateSentence }) => {
    const availableAnns = getAvailableAnns(sentence, defaultAnnotator);
    
    const displayableAnns = useMemo(() => {
        return availableAnns.filter(ann => {
            if (!hasAnnotationData(sentence, ann)) return false;
            if (ann === defaultAnnotator) return true;
            if (!hasAnnotationData(sentence, defaultAnnotator)) return true;

            return sentence.tokens.some(t => {
                const a = t.annotations[ann] || { head: '_', deprel: '_', deps: '_' };
                const d = t.annotations[defaultAnnotator] || { head: '_', deprel: '_', deps: '_' };
                return a.head !== d.head || a.deprel !== d.deprel || a.deps !== d.deps;
            });
        });
    }, [sentence, availableAnns]);

    let activeAnn = perUserMode ? (sentence.activeAnnotator || defaultAnnotator) : defaultAnnotator;
    if (perUserMode && !displayableAnns.includes(activeAnn)) {
        activeAnn = displayableAnns.includes(defaultAnnotator) ? defaultAnnotator : (displayableAnns[0] || defaultAnnotator);
    }

    const showAnnotators = perUserMode && displayableAnns.length > 1;
  
    const [isCompareMode, setIsCompareMode] = useState(false);
    const [compareUsers, setCompareUsers] = useState([]);

    const annotatorColors = useMemo(() => {
        const map = {};
        const palette = COLORS.slice(1);
        displayableAnns.forEach((ann, i) => map[ann] = palette[i % palette.length]);
        return map;
    }, [displayableAnns]);

    useEffect(() => {
        if (isCompareMode && compareUsers.length === 0) {
            setCompareUsers([activeAnn]);
        }
    }, [isCompareMode, activeAnn, compareUsers.length]);

    return (
      <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden transition-all duration-300">
        <div className={`flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors ${isExpanded ? 'border-b border-gray-100 bg-indigo-50/30' : ''}`} onClick={onToggle}>
          <div className="flex items-center gap-3 overflow-hidden">
            <div className={`p-1 rounded-md transition-colors ${isExpanded ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400'}`}>
              {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
            </div>
            <span className="font-mono text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded-md shrink-0">{index + 1}</span>
            <h3 className={`text-base truncate font-medium ${isExpanded ? 'text-indigo-900' : 'text-gray-800'}`}>
              {sentence.text}
            </h3>
          </div>
          
          {showAnnotators && (
            <div className="flex items-center gap-2 ml-auto shrink-0 bg-gray-100 p-1.5 rounded-lg" onClick={e => e.stopPropagation()}>
              {displayableAnns.length > 1 && (
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-600 mr-2 border-r border-gray-300 pr-3 cursor-pointer">
                  <input type="checkbox" checked={isCompareMode} onChange={(e) => {
                    setIsCompareMode(e.target.checked);
                    if (e.target.checked) setCompareUsers([activeAnn]);
                  }} className="rounded text-indigo-600 focus:ring-indigo-500" />
                  Compare
                </label>
              )}

              {displayableAnns.map(ann => {
                const isActive = isCompareMode ? compareUsers.includes(ann) : activeAnn === ann;
                const userColor = annotatorColors[ann] || '#6b7280';
                const style = isCompareMode && isActive 
                    ? { backgroundColor: userColor, color: 'white' } 
                    : (isActive ? { backgroundColor: 'white', color: '#4338ca' } : { color: isCompareMode ? userColor : undefined });

                return (
                   <button
                      key={ann}
                      onClick={(e) => {
                         e.stopPropagation();
                         if (isCompareMode) {
                            setCompareUsers(prev => prev.includes(ann) ? prev.filter(u => u !== ann) : [...prev, ann]);
                         } else {
                            onUpdateSentence({ ...sentence, activeAnnotator: ann }, true);
                         }
                      }}
                      style={style}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${!isActive ? 'hover:bg-gray-200 opacity-70 hover:opacity-100' : 'shadow-sm opacity-100'}`}
                   >
                      {ann}
                   </button>
                )
              })}
            </div>
          )}
        </div>
  
        {isExpanded && (
          <div className="p-4 bg-white animate-in fade-in slide-in-from-top-2 duration-200">
            <DependencyGraph 
               sentence={sentence}
               activeAnn={activeAnn}
               onUpdateSentence={onUpdateSentence} 
               isCompareMode={isCompareMode}
               compareUsers={compareUsers}
               annotatorColors={annotatorColors}
            />
          </div>
        )}
      </div>
    );
  };

  // --- UI Frame ---

  return (
    <div className="h-full bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900 flex flex-col">
      <nav className="bg-indigo-900 text-white shadow-md shrink-0 z-30">
        <div className="w-full px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 p-1.5 rounded-lg border border-white/20">
              <GitBranch size={24} className="text-indigo-300" />
            </div>
            <h1 className="text-lg font-bold tracking-tight"><span className="text-indigo-300 font-light ml-1">GitDOX</span> Dendroid</h1>
            {perUserMode && <span className="bg-indigo-800 text-xs px-2 py-1 rounded ml-4">Editing as: <strong>{currentUser}</strong></span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-indigo-950/50 rounded-lg p-1 mr-4 border border-indigo-800">
              <button onClick={() => setViewMode('editor')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'editor' ? 'bg-indigo-600 text-white shadow-sm' : 'text-indigo-300 hover:text-white hover:bg-white/5'}`}>Tree Editor</button>
              <button onClick={() => { setRawData(exportCoNLLU(sentences, globalPreferredAnnotator, globalAllAnnotators)); setViewMode('conllu'); }} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'conllu' ? 'bg-indigo-600 text-white shadow-sm' : 'text-indigo-300 hover:text-white hover:bg-white/5'}`}>CoNLL-U Source</button>
              <button onClick={() => { setRawData(exportSocialCalc(sentences, globalAllAnnotators)); setViewMode('socialcalc'); }} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'socialcalc' ? 'bg-indigo-600 text-white shadow-sm' : 'text-indigo-300 hover:text-white hover:bg-white/5'}`}>SocialCalc Source</button>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 w-full p-6 overflow-y-auto">
        {viewMode === 'editor' ? (
          <div className="flex flex-col gap-3">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mb-1">
              <button onClick={() => setShowHelp(!showHelp)} className="w-full flex items-center justify-between p-3 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-900 transition-colors focus:outline-none">
                <span className="font-medium text-sm flex items-center gap-2"><Info size={16} className="text-indigo-600" /> Editor Quick Guide</span>
                {showHelp ? <ChevronDown size={18} className="text-indigo-400" /> : <ChevronRight size={18} className="text-indigo-400" />}
              </button>
              {showHelp && (
                <div className="p-4 text-sm text-gray-700 bg-white grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 animate-in fade-in duration-200">
                  <ul className="list-disc pl-5 space-y-1.5" style={{ textAlign: 'left' }}>
                    <li><b>Assign dependencies:</b> Drag governor to dependent to attach.</li>
                    <li><b>Assign root:</b> Drag from the top above a word to set it as the root.</li>
                    {features.edeps && <li><b>Enhanced Dependencies:</b> <span className="text-indigo-600 font-semibold">Hold CTRL</span> while dragging.</li>}
                    {features.mwt && <li><b>Multiword Tokens:</b> <span className="text-blue-500 font-semibold">Hold SHIFT</span> & drag to lasso tokens.</li>}
                  </ul>
                  <ul className="list-disc pl-5 space-y-1.5" style={{ textAlign: 'left' }}>
                    <li><b>Edit Labels:</b> Click on arc labels or POS tags to change them.</li>
                    <li><b>Edit Text:</b> Double-click on words or lemmas to edit them directly.</li>
                  </ul>
                </div>
              )}
            </div>

            {sentences.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                <p className="text-gray-500 mb-4">No sentences loaded.</p>
                <button onClick={() => setViewMode('conllu')} className="px-4 py-2 bg-indigo-50 text-indigo-700 font-medium rounded-lg hover:bg-indigo-100 transition-colors">Import Data</button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 pb-20">
                {sentences.map((sent, idx) => (
                  <SentenceEditor 
                    key={sent.id} sentence={sent} index={idx}
                    isExpanded={expandedIds.has(sent.id)} 
                    onToggle={() => { setExpandedIds(prev => { const next = new Set(prev); if (next.has(sent.id)) next.delete(sent.id); else next.add(sent.id); return next; }); }} 
                    onUpdateSentence={handleUpdateSentence} 
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="font-semibold text-gray-800 flex items-center gap-2"><Upload size={18} className="text-indigo-500" /> {viewMode === 'conllu' ? 'Raw CoNLL-U Data' : 'Raw SocialCalc Data'}</h2>
              </div>
              <div className="flex items-center gap-3">
                 {viewMode === 'conllu' && perUserMode && globalAllAnnotators.length > 1 && (
                    <div className="flex items-center gap-2 mr-4 bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">
                       <Users size={16} className="text-indigo-500" />
                       <span className="text-sm font-medium text-gray-600">Export mode:</span>
                       <select value={globalPreferredAnnotator} onChange={e => { const newMode = e.target.value; setGlobalPreferredAnnotator(newMode); setRawData(exportCoNLLU(sentences, newMode, globalAllAnnotators)); }} className="text-sm border-none bg-transparent font-medium text-indigo-700 outline-none cursor-pointer">
                          <option value="LATEST">Latest Editor (Mixed)</option>
                          {globalAllAnnotators.map(a => <option key={a} value={a}>Force: {a}</option>)}
                       </select>
                    </div>
                 )}
                 <button onClick={applyRawData} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors">Apply & Switch to Visual Editor</button>
              </div>
            </div>
            <textarea value={rawData} onChange={(e) => setRawData(e.target.value)} className="flex-1 w-full p-6 font-mono text-sm leading-relaxed resize-none outline-none focus:ring-inset focus:ring-2 focus:ring-indigo-500 bg-gray-900 text-green-400" spellCheck="false" placeholder={`# Paste ${viewMode} data here...`} />
          </div>
        )}
      </main>
    </div>
  );
}

// --- Demo Wrapper / Testing Data ---

const sampleData = `# newdoc
# newpar
# sent_id = 1
# annotator = Kim
1    This    this    PRON    DT    Number=Sing|PronType=Dem    2    nsubj    2:nsubj|4:nsubj:xsubj    TokenRange=0:4
2    tried    try    VERB    VBD    Mood=Ind|Number=Sing|Person=3|Tense=Past|VerbForm=Fin    0    root    0:root    TokenRange=5:10
3    to    to    PART    TO    _    4    mark    4:mark    TokenRange=11:13
4    present    present    VERB    VB    VerbForm=Inf    2    xcomp    2:xcomp    TokenRange=14:21
5    an    a    DET    DT    Definite=Ind|PronType=Art    6    det    6:det    TokenRange=22:24
6    example    example    NOUN    NN    Number=Sing    4    obj    4:obj    SpaceAfter=No|TokenRange=25:32
7    .    .    PUNCT    .    _    2    punct    2:punct    SpaceAfter=No|TokenRange=32:33


# sent_id = 2
1-2    doesn't    _    _    _    _    _    _    _    _
1    does    do    AUX    VBZ    Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin    3    aux    _    _
2    n't    not    PART    RB    _    3    advmod    _    _
3    require    require    VERB    VB    VerbForm=Inf    0    root    _    _
4    spaces    space    NOUN    NNS    Number=Plur    3    obj    _    SpaceAfter=No
5    .    .    PUNCT    .    _    3    punct    _    _`;

export default function App() {
  return (
    <Dendroid 
      initialData={sampleData} 
      initialFormat="conllu"
      currentUser="Yun"
      defaultAnnotator="Parser"
      perUserMode={true}
      textCol=""
      sentBoundCol="sent_id"
      sentenceAnnotations={['sent_id']}
    />
  );
}
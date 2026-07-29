import {
  assertStateInvariants,
  buildSpannotatorConfig,
  mergeSalienceValues,
  normalizeSalienceValue,
  parseTextToTokens,
  sortByStart,
  sortEntityIds
} from './model.js';

function withInvariantCheck(payload, config) {
  assertStateInvariants({
    tokens: payload.tokens,
    entitiesById: payload.entities,
    groupsByType: payload.groups,
    assignedColors: payload.assignedColors,
    config: buildSpannotatorConfig(config),
    uiState: {
      selectedTokens: new Set(),
      selectedEntities: new Set(),
      dialogs: {}
    }
  }, { throwOnError: true });

  return payload;
}

function randomColor() {
  return `#${Math.floor(Math.random() * 16777215).toString(16)}`;
}

function baseEntity(tokIds, type, defaultAnnos, config) {
  const start = tokIds[0];
  const end = tokIds[tokIds.length - 1];
  const divId = `${start}-${end}`;
  
  const initialGroups = {};
  const initialAntecedents = {};
  const groupTypes = Array.isArray(config?.GROUP_TYPES) ? config.GROUP_TYPES : ['coref'];
  const edgeTypes = Array.isArray(config?.EDGE_TYPES) ? config.EDGE_TYPES : ['bridge'];
  
  groupTypes.forEach(mode => initialGroups[mode] = 0);
  edgeTypes.forEach(mode => {
     initialGroups[mode] = 0;
     initialAntecedents[mode] = '_';
  });

  return {
    type,
    start,
    end,
    toks: tokIds,
    length: end - start + 1,
    div_id: divId,
    annos: { ...defaultAnnos },
    salienceField: true,
    identity: '_',
    bridge_antec: '_',
    antecedents: initialAntecedents,
    next: {},
    groups: initialGroups
  };
}

function isMeaningful(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 && text !== '_';
}

function resolveBridgeSubtypeKey(config) {
  const configured = String(config?.bridgetype || '').trim();
  return configured.length > 0 ? configured : 'bridgetype';
}

function resolveEntityTypeKey(config) {
  const configured = String(config?.entity || '').trim();
  return configured.length > 0 ? configured : 'entity';
}

function resolveSentenceColumnKey(config) {
  const configured = String(config?.sent || '').trim();
  return configured.length > 0 ? configured : 'sentence';
}

function readAnnotationBlocks(config) {
  const configuredAnnotations = config?.annotations && typeof config.annotations === 'object'
    ? config.annotations
    : null;
  const keyBlock = configuredAnnotations?.keys && typeof configuredAnnotations.keys === 'object'
    ? configuredAnnotations.keys
    : {};
  const checkBlock = configuredAnnotations?.checks && typeof configuredAnnotations.checks === 'object'
    ? configuredAnnotations.checks
    : {};
  return { keyBlock, checkBlock };
}

function uniqueNonEmpty(keys) {
  return [...new Set((keys || [])
    .map((key) => String(key || '').trim())
    .filter((key) => key.length > 0))];
}

function resolveCarouselMetadataKeys(config) {
  return uniqueNonEmpty([
    ...(Array.isArray(config?.CAROUSEL_KEYS) ? config.CAROUSEL_KEYS : []),
    ...(Array.isArray(config?.SUMMARY_KEYS) ? config.SUMMARY_KEYS : [])
  ]);
}

function readLegacySummaryMetadata(parsedMetadata = {}) {
  return Object.entries(parsedMetadata || {})
    .map(([key, value]) => {
      const match = String(key || '').trim().match(/^Summary(\d+)$/i);
      if (!match) return null;
      const index = parseInt(match[1], 10) - 1;
      if (index < 0) return null;
      return {
        index,
        key,
        value: String(value ?? '').trim()
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
}

function pickOwnedWebAnnoMetadata(parsedMetadata = {}, config = {}) {
  const carouselKeys = resolveCarouselMetadataKeys(config);
  if (carouselKeys.length > 0) {
    return carouselKeys.reduce((acc, key) => {
      if (Object.prototype.hasOwnProperty.call(parsedMetadata, key)) {
        acc[key] = parsedMetadata[key];
      }
      return acc;
    }, {});
  }

  return readLegacySummaryMetadata(parsedMetadata).reduce((acc, entry) => {
    acc[entry.key] = entry.value;
    return acc;
  }, {});
}

function buildSummariesFromWebAnnoMetadata(parsedMetadata = {}, config = {}) {
  const carouselKeys = resolveCarouselMetadataKeys(config);
  if (carouselKeys.length > 0) {
    return carouselKeys
      .map((key) => String(parsedMetadata?.[key] ?? '').trim())
      .filter((summary) => summary.length > 0);
  }

  return readLegacySummaryMetadata(parsedMetadata)
    .map((entry) => entry.value)
    .filter((summary) => summary.length > 0);
}

function getAnnotationSchema(config) {
  const entityKey = resolveEntityTypeKey(config);
  const bridgeSubtypeKey = resolveBridgeSubtypeKey(config);
  const sentenceKey = resolveSentenceColumnKey(config);
  const { keyBlock, checkBlock } = readAnnotationBlocks(config);
  const hasExplicitEmptyAnnotationKeys = Boolean(
    Array.isArray(config?.annotations?.keys)
    && config.annotations.keys.length === 0
    && Object.keys(config?.annotations?.checks || {}).length === 0
  );

  const keyValueKeys = uniqueNonEmpty(Object.keys(keyBlock).filter((key) => key !== entityKey && key !== sentenceKey && key !== 'char_offset'));
  const checkKeys = uniqueNonEmpty(Object.keys(checkBlock).filter((key) => key !== entityKey && key !== sentenceKey && key !== 'char_offset'));

  const supplementalConfiguredKeys = uniqueNonEmpty([
    ...(Array.isArray(config?.ANNOTATION_KEYS) ? config.ANNOTATION_KEYS : []),
    ...Object.keys(config?.ANNOTATION_KINDS || {}),
    ...Object.keys(config?.CHECK_SETTINGS_BY_KEY || {}),
    ...Object.keys(config?.ANNO_VALUES || {}),
    ...Object.keys(config?.DEFAULT_ANNOS || {})
  ].filter((key) => key !== entityKey && key !== sentenceKey && key !== 'char_offset'));

  const supplementalCheckKeys = uniqueNonEmpty(
    supplementalConfiguredKeys.filter((key) => Boolean(config?.CHECK_SETTINGS_BY_KEY?.[key]))
  );

  const mergedCheckKeys = uniqueNonEmpty([...checkKeys, ...supplementalCheckKeys]);
  const mergedKeyValueKeys = uniqueNonEmpty([
    ...keyValueKeys,
    ...supplementalConfiguredKeys.filter((key) => !mergedCheckKeys.includes(key))
  ]);

  let annotationKeys = uniqueNonEmpty([...mergedKeyValueKeys, ...mergedCheckKeys]);
  if (annotationKeys.length === 0 && !hasExplicitEmptyAnnotationKeys) {
    annotationKeys = uniqueNonEmpty(Object.keys(config?.DEFAULT_ANNOS || {}).filter((key) => key !== entityKey && key !== sentenceKey));
  }

  const salienceKeyConfigured = String(config?.SALIENCE_SETTINGS?.key || '').trim();
  const salienceKey = (salienceKeyConfigured && (mergedCheckKeys.includes(salienceKeyConfigured) || annotationKeys.includes(salienceKeyConfigured)))
    ? salienceKeyConfigured
    : (mergedCheckKeys.length > 0 ? mergedCheckKeys[0] : null);

  return {
    entityKey,
    bridgeSubtypeKey,
    sentenceKey,
    keyValueKeys: mergedKeyValueKeys,
    checkKeys: mergedCheckKeys,
    checkSpecs: checkBlock,
    annotationKeys,
    spanKeys: [entityKey, ...annotationKeys],
    salienceKey
  };
}

function extendSchemaWithEntityAnnotationKeys(schema, entities = {}) {
  const observedKeySet = new Set();
  Object.values(entities || {}).forEach((entity) => {
    Object.entries(entity?.annos || {}).forEach(([key, value]) => {
      if (key === schema.entityKey) return;
      if (key === schema.sentenceKey) return;
      if (key === 'char_offset') return;
      if (!isMeaningful(value)) return;
      observedKeySet.add(String(key || '').trim());
    });
  });
  const observedKeys = uniqueNonEmpty([...observedKeySet]);

  if (observedKeys.length === 0) return schema;

  const annotationKeys = uniqueNonEmpty([...schema.annotationKeys, ...observedKeys]);
  const keyValueKeys = uniqueNonEmpty([...schema.keyValueKeys, ...observedKeys.filter((key) => !schema.checkKeys.includes(key))]);
  const checkKeys = [...schema.checkKeys];

  const salienceKey = schema.salienceKey && annotationKeys.includes(schema.salienceKey)
    ? schema.salienceKey
    : (checkKeys.length > 0 ? checkKeys[0] : null);

  return {
    ...schema,
    annotationKeys,
    keyValueKeys,
    checkKeys,
    spanKeys: [schema.entityKey, ...annotationKeys],
    salienceKey
  };
}

function isCheckAnnotationKey(schema, key) {
  return Boolean(schema?.checkKeys?.includes(key));
}

function normalizeCheckAnnotationValue(rawValue, key, schema, config) {
  const spec = schema?.checkSpecs?.[key];
  if (!Array.isArray(spec) || spec.length < 3) {
    const text = String(rawValue ?? '').trim();
    if (text && text !== '_') return text;
    const fallback = config?.DEFAULT_ANNOS?.[key];
    return fallback == null ? '_' : String(fallback);
  }

  const count = Math.max(parseInt(spec[0], 10) || 0, 1);
  const falseChar = String(spec[1] ?? 'n').charAt(0) || 'n';
  const trueChar = String(spec[2] ?? 's').charAt(0) || 's';
  const defaultValue = falseChar.repeat(count);
  const normalizedRaw = String(rawValue ?? '').trim();
  if (!normalizedRaw || normalizedRaw === '_') return defaultValue;

  let out = '';
  for (let i = 0; i < count; i += 1) {
    const char = normalizedRaw.charAt(i);
    out += (char === trueChar) ? trueChar : falseChar;
  }
  return out;
}

function normalizeAnnotationValueForSchema(key, value, schema, config, fallback = '_') {
  if (isCheckAnnotationKey(schema, key)) {
    return normalizeCheckAnnotationValue(value, key, schema, config);
  }
  const text = String(value ?? '').trim();
  if (text && text !== '_') return text;
  const defaultValue = config?.DEFAULT_ANNOS?.[key];
  if (defaultValue == null) return fallback;
  return String(defaultValue);
}

function readWebAnnoSpanKeysFromConfig(config) {
  return getAnnotationSchema(config).spanKeys;
}

function parseWebAnnoHeader(rawLines, config) {
  const schema = getAnnotationSchema(config);
  const spanKeys = [];

  rawLines.forEach((line) => {
    if (!line.startsWith('#T_SP=')) return;
    if (spanKeys.length > 0) return;
    const payload = line.slice('#T_SP='.length).trim();
    const parts = payload.split('|').map((part) => part.trim());
    if (parts.length <= 1) return;
    parts.slice(1).forEach((key) => {
      if (!key || spanKeys.includes(key)) return;
      spanKeys.push(key);
    });
  });

  const resolvedSpanKeys = spanKeys.length > 0
    ? spanKeys
    : schema.spanKeys;
  const tokenColumnCount = 3;
  const spanColumnByKey = {};
  resolvedSpanKeys.forEach((key, index) => {
    spanColumnByKey[key] = tokenColumnCount + index;
  });

  const entityKey = resolvedSpanKeys.includes(schema.entityKey)
    ? schema.entityKey
    : (resolvedSpanKeys[0] || schema.entityKey);

  const edgeTypeIndex = tokenColumnCount + resolvedSpanKeys.length;
  const edgePathIndex = edgeTypeIndex + 1;

  return {
    spanKeys: resolvedSpanKeys,
    entityKey,
    spanColumnByKey,
    edgeTypeIndex,
    edgePathIndex
  };
}

function parseWebAnnoCellItems(rawValue) {
  return String(rawValue ?? '_')
    .split('|')
    .map((item) => {
      const text = String(item ?? '').trim();
      if (!text) return { raw: '', value: '_', refId: null };
      const match = text.match(/^(.*?)(?:\[(.+?)\])?$/);
      const value = (match?.[1] ?? text).trim() || '_';
      const refId = (match?.[2] ?? '').trim() || null;
      return { raw: text, value, refId };
    });
}

function ConvertWebannoTopology(webannoString, edgeType, targetTopology, config) {
    class UnionFind {
        constructor() { this.parent = {}; }
        find(i) {
            if (this.parent[i] === undefined) this.parent[i] = i;
            if (this.parent[i] === i) return i;
            return this.parent[i] = this.find(this.parent[i]);
        }
        union(i, j) {
            let rootI = this.find(i);
            let rootJ = this.find(j);
            if (rootI !== rootJ) this.parent[rootI] = rootJ;
        }
        getClusters() {
            let clusters = {};
            for (let i in this.parent) {
                let root = this.find(i);
                if (!clusters[root]) clusters[root] = [];
                clusters[root].push(i);
            }
            return Object.values(clusters);
        }
    }

    const lines = webannoString.split(/\r?\n/);
    const header = parseWebAnnoHeader(lines, config);
    const edgeTypeIdx = header.edgeTypeIndex;
    const edgePathIdx = header.edgePathIndex;
    
    const parsedLines = [];
    const spanToFirstToken = {};
    const tokenLinesMap = {};
    const unionFind = new UnionFind();

    // PASS 1: Parse Lines, Map Spans, Extract Edges
    for (const rawLine of lines) {
        if (!/^\d+-\d+\t/.test(rawLine)) {
            parsedLines.push({ isToken: false, rawLine });
            continue;
        }

        const cols = rawLine.split('\t');
        const tokenId = cols[0];
        const edges = [];

        // Isolate span mappings strictly to span columns
        for (let i = 3; i < edgeTypeIdx; i++) {
            if (cols[i] === undefined || cols[i] === '_') continue;
            const matches = cols[i].matchAll(/\[(\d+)\]/g);
            for (const match of matches) {
                const spanId = match[1];
                if (!spanToFirstToken[spanId]) {
                    spanToFirstToken[spanId] = tokenId;
                }
            }
        }

        const typeCol = cols[edgeTypeIdx];
        const targetCol = cols[edgePathIdx];

        if (typeCol && typeCol !== '_' && targetCol && targetCol !== '_') {
            const types = typeCol.split('|');
            const targets = targetCol.split('|');
            for (let i = 0; i < types.length; i++) {
                const type = types[i];
                const targetStr = targets[i];
                const baseType = type.includes(':') ? type.split(':')[0] : type;
                edges.push({ type, targetStr, baseType });

                if (baseType === edgeType) {
                    const edgeMatch = targetStr.match(/\[(\d+)_(\d+)\]/);
                    if (edgeMatch) {
                        unionFind.union(edgeMatch[1], edgeMatch[2]);
                    }
                }
            }
        }

        const lineObj = { isToken: true, rawLine, cols, tokenId, edges, edgeTypeIdx, edgePathIdx };
        parsedLines.push(lineObj);
        tokenLinesMap[tokenId] = lineObj;
    }

    // PASS 2: Re-topologize
    const clusters = unionFind.getClusters();
    const newEdgesList = [];
    const compareTokens = (t1, t2) => {
        const [s1, w1] = t1.split('-').map(Number);
        const [s2, w2] = t2.split('-').map(Number);
        return s1 !== s2 ? s1 - s2 : w1 - w2;
    };

    for (const clusterStr of clusters) {
        const cluster = clusterStr.map(String).sort((a, b) => {
            return compareTokens(spanToFirstToken[a], spanToFirstToken[b]);
        });

        if (cluster.length < 2) continue;

        if (targetTopology === 'chain') {
            for (let i = 1; i < cluster.length; i++) {
                newEdgesList.push({ source: cluster[i], target: cluster[i - 1] });
            }
        } else if (targetTopology === 'star') {
            const source = cluster[cluster.length - 1];
            for (let i = 0; i < cluster.length - 1; i++) {
                newEdgesList.push({ source: source, target: cluster[i] });
            }
        }
    }

    // PASS 3: Rebuild Edge Arrays & Stringify
    for (const line of parsedLines) {
        if (line.isToken) {
            line.edges = line.edges.filter(e => e.baseType !== edgeType);
        }
    }

    for (const newEdge of newEdgesList) {
        const { source, target } = newEdge;
        const targetTokenId = spanToFirstToken[target];
        const sourceTokenId = spanToFirstToken[source];

        const targetLine = tokenLinesMap[targetTokenId];
        if (targetLine) {
            targetLine.edges.push({
                type: edgeType,
                targetStr: `${sourceTokenId}[${source}_${target}]`
            });
        }
    }

    const outputLines = [];
    for (const line of parsedLines) {
        if (!line.isToken) {
            outputLines.push(line.rawLine);
            continue;
        }
        
        while (line.cols.length <= line.edgePathIdx) {
            line.cols.push('_');
        }

        if (line.edges.length === 0) {
            line.cols[line.edgeTypeIdx] = '_';
            line.cols[line.edgePathIdx] = '_';
        } else {
            line.cols[line.edgeTypeIdx] = line.edges.map(e => e.type).join('|');
            line.cols[line.edgePathIdx] = line.edges.map(e => e.targetStr).join('|');
        }
        outputLines.push(line.cols.join('\t'));
    }

    return outputLines.join('\n');
}

export function exportSpannotatorData({ format, tokens, tokensById, entities, groups, summaries, socialcalc, config = {} }) {
  const fmt = format || 'webanno';
  const resolvedConfig = buildSpannotatorConfig(config);
  const schema = extendSchemaWithEntityAnnotationKeys(getAnnotationSchema(resolvedConfig), entities);
  const bridgeSubtypeKey = schema.bridgeSubtypeKey;

  const enabledGroupTypes = Array.isArray(resolvedConfig.GROUP_TYPES) ? resolvedConfig.GROUP_TYPES : ['coref'];
  const enabledEdgeTypes = Array.isArray(resolvedConfig.EDGE_TYPES) ? resolvedConfig.EDGE_TYPES : ['bridge'];

  if (fmt === 'socialcalc') {
    return exportSocialCalc({ tokens, entities, groups, summaries, socialcalc, config: resolvedConfig });
  }

  if (fmt === 'tt') {
    const lines = [];
    for (let tid = 1; tid <= tokens.length; tid += 1) {
      const tok = tokensById[tid];
      if (!tok) continue;

      if (tok.toknum_in_sent === 1) {
        if (tid !== 1) lines.push('</s>');
        lines.push('<s>');
      }

      Object.values(entities)
        .filter((e) => e.start === tid)
        .sort((a, b) => b.end - a.end)
        .forEach((e) => {
          const attrs = [`entity="${e.type}"`];
          schema.annotationKeys.forEach((key) => {
            const value = normalizeAnnotationValueForSchema(key, e.annos?.[key], schema, resolvedConfig, '_');
            attrs.push(`${key}="${value}"`);
          });
          lines.push(`<entity ${attrs.join(' ')}>`);
        });

      lines.push(tok.word);

      Object.values(entities)
        .filter((e) => e.end === tid)
        .sort((a, b) => a.start - b.start)
        .forEach(() => lines.push('</entity>'));
    }
    lines.push('</s>');
    return lines.join('\n');
  }

  const out = [];
  const carouselMetadataKeys = resolveCarouselMetadataKeys(resolvedConfig);
  const socialcalcMeta = socialcalc?.meta && typeof socialcalc.meta === 'object' ? socialcalc.meta : {};
  const configMeta = resolvedConfig?.meta_dict && typeof resolvedConfig.meta_dict === 'object' ? resolvedConfig.meta_dict : {};
  const metaSource = Object.keys(socialcalcMeta).length > 0 ? socialcalcMeta : configMeta;

  let spanKeys = [];
  if (metaSource['__webanno_span_keys']) {
      spanKeys = metaSource['__webanno_span_keys'].split('|');
  } else {
      const edgeSubtypeKeys = new Set([schema.bridgeSubtypeKey]);
      enabledEdgeTypes.forEach(mode => {
          const edgeConf = resolvedConfig.colors?.edges?.[mode] || {};
          Object.keys(edgeConf).filter(k => Array.isArray(edgeConf[k])).forEach(k => edgeSubtypeKeys.add(k));
      });
      spanKeys = schema.spanKeys.filter(k => !edgeSubtypeKeys.has(k));
  }

  // --- NEW: Apply preferred webanno column order ---
  const preferredOrderRaw = resolvedConfig?.entities?.webanno_order || resolvedConfig?.webanno_order || [];
  const preferredOrder = Array.isArray(preferredOrderRaw) ? preferredOrderRaw.map(k => String(k).trim()) : [];
  if (preferredOrder.length > 0) {
      const ordered = [];
      const remaining = new Set(spanKeys);
      
      // 1. Add configured keys in their preferred order
      preferredOrder.forEach(k => {
          if (remaining.has(k)) {
              ordered.push(k);
              remaining.delete(k);
          }
      });
      
      // 2. Append any leftover keys not specified in the config
      spanKeys.forEach(k => {
          if (remaining.has(k)) {
              ordered.push(k);
          }
      });
      spanKeys = ordered;
  }
  // -------------------------------------------------

  out.push('#FORMAT=WebAnno TSV 3.2');
  out.push(`#T_SP=webanno.custom.Referent|${spanKeys.join('|')}`);
  out.push('#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent');

  if (carouselMetadataKeys.length > 0) {
    carouselMetadataKeys.forEach((key, index) => {
      const directValue = String(metaSource?.[key] ?? '').trim();
      const fallbackSummary = String(summaries?.[index] ?? '').trim();
      const value = directValue.length > 0 ? directValue : fallbackSummary;
      if (value.length === 0) return;
      out.push(`#${key}=${value}`);
    });
  } else {
    // Backward compatibility: preserve legacy free-form metadata and SummaryN lines.
    const exportedMeta = { ...(metaSource || {}) };
    Object.keys(exportedMeta).forEach((k) => {
      if (/^Summary\d+$/i.test(k) || k === '__webanno_span_keys') delete exportedMeta[k];
    });

    Object.keys(exportedMeta).sort().forEach((k) => {
      out.push(`#${k}=${exportedMeta[k]}`);
    });

    summaries.forEach((summary, idx) => {
      out.push(`#Summary${idx + 1}=${summary}`);
    });
  }

  const entIds = sortEntityIds(Object.keys(entities));
  const entIndex = {};
  entIds.forEach((id, i) => {
    entIndex[id] = i + 1;
  });

  const maxSent = Math.max(...tokens.map((t) => t.sentnum), 1);
  let currentDocumentOffset = 0;

  for (let sent = 1; sent <= maxSent; sent += 1) {
    const sentTokens = tokens.filter((t) => t.sentnum === sent);
    if (sentTokens.length === 0) continue;
    out.push('');
    out.push(`#Text=${sentTokens.map((t) => t.word).join(' ')}`);

    sentTokens.forEach((tok) => {
      const wordLen = tok.word.length;
      let offsetStr = tok.char_offset;
      if (!offsetStr) {
          offsetStr = `${currentDocumentOffset}-${currentDocumentOffset + wordLen}`;
          currentDocumentOffset += wordLen + 1;
      } else {
          const parts = offsetStr.split('-');
          if (parts.length === 2 && !Number.isNaN(parseInt(parts[1], 10))) {
              currentDocumentOffset = parseInt(parts[1], 10) + 1;
          } else {
              currentDocumentOffset += wordLen + 1;
          }
      }

      const covering = Object.values(entities)
        .filter((e) => e.start <= tok.tid && e.end >= tok.tid)
        .sort((a, b) => (b.end - b.start) - (a.end - a.start));

      const spanCols = spanKeys.map((key) => {
        if (covering.length === 0) return '_';
        return covering.map((e) => {
          let value = '_';
          if (key === schema.entityKey) {
            value = e.type || resolvedConfig.GLOBAL_DEFAULTS.DEFAULT_ENTITY_TYPE;
          } else {
            value = normalizeAnnotationValueForSchema(key, e.annos?.[key], schema, resolvedConfig, '_');
          }
          return `${value}[${entIndex[e.div_id]}]`;
        }).join('|');
      });

      const outEdgeTypes = [];
      const outEdgePaths = [];
      covering.forEach((e) => {
        // Enforce strictly generating edges only at the leading token of the target span
        if (tok.tid !== e.start) return;

        enabledGroupTypes.forEach(mode => {
            const gid = parseInt(e.groups[mode] || 0, 10);
            if (gid > 0) {
              const cluster = sortByStart(groups[mode]?.[gid] || []);
              const idx = cluster.indexOf(e.div_id);
              if (idx > 0) {
                const antecId = cluster[idx - 1];
                const antec = entities[antecId];
                outEdgeTypes.push(mode);
                outEdgePaths.push(`${tokensById[e.start].sentnum}-${tokensById[e.start].toknum_in_sent}[${entIndex[e.div_id]}_${entIndex[antec.div_id]}]`);
              }
            }
        });

        enabledEdgeTypes.forEach(mode => {
            const gid = parseInt(e.groups[mode] || 0, 10);
            if (gid > 0) {
              const antecId = e.antecedents?.[mode] || (mode === 'bridge' ? e.bridge_antec : '_');
              if (antecId && antecId !== '_' && entities[antecId]) {
                const antec = entities[antecId];
                let subtype = 'nobridge';
                if (mode === 'bridge') {
                    subtype = e.annos[bridgeSubtypeKey] || resolvedConfig.DEFAULT_ANNOS[bridgeSubtypeKey] || 'nobridge';
                } else {
                    const edgeConf = resolvedConfig.colors?.edges?.[mode] || {};
                    const typeKeys = Object.keys(edgeConf).filter(k => Array.isArray(edgeConf[k]));
                    if (typeKeys.length > 0) subtype = e.annos[typeKeys[0]] || `no${mode}`;
                }
                outEdgeTypes.push(subtype !== 'nobridge' && !subtype.startsWith('no') ? `${mode}:${subtype}` : mode);
                outEdgePaths.push(`${tokensById[e.start].sentnum}-${tokensById[e.start].toknum_in_sent}[${entIndex[e.div_id]}_${entIndex[antec.div_id]}]`);
              }
            }
        });
      });

      const row = [
        `${tok.sentnum}-${tok.toknum_in_sent}`,
        offsetStr,
        tok.word
      ];
      row.push(...spanCols);
      row.push(
        outEdgeTypes.length > 0 ? outEdgeTypes.join('|') : '_',
        outEdgePaths.length > 0 ? outEdgePaths.join('|') : '_',
        ''
      );

      out.push(row.join('\t'));
    });
  }

  let webannoText = out.join('\n');
  const groupsConf = resolvedConfig?.entities?.colors?.groups || resolvedConfig?.colors?.groups || resolvedConfig?.GROUP_TYPES;
  if (groupsConf && typeof groupsConf === 'object' && !Array.isArray(groupsConf)) {
    for (const [edgeType, topology] of Object.entries(groupsConf)) {
      if (topology === 'chain' || topology === 'star') {
        webannoText = ConvertWebannoTopology(webannoText, edgeType, topology, resolvedConfig);
      }
    }
  }
  return webannoText;
}

function exportSocialCalc({ tokens, entities, groups, socialcalc, config = {} }) {
  const socialcalcModel = socialcalc && typeof socialcalc === 'object' ? socialcalc : null;
  const sheetModel = socialcalcModel?.sheet;
  if (!socialcalcModel?.raw || !sheetModel?.cells) {
    throw new Error('SocialCalc export requires a SocialCalc-backed import model.');
  }
  const resolvedConfig = buildSpannotatorConfig(config);
  // Only operate on explicitly configured Spannotator keys so unrelated spreadsheet
  // columns are preserved verbatim through import/export round-trips.
  const schema = getAnnotationSchema(resolvedConfig);

  const encodeSocialCalcText = (value) => {
    const text = String(value ?? '');
    return text
      .replace(/\\/g, '\\b')
      .replace(/:/g, '\\c')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
  };

  const decodeSocialCalcText = (value) => {
    const text = String(value ?? '');
    return text
      .replace(/\\c/g, ':')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\b/g, '\\');
  };

  const colLettersToNumber = (letters) => {
    const chars = String(letters || '').toUpperCase();
    let n = 0;
    for (let i = 0; i < chars.length; i += 1) {
      n = (n * 26) + (chars.charCodeAt(i) - 64);
    }
    return n;
  };

  const colNumberToLetters = (num) => {
    let n = Number(num);
    if (!Number.isFinite(n) || n < 1) return 'A';

    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };

  const parsedCells = (sheetModel.cells || []).map((cell) => ({
    ...cell,
    attrs: { ...(cell.attrs || {}) }
  }));

  const cellsByRef = {};
  const dataCellPrototypeByCol = {};
  parsedCells.forEach((cell) => {
    cellsByRef[cell.ref] = cell;
    if (cell.row > 1 && !dataCellPrototypeByCol[cell.col]) {
      dataCellPrototypeByCol[cell.col] = {
        type: cell.type || 't',
        attrs: { ...(cell.attrs || {}) }
      };
    }
  });

  const getColumnPrototype = (col) => {
    const existing = dataCellPrototypeByCol[col];
    if (existing) {
      return {
        type: existing.type || 't',
        attrs: { ...existing.attrs }
      };
    }
    return {
      type: 't',
      attrs: { f: '1', tvf: '1' }
    };
  };

  const deleteDataCellsInColumns = (columns) => {
    const set = new Set((columns || []).filter(Boolean));
    if (set.size === 0) return;
    Object.values(cellsByRef).forEach((cell) => {
      if (cell.row <= 1) return;
      if (!set.has(cell.col)) return;
      delete cellsByRef[cell.ref];
    });
  };

  const upsertCell = (col, row, value, rowspan = 1) => {
    if (!col || !Number.isFinite(row) || row < 1) return;
    const ref = `${col}${row}`;
    const existing = cellsByRef[ref];
    const prototype = getColumnPrototype(col);
    const attrs = {
      ...(existing?.attrs || prototype.attrs)
    };
    delete attrs.rowspan;
    if (rowspan > 1) {
      attrs.rowspan = String(rowspan);
    }
    const serialized = encodeSocialCalcText(value);
    const next = {
      ...(existing || {}),
      ref,
      col,
      row,
      colIndex: colLettersToNumber(col),
      type: existing?.type || prototype.type || 't',
      rawValue: serialized,
      value: decodeSocialCalcText(serialized),
      attrs,
      rowspan,
      rowEnd: row + rowspan - 1
    };
    cellsByRef[ref] = next;
  };

  const mappingSource = socialcalcModel.mappings || {};
  const wordCols = [...(mappingSource.wordCols || [])];
  const tokCols = [...(mappingSource.tokCols || [])];
  const sentCols = [...(mappingSource.sentCols || [])];
  const entityCols = [...(mappingSource.entityCols || [])];
  const charOffsetCols = [...(mappingSource.charOffsetCols || [])];
  const annotationColsByKey = {};
  
  schema.annotationKeys.forEach((key) => {
    annotationColsByKey[key] = [...(mappingSource.annotationColsByKey?.[key] || [])];
  });
  if (schema.annotationKeys.includes('infstat') && annotationColsByKey.infstat.length === 0) {
    annotationColsByKey.infstat = [...(mappingSource.infstatCols || [])];
  }
  if (schema.annotationKeys.includes('salience') && annotationColsByKey.salience.length === 0) {
    annotationColsByKey.salience = [...(mappingSource.salienceCols || [])];
  }
  if (schema.annotationKeys.includes(schema.bridgeSubtypeKey) && annotationColsByKey[schema.bridgeSubtypeKey].length === 0) {
    annotationColsByKey[schema.bridgeSubtypeKey] = [...(mappingSource.bridgetypeCols || [])];
  }

  const annotationKeysToWrite = schema.annotationKeys.filter((key) => {
    const existingColumns = annotationColsByKey[key] || [];
    if (existingColumns.length > 0) return true;

    const defaultValue = config?.DEFAULT_ANNOS?.[key];
    return Object.values(entities).some((entity) => {
      const value = entity?.annos?.[key];
      return isMeaningful(value) && String(value) !== String(defaultValue ?? '');
    });
  });

  const enabledGroupTypes = Array.isArray(resolvedConfig.GROUP_TYPES) ? resolvedConfig.GROUP_TYPES : ['coref'];
  const enabledEdgeTypes = Array.isArray(resolvedConfig.EDGE_TYPES) ? resolvedConfig.EDGE_TYPES : ['bridge'];
  const shouldWriteEdgeColumns = Boolean(resolvedConfig.ENABLE_EDGE_COLUMNS) && enabledEdgeTypes.length > 0;

  const groupColsByType = {};
  const antecColsByType = {};
  enabledGroupTypes.forEach(mode => {
      groupColsByType[mode] = [...(mappingSource.groupColsByType?.[mode] || mappingSource[`group${mode.charAt(0).toUpperCase() + mode.slice(1)}Cols`] || [])];
  });
  enabledEdgeTypes.forEach(mode => {
      groupColsByType[mode] = [...(mappingSource.groupColsByType?.[mode] || mappingSource[`group${mode.charAt(0).toUpperCase() + mode.slice(1)}Cols`] || [])];
      antecColsByType[mode] = [...(mappingSource.antecColsByType?.[mode] || mappingSource[`${mode}AntecCols`] || [])];
  });

  const entIdCols = [...(mappingSource.entIdCols || [])];
  const rowToTokenId = socialcalcModel.rowToTokenId || {};
  const tokenRowsByTid = socialcalcModel.tokenRowsByTid || {};

  const primaryWordCol = wordCols[0] || tokCols[0] || null;
  if (!primaryWordCol) {
    throw new Error('SocialCalc export could not resolve the primary token column.');
  }

  const firstMissingToken = tokens.find((tok) => !tokenRowsByTid[tok.tid]?.startRow || !tokenRowsByTid[tok.tid]?.endRow);
  if (firstMissingToken) {
    throw new Error(`SocialCalc export cannot map token ${firstMissingToken.tid} back to sheet rows.`);
  }

  // Keep token rows and rowspans stable to preserve non-Spannotator UI columns in the SocialCalc model
  tokens.forEach((tok) => {
    const rowInfo = tokenRowsByTid[tok.tid];
    const rowspan = (rowInfo.endRow - rowInfo.startRow) + 1;
    upsertCell(primaryWordCol, rowInfo.startRow, tok.word, rowspan);
  });

  const allUsedColumnIndexes = new Set(
    Object.values(cellsByRef)
      .map((cell) => colLettersToNumber(cell.col))
      .filter((idx) => Number.isFinite(idx) && idx > 0)
  );
  let nextAvailableColumnIndex = allUsedColumnIndexes.size > 0
    ? Math.max(...allUsedColumnIndexes) + 1
    : 1;

  const headerByCol = sheetModel.headerByCol || {};

  const createNewColumn = (headerText) => {
    while (allUsedColumnIndexes.has(nextAvailableColumnIndex)) {
      nextAvailableColumnIndex += 1;
    }
    const col = colNumberToLetters(nextAvailableColumnIndex);
    allUsedColumnIndexes.add(nextAvailableColumnIndex);
    nextAvailableColumnIndex += 1;
    upsertCell(col, 1, headerText || 'annotation', 1);
    const headerRef = `${col}1`;
    const headerCell = cellsByRef[headerRef];
    if (headerCell) {
      const headerAttrs = { ...(headerCell.attrs || {}) };
      delete headerAttrs.tvf;
      delete headerAttrs.rowspan;
      headerCell.attrs = {
        ...headerAttrs,
        f: '2',
        bgcolor: '#f3f4f6'
      };
    }
    return col;
  };

  const ensureSlotColumns = (columns, fallbackHeader, slotIdx) => {
    const normalizedFallback = String(fallbackHeader || 'annotation').trim() || 'annotation';
    const preferredHeader = (columns[0] && headerByCol[columns[0]])
      ? String(headerByCol[columns[0]])
      : normalizedFallback;

    while (columns.length <= slotIdx) {
      columns.push(createNewColumn(preferredHeader));
    }
  };

  const ensureAnnotationColumnsForSlot = (slotIdx) => {
    ensureSlotColumns(entityCols, 'entity', slotIdx);
    annotationKeysToWrite.forEach((key) => {
      ensureSlotColumns(annotationColsByKey[key], key, slotIdx);
    });
    
    enabledGroupTypes.forEach(mode => ensureSlotColumns(groupColsByType[mode], `group:${mode}`, slotIdx));
    enabledEdgeTypes.forEach(mode => {
        ensureSlotColumns(groupColsByType[mode], `group:${mode}`, slotIdx);
        ensureSlotColumns(antecColsByType[mode], `${mode}_antec`, slotIdx);
    });
    
    if (shouldWriteEdgeColumns) ensureSlotColumns(entIdCols, 'ent_id', slotIdx);
  };

  const shouldWriteCharOffsetColumn = charOffsetCols.length > 0 || tokens.some((tok) => isMeaningful(tok.char_offset));
  if (shouldWriteCharOffsetColumn && charOffsetCols.length === 0) {
    charOffsetCols.push(createNewColumn('char_offset'));
  }

  deleteDataCellsInColumns([
    ...entityCols,
    ...charOffsetCols,
    ...annotationKeysToWrite.flatMap((key) => annotationColsByKey[key] || []),
    ...Object.values(groupColsByType).flat(),
    ...Object.values(antecColsByType).flat(),
    ...(shouldWriteEdgeColumns ? entIdCols : [])
  ]);

  const sortedEntityIds = Object.keys(entities).sort((a, b) => {
    const ea = entities[a];
    const eb = entities[b];
    if (ea.start !== eb.start) return ea.start - eb.start;
    return eb.end - ea.end;
  });

  const writeSlotValue = (columns, slotIdx, row, value, rowspan = 1) => {
    if (!Array.isArray(columns) || columns.length === 0) return;
    const col = columns[slotIdx] || (columns.length === 1 ? columns[0] : null);
    if (!col) return;
    const text = String(value ?? '');
    if (!text.trim()) return;
    upsertCell(col, row, text, rowspan);
  };

  tokens.forEach((tok) => {
    const rowInfo = tokenRowsByTid[tok.tid];
    writeSlotValue(charOffsetCols, 0, rowInfo.startRow, tok.char_offset || '', 1);
  });

  // Assign entities to the minimal number of parallel slots, always filling leftmost viable slots first
  const slotOccupancyRows = [new Set()];
  const slotByEntityId = {};
  sortedEntityIds.forEach((entityId) => {
    const entity = entities[entityId];
    if (!entity) return;
    const startRow = tokenRowsByTid[entity.start]?.startRow;
    const endRow = tokenRowsByTid[entity.end]?.endRow;
    if (!startRow || endRow === undefined) {
      throw new Error(`SocialCalc export cannot map entity ${entityId} to sheet rows.`);
    }

    const findSlot = () => {
      for (let slotIdx = 0; slotIdx < slotOccupancyRows.length; slotIdx += 1) {
        if (!slotOccupancyRows[slotIdx]) {
          slotOccupancyRows[slotIdx] = new Set();
        }
        const occupied = slotOccupancyRows[slotIdx];
        let hasCollision = false;
        for (let row = startRow; row <= endRow; row += 1) {
          if (occupied.has(row)) {
            hasCollision = true;
            break;
          }
        }
        if (!hasCollision) return slotIdx;
      }
      slotOccupancyRows.push(new Set());
      return slotOccupancyRows.length - 1;
    };

    const chosen = findSlot();
    for (let row = startRow; row <= endRow; row += 1) {
      slotOccupancyRows[chosen].add(row);
    }
    slotByEntityId[entityId] = chosen;
  });

  const requiredSlotCount = Math.max(
    sortedEntityIds.length > 0 ? (Math.max(...Object.values(slotByEntityId)) + 1) : 1,
    1
  );
  for (let slotIdx = 0; slotIdx < requiredSlotCount; slotIdx += 1) {
    ensureAnnotationColumnsForSlot(slotIdx);
  }

  const entityExternalIdByDiv = {
    ...(socialcalcModel.entityExternalIdByDiv || {})
  };
  let maxExternalId = 0;
  Object.values(entityExternalIdByDiv).forEach((externalId) => {
    const n = parseInt(String(externalId || '').trim(), 10);
    if (!Number.isNaN(n)) maxExternalId = Math.max(maxExternalId, n);
  });

  const ensureExternalId = (entityId) => {
    if (entityExternalIdByDiv[entityId]) {
      return String(entityExternalIdByDiv[entityId]);
    }
    maxExternalId += 1;
    entityExternalIdByDiv[entityId] = String(maxExternalId);
    return entityExternalIdByDiv[entityId];
  };

  const sentenceColumnKey = String(resolvedConfig.sent || 'sentence').trim() || 'sentence';
  const expectedSentenceSpans = (() => {
    const bySentence = {};
    tokens.forEach((tok) => {
      const sentnum = parseInt(tok.sentnum, 10);
      if (!Number.isFinite(sentnum)) return;
      if (!bySentence[sentnum]) bySentence[sentnum] = [];
      bySentence[sentnum].push(tok.tid);
    });

    return Object.keys(bySentence)
      .map((sentnumText) => parseInt(sentnumText, 10))
      .sort((a, b) => a - b)
      .map((sentnum) => {
        const tids = [...new Set(bySentence[sentnum])].sort((a, b) => a - b);
        if (tids.length === 0) return null;
        const startRow = tokenRowsByTid[tids[0]]?.startRow;
        const endRow = tokenRowsByTid[tids[tids.length - 1]]?.endRow;
        if (!startRow || !endRow || endRow < startRow) return null;
        return { startRow, endRow, rowspan: (endRow - startRow) + 1 };
      })
      .filter(Boolean);
  })();

  const extractSentenceSpansFromColumn = (col) => {
    if (!col) return [];
    return parsedCells
      .filter((cell) => cell.col === col && cell.row > 1)
      .sort((a, b) => a.row - b.row)
      .map((cell) => ({
        startRow: cell.row,
        endRow: cell.rowEnd || cell.row,
        rowspan: (cell.rowEnd || cell.row) - cell.row + 1
      }));
  };

  const areSentenceSpansEqual = (left, right) => {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i].startRow !== right[i].startRow || left[i].endRow !== right[i].endRow) {
        return false;
      }
    }
    return true;
  };

  let shouldRewriteSentenceSpans = false;
  if (expectedSentenceSpans.length > 0) {
    if (sentCols.length === 0) {
      sentCols.push(createNewColumn(sentenceColumnKey));
      shouldRewriteSentenceSpans = true;
    } else {
      const existingSpans = extractSentenceSpansFromColumn(sentCols[0]);
      shouldRewriteSentenceSpans = !areSentenceSpansEqual(existingSpans, expectedSentenceSpans);
    }
  }

  if (shouldRewriteSentenceSpans) {
    deleteDataCellsInColumns(sentCols);
    expectedSentenceSpans.forEach((span) => {
      writeSlotValue(sentCols, 0, span.startRow, sentenceColumnKey, span.rowspan);
    });
  }

  sortedEntityIds.forEach((entityId) => {
    const entity = entities[entityId];
    if (!entity) return;

    const slotIdx = slotByEntityId[entityId] ?? 0;
    const startRow = tokenRowsByTid[entity.start]?.startRow;
    const endRow = tokenRowsByTid[entity.end]?.endRow;
    if (!startRow || !endRow) return;
    const rowspan = (endRow - startRow) + 1;

    writeSlotValue(entityCols, slotIdx, startRow, entity.type || '', rowspan);
    annotationKeysToWrite.forEach((key) => {
      const value = normalizeAnnotationValueForSchema(key, entity.annos?.[key], schema, resolvedConfig, '');
      writeSlotValue(annotationColsByKey[key], slotIdx, startRow, value, rowspan);
    });

    enabledGroupTypes.forEach(mode => {
       const gid = parseInt(entity.groups?.[mode] || 0, 10);
       if (gid > 0) writeSlotValue(groupColsByType[mode], slotIdx, startRow, String(gid), rowspan);
    });
    
    enabledEdgeTypes.forEach(mode => {
       const gid = parseInt(entity.groups?.[mode] || 0, 10);
       if (gid > 0) writeSlotValue(groupColsByType[mode], slotIdx, startRow, String(gid), rowspan);
       
       const antec = entity.antecedents?.[mode] || (mode === 'bridge' ? entity.bridge_antec : '_');
       if (antec && antec !== '_' && entities[antec]) {
           writeSlotValue(antecColsByType[mode], slotIdx, startRow, ensureExternalId(antec), rowspan);
       }
    });

    if (shouldWriteEdgeColumns) {
      writeSlotValue(entIdCols, slotIdx, startRow, ensureExternalId(entityId), rowspan);
    }
  });

  const trimColumnsToSlots = (columns, count) => {
    while (columns.length < count) {
      ensureSlotColumns(columns, 'annotation', columns.length);
    }
    return columns.slice(0, count);
  };

  const keepColumnsSet = new Set();
  const columnsToDropSet = new Set();

  const markColumns = (columns, count) => {
    const kept = trimColumnsToSlots(columns, count);
    kept.forEach((col) => keepColumnsSet.add(col));
    columns.forEach((col, idx) => {
      if (idx >= count) columnsToDropSet.add(col);
    });
    columns.length = 0;
    kept.forEach((col) => columns.push(col));
  };

  if (shouldWriteCharOffsetColumn) {
    markColumns(charOffsetCols, 1);
  }
  markColumns(entityCols, requiredSlotCount);
  annotationKeysToWrite.forEach((key) => {
    markColumns(annotationColsByKey[key], requiredSlotCount);
  });
  
  enabledGroupTypes.forEach(mode => markColumns(groupColsByType[mode], requiredSlotCount));
  enabledEdgeTypes.forEach(mode => {
      markColumns(groupColsByType[mode], requiredSlotCount);
      markColumns(antecColsByType[mode], requiredSlotCount);
  });
  
  if (shouldWriteEdgeColumns) markColumns(entIdCols, requiredSlotCount);

  keepColumnsSet.forEach((col) => columnsToDropSet.delete(col));

  const droppedIndexes = Array.from(columnsToDropSet)
    .map((col) => colLettersToNumber(col))
    .filter((idx) => Number.isFinite(idx) && idx > 0)
    .sort((a, b) => a - b);

  if (droppedIndexes.length > 0) {
    const droppedSet = new Set(droppedIndexes);
    const remapIndex = (oldIdx) => {
      if (droppedSet.has(oldIdx)) return null;
      let shift = 0;
      for (let i = 0; i < droppedIndexes.length; i += 1) {
        if (droppedIndexes[i] < oldIdx) shift += 1;
      }
      return oldIdx - shift;
    };

    const remappedCellsByRef = {};
    Object.values(cellsByRef).forEach((cell) => {
      const oldIdx = cell.colIndex || colLettersToNumber(cell.col);
      const newIdx = remapIndex(oldIdx);
      if (!newIdx) return;
      const newCol = colNumberToLetters(newIdx);
      const newRef = `${newCol}${cell.row}`;
      remappedCellsByRef[newRef] = {
        ...cell,
        col: newCol,
        colIndex: newIdx,
        ref: newRef
      };
    });

    Object.keys(cellsByRef).forEach((key) => delete cellsByRef[key]);
    Object.entries(remappedCellsByRef).forEach(([ref, cell]) => {
      cellsByRef[ref] = cell;
    });

    const remapColumnsArray = (columns) => {
      const next = columns
        .map((col) => {
          const oldIdx = colLettersToNumber(col);
          const newIdx = remapIndex(oldIdx);
          return newIdx ? colNumberToLetters(newIdx) : null;
        })
        .filter(Boolean);
      columns.length = 0;
      next.forEach((col) => columns.push(col));
    };

    if (shouldWriteCharOffsetColumn) remapColumnsArray(charOffsetCols);
    remapColumnsArray(wordCols);
    remapColumnsArray(tokCols);
    remapColumnsArray(sentCols);
    remapColumnsArray(entityCols);
    annotationKeysToWrite.forEach((key) => remapColumnsArray(annotationColsByKey[key]));
    
    Object.values(groupColsByType).forEach(cols => remapColumnsArray(cols));
    Object.values(antecColsByType).forEach(cols => remapColumnsArray(cols));
    remapColumnsArray(entIdCols);
  }

  const serializeCell = (cell) => {
    const ref = cell.ref || `${cell.col}${cell.row}`;
    const type = cell.type || 't';
    const rawValue = encodeSocialCalcText(cell.value ?? '');
    const parts = [`cell:${ref}:${type}:${rawValue}`];
    const isHeaderRow = cell.row === 1;
    const hasValue = isMeaningful(cell.value);
    let attrs = { ...(cell.attrs || {}) };
    if (isHeaderRow && hasValue) {
      attrs.f = '2';
      attrs.bgcolor = '#f3f4f6';
      delete attrs.tvf;
      delete attrs.rowspan;
    }
    Object.entries(attrs).forEach(([key, value]) => {
      if (value == null || key === '') return;
      parts.push(`${key}:${value}`);
    });
    return parts.join(':');
  };

  const cells = Object.values(cellsByRef).sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    if (a.colIndex !== b.colIndex) return a.colIndex - b.colIndex;
    return String(a.ref).localeCompare(String(b.ref));
  });

  let maxRow = 1;
  let maxCol = 1;
  cells.forEach((cell) => {
    maxRow = Math.max(maxRow, cell.rowEnd || cell.row || 1);
    maxCol = Math.max(maxCol, cell.colIndex || colLettersToNumber(cell.col));
  });

  const sheetMeta = { ...(sheetModel.sheetMeta || {}) };
  sheetMeta.c = String(maxCol);
  sheetMeta.r = String(maxRow);

  const sheetKeys = Object.keys(sheetMeta);
  const normalizedSheetKeys = sheetKeys.length > 0
    ? [...sheetKeys]
    : ['c', 'r', 'tvf'];
  if (!normalizedSheetKeys.includes('c')) normalizedSheetKeys.push('c');
  if (!normalizedSheetKeys.includes('r')) normalizedSheetKeys.push('r');
  if (!normalizedSheetKeys.includes('tvf')) normalizedSheetKeys.push('tvf');
  if (!('tvf' in sheetMeta)) sheetMeta.tvf = '2';
  const sheetLine = `sheet:${normalizedSheetKeys.map((key) => `${key}:${sheetMeta[key] ?? ''}`).join(':')}`;

  const rawLines = String(socialcalcModel.raw || '').split(/\r?\n/);
  const preSheetLines = [];
  const postSheetLines = [];
  const sheetBodyNonCellLines = [];
  let phase = 'pre';

  rawLines.forEach((line) => {
    // Strip all old cell and sheet definitions to prevent infinite duplication
    if (line.startsWith('cell:') || line.startsWith('sheet:')) {
      if (phase === 'pre') phase = 'sheet';
      return;
    }

    if (phase === 'pre') {
      preSheetLines.push(line);
      if (line.startsWith('version:1.5')) {
        phase = 'sheet';
      }
      return;
    }

    if (phase === 'sheet') {
      if (line.startsWith('--SocialCalcSpreadsheetControlSave')) {
        phase = 'post';
        postSheetLines.push(line);
        return;
      }
      sheetBodyNonCellLines.push(line);
      return;
    }

    postSheetLines.push(line);
  });

  // Guarantee required sheet version header exists
  if (!preSheetLines.some(l => l.startsWith('version:1.5'))) {
    preSheetLines.push('version:1.5');
  }

  // Ensure multipart trailers exist
  if (postSheetLines.length === 0) {
    postSheetLines.push('--SocialCalcSpreadsheetControlSave');
    postSheetLines.push('Content-type: text/plain; charset=UTF-8');
    postSheetLines.push('');
    postSheetLines.push('--SocialCalcSpreadsheetControlSave--');
  }

  const outputLines = [
    ...preSheetLines,
    ...cells.map((cell) => serializeCell(cell)),
    sheetLine,
    ...sheetBodyNonCellLines,
    ...postSheetLines
  ];

  return outputLines.join('\n');
}


function importWebAnno(raw, config) {
  const lines = raw.split(/\r?\n/);
  const schema = getAnnotationSchema(config);
  const header = parseWebAnnoHeader(lines, config);
  const bridgeSubtypeKey = schema.bridgeSubtypeKey;
  const parsedTokens = [];
  const parsedMetadata = {};
  const e2tok = {};
  const e2type = {};
  const e2annos = {};
  const sentTok2GlobalTok = {};
  const edges = [];
  const collapseEdges = { appos: 'coref', ana: 'coref', cata: 'coref' };
  let tid = 1;

  lines.forEach((line) => {
    if (line.startsWith('#FORMAT=') || line.startsWith('#T_SP=') || line.startsWith('#T_RL=') || line.startsWith('#Text=')) return;
    
    // Parse WebAnno metadata lines (non-token #key=value pairs)
    if (line.startsWith('#') && line.includes('=')) {
      const match = line.match(/^#([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim();
        parsedMetadata[key] = val;
      }
      return;
    }

    if (!line.includes('\t')) return;
    const fields = line.split('\t');
    if (fields.length < 3) return;
    const sentTok = fields[0].split('-').map(Number);
    if (!Number.isFinite(sentTok[0]) || !Number.isFinite(sentTok[1])) return;
    const word = fields[2];
    const sentTokId = `${sentTok[0]}-${sentTok[1]}`;
    sentTok2GlobalTok[sentTokId] = tid;
    parsedTokens.push({
      tid,
      toknum_in_sent: sentTok[1],
      word,
      char_offset: fields[1],
      sent: sentTok[1] === 1 ? sentTok[0] : null,
      sentnum: sentTok[0],
      sent_tooltip: ''
    });

    const slotItemsByKey = {};
    const slotValuesByKey = {};
    const slotValueByRefByKey = {};
    header.spanKeys.forEach((key) => {
      const colIndex = header.spanColumnByKey[key];
      const rawValue = fields[colIndex] ?? '_';
      const parsedItems = parseWebAnnoCellItems(rawValue);
      slotItemsByKey[key] = parsedItems;
      slotValuesByKey[key] = parsedItems.map((item) => item.raw);
      const byRef = {};
      parsedItems.forEach((item) => {
        if (!item.refId) return;
        if (!isMeaningful(item.value)) return;
        if (!(item.refId in byRef)) {
          byRef[item.refId] = item.value;
        }
      });
      slotValueByRefByKey[key] = byRef;
    });

    const ents = slotItemsByKey[header.entityKey] || [];
    ents.forEach((entItem, idx) => {
      const ent = entItem.raw;
      if (ent === '_') return;
      const type = entItem.value || ent;
      const eid = entItem.refId || sentTokId;
      if (!e2tok[eid]) e2tok[eid] = [];
      e2tok[eid].push(tid);
      e2type[eid] = type;
      if (!e2annos[eid]) e2annos[eid] = { ...config.DEFAULT_ANNOS };

      header.spanKeys.forEach((key) => {
        if (key === header.entityKey) return;
        const valueByRef = slotValueByRefByKey[key] || {};
        const slotValues = slotValuesByKey[key] || [];
        const parsedValue = valueByRef[eid] ?? slotValues[idx]?.split('[')?.[0];
        if (!isMeaningful(parsedValue)) return;
        e2annos[eid][key] = normalizeAnnotationValueForSchema(key, parsedValue, schema, config, '_');
      });
    });

    const edgeTypeCol = fields[header.edgeTypeIndex] ?? '_';
    const edgePathCol = fields[header.edgePathIndex] ?? '_';

    if (edgeTypeCol && edgeTypeCol !== '_' && edgePathCol && edgePathCol !== '_') {
      const types = edgeTypeCol.split('|');
      const paths = edgePathCol.split('|');
      types.forEach((rawType, idx) => {
        if (!rawType) return;
        const rawPath = paths[idx];
        if (!rawPath) return;

        let edgeType = rawType;
        let subtype = null;
        if (edgeType.includes(':')) {
          const typeParts = edgeType.split(':');
          edgeType = typeParts[0];
          subtype = typeParts.slice(1).join(':');
        }
        if (collapseEdges[edgeType]) edgeType = collapseEdges[edgeType];

        const withFallback = rawPath.includes('[') ? rawPath : `${rawPath}[0_0]`;
        const pathParts = withFallback.split('[');
        const sentTokRef = pathParts[0];
        const pairPart = (pathParts[1] || '0_0').replace(']', '');
        const pair = pairPart.split('_');
        let src = pair[0] || '0';
        let trg = pair[1] || '0';

        if (src === '0') src = sentTokRef;
        if (trg === '0') trg = fields[0];

        edges.push({
          type: edgeType,
          subtype,
          src,
          trg
        });
      });
    }

    tid += 1;
  });

  const newEntities = {};
  const entIdToDiv = {};
  Object.keys(e2tok).forEach((eid) => {
    const tokIds = e2tok[eid].sort((a, b) => a - b);
    const entity = baseEntity(
      tokIds,
      e2type[eid] || config.GLOBAL_DEFAULTS.DEFAULT_ENTITY_TYPE,
      { ...config.DEFAULT_ANNOS, ...(e2annos[eid] || {}) },
      config
    );
    entIdToDiv[eid] = entity.div_id;
    newEntities[entity.div_id] = entity;
  });

  const resolveEdgeRefToDivId = (ref) => {
    if (!ref) return null;
    if (entIdToDiv[ref]) return entIdToDiv[ref];
    if (ref.includes('-') && sentTok2GlobalTok[ref]) {
      const gtok = sentTok2GlobalTok[ref];
      const singletonId = `${gtok}-${gtok}`;
      if (newEntities[singletonId]) return singletonId;
    }
    return null;
  };

  const groupTypes = Array.isArray(config.GROUP_TYPES) ? config.GROUP_TYPES : ['coref'];
  const edgeTypes = Array.isArray(config.EDGE_TYPES) ? config.EDGE_TYPES : ['bridge'];

  // Group-type edges: flat clustering via union-find only, no antecedent tracking.
  // Edge-type edges: union-find PLUS per-entity antecedent assignment.
  // Kept separate so a star-topology input (one source entity pointing to N targets)
  // cannot accidentally overwrite earlier antecedents when collecting group-type edges.
  const groupTypeEdges = {};
  const edgeTypeEdges = {};
  edges.forEach((e) => {
    const srcDiv = resolveEdgeRefToDivId(e.src);
    const trgDiv = resolveEdgeRefToDivId(e.trg);
    if (!srcDiv || !trgDiv) return;

    if (groupTypes.includes(e.type)) {
      // Pure union-find clustering only — no antecedents assigned for group types.
      if (!groupTypeEdges[e.type]) groupTypeEdges[e.type] = [];
      groupTypeEdges[e.type].push({ srcDiv, trgDiv });
    } else if (edgeTypes.includes(e.type)) {
      if (!edgeTypeEdges[e.type]) edgeTypeEdges[e.type] = [];
      edgeTypeEdges[e.type].push({ srcDiv, trgDiv, subtype: e.subtype });
      // For edge types, the last edge from a given source wins as its antecedent.
      newEntities[srcDiv].antecedents[e.type] = trgDiv;
      if (e.type === 'bridge') {
        newEntities[srcDiv].bridge_antec = trgDiv;
        if (e.subtype) newEntities[srcDiv].annos[bridgeSubtypeKey] = e.subtype;
      } else if (e.subtype) {
        const edgeConf = config.colors?.edges?.[e.type] || {};
        const typeKeys = Object.keys(edgeConf).filter(k => Array.isArray(edgeConf[k]));
        if (typeKeys.length > 0) newEntities[srcDiv].annos[typeKeys[0]] = e.subtype;
      }
    }
  });

  const entityIds = Object.keys(newEntities);
  const nextGroups = {};
  const nextAssigned = {};
  groupTypes.forEach(mode => { nextGroups[mode] = { 0: [...entityIds] }; nextAssigned[mode] = { 0: config.GLOBAL_DEFAULTS.DEFAULT_COLOR }; });
  edgeTypes.forEach(mode => { nextGroups[mode] = { 0: [...entityIds] }; nextAssigned[mode] = { 0: config.GLOBAL_DEFAULTS.DEFAULT_COLOR }; });

  const buildGroupsForType = (groupType, edgeMap) => {
    const typedEdges = edgeMap[groupType] || [];
    if (typedEdges.length === 0) return;

    const parent = {};
    const rank = {};
    entityIds.forEach((id) => {
      parent[id] = id;
      rank[id] = 0;
    });

    const find = (x) => {
      if (parent[x] !== x) parent[x] = find(parent[x]);
      return parent[x];
    };

    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return;
      if (rank[ra] < rank[rb]) parent[ra] = rb;
      else if (rank[ra] > rank[rb]) parent[rb] = ra;
      else {
        parent[rb] = ra;
        rank[ra] += 1;
      }
    };

    typedEdges.forEach(({ srcDiv, trgDiv }) => union(srcDiv, trgDiv));

    const components = {};
    entityIds.forEach((id) => {
      const r = find(id);
      if (!components[r]) components[r] = [];
      components[r].push(id);
    });

    let gid = 1;
    Object.values(components)
      .filter((members) => members.length > 1)
      .forEach((members) => {
        const sortedMembers = sortByStart(members);
        nextGroups[groupType][gid] = sortedMembers;
        sortedMembers.forEach((id) => {
          newEntities[id].groups[groupType] = gid;
        });
        nextAssigned[groupType][gid] = config.COREF_COLORS[gid - 1] || randomColor();
        gid += 1;
      });

    nextGroups[groupType][0] = nextGroups[groupType][0].filter((id) => newEntities[id].groups[groupType] === 0);
  };

  groupTypes.forEach(mode => buildGroupsForType(mode, groupTypeEdges));
  edgeTypes.forEach(mode => buildGroupsForType(mode, edgeTypeEdges));

  const primaryGroup = groupTypes[0] || 'coref';
  Object.entries(nextGroups[primaryGroup] || {}).forEach(([gid, members]) => {
    if (parseInt(gid, 10) > 0 && members.length > 1) {
      const salienceKey = schema.salienceKey;
      if (!salienceKey) return;
      const merged = mergeSalienceValues(members.map((id) => newEntities[id]?.annos?.[salienceKey]), config);
      members.forEach((id) => {
        if (!newEntities[id]) return;
        newEntities[id].annos[salienceKey] = merged;
        newEntities[id].salienceField = true;
      });
    }
  });

  const ownedMetadata = pickOwnedWebAnnoMetadata(parsedMetadata, config);
  const parsedSummaries = buildSummariesFromWebAnnoMetadata(parsedMetadata, config);
  
  parsedMetadata['__webanno_span_keys'] = header.spanKeys.join('|');
  ownedMetadata['__webanno_span_keys'] = header.spanKeys.join('|');

  return {
    tokens: parsedTokens,
    entities: newEntities,
    groups: nextGroups,
    assignedColors: nextAssigned,
    summaries: parsedSummaries,
    metadata: parsedMetadata,
    metadataOwned: ownedMetadata
  };
}

function parseEntityTag(line) {
  const attrs = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(line)) != null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function readConfiguredTokenContainer(config) {
  const name = String(config?.annotation || '').trim();
  return name.length > 0 ? name : null;
}

function importTT(raw, config) {
  const schema = getAnnotationSchema(config);
  const lines = raw.split(/\r?\n/);
  const tokens = [];
  const entities = {};
  const groups = {};
  const assignedColors = {};
  
  const groupTypes = Array.isArray(config.GROUP_TYPES) ? config.GROUP_TYPES : ['coref'];
  const edgeTypes = Array.isArray(config.EDGE_TYPES) ? config.EDGE_TYPES : ['bridge'];
  groupTypes.forEach(mode => { groups[mode] = { 0: [] }; assignedColors[mode] = { 0: config.GLOBAL_DEFAULTS.DEFAULT_COLOR }; });
  edgeTypes.forEach(mode => { groups[mode] = { 0: [] }; assignedColors[mode] = { 0: config.GLOBAL_DEFAULTS.DEFAULT_COLOR }; });

  const stack = [];
  let tid = 1;
  let sentnum = 1;
  let toknumInSent = 0;
  let sentenceHasTokens = false;
  const tokenContainerName = readConfiguredTokenContainer(config);
  const tokenContainerAttr = String(config?.tok || config?.word || '').trim();
  const tokenContainerOpenRegex = tokenContainerName
    ? new RegExp(`^<${tokenContainerName}\\b`, 'i')
    : null;
  const tokenContainerCloseRegex = tokenContainerName
    ? new RegExp(`^</${tokenContainerName}>`, 'i')
    : null;
  let tokenContainerDepth = 0;
  let tokenContainerTextParts = [];
  let tokenContainerIgnoreDepth = 0;

  const startSentence = () => {
    if (sentenceHasTokens) sentnum += 1;
    toknumInSent = 0;
    sentenceHasTokens = false;
  };

  const emitToken = (tokenText) => {
    const text = String(tokenText ?? '').trim();
    if (!text) return;

    toknumInSent += 1;
    sentenceHasTokens = true;

    tokens.push({
      tid,
      toknum_in_sent: toknumInSent,
      word: text,
      sent: toknumInSent === 1 ? sentnum : null,
      sentnum,
      sent_tooltip: ''
    });

    stack.forEach((openEntity) => openEntity.tokIds.push(tid));
    tid += 1;
  };

  const flushTokenContainer = () => {
    if (tokenContainerDepth !== 0) return;
    if (tokenContainerTextParts.length === 0) return;
    const merged = tokenContainerTextParts.join(' ').replace(/\s+/g, ' ').trim();
    tokenContainerTextParts = [];
    if (merged) emitToken(merged);
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    if (/^<s\b/i.test(line)) {
      startSentence();
      return;
    }

    if (/^<\/s>/i.test(line)) {
      return;
    }

    if (/^<entity\b/i.test(line)) {
      const attrs = parseEntityTag(line);
      const annos = { ...config.DEFAULT_ANNOS };
      schema.annotationKeys.forEach((key) => {
        const rawValue = attrs[key] ?? config.DEFAULT_ANNOS?.[key];
        annos[key] = normalizeAnnotationValueForSchema(key, rawValue, schema, config, '_');
      });
      stack.push({
        type: attrs.entity || config.GLOBAL_DEFAULTS.DEFAULT_ENTITY_TYPE,
        annos,
        tokIds: []
      });
      return;
    }

    if (/^<\/entity>/i.test(line)) {
      const closed = stack.pop();
      if (!closed || closed.tokIds.length === 0) return;
      const divId = `${closed.tokIds[0]}-${closed.tokIds[closed.tokIds.length - 1]}`;
      if (!entities[divId]) {
        entities[divId] = baseEntity(closed.tokIds, closed.type, closed.annos, config);
      }
      return;
    }

    if (tokenContainerOpenRegex && tokenContainerOpenRegex.test(line)) {
      const attrs = parseEntityTag(line);
      const configuredAttrValue = tokenContainerAttr ? String(attrs[tokenContainerAttr] || '').trim() : '';
      const fallbackWordAttr = String(attrs.word || '').trim();
      const fallbackTokAttr = String(attrs.tok || '').trim();
      const attrToken = configuredAttrValue || fallbackWordAttr || fallbackTokAttr;

      if (attrToken) {
        emitToken(attrToken);
      }

      const closesInline = tokenContainerCloseRegex ? tokenContainerCloseRegex.test(line) : false;
      if (!closesInline) {
        if (attrToken) {
          tokenContainerIgnoreDepth += 1;
        } else {
          tokenContainerDepth += 1;
          tokenContainerTextParts = [];
        }
      }
      return;
    }

    if (tokenContainerIgnoreDepth > 0) {
      if (tokenContainerOpenRegex && tokenContainerOpenRegex.test(line)) {
        tokenContainerIgnoreDepth += 1;
        return;
      }

      if (tokenContainerCloseRegex && tokenContainerCloseRegex.test(line)) {
        tokenContainerIgnoreDepth = Math.max(tokenContainerIgnoreDepth - 1, 0);
      }
      return;
    }

    if (tokenContainerDepth > 0) {
      if (tokenContainerOpenRegex && tokenContainerOpenRegex.test(line)) {
        tokenContainerDepth += 1;
        return;
      }

      if (tokenContainerCloseRegex && tokenContainerCloseRegex.test(line)) {
        tokenContainerDepth = Math.max(tokenContainerDepth - 1, 0);
        flushTokenContainer();
        return;
      }

      if (!/^<[^>]+>$/.test(line)) {
        tokenContainerTextParts.push(line);
      }
      return;
    }

    if (/^<[^>]+>$/.test(line)) {
      return;
    }

    emitToken(line);
  });

  Object.keys(entities).forEach((entityId) => {
    groupTypes.forEach(mode => groups[mode][0].push(entityId));
    edgeTypes.forEach(mode => groups[mode][0].push(entityId));
  });

  return { tokens, entities, groups, assignedColors, summaries: [] };
}

export function importSpannotatorData(rawInput, configOverrides = {}) {
  const config = buildSpannotatorConfig(configOverrides);
  const raw = (rawInput || '').trim();

  const groupTypes = Array.isArray(config.GROUP_TYPES) ? config.GROUP_TYPES : ['coref'];
  const edgeTypes = Array.isArray(config.EDGE_TYPES) ? config.EDGE_TYPES : ['bridge'];
  const initialGroups = {};
  const initialColors = {};
  groupTypes.forEach(mode => { initialGroups[mode] = { 0: [] }; initialColors[mode] = { 0: config.GLOBAL_DEFAULTS.DEFAULT_COLOR }; });
  edgeTypes.forEach(mode => { initialGroups[mode] = { 0: [] }; initialColors[mode] = { 0: config.GLOBAL_DEFAULTS.DEFAULT_COLOR }; });

  if (!raw) {
    return withInvariantCheck({
      tokens: parseTextToTokens(''),
      entities: {},
      groups: initialGroups,
      assignedColors: initialColors,
      summaries: []
    }, config);
  }

  if (raw.includes('#FORMAT=WebAnno')) {
    let processedRaw = raw;
    const groupsConf = config?.entities?.colors?.groups || config?.colors?.groups || config?.GROUP_TYPES;
    if (groupsConf && typeof groupsConf === 'object' && !Array.isArray(groupsConf)) {
      for (const [edgeType, topology] of Object.entries(groupsConf)) {
        if (topology === 'chain' || topology === 'star') {
          processedRaw = ConvertWebannoTopology(processedRaw, edgeType, topology, config);
        }
      }
    }

    const webAnnoResult = importWebAnno(processedRaw, config);
    const incomingOwnedMeta = webAnnoResult?.metadataOwned && typeof webAnnoResult.metadataOwned === 'object'
      ? webAnnoResult.metadataOwned
      : {};
    
    if (config.socialcalc) {
      const sc = config.socialcalc;
      let scTokenCount = 0;
      if (sc.tokenRowsByTid) {
        scTokenCount = Object.keys(sc.tokenRowsByTid).length;
      } else if (sc.sheet?.cells) {
        const wordCols = sc.mappings?.wordCols || sc.mappings?.tokCols || [];
        const primaryWordCol = wordCols[0];
        if (primaryWordCol) {
          const colCells = sc.sheet.cells.filter(c => c.col === primaryWordCol && c.row > 1);
          scTokenCount = colCells.length;
        }
      }
      
      if (scTokenCount > 0 && scTokenCount === webAnnoResult.tokens.length) {
        // Merge only Spannotator-owned keys over existing spreadsheet metadata.
        const nextMeta = { ...(sc.meta || {}) };
        Object.assign(nextMeta, incomingOwnedMeta);
        
        webAnnoResult.socialcalc = {
          ...sc,
          meta: nextMeta
        };
      } else if (scTokenCount > 0) {
        console.warn(`WebAnno import token count (${webAnnoResult.tokens.length}) does not match existing spreadsheet token count (${scTokenCount}). Existing spreadsheet columns will not be merged.`);
      }
    }

    return withInvariantCheck(webAnnoResult, config);
  }

  const configuredTokenContainer = readConfiguredTokenContainer(config);
  const hasConfiguredTokenContainerTag = configuredTokenContainer
    ? new RegExp(`<${configuredTokenContainer}\\b|</${configuredTokenContainer}>`, 'i').test(raw)
    : false;
  const hasGenericSgmlLineTags = /^\s*<[^>]+>\s*$/m.test(raw);

  if (raw.includes('<entity') || raw.includes('<s>') || hasConfiguredTokenContainerTag || hasGenericSgmlLineTags) {
    return withInvariantCheck(importTT(raw, config), config);
  }

  if (raw.includes('SocialCalcSpreadsheetControlSave') || /^\s*socialcalc:version:/im.test(raw) || /^\s*cell:[A-Z]+\d+:/m.test(raw)) {
    const socialcalcMeta = configOverrides?.meta_dict || configOverrides?.socialcalcMeta || {};
    return withInvariantCheck(importSocialCalc(raw, socialcalcMeta, config), config);
  }

  return withInvariantCheck({
    tokens: parseTextToTokens(raw),
    entities: {},
    groups: initialGroups,
    assignedColors: initialColors,
    summaries: []
  }, config);
}

function importSocialCalc(raw, meta_dict, config) {
  const lines = (raw || '').split(/\r?\n/);
  const safeMeta = meta_dict && typeof meta_dict === 'object' ? meta_dict : {};
  const schema = getAnnotationSchema(config);

  const decodeSocialCalcText = (value) => {
    const text = String(value ?? '');
    return text
      .replace(/\\c/g, ':')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\b/g, '\\');
  };

  const parseCellRef = (ref) => {
    const match = String(ref || '').match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;
    return {
      col: match[1],
      row: parseInt(match[2], 10)
    };
  };

  const colLettersToNumber = (letters) => {
    const chars = String(letters || '').toUpperCase();
    let n = 0;
    for (let i = 0; i < chars.length; i += 1) {
      n = (n * 26) + (chars.charCodeAt(i) - 64);
    }
    return n;
  };

  const normalizeHeaderKey = (value) => decodeSocialCalcText(value).trim().toLowerCase();

  const parsedCells = [];
  const cellsByRef = {};
  const cellsByCol = {};
  const headerByCol = {};
  const columnsByHeader = {};
  const nonCellLines = [];
  const sheetMeta = {};

  let maxRow = 1;
  let maxCol = 1;

  lines.forEach((line, lineIndex) => {
    if (line.startsWith('cell:')) {
      const parts = line.split(':');
      if (parts.length < 4) {
        nonCellLines.push({ lineIndex, line });
        return;
      }

      const ref = parts[1] || '';
      const refParts = parseCellRef(ref);
      if (!refParts) {
        nonCellLines.push({ lineIndex, line });
        return;
      }

      const cellType = parts[2] || '';
      const rawValue = parts[3] || '';
      const attrs = {};
      for (let i = 4; i < parts.length; i += 2) {
        const key = parts[i];
        const value = parts[i + 1] ?? '';
        if (!key) continue;
        attrs[key] = value;
      }

      const rowspan = Math.max(parseInt(attrs.rowspan || '1', 10) || 1, 1);
      const cell = {
        lineIndex,
        rawLine: line,
        ref,
        col: refParts.col,
        row: refParts.row,
        colIndex: colLettersToNumber(refParts.col),
        type: cellType,
        rawValue,
        value: decodeSocialCalcText(rawValue),
        attrs,
        rowspan,
        rowEnd: refParts.row + rowspan - 1
      };

      parsedCells.push(cell);
      cellsByRef[ref] = cell;
      if (!cellsByCol[cell.col]) cellsByCol[cell.col] = [];
      cellsByCol[cell.col].push(cell);

      maxRow = Math.max(maxRow, cell.rowEnd);
      maxCol = Math.max(maxCol, cell.colIndex);
      return;
    }

    if (line.startsWith('sheet:')) {
      const parts = line.split(':');
      for (let i = 1; i < parts.length; i += 2) {
        const key = parts[i];
        const value = parts[i + 1] ?? '';
        if (!key) continue;
        sheetMeta[key] = value;
      }
    }

    nonCellLines.push({ lineIndex, line });
  });

  Object.keys(cellsByCol).forEach((col) => {
    cellsByCol[col].sort((a, b) => a.row - b.row);
  });

  Object.values(cellsByRef)
    .filter((cell) => cell.row === 1)
    .forEach((cell) => {
      const key = normalizeHeaderKey(cell.value);
      if (!key) return;
      headerByCol[cell.col] = cell.value;
      if (!columnsByHeader[key]) columnsByHeader[key] = [];
      columnsByHeader[key].push(cell.col);
    });

  Object.keys(columnsByHeader).forEach((key) => {
    columnsByHeader[key].sort((a, b) => colLettersToNumber(a) - colLettersToNumber(b));
  });

  const getEffectiveCell = (col, row) => {
    if (!col || !row) return null;
    const exact = cellsByRef[`${col}${row}`];
    if (exact) return exact;

    const colCells = cellsByCol[col] || [];
    let left = 0;
    let right = colCells.length - 1;
    let candidate = null;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const cell = colCells[mid];
      if (cell.row <= row) {
        candidate = cell;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    if (!candidate) return null;
    return candidate.rowEnd >= row ? candidate : null;
  };

  const resolveColumns = (settingKey, fallbackHeader, options = {}) => {
    const { allowColumnLetters = true } = options;
    const resolveFromCandidates = (candidates) => {
      const resolved = [];
      (candidates || []).forEach((candidate) => {
        const text = String(candidate || '').trim();
        if (!text) return;

        const maybeCol = text.toUpperCase();
        if (allowColumnLetters && /^[A-Z]+$/.test(maybeCol) && cellsByCol[maybeCol]) {
          resolved.push(maybeCol);
        }

        const key = normalizeHeaderKey(text);
        (columnsByHeader[key] || []).forEach((col) => resolved.push(col));
      });

      return [...new Set(resolved)].sort((a, b) => colLettersToNumber(a) - colLettersToNumber(b));
    };

    const requested = [];
    const configured = config?.[settingKey];

    if (Array.isArray(configured)) {
      requested.push(...configured);
    } else if (typeof configured === 'string' && configured.trim()) {
      requested.push(configured);
    }

    if (requested.length === 0 && fallbackHeader) {
      requested.push(fallbackHeader);
    }

    return resolveFromCandidates(requested);
  };

  const readSlotValue = (columns, slotIdx, row, options = {}) => {
    const {
      allowMerged = true,
      allowSingleColumnFallback = true
    } = options;

    if (!columns || columns.length === 0) return '';
    let col = columns[slotIdx];
    if (!col && allowSingleColumnFallback && columns.length === 1) {
      col = columns[0];
    }
    if (!col) return '';

    const cell = allowMerged
      ? getEffectiveCell(col, row)
      : (cellsByRef[`${col}${row}`] || null);
    return cell?.value || '';
  };

  const parseGroupValue = (value) => {
    const text = String(value ?? '').trim();
    if (!text || text === '_' || text === '0') return null;
    return text;
  };

  const wordCols = resolveColumns('word', 'word');
  const tokCols = resolveColumns('tok', 'tok');
  const resolveSentenceColumns = () => {
    const configuredSent = resolveColumns('sent', null);
    if (configuredSent.length > 0) return configuredSent;

    const sentenceFallbackHeaders = ['sent', 'sentence', 's', 's_type', 'translation', 'verse', 'verse_n'];
    const fallbackCols = [];
    sentenceFallbackHeaders.forEach((headerName) => {
      const cols = resolveColumns(null, headerName, { allowColumnLetters: false });
      cols.forEach((col) => fallbackCols.push(col));
    });

    return [...new Set(fallbackCols)].sort((a, b) => colLettersToNumber(a) - colLettersToNumber(b));
  };

  const sentCols = resolveSentenceColumns();
  const enabledGroupTypes = Array.isArray(config.GROUP_TYPES) ? config.GROUP_TYPES : ['coref'];
  const enabledEdgeTypes = Array.isArray(config.EDGE_TYPES) ? config.EDGE_TYPES : ['bridge'];

  const entityCols = resolveColumns('entity', schema.entityKey);
  const charOffsetCols = resolveColumns('char_offset', 'char_offset');
  const annotationColsByKey = {};
  const annotationKeysForSocialcalc = [...schema.annotationKeys];
  schema.annotationKeys.forEach((key) => {
    annotationColsByKey[key] = resolveColumns(key, key);
  });
  if (schema.annotationKeys.includes('infstat') && annotationColsByKey.infstat.length === 0) {
    annotationColsByKey.infstat = resolveColumns('infstat', 'infstat');
  }
  if (schema.annotationKeys.includes('salience') && annotationColsByKey.salience.length === 0) {
    annotationColsByKey.salience = resolveColumns('salience', 'salience');
  }
  if (schema.annotationKeys.includes(schema.bridgeSubtypeKey) && annotationColsByKey[schema.bridgeSubtypeKey].length === 0) {
    annotationColsByKey[schema.bridgeSubtypeKey] = resolveColumns('bridgetype', 'bridgetype');
  }

  const groupColsByType = {};
  const antecColsByType = {};
  enabledGroupTypes.forEach(mode => {
      groupColsByType[mode] = resolveColumns(null, `group:${mode}`, { allowColumnLetters: false });
  });
  enabledEdgeTypes.forEach(mode => {
      const gCols = resolveColumns(null, `group:${mode}`, { allowColumnLetters: false });
      if (gCols.length > 0) groupColsByType[mode] = gCols;
      antecColsByType[mode] = resolveColumns(null, `${mode}_antec`, { allowColumnLetters: false });
  });

  const entIdCols = enabledEdgeTypes.length > 0 ? resolveColumns('ent_id', 'ent_id') : [];

  const primaryWordCol = wordCols[0] || tokCols[0] || null;
  const tokenCells = primaryWordCol
    ? (cellsByCol[primaryWordCol] || [])
      .filter((cell) => cell.row > 1)
      .sort((a, b) => a.row - b.row)
    : [];

  let tokenCoverageEnd = 1;
  if (primaryWordCol && tokenCells.length > 0) {
    tokenCoverageEnd = tokenCells[0].rowEnd;
    if (tokenCells[0].row > 2) {
      throw new Error(`Attempted to read word forms from column ${primaryWordCol}, but there are gaps in the column. First gap at row: 2`);
    }

    for (let i = 1; i < tokenCells.length; i += 1) {
      const cell = tokenCells[i];
      if (cell.row > tokenCoverageEnd + 1) {
        throw new Error(`Attempted to read word forms from column ${primaryWordCol}, but there are gaps in the column. First gap at row: ${tokenCoverageEnd + 1}`);
      }
      if (cell.rowEnd > tokenCoverageEnd) tokenCoverageEnd = cell.rowEnd;
    }
  }

  const maxSheetRow = Math.max(maxRow, parseInt(sheetMeta.r || '1', 10) || 1);
  const rowToTokenId = {};
  const tokenRowsByTid = {};
  const tokens = [];

  const sentenceStartRows = new Set();
  sentCols.forEach((col) => {
    (cellsByCol[col] || []).forEach((cell) => {
      if (cell.row > 1) sentenceStartRows.add(cell.row);
    });
  });

  let tid = 1;
  let sentnum = 1;
  let toknumInSent = 0;

  if (primaryWordCol) {
    for (let row = 2; row <= tokenCoverageEnd; row += 1) {
      const tokenCell = getEffectiveCell(primaryWordCol, row);
      if (!tokenCell) {
        throw new Error(`Attempted to read word forms from column ${primaryWordCol}, but there are gaps in the column. First gap at row: ${row}`);
      }
      
      // Rows covered by a merged token cell belong to the same token.
      if (tokenCell.row < row) {
        continue;
      }

      if (tid > 1 && sentenceStartRows.has(row)) {
        sentnum += 1;
        toknumInSent = 0;
      }

      toknumInSent += 1;
      const charOffsetValue = readSlotValue(charOffsetCols, 0, tokenCell.row);
      const token = {
        tid,
        toknum_in_sent: toknumInSent,
        word: tokenCell.value,
        char_offset: charOffsetValue || null,
        sent: toknumInSent === 1 ? sentnum : null,
        sentnum,
        sent_tooltip: ''
      };
      tokens.push(token);

      const coveredRows = [];
      for (let r = tokenCell.row; r <= tokenCell.rowEnd; r += 1) {
        rowToTokenId[r] = tid;
        coveredRows.push(r);
      }

      tokenRowsByTid[tid] = {
        startRow: tokenCell.row,
        endRow: tokenCell.rowEnd,
        rows: coveredRows,
        sourceCell: tokenCell.ref
      };

      tid += 1;
    }
  }

  const entities = {};
  const entityExternalIdByDiv = {};
  
  const groupBuckets = {};
  const edgeBuckets = {};
  const edgeAntecByEntity = {};
  enabledGroupTypes.forEach(mode => groupBuckets[mode] = {});
  enabledEdgeTypes.forEach(mode => {
     edgeBuckets[mode] = {};
     edgeAntecByEntity[mode] = {};
  });

  const externalToDivBySlot = {};
  const externalToDivUnique = {};
  const externalToDivAmbiguous = new Set();

  entityCols.forEach((col, slotIdx) => {
    const colCells = cellsByCol[col] || [];
    colCells.forEach((entityCell) => {
      if (entityCell.row <= 1) return;
      if (!isMeaningful(entityCell.value)) return;

      const tokIds = [];
      for (let row = entityCell.row; row <= entityCell.rowEnd; row += 1) {
        const mappedTid = rowToTokenId[row];
        if (mappedTid) tokIds.push(mappedTid);
      }

      const uniqTokIds = [...new Set(tokIds)].sort((a, b) => a - b);
      if (uniqTokIds.length === 0) return;

      const annotationValuesByKey = {};
      annotationKeysForSocialcalc.forEach((key) => {
        annotationValuesByKey[key] = readSlotValue(annotationColsByKey[key], slotIdx, entityCell.row);
      });
      const entExternalId = enabledEdgeTypes.length > 0 ? readSlotValue(entIdCols, slotIdx, entityCell.row).trim() : '';

      const defaultAnnos = { ...config.DEFAULT_ANNOS };
      annotationKeysForSocialcalc.forEach((key) => {
        const rawValue = annotationValuesByKey[key];
        const normalized = normalizeAnnotationValueForSchema(key, rawValue, schema, config, '_');
        if (isMeaningful(rawValue)) {
          defaultAnnos[key] = normalized;
        } else if (!(key in defaultAnnos)) {
          defaultAnnos[key] = normalized;
        }
      });

      const parsedGroups = {};
      enabledGroupTypes.forEach((mode) => {
        parsedGroups[mode] = parseGroupValue(readSlotValue(groupColsByType[mode], slotIdx, entityCell.row, {
          allowMerged: false,
          allowSingleColumnFallback: false
        }));
      });
      const parsedAntecs = {};
      enabledEdgeTypes.forEach(mode => {
         parsedGroups[mode] = parseGroupValue(readSlotValue(groupColsByType[mode], slotIdx, entityCell.row, {
           allowMerged: false,
           allowSingleColumnFallback: false
         }));
         parsedAntecs[mode] = readSlotValue(antecColsByType[mode], slotIdx, entityCell.row, {
           allowMerged: false,
           allowSingleColumnFallback: false
         }).trim();
      });

      const entity = baseEntity(
        uniqTokIds,
        entityCell.value || config.GLOBAL_DEFAULTS.DEFAULT_ENTITY_TYPE,
        defaultAnnos,
        config
      );

      if (!entities[entity.div_id]) {
        entities[entity.div_id] = entity;
      }

      const target = entities[entity.div_id];
      annotationKeysForSocialcalc.forEach((key) => {
        const rawValue = annotationValuesByKey[key];
        if (!isMeaningful(rawValue)) return;
        target.annos[key] = normalizeAnnotationValueForSchema(key, rawValue, schema, config, '_');
      });

      if (enabledEdgeTypes.length > 0 && entExternalId) {
        entityExternalIdByDiv[target.div_id] = entExternalId;

        if (!externalToDivBySlot[slotIdx]) externalToDivBySlot[slotIdx] = {};
        const slotMap = externalToDivBySlot[slotIdx];
        if (!(entExternalId in slotMap)) {
          slotMap[entExternalId] = target.div_id;
        } else if (slotMap[entExternalId] !== target.div_id) {
          slotMap[entExternalId] = null;
        }

        if (!externalToDivAmbiguous.has(entExternalId)) {
          if (!(entExternalId in externalToDivUnique)) {
            externalToDivUnique[entExternalId] = target.div_id;
          } else if (externalToDivUnique[entExternalId] !== target.div_id) {
            delete externalToDivUnique[entExternalId];
            externalToDivAmbiguous.add(entExternalId);
          }
        }
      }

      enabledGroupTypes.forEach(mode => {
         if (parsedGroups[mode]) {
             if (!groupBuckets[mode][parsedGroups[mode]]) groupBuckets[mode][parsedGroups[mode]] = new Set();
             groupBuckets[mode][parsedGroups[mode]].add(target.div_id);
         }
      });
      
      enabledEdgeTypes.forEach(mode => {
         if (parsedGroups[mode]) {
             if (!edgeBuckets[mode][parsedGroups[mode]]) edgeBuckets[mode][parsedGroups[mode]] = new Set();
             edgeBuckets[mode][parsedGroups[mode]].add(target.div_id);
         }
         if (parsedAntecs[mode] && parsedAntecs[mode] !== '_' && parsedAntecs[mode] !== '0') {
             edgeAntecByEntity[mode][target.div_id] = { externalId: parsedAntecs[mode], slotIdx };
         }
      });
    });
  });

  const entityIds = Object.keys(entities);
  const groups = {};
  const assignedColors = {};
  enabledGroupTypes.forEach(mode => { groups[mode] = { 0: [...entityIds] }; assignedColors[mode] = { 0: config.GLOBAL_DEFAULTS.DEFAULT_COLOR }; });
  enabledEdgeTypes.forEach(mode => { groups[mode] = { 0: [...entityIds] }; assignedColors[mode] = { 0: config.GLOBAL_DEFAULTS.DEFAULT_COLOR }; });

  const assignGroups = (groupType, bucketMap) => {
    const rawIds = Object.keys(bucketMap).sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (Number.isNaN(na) || Number.isNaN(nb)) return String(a).localeCompare(String(b));
      return na - nb;
    });

    let gid = 1;
    rawIds.forEach((rawId) => {
      const members = sortByStart([...bucketMap[rawId]]);
      if (members.length < 2) return;

      groups[groupType][gid] = members;
      assignedColors[groupType][gid] = config.COREF_COLORS[gid - 1] || randomColor();
      members.forEach((entityId) => {
        if (!entities[entityId]) return;
        entities[entityId].groups[groupType] = gid;
      });
      gid += 1;
    });

    groups[groupType][0] = groups[groupType][0].filter((entityId) => entities[entityId]?.groups[groupType] === 0);
  };

  enabledGroupTypes.forEach(mode => assignGroups(mode, groupBuckets[mode]));
  enabledEdgeTypes.forEach(mode => assignGroups(mode, edgeBuckets[mode]));

  enabledEdgeTypes.forEach(mode => {
      Object.entries(edgeAntecByEntity[mode]).forEach(([entityId, bridgeInfo]) => {
      const { externalId: antecExternal, slotIdx } = bridgeInfo || {};
      if (!antecExternal) return;

      const entity = entities[entityId];
      if (!entity) return;

      const entityEdgeGroup = parseInt(entity.groups?.[mode] || 0, 10);
      const slotCandidate = externalToDivBySlot[slotIdx]?.[antecExternal];
      const globalCandidate = externalToDivUnique[antecExternal];

      const pickCandidate = [slotCandidate, globalCandidate].find((candidate) => {
        if (!candidate || !entities[candidate] || candidate === entityId) return false;
        const antecEntity = entities[candidate];
        const antecGroup = parseInt(antecEntity.groups?.[mode] || 0, 10);
        return antecGroup === entityEdgeGroup && antecEntity.start < entity.start;
      });

      if (!pickCandidate) return;
      entities[entityId].antecedents[mode] = pickCandidate;
      if (mode === 'bridge') entities[entityId].bridge_antec = pickCandidate;
      });

      Object.entries(groups[mode]).forEach(([gid, members]) => {
      if (parseInt(gid, 10) <= 0 || !Array.isArray(members)) return;
      const ordered = sortByStart(members);
      for (let i = 1; i < ordered.length; i += 1) {
        const current = ordered[i];
        const currentEntity = entities[current];
        if (!currentEntity) continue;
        const mappedAntec = currentEntity.antecedents?.[mode] || (mode === 'bridge' ? currentEntity.bridge_antec : '_');
        if (mappedAntec && mappedAntec !== '_') continue;

        let fallbackAntec = null;
        for (let j = i - 1; j >= 0; j -= 1) {
          const candidate = ordered[j];
          const candidateEntity = entities[candidate];
          if (!candidateEntity) continue;
          if (candidateEntity.start < currentEntity.start) {
            fallbackAntec = candidate;
            break;
          }
        }

        if (fallbackAntec) {
          currentEntity.antecedents[mode] = fallbackAntec;
          if (mode === 'bridge') currentEntity.bridge_antec = fallbackAntec;
        }
      }
      });
  });

  const primaryGroup = enabledGroupTypes[0] || 'coref';
  Object.entries(groups[primaryGroup] || {}).forEach(([gid, members]) => {
    if (parseInt(gid, 10) > 0 && members.length > 1) {
      const salienceKey = schema.salienceKey;
      if (!salienceKey) return;
      const merged = mergeSalienceValues(members.map((id) => entities[id]?.annos?.[salienceKey]), config);
      members.forEach((id) => {
        if (!entities[id]) return;
        entities[id].annos[salienceKey] = merged;
        entities[id].salienceField = true;
      });
    }
  });

  const summaryKeys = Array.isArray(config.SUMMARY_KEYS)
    ? config.SUMMARY_KEYS.filter((key) => typeof key === 'string' && key.trim().length > 0)
    : [];
  const summaries = summaryKeys.length > 0
    ? summaryKeys
      .map((key) => safeMeta[key])
      .filter((summary) => typeof summary === 'string' && summary.trim().length > 0)
    : (Array.isArray(safeMeta.summaries)
      ? safeMeta.summaries.filter((summary) => typeof summary === 'string' && summary.trim().length > 0)
      : []);

  return {
    tokens,
    entities,
    groups,
    assignedColors,
    summaries,
    socialcalc: {
      raw,
      meta: { ...safeMeta },
      sheet: {
        maxRow,
        maxCol,
        sheetMeta,
        headerByCol,
        columnsByHeader,
        cells: parsedCells,
        cellsByRef,
        nonCellLines
      },
      mappings: {
        charOffsetCols,
        wordCols,
        tokCols,
        sentCols,
        entityCols,
        annotationColsByKey,
        infstatCols: annotationColsByKey.infstat || [],
        salienceCols: annotationColsByKey.salience || [],
        bridgetypeCols: annotationColsByKey[schema.bridgeSubtypeKey] || [],
        groupColsByType,
        antecColsByType,
        entIdCols
      },
      rowToTokenId,
      tokenRowsByTid,
      entityExternalIdByDiv
    }
  };
}
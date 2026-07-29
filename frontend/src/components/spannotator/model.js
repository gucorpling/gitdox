export const DEFAULT_SPANNOTATOR_CONFIG = {
  ICON_MAP: {
    person: ['male', 'blue'],
    time: ['clock-o', 'pink'],
    abstract: ['cloud', 'cyan'],
    object: ['cube', 'green'],
    animal: ['paw', 'orange'],
    plant: ['pagelines', 'magenta'],
    place: ['map-marker', 'red'],
    substance: ['flask', 'purple'],
    organization: ['bank', 'brown'],
    event: ['bell', 'gold']
  },
  GLOBAL_DEFAULTS: {
    DEFAULT_ENTITY_TYPE: 'abstract',
    DEFAULT_ICON: 'question',
    DEFAULT_COLOR: 'lightgray',
    DEFAULT_GROUP: 'coref'
  },
  DEFAULT_ANNOS: { infstat: 'new', salience: 'nnnnn', bridgetype: 'nobridge' },
  ANNOTATION_KINDS: {
    infstat: 'enum',
    salience: 'checks',
    bridgetype: 'enum'
  },
  ANNOTATION_KEYS: ['infstat', 'salience', 'bridgetype'],
  ANNOTATION_STARS: {},
  CHECK_SETTINGS_BY_KEY: {
    salience: { count: 5, falseChar: 'n', trueChar: 's' }
  },
  CAROUSEL_KEYS: [],
  CAROUSEL_SYNC_KEY: 'salience',
  DRAG_TOL: 5,
  SALIENCE_SETTINGS: {
    key: 'salience',
    count: 5,
    falseChar: 'n',
    trueChar: 's'
  },
  ANNO_VALUES: {
    infstat: ['auto', 'giv', 'acc', 'new', 'split'],
    salience: ['nnnnn', 'sssss'],
    bridgetype: [
      'nobridge',
      'comparison-relative',
      'comparison-sense',
      'comparison-time',
      'entity-associative',
      'entity-meronomy',
      'entity-property',
      'entity-resultative',
      'set-member',
      'set-subset',
      'set-span-interval',
      'other'
    ]
  },
  BRIDGETYPE_PRIORITY: [
    'other',
    'set-span-interval',
    'set-subset',
    'set-member',
    'entity-resultative',
    'entity-property',
    'entity-meronomy',
    'entity-associative',
    'comparison-time',
    'comparison-sense',
    'comparison-relative',
    'nobridge'
  ],
  BRIDGE_COARSE_SEPARATOR: '-',
  SUMMARY_KEYS: [],
  GROUP_TYPES: [], // e.g. 'coref'
  GROUP_TOPOLOGIES: {'coref': 'chain', 'split': 'star'},
  GROUP_BEHAVIORS: {'coref': 'anytype', 'split': 'anytype'},
  EDGE_TYPES: [], // e.g. 'bridge'
  ENABLE_EDGE_COLUMNS: true,
  COREF_COLORS: [
    'Red', 'RoyalBlue', 'ForestGreen', 'DarkMagenta', 'Brown', 'DarkTurquoise', 'Plum', 'Orange', 'Navy', 'Olive',
    'LightSeaGreen', 'MediumSeaGreen', 'Aqua', 'Blue', 'BlueViolet', 'CadetBlue', 'Chartreuse', 'Chocolate',
    'Coral', 'CornflowerBlue', 'Crimson', 'DarkBlue', 'DarkCyan', 'DarkGoldenRod', 'DarkGreen', 'DarkKhaki',
    'DarkOliveGreen', 'DarkOrange', 'DarkOrchid', 'DarkRed', 'DarkSalmon', 'DarkSeaGreen', 'DarkSlateBlue',
    'DarkSlateGray', 'DeepPink', 'DarkViolet', 'DeepSkyBlue', 'DimGray', 'DodgerBlue', 'FireBrick', 'Fuchsia',
    'Gold', 'GoldenRod', 'Gray', 'Green', 'GreenYellow', 'HotPink', 'IndianRed', 'Indigo', 'Khaki', 'LawnGreen',
    'LightBlue', 'LightCoral', 'LightGreen', 'LightPink', 'LightSalmon', 'LightSkyBlue', 'LightSlateGray',
    'LightSteelBlue', 'Lime', 'LimeGreen', 'Magenta', 'Maroon', 'MediumAquaMarine', 'MediumBlue', 'MediumOrchid',
    'MediumPurple', 'MediumSlateBlue', 'MediumSpringGreen', 'MediumTurquoise', 'MediumVioletRed', 'MidnightBlue',
    'NavajoWhite', 'OliveDrab', 'OrangeRed', 'Orchid', 'PaleGreen', 'PaleTurquoise', 'PaleVioletRed', 'PeachPuff',
    'Peru', 'Pink', 'PowderBlue', 'Purple', 'RebeccaPurple', 'RosyBrown', 'SaddleBrown', 'Salmon', 'SandyBrown',
    'SeaGreen', 'Sienna', 'SkyBlue', 'SlateBlue', 'SlateGray', 'SpringGreen', 'SteelBlue', 'Tan', 'Teal', 'Thistle',
    'Tomato', 'Turquoise', 'Violet', 'Wheat', 'Yellow'
  ]
};

function asNonEmptyStringArray(value) {
  if (!Array.isArray(value)) {
    if (value && typeof value === 'object') {
      return Object.keys(value).map(k => String(k).trim()).filter(k => k.length > 0);
    }
    return [];
  }
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
}

function normalizeAnnotationSpec(spec) {
  if (Array.isArray(spec)) {
    return { kind: 'enum', values: asNonEmptyStringArray(spec), stars: {} };
  }

  if (spec && typeof spec === 'object') {
    const values = asNonEmptyStringArray(spec.values || spec.options || spec.list || []);
    const stars = spec.stars && typeof spec.stars === 'object' ? { ...spec.stars } : {};
    const kind = String(spec.kind || spec.type || '').trim().toLowerCase();
    if (kind === 'text' || kind === 'freeform') {
      return { kind: 'text', values: [], stars };
    }
    if (kind === 'checks') {
      return { kind: 'checks', values, stars };
    }
    if (values.length > 0) {
      return { kind: 'enum', values, stars };
    }
    return { kind: 'text', values: [], stars };
  }

  if (typeof spec === 'string') {
    const text = spec.trim();
    if (text.length === 0) return { kind: 'text', values: [], stars: {} };
    return { kind: 'enum', values: [text], stars: {} };
  }

  if (spec == null) {
    return { kind: 'text', values: [], stars: {} };
  }

  return { kind: 'enum', values: asNonEmptyStringArray([spec]), stars: {} };
}

function normalizeCheckSpec(spec) {
  if (!Array.isArray(spec) || spec.length < 3) return null;
  const count = Math.max(parseInt(spec[0], 10) || 0, 1);
  const falseChar = String(spec[1] ?? 'n').charAt(0) || 'n';
  const trueChar = String(spec[2] ?? 's').charAt(0) || 's';
  return { count, falseChar, trueChar };
}

let warnedEntityIconLengthMismatch = false;

function normalizeEntitiesSchemaOverrides(overrides = {}) {
  const looksLikeEntitiesSchema = Boolean(
    overrides?.annotations || overrides?.colors || overrides?.tokens || overrides?.sentences || overrides?.carousel
  );
  if (!looksLikeEntitiesSchema) return {};

  const next = {};
  const annotations = overrides.annotations && typeof overrides.annotations === 'object' ? overrides.annotations : {};
  const entityBlock = annotations.entity && typeof annotations.entity === 'object' ? annotations.entity : {};
  const entityEntry = Object.entries(entityBlock).find(([, v]) => Array.isArray(v));
  const entityColumnName = entityEntry?.[0] || 'entity';
  const entityTypes = asNonEmptyStringArray(entityEntry?.[1]);
  const iconList = asNonEmptyStringArray(entityBlock.icons);
  const identityKey = String(entityBlock.identity || '').trim();

  if (!warnedEntityIconLengthMismatch && entityTypes.length > 0 && iconList.length > 0 && entityTypes.length !== iconList.length) {
    warnedEntityIconLengthMismatch = true;
    console.warn(
      `Spannotator config warning: entities.annotations.entity.${entityColumnName} has ${entityTypes.length} values, `
      + `but entities.annotations.entity.icons has ${iconList.length}. Extra values/icons will use fallback icon mapping.`
    );
  }

  if (entityTypes.length > 0) {
    next.ANNO_VALUES = { ...(next.ANNO_VALUES || {}), [entityColumnName]: entityTypes };
    next.DEFAULT_ANNOS = { ...(next.DEFAULT_ANNOS || {}), [entityColumnName]: entityTypes[0] };
    next.entity = entityColumnName;
    next.GLOBAL_DEFAULTS = {
      ...(next.GLOBAL_DEFAULTS || {}),
      DEFAULT_ENTITY_TYPE: entityTypes[0]
    };
  }

  if (identityKey) {
    next.ANNOTATION_KINDS = { ...(next.ANNOTATION_KINDS || {}), [identityKey]: 'text' };
    next.ANNO_VALUES = { ...(next.ANNO_VALUES || {}), [identityKey]: [] };
    next.DEFAULT_ANNOS = { ...(next.DEFAULT_ANNOS || {}), [identityKey]: '' };
    next[identityKey] = identityKey;
  }

  if (iconList.length > 0 && entityTypes.length > 0) {
    const nextIconMap = { ...(next.ICON_MAP || {}) };
    entityTypes.forEach((typeName, index) => {
      const iconName = iconList[index];
      if (!iconName) return;
      const existingColor = DEFAULT_SPANNOTATOR_CONFIG.ICON_MAP[typeName]?.[1] || DEFAULT_SPANNOTATOR_CONFIG.GLOBAL_DEFAULTS.DEFAULT_COLOR;
      nextIconMap[typeName] = [iconName, existingColor];
    });
    next.ICON_MAP = nextIconMap;
  }

  const keyAnnos = annotations.keys && typeof annotations.keys === 'object' ? annotations.keys : {};
  const annotationKinds = { ...(next.ANNOTATION_KINDS || {}) };
  const annotationStars = { ...(next.ANNOTATION_STARS || {}) };
  const annotationKeys = [];

  Object.entries(keyAnnos).forEach(([key, spec]) => {
    const keyName = String(key || '').trim();
    if (!keyName) return;

    const normalized = normalizeAnnotationSpec(spec);
    annotationKinds[keyName] = normalized.kind;
    if (!annotationKeys.includes(keyName)) annotationKeys.push(keyName);
    next[keyName] = keyName;

    if (normalized.kind === 'enum' && normalized.values.length > 0) {
      next.ANNO_VALUES = { ...(next.ANNO_VALUES || {}), [keyName]: normalized.values };
      next.DEFAULT_ANNOS = { ...(next.DEFAULT_ANNOS || {}), [keyName]: normalized.values[0] };
    } else if (normalized.kind === 'text') {
      next.ANNO_VALUES = { ...(next.ANNO_VALUES || {}), [keyName]: [] };
      if (!(keyName in (next.DEFAULT_ANNOS || {}))) {
        next.DEFAULT_ANNOS = { ...(next.DEFAULT_ANNOS || {}), [keyName]: '' };
      }
    }

    if (normalized.kind !== 'checks' && normalized.stars && Object.keys(normalized.stars).length > 0) {
      annotationStars[keyName] = normalized.stars;
    }
  });

  const checks = annotations.checks && typeof annotations.checks === 'object' ? annotations.checks : {};
  const checkSettingsByKey = { ...(next.CHECK_SETTINGS_BY_KEY || {}) };
  Object.entries(checks).forEach(([key, spec]) => {
    const keyName = String(key || '').trim();
    if (!keyName) return;
    const normalized = normalizeCheckSpec(spec);
    if (!normalized) return;
    annotationKinds[keyName] = 'checks';
    if (!annotationKeys.includes(keyName)) annotationKeys.push(keyName);
    checkSettingsByKey[keyName] = normalized;
    const defaultValue = normalized.falseChar.repeat(normalized.count);
    next.ANNO_VALUES = { ...(next.ANNO_VALUES || {}), [keyName]: [defaultValue, normalized.trueChar.repeat(normalized.count)] };
    next.DEFAULT_ANNOS = { ...(next.DEFAULT_ANNOS || {}), [keyName]: defaultValue };
    next[keyName] = keyName;
  });

  const carousel = overrides.carousel;
  if (Array.isArray(carousel)) {
    const summaryKeys = asNonEmptyStringArray(carousel);
    if (summaryKeys.length > 0) {
      next.CAROUSEL_KEYS = summaryKeys;
      next.SUMMARY_KEYS = summaryKeys;
    }
  } else if (carousel && typeof carousel === 'object') {
    const summaryKeys = asNonEmptyStringArray(carousel.keys);
    if (summaryKeys.length > 0) {
      next.CAROUSEL_KEYS = summaryKeys;
      next.SUMMARY_KEYS = summaryKeys;
    }
    const syncKey = String(carousel.sync || '').trim();
    if (syncKey) {
      next.CAROUSEL_SYNC_KEY = syncKey;
      next.SALIENCE_SETTINGS = { ...(next.SALIENCE_SETTINGS || {}), key: syncKey };
    }
  }

  next.ANNOTATION_KINDS = annotationKinds;
  if (annotationKeys.length > 0) next.ANNOTATION_KEYS = annotationKeys;
  next.ANNOTATION_STARS = annotationStars;
  next.CHECK_SETTINGS_BY_KEY = checkSettingsByKey;

  const colorsRoot = overrides?.entities?.colors || overrides?.colors || {};
  
  if (colorsRoot.groups && typeof colorsRoot.groups === 'object' && !Array.isArray(colorsRoot.groups)) {
    next.GROUP_TYPES = [];
    next.GROUP_TOPOLOGIES = {};
    next.GROUP_BEHAVIORS = {};
    
    Object.entries(colorsRoot.groups).forEach(([gType, gSpec]) => {
      next.GROUP_TYPES.push(gType);
      if (Array.isArray(gSpec)) {
        next.GROUP_TOPOLOGIES[gType] = gSpec[0] || 'chain';
        next.GROUP_BEHAVIORS[gType] = gSpec[1] || 'anytype';
      } else {
        next.GROUP_TOPOLOGIES[gType] = typeof gSpec === 'string' ? gSpec : 'chain';
        next.GROUP_BEHAVIORS[gType] = 'anytype';
      }
    });
  } else {
    // Fallback for the old array-based config
    const groups = asNonEmptyStringArray(colorsRoot.groups);
    if (groups.length > 0) {
      next.GROUP_TYPES = groups;
    }
  }

  const edgeBlocks = colorsRoot.edges && typeof colorsRoot.edges === 'object' ? colorsRoot.edges : {};
  const edgeTypes = Object.keys(edgeBlocks).filter((k) => k && typeof edgeBlocks[k] === 'object');
  if (edgeTypes.length > 0) {
    next.EDGE_TYPES = edgeTypes;
    next.ENABLE_EDGE_COLUMNS = true;
    next.ent_id = 'ent_id';
    if (edgeTypes.includes('bridge')) {
      const bridgeBlock = edgeBlocks.bridge || {};
      const bridgeSubtypeEntry = Object.entries(bridgeBlock).find(([k, v]) => k !== 'showcoarse' && k !== 'show_coarse' && k !== 'coarse_separator' && Array.isArray(v));
      if (bridgeSubtypeEntry) {
        const [bridgeAnnoKey, bridgeValuesRaw] = bridgeSubtypeEntry;
        const bridgeValues = asNonEmptyStringArray(bridgeValuesRaw);
        if (bridgeValues.length > 0) {
          const alphaPriority = [...bridgeValues].sort((a, b) => a.localeCompare(b));
          next.ANNO_VALUES = { ...(next.ANNO_VALUES || {}), [bridgeAnnoKey]: bridgeValues };
          next.DEFAULT_ANNOS = { ...(next.DEFAULT_ANNOS || {}), [bridgeAnnoKey]: bridgeValues[0] };
          next.BRIDGETYPE_PRIORITY = alphaPriority;
          next.bridgetype = bridgeAnnoKey;
        }
      }
      const showCoarse = bridgeBlock.show_coarse;
      if (typeof showCoarse === 'boolean') {
        next.SHOW_BRIDGE_COARSE = showCoarse;
      } else if (typeof bridgeBlock.showcoarse === 'boolean') {
        next.SHOW_BRIDGE_COARSE = bridgeBlock.showcoarse;
      }
      if (typeof bridgeBlock.coarse_separator === 'string' && bridgeBlock.coarse_separator.length > 0) {
        next.BRIDGE_COARSE_SEPARATOR = bridgeBlock.coarse_separator;
      }
    }
  } else {
    next.EDGE_TYPES = [];
    next.ENABLE_EDGE_COLUMNS = false;
  }

  if (typeof overrides.tokens === 'string' && overrides.tokens.trim()) {
    next.tok = overrides.tokens.trim();
    next.word = overrides.tokens.trim();
  }

  if (typeof overrides.sentences === 'string' && overrides.sentences.trim()) {
    next.sent = overrides.sentences.trim();
  }

  return next;
}

export function buildSpannotatorConfig(overrides = {}) {
  const normalizedSchemaOverrides = normalizeEntitiesSchemaOverrides(overrides);
  const hasExplicitEmptyAnnotationKeys = Boolean(
    Array.isArray(overrides?.annotations?.keys)
    && overrides.annotations.keys.length === 0
    && Object.keys(overrides?.annotations?.checks || {}).length === 0
  );
  const cfg = { ...DEFAULT_SPANNOTATOR_CONFIG, ...overrides, ...normalizedSchemaOverrides };
  return {
    ...cfg,
    ICON_MAP: {
      ...DEFAULT_SPANNOTATOR_CONFIG.ICON_MAP,
      ...(overrides.ICON_MAP || {}),
      ...(normalizedSchemaOverrides.ICON_MAP || {})
    },
    GLOBAL_DEFAULTS: {
      ...DEFAULT_SPANNOTATOR_CONFIG.GLOBAL_DEFAULTS,
      ...(overrides.GLOBAL_DEFAULTS || {}),
      ...(normalizedSchemaOverrides.GLOBAL_DEFAULTS || {})
    },
    DEFAULT_ANNOS: {
      ...(hasExplicitEmptyAnnotationKeys ? {} : DEFAULT_SPANNOTATOR_CONFIG.DEFAULT_ANNOS),
      ...(overrides.DEFAULT_ANNOS || {}),
      ...(normalizedSchemaOverrides.DEFAULT_ANNOS || {})
    },
    SALIENCE_SETTINGS: {
      ...(hasExplicitEmptyAnnotationKeys ? {} : DEFAULT_SPANNOTATOR_CONFIG.SALIENCE_SETTINGS),
      ...(overrides.SALIENCE_SETTINGS || {}),
      ...(normalizedSchemaOverrides.SALIENCE_SETTINGS || {})
    },
    ANNO_VALUES: {
      ...(hasExplicitEmptyAnnotationKeys ? {} : DEFAULT_SPANNOTATOR_CONFIG.ANNO_VALUES),
      ...(overrides.ANNO_VALUES || {}),
      ...(normalizedSchemaOverrides.ANNO_VALUES || {})
    },
    ANNOTATION_KINDS: {
      ...(hasExplicitEmptyAnnotationKeys ? {} : DEFAULT_SPANNOTATOR_CONFIG.ANNOTATION_KINDS),
      ...(overrides.ANNOTATION_KINDS || {}),
      ...(normalizedSchemaOverrides.ANNOTATION_KINDS || {})
    },
    ANNOTATION_KEYS: hasExplicitEmptyAnnotationKeys
      ? []
      : (normalizedSchemaOverrides.ANNOTATION_KEYS || overrides.ANNOTATION_KEYS || DEFAULT_SPANNOTATOR_CONFIG.ANNOTATION_KEYS),
    ANNOTATION_STARS: {
      ...DEFAULT_SPANNOTATOR_CONFIG.ANNOTATION_STARS,
      ...(overrides.ANNOTATION_STARS || {}),
      ...(normalizedSchemaOverrides.ANNOTATION_STARS || {})
    },
    CHECK_SETTINGS_BY_KEY: {
      ...(hasExplicitEmptyAnnotationKeys ? {} : DEFAULT_SPANNOTATOR_CONFIG.CHECK_SETTINGS_BY_KEY),
      ...(overrides.CHECK_SETTINGS_BY_KEY || {}),
      ...(normalizedSchemaOverrides.CHECK_SETTINGS_BY_KEY || {})
    },
    BRIDGETYPE_PRIORITY: normalizedSchemaOverrides.BRIDGETYPE_PRIORITY || overrides.BRIDGETYPE_PRIORITY || DEFAULT_SPANNOTATOR_CONFIG.BRIDGETYPE_PRIORITY,
    BRIDGE_COARSE_SEPARATOR: normalizedSchemaOverrides.BRIDGE_COARSE_SEPARATOR || overrides.BRIDGE_COARSE_SEPARATOR || DEFAULT_SPANNOTATOR_CONFIG.BRIDGE_COARSE_SEPARATOR,
    GROUP_TYPES: normalizedSchemaOverrides.GROUP_TYPES || overrides.GROUP_TYPES || DEFAULT_SPANNOTATOR_CONFIG.GROUP_TYPES,
    GROUP_TOPOLOGIES: { ...DEFAULT_SPANNOTATOR_CONFIG.GROUP_TOPOLOGIES, ...(normalizedSchemaOverrides.GROUP_TOPOLOGIES || overrides.GROUP_TOPOLOGIES || {}) },
    GROUP_BEHAVIORS: { ...DEFAULT_SPANNOTATOR_CONFIG.GROUP_BEHAVIORS, ...(normalizedSchemaOverrides.GROUP_BEHAVIORS || overrides.GROUP_BEHAVIORS || {}) },
    EDGE_TYPES: (normalizedSchemaOverrides.EDGE_TYPES != null ? normalizedSchemaOverrides.EDGE_TYPES : null)
      ?? overrides.EDGE_TYPES
      ?? DEFAULT_SPANNOTATOR_CONFIG.EDGE_TYPES,
    SUMMARY_KEYS: normalizedSchemaOverrides.SUMMARY_KEYS || overrides.SUMMARY_KEYS || DEFAULT_SPANNOTATOR_CONFIG.SUMMARY_KEYS,
    CAROUSEL_KEYS: normalizedSchemaOverrides.CAROUSEL_KEYS || overrides.CAROUSEL_KEYS || DEFAULT_SPANNOTATOR_CONFIG.CAROUSEL_KEYS,
    CAROUSEL_SYNC_KEY: normalizedSchemaOverrides.CAROUSEL_SYNC_KEY || overrides.CAROUSEL_SYNC_KEY || DEFAULT_SPANNOTATOR_CONFIG.CAROUSEL_SYNC_KEY,
    ENABLE_EDGE_COLUMNS: typeof (normalizedSchemaOverrides.ENABLE_EDGE_COLUMNS ?? overrides.ENABLE_EDGE_COLUMNS) === 'boolean'
      ? (normalizedSchemaOverrides.ENABLE_EDGE_COLUMNS ?? overrides.ENABLE_EDGE_COLUMNS)
      : DEFAULT_SPANNOTATOR_CONFIG.ENABLE_EDGE_COLUMNS,
    COREF_COLORS: overrides.COREF_COLORS || DEFAULT_SPANNOTATOR_CONFIG.COREF_COLORS
  };
}

export function getAnnotationKind(config = DEFAULT_SPANNOTATOR_CONFIG, key = '') {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return 'text';
  const explicit = String(config?.ANNOTATION_KINDS?.[normalizedKey] || '').trim();
  if (explicit) return explicit;
  if (config?.CHECK_SETTINGS_BY_KEY?.[normalizedKey]) return 'checks';
  if (Array.isArray(config?.ANNO_VALUES?.[normalizedKey]) && config.ANNO_VALUES[normalizedKey].length > 0) return 'enum';
  return 'text';
}

export function getAnnotationKeys(config = DEFAULT_SPANNOTATOR_CONFIG) {
  const explicitOrder = Array.isArray(config?.ANNOTATION_KEYS)
    ? config.ANNOTATION_KEYS
    : [];
  const fromKinds = Object.keys(config?.ANNOTATION_KINDS || {});
  const fromChecks = Object.keys(config?.CHECK_SETTINGS_BY_KEY || {});
  const fromValues = Object.keys(config?.ANNO_VALUES || {});
  const fromDefaults = Object.keys(config?.DEFAULT_ANNOS || {});

  return [...new Set([...explicitOrder, ...fromKinds, ...fromChecks, ...fromValues, ...fromDefaults])]
    .map((key) => String(key || '').trim())
    .filter((key) => key.length > 0 && key !== 'entity' && key !== 'char_offset');
}

export function enforceClusterSameType(entitiesById, memberIds) {
  // Ignore singletons or empty groups
  if (!memberIds || memberIds.length < 2) return;

  const typeCounts = {};
  const earliestStarts = {};

  // 1. Calculate frequencies and earliest text occurrences
  memberIds.forEach((id) => {
    const entity = entitiesById[id];
    if (!entity || !entity.type) return;
    
    const type = entity.type;
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    
    if (!(type in earliestStarts) || entity.start < earliestStarts[type]) {
      earliestStarts[type] = entity.start;
    }
  });

  // 2. Find the majority type, applying tie-breakers
  let winningType = null;
  let maxCount = -1;

  Object.entries(typeCounts).forEach(([type, count]) => {
    if (count > maxCount) {
      winningType = type;
      maxCount = count;
    } else if (count === maxCount) {
      // Tie breaker: earliest starting span wins
      if (earliestStarts[type] < earliestStarts[winningType]) {
        winningType = type;
      }
    }
  });

  // 3. Propagate to cluster members
  if (winningType) {
    memberIds.forEach((id) => {
      if (entitiesById[id] && entitiesById[id].type !== winningType) {
        entitiesById[id] = { ...entitiesById[id], type: winningType };
      }
    });
  }
}

export function getAnnotationCheckSettings(config = DEFAULT_SPANNOTATOR_CONFIG, key = '') {
  const normalizedKey = String(key || '').trim();
  const settings = config?.CHECK_SETTINGS_BY_KEY?.[normalizedKey];
  if (!settings) return null;
  return {
    count: Math.max(parseInt(settings.count, 10) || 0, 1),
    falseChar: String(settings.falseChar || 'n').charAt(0) || 'n',
    trueChar: String(settings.trueChar || 's').charAt(0) || 's'
  };
}

export function normalizeCheckValue(value, config = DEFAULT_SPANNOTATOR_CONFIG, key = 'salience') {
  const settings = getAnnotationCheckSettings(config, key);
  if (!settings) return normalizeSalienceValue(value, config);
  const defaultValue = settings.falseChar.repeat(settings.count);
  const cleaned = typeof value === 'string' && value.length > 0 ? value : defaultValue;
  const sanitizedChars = cleaned
    .replace(/_/g, settings.falseChar)
    .split('')
    .map((ch) => (ch === settings.trueChar || ch === 's' ? settings.trueChar : settings.falseChar));

  return sanitizedChars.join('').slice(0, settings.count).padEnd(settings.count, settings.falseChar);
}

export function countCheckValues(value, config = DEFAULT_SPANNOTATOR_CONFIG, key = 'salience') {
  const settings = getAnnotationCheckSettings(config, key);
  if (!settings) return 0;
  return normalizeCheckValue(value, config, key).split('').filter((ch) => ch === settings.trueChar).length;
}

export function mergeCheckValues(values, config = DEFAULT_SPANNOTATOR_CONFIG, key = 'salience') {
  const settings = getAnnotationCheckSettings(config, key);
  if (!settings) return '';
  const normalized = values.map((value) => normalizeCheckValue(value, config, key));
  return Array.from({ length: settings.count }, (_, idx) => (
    normalized.some((item) => item[idx] === settings.trueChar) ? settings.trueChar : settings.falseChar
  )).join('');
}

export function getAnnotationStarColor(config = DEFAULT_SPANNOTATOR_CONFIG, key = '', value = '') {
  const normalizedKey = String(key || '').trim();
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedKey || !normalizedValue) return '';
  return String(config?.ANNOTATION_STARS?.[normalizedKey]?.[normalizedValue] || '').trim();
}

export function getNamedEntityTypes(config = DEFAULT_SPANNOTATOR_CONFIG, source = {}) {
  /*
  Return per entity type the unique entity strings for the smallest entity span
  around each token tagged as a named-entity POS.
  */
  const tokens = Array.isArray(source?.tokens) ? source.tokens : [];
  const entitiesById = source?.entitiesById && typeof source.entitiesById === 'object'
    ? source.entitiesById
    : {};
  if (tokens.length === 0 || Object.keys(entitiesById).length === 0) return {};

  const nerPosSpec = config?.entities?.annotations?.entity?.ner_pos || config?.annotations?.entity?.ner_pos;
  const nerPosEntry = nerPosSpec && typeof nerPosSpec === 'object'
    ? Object.entries(nerPosSpec).find(([, v]) => Array.isArray(v))
    : null;
  const posColumnName = String(nerPosEntry?.[0] || 'pos').trim() || 'pos';
  const configuredPosValues = asNonEmptyStringArray(nerPosEntry?.[1]);
  const nerPosValues = configuredPosValues.length > 0 ? configuredPosValues : ['PROPN'];
  const nerPosValueSet = new Set(nerPosValues.map((v) => String(v).trim().toUpperCase()).filter((v) => v.length > 0));

  const tokensById = {};
  tokens.forEach((tok) => {
    const tid = parseInt(tok?.tid, 10);
    if (!Number.isNaN(tid)) tokensById[tid] = tok;
  });

  const socialcalcModel = source?.socialcalc || source?.socialcalcModel || null;
  const tokenRowsByTid = socialcalcModel?.tokenRowsByTid && typeof socialcalcModel.tokenRowsByTid === 'object'
    ? socialcalcModel.tokenRowsByTid
    : {};
  const columnsByHeader = socialcalcModel?.sheet?.columnsByHeader && typeof socialcalcModel.sheet.columnsByHeader === 'object'
    ? socialcalcModel.sheet.columnsByHeader
    : {};
  const posCols = columnsByHeader[String(posColumnName).toLowerCase()] || [];

  const cellsByCol = {};
  if (Array.isArray(socialcalcModel?.sheet?.cells) && posCols.length > 0) {
    socialcalcModel.sheet.cells.forEach((cell) => {
      if (!cell || !cell.col) return;
      if (!cellsByCol[cell.col]) cellsByCol[cell.col] = [];
      cellsByCol[cell.col].push(cell);
    });
    Object.keys(cellsByCol).forEach((col) => {
      cellsByCol[col].sort((a, b) => a.row - b.row);
    });
  }

  const getTokenPosFromSocialCalc = (tid) => {
    const row = parseInt(tokenRowsByTid?.[tid]?.startRow, 10);
    if (Number.isNaN(row) || row < 2) return '';
    for (const col of posCols) {
      const colCells = cellsByCol[col] || [];
      const hit = colCells.find((cell) => row >= cell.row && row <= cell.rowEnd);
      if (hit && String(hit.value ?? '').trim().length > 0) {
        return String(hit.value).trim();
      }
    }
    return '';
  };

  const getTokenPosTag = (tok) => {
    const directValue = tok?.[posColumnName] ?? tok?.[String(posColumnName).toLowerCase()] ?? tok?.[String(posColumnName).toUpperCase()];
    const directText = String(directValue ?? '').trim();
    if (directText.length > 0) return directText;

    const tid = parseInt(tok?.tid, 10);
    if (Number.isNaN(tid)) return '';
    return getTokenPosFromSocialCalc(tid);
  };

  const entityTypeKey = String(config?.entity || 'entity').trim() || 'entity';
  const entities = Object.values(entitiesById).filter((entity) => entity && Number.isFinite(entity.start) && Number.isFinite(entity.end));
  const resultsByType = {};

  const addResult = (typeName, text) => {
    if (!typeName || !text) return;
    if (!resultsByType[typeName]) resultsByType[typeName] = new Set();
    resultsByType[typeName].add(text);
  };

  tokens.forEach((tok) => {
    const tid = parseInt(tok?.tid, 10);
    if (Number.isNaN(tid)) return;

    const posTag = getTokenPosTag(tok);
    if (!nerPosValueSet.has(String(posTag).trim().toUpperCase())) return;

    let bestEntity = null;
    entities.forEach((entity) => {
      if (tid < entity.start || tid > entity.end) return;
      const spanLen = entity.end - entity.start + 1;
      const bestSpanLen = bestEntity ? (bestEntity.end - bestEntity.start + 1) : Infinity;
      if (spanLen < bestSpanLen || (spanLen === bestSpanLen && entity.start < bestEntity.start)) {
        bestEntity = entity;
      }
    });

    if (!bestEntity) return;

    const entityType = String(bestEntity.type || bestEntity.annos?.[entityTypeKey] || '').trim();
    if (!entityType) return;

    const tokIds = Array.isArray(bestEntity.toks) && bestEntity.toks.length > 0
      ? uniqueSortedNumbers(bestEntity.toks)
      : Array.from({ length: bestEntity.end - bestEntity.start + 1 }, (_, idx) => bestEntity.start + idx);
    const text = tokIds.map((id) => String(tokensById[id]?.word || '').trim()).filter((w) => w.length > 0).join(' ').trim();
    if (!text) return;

    addResult(entityType, text);
  });

  const out = {};
  Object.entries(resultsByType).forEach(([typeName, values]) => {
    out[typeName] = Array.from(values);
  });
  return out;
}

export function findEntitiesByText(text = '', source = {}) {
  const query = String(text || '').trim().replace(/\s+/g, ' ');
  if (!query) return [];

  const tokens = Array.isArray(source?.tokens) ? source.tokens : [];
  const entitiesById = source?.entitiesById && typeof source.entitiesById === 'object'
    ? source.entitiesById
    : {};
  if (tokens.length === 0 || Object.keys(entitiesById).length === 0) return [];

  const tokensById = {};
  tokens.forEach((tok) => {
    const tid = parseInt(tok?.tid, 10);
    if (!Number.isNaN(tid)) tokensById[tid] = tok;
  });

  const socialcalcModel = source?.socialcalc || source?.socialcalcModel || null;
  const tokenRowsByTid = socialcalcModel?.tokenRowsByTid && typeof socialcalcModel.tokenRowsByTid === 'object'
    ? socialcalcModel.tokenRowsByTid
    : {};

  const entities = Object.values(entitiesById)
    .filter((entity) => entity && Number.isFinite(entity.start) && Number.isFinite(entity.end))
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return (a.end - a.start) - (b.end - b.start);
    });

  const matches = [];
  entities.forEach((entity) => {
    const tokIds = Array.isArray(entity.toks) && entity.toks.length > 0
      ? uniqueSortedNumbers(entity.toks)
      : Array.from({ length: entity.end - entity.start + 1 }, (_, idx) => entity.start + idx);
    if (tokIds.length === 0) return;

    const spanText = tokIds
      .map((id) => String(tokensById[id]?.word || '').trim())
      .filter((word) => word.length > 0)
      .join(' ')
      .trim()
      .replace(/\s+/g, ' ');
    if (!spanText || spanText !== query) return;

    const firstTid = tokIds[0];
    const lastTid = tokIds[tokIds.length - 1];
    const startRow = tokenRowsByTid?.[firstTid]?.startRow ?? null;
    const endRow = tokenRowsByTid?.[lastTid]?.endRow ?? startRow;

    matches.push({
      entityId: entity.div_id || `${entity.start}-${entity.end}`,
      type: String(entity.type || '').trim(),
      text: spanText,
      start: entity.start,
      end: entity.end,
      toks: tokIds,
      startRow,
      endRow,
      entity
    });
  });

  return matches;
}

export function findEntitiesByTextAndType(text = '', entityType = '', source = {}) {
  const normalizedType = String(entityType || '').trim();
  if (!normalizedType) return [];
  const typeKey = String(source?.entityTypeKey || source?.entityKey || 'entity').trim() || 'entity';

  const matches = findEntitiesByText(text, source);
  return matches.filter((match) => {
    const resolvedType = String(
      match?.type
      || match?.entity?.type
      || match?.entity?.annos?.[typeKey]
      || ''
    ).trim();
    return resolvedType === normalizedType;
  });
}

export function parseTextToTokens(text) {
  const lines = (text || '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  const srcLines = lines.length > 0 ? lines : [''];

  const tokens = [];
  let tid = 1;
  srcLines.forEach((line, sentIdx) => {
    const words = line.trim().length > 0 ? line.trim().split(/\s+/) : [];
    words.forEach((word, wIdx) => {
      tokens.push({
        tid,
        toknum_in_sent: wIdx + 1,
        word,
        sent: wIdx === 0 ? sentIdx + 1 : null,
        sentnum: sentIdx + 1,
        sent_tooltip: ''
      });
      tid += 1;
    });
  });
  return tokens;
}

export function sortEntityIds(entIds) {
  return [...entIds].sort((a, b) => {
    const [as] = a.split('-').map(Number);
    const [bs] = b.split('-').map(Number);
    if (as !== bs) return as - bs;
    const [, ae] = a.split('-').map(Number);
    const [, be] = b.split('-').map(Number);
    return be - ae;
  });
}

export function nextGroupId(groups, groupType) {
  const existing = Object.keys(groups[groupType] || { 0: [] }).map((x) => parseInt(x, 10));
  const max = existing.length > 0 ? Math.max(...existing) : 0;
  for (let i = 1; i <= max + 1; i += 1) {
    if (!existing.includes(i)) return i;
  }
  return 1;
}

export function hasCrossingOverlap(existingEntity, start, end) {
  return (
    (existingEntity.start < start && existingEntity.end >= start && existingEntity.end < end) ||
    (start < existingEntity.start && end >= existingEntity.start && end < existingEntity.end)
  );
}

export function entityText(entity, tokensById) {
  return entity.toks.map((t) => tokensById[t]?.word || '').join(' ').trim();
}

export function sortByStart(ids) {
  return [...ids].sort((a, b) => {
    const [as] = a.split('-').map(Number);
    const [bs] = b.split('-').map(Number);
    return as - bs;
  });
}

export function priorityOrderBridge(values, priority = DEFAULT_SPANNOTATOR_CONFIG.BRIDGETYPE_PRIORITY) {
  const ordered = [];
  priority.forEach((v) => {
    if (values.includes(v)) ordered.push(v);
  });
  values.forEach((v) => {
    if (!ordered.includes(v)) ordered.push(v);
  });
  return ordered;
}

export function bridgeCoarseDefault(value, config = DEFAULT_SPANNOTATOR_CONFIG) {
  if (!value) return value;
  const separator = String(config?.BRIDGE_COARSE_SEPARATOR || DEFAULT_SPANNOTATOR_CONFIG.BRIDGE_COARSE_SEPARATOR);
  if (value.includes(separator)) return value;

  const bridgeValues = Array.isArray(config?.ANNO_VALUES?.bridgetype)
    ? config.ANNO_VALUES.bridgetype
    : DEFAULT_SPANNOTATOR_CONFIG.ANNO_VALUES.bridgetype;
  const candidates = bridgeValues
    .filter((item) => item === value || item.startsWith(`${value}${separator}`))
    .sort((a, b) => a.localeCompare(b));

  if (candidates.length > 0) return candidates[0];
  return value;
}

export function normalizeSalienceValue(value, config = DEFAULT_SPANNOTATOR_CONFIG) {
  return normalizeCheckValue(value, config, 'salience');
}

export function countSalienceChecks(value, config = DEFAULT_SPANNOTATOR_CONFIG) {
  return countCheckValues(value, config, 'salience');
}

export function mergeSalienceValues(values, config = DEFAULT_SPANNOTATOR_CONFIG) {
  return mergeCheckValues(values, config, 'salience');
}

export function columnMajorOrder(values, columns = 2) {
  if (columns <= 1) return values;
  const rows = Math.ceil(values.length / columns);
  const ordered = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const index = col * rows + row;
      if (index < values.length) ordered.push(values[index]);
    }
  }
  return ordered;
}

function normalizeGroupId(value) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function uniqueSortedNumbers(values) {
  return Array.from(new Set(values.map((v) => parseInt(v, 10)).filter((v) => !Number.isNaN(v)))).sort((a, b) => a - b);
}

function cloneGroupMap(groupMap = { 0: [] }) {
  const next = {};
  Object.keys(groupMap).forEach((gid) => {
    next[gid] = [...(groupMap[gid] || [])];
  });
  if (!next[0]) next[0] = [];
  return next;
}

function cloneGroupsByType(groupsByType = {}) {
  const next = {};
  Object.keys(groupsByType).forEach(key => {
    next[key] = cloneGroupMap(groupsByType[key]);
  });
  return next;
}

function cloneAssignedColors(assignedColors = {}, defaultColor) {
  const next = {};
  Object.keys(assignedColors).forEach(key => {
    next[key] = { ...(assignedColors[key] || {}) };
    if (!next[key][0]) next[key][0] = defaultColor;
  });
  return next;
}

function randomColor() {
  return `#${Math.floor(Math.random() * 16777215).toString(16)}`;
}

function ensureEntityInGroup(groupsByType, groupType, groupId, entityId) {
  if (!groupsByType[groupType]) groupsByType[groupType] = { 0: [] };
  if (!groupsByType[groupType][groupId]) groupsByType[groupType][groupId] = [];
  if (!groupsByType[groupType][groupId].includes(entityId)) {
    groupsByType[groupType][groupId] = [...groupsByType[groupType][groupId], entityId];
  }
}

function removeEntityFromAllGroups(groupsByType, groupType, entityId) {
  if (!groupsByType[groupType]) return;
  const groupEntries = groupsByType[groupType];
  Object.keys(groupEntries).forEach((gid) => {
    groupEntries[gid] = (groupEntries[gid] || []).filter((id) => id !== entityId);
    if (parseInt(gid, 10) > 0 && groupEntries[gid].length === 0) {
      delete groupEntries[gid];
    }
  });
  if (!groupEntries[0]) groupEntries[0] = [];
}

function assignGroupForEntity({
  entitiesById,
  groupsByType,
  assignedColors,
  groupType,
  entityId,
  newGroup,
  defaultColor,
  corefColors,
  oldGroupHint
}) {
  const entity = entitiesById[entityId];
  if (!entity) return;

  if (!groupsByType[groupType]) groupsByType[groupType] = { 0: [] };
  const groupEntries = groupsByType[groupType];
  if (!groupEntries[0]) groupEntries[0] = [];

  let oldGroup = normalizeGroupId(oldGroupHint);
  if (oldGroupHint == null) {
    oldGroup = 0;
    const detectedOldGroup = Object.keys(groupEntries).find((gid) => (groupEntries[gid] || []).includes(entityId));
    if (detectedOldGroup != null) oldGroup = normalizeGroupId(detectedOldGroup);
  }

  const nextGroup = normalizeGroupId(newGroup);

  if (!groupEntries[nextGroup]) groupEntries[nextGroup] = [];

  if (oldGroup !== nextGroup && groupEntries[oldGroup]) {
    groupEntries[oldGroup] = groupEntries[oldGroup].filter((id) => id !== entityId);

    if (oldGroup > 0 && groupEntries[oldGroup].length === 1) {
      const [remainingId] = groupEntries[oldGroup];
      if (remainingId && entitiesById[remainingId]) {
        let nextAnnos = { ...entitiesById[remainingId].annos };
        if (groupType === 'bridge') {
           nextAnnos.bridgetype = 'nobridge';
           nextAnnos.infstat = nextAnnos.infstat === 'acc' ? 'auto' : nextAnnos.infstat;
        }

        entitiesById[remainingId] = {
          ...entitiesById[remainingId],
          groups: { ...entitiesById[remainingId].groups, [groupType]: 0 },
          bridge_antec: groupType === 'bridge' ? '_' : entitiesById[remainingId].bridge_antec,
          antecedents: {
             ...(entitiesById[remainingId].antecedents || {}),
             [groupType]: '_'
          },
          annos: nextAnnos
        };
      }
      ensureEntityInGroup(groupsByType, groupType, 0, remainingId);
      delete groupEntries[oldGroup];
    }

    if (oldGroup > 0 && groupEntries[oldGroup] && groupEntries[oldGroup].length === 0) {
      delete groupEntries[oldGroup];
    }
  }

  ensureEntityInGroup(groupsByType, groupType, nextGroup, entityId);

  entitiesById[entityId] = {
    ...entity,
    groups: {
      ...entity.groups,
      [groupType]: nextGroup
    }
  };

  if (!assignedColors[groupType]) assignedColors[groupType] = { 0: defaultColor };
  if (!(nextGroup in assignedColors[groupType])) {
    assignedColors[groupType][nextGroup] = nextGroup === 0
      ? defaultColor
      : (corefColors[nextGroup - 1] || randomColor());
  }
}

function removeEntityFromState(nextState, entityId) {
  const existing = nextState.entitiesById[entityId];
  if (!existing) return;
  delete nextState.entitiesById[entityId];

  const allModes = [...(nextState.config?.GROUP_TYPES || ['coref']), ...(nextState.config?.EDGE_TYPES || ['bridge'])];
  allModes.forEach(mode => removeEntityFromAllGroups(nextState.groupsByType, mode, entityId));

  if (nextState.uiState.activeEntityId === entityId) {
    nextState.uiState.activeEntityId = '';
  }

  if (nextState.uiState.selectedEntities?.has(entityId)) {
    const selected = new Set(nextState.uiState.selectedEntities);
    selected.delete(entityId);
    nextState.uiState.selectedEntities = selected;
  }

  Object.keys(nextState.entitiesById).forEach((id) => {
    const entity = nextState.entitiesById[id];
    if (!entity) return;

    const edgeModes = nextState.config?.EDGE_TYPES || ['bridge'];
    edgeModes.forEach(mode => {
        const antec = entity.antecedents?.[mode] || (mode === 'bridge' ? entity.bridge_antec : '_');
        if (antec === entityId) {
            const nextAnnos = { ...entity.annos };
            if (mode === 'bridge') {
                nextAnnos.bridgetype = 'nobridge';
                nextAnnos.infstat = nextAnnos.infstat === 'acc' ? 'auto' : nextAnnos.infstat;
            } else {
                const edgeConf = nextState.config.colors?.edges?.[mode] || {};
                const typeKeys = Object.keys(edgeConf).filter(k => Array.isArray(edgeConf[k]));
                typeKeys.forEach(k => nextAnnos[k] = `no${mode}`);
            }

            nextState.entitiesById[id] = {
                ...nextState.entitiesById[id],
                bridge_antec: mode === 'bridge' ? '_' : nextState.entitiesById[id].bridge_antec,
                antecedents: {
                    ...(nextState.entitiesById[id].antecedents || {}),
                    [mode]: '_'
                },
                annos: nextAnnos,
                groups: {
                    ...nextState.entitiesById[id].groups,
                    [mode]: 0
                }
            };
            
            assignGroupForEntity({
                entitiesById: nextState.entitiesById,
                groupsByType: nextState.groupsByType,
                assignedColors: nextState.assignedColors,
                groupType: mode,
                entityId: id,
                newGroup: 0,
                defaultColor: nextState.config.GLOBAL_DEFAULTS.DEFAULT_COLOR,
                corefColors: nextState.config.COREF_COLORS
            });
        }
    });
  });
}

export function createAnnotationState({
  tokens = [],
  entitiesById = {},
  groupsByType = {},
  assignedColors = {},
  uiState = {},
  summaries = [],
  config = DEFAULT_SPANNOTATOR_CONFIG
} = {}) {
  const normalizedConfig = buildSpannotatorConfig(config);
  const defaultColor = normalizedConfig.GLOBAL_DEFAULTS.DEFAULT_COLOR;

  const nextGroupsByType = cloneGroupsByType(groupsByType);
  const nextAssignedColors = cloneAssignedColors(assignedColors, defaultColor);

  const allModes = [...(normalizedConfig.GROUP_TYPES || ['coref']), ...(normalizedConfig.EDGE_TYPES || ['bridge'])];
  allModes.forEach(mode => {
      if (!nextGroupsByType[mode]) nextGroupsByType[mode] = { 0: [] };
      if (!nextAssignedColors[mode]) nextAssignedColors[mode] = { 0: defaultColor };
  });

  return {
    tokens: [...tokens],
    entitiesById: { ...entitiesById },
    groupsByType: nextGroupsByType,
    assignedColors: nextAssignedColors,
    uiState: {
      colorMode: uiState.colorMode || 'entities',
      selectedTokens: uiState.selectedTokens instanceof Set ? new Set(uiState.selectedTokens) : new Set(),
      selectedEntities: uiState.selectedEntities instanceof Set ? new Set(uiState.selectedEntities) : new Set(),
      activeEntityId: uiState.activeEntityId || '',
      hoveredGroupEntities: uiState.hoveredGroupEntities instanceof Set ? new Set(uiState.hoveredGroupEntities) : new Set(),
      hoveredBridgeEntityId: uiState.hoveredBridgeEntityId || uiState.hoveredEdgeEntityId || '',
      contextMenu: uiState.contextMenu || { open: false, x: 0, y: 0, entityId: '' },
      dialogs: {
        showImportDialog: Boolean(uiState.dialogs?.showImportDialog),
        showExportDialog: Boolean(uiState.dialogs?.showExportDialog),
        showAnnotationDialog: Boolean(uiState.dialogs?.showAnnotationDialog)
      }
    },
    summaries: [...summaries],
    config: normalizedConfig
  };
}

export function createInitialAnnotationState(initialText = '', configOverrides = {}) {
  const config = buildSpannotatorConfig(configOverrides);
  return createAnnotationState({
    tokens: parseTextToTokens(initialText),
    entitiesById: {},
    groupsByType: {},
    assignedColors: {},
    summaries: [],
    config
  });
}

export function assertStateInvariants(state, { throwOnError = true } = {}) {
  const errors = [];
  const entitiesById = state?.entitiesById || {};
  const groupsByType = state?.groupsByType || {};
  const tokens = state?.tokens || [];
  const assignedColors = state?.assignedColors || {};
  const defaultColor = state?.config?.GLOBAL_DEFAULTS?.DEFAULT_COLOR || DEFAULT_SPANNOTATOR_CONFIG.GLOBAL_DEFAULTS.DEFAULT_COLOR;

  const tokenById = {};
  tokens.forEach((t) => {
    tokenById[t.tid] = t;
  });

  const entityIds = Object.keys(entitiesById);

  entityIds.forEach((id) => {
    const entity = entitiesById[id];
    if (!entity) return;

    if (entity.div_id !== id) {
      errors.push(`Entity ${id} has mismatched div_id ${entity.div_id}.`);
    }

    const expectedDiv = `${entity.start}-${entity.end}`;
    if (expectedDiv !== id) {
      errors.push(`Entity ${id} key does not match start/end (${expectedDiv}).`);
    }

    const tokIds = uniqueSortedNumbers(entity.toks || []);
    if (tokIds.length === 0) {
      errors.push(`Entity ${id} has empty token range.`);
      return;
    }

    if (entity.start !== tokIds[0] || entity.end !== tokIds[tokIds.length - 1]) {
      errors.push(`Entity ${id} has inconsistent start/end vs toks.`);
    }

    for (let i = 1; i < tokIds.length; i += 1) {
      if (tokIds[i] !== tokIds[i - 1] + 1) {
        errors.push(`Entity ${id} token range is not contiguous.`);
        break;
      }
    }

    const firstToken = tokenById[tokIds[0]];
    if (!firstToken) {
      errors.push(`Entity ${id} references missing token ${tokIds[0]}.`);
    }

    const sentnum = firstToken?.sentnum;
    tokIds.forEach((tid) => {
      const tok = tokenById[tid];
      if (!tok) {
        errors.push(`Entity ${id} references missing token ${tid}.`);
        return;
      }
      if (sentnum != null && tok.sentnum !== sentnum) {
        errors.push(`Entity ${id} spans multiple sentences.`);
      }
    });
  });

  for (let i = 0; i < entityIds.length; i += 1) {
    for (let j = i + 1; j < entityIds.length; j += 1) {
      const a = entitiesById[entityIds[i]];
      const b = entitiesById[entityIds[j]];
      if (!a || !b) continue;
      if (hasCrossingOverlap(a, b.start, b.end)) {
        errors.push(`Crossing overlap between ${a.div_id} and ${b.div_id}.`);
      }
    }
  }

  const allModes = [...(state.config?.GROUP_TYPES || ['coref']), ...(state.config?.EDGE_TYPES || ['bridge'])];
  allModes.forEach((groupType) => {
    const groupMap = groupsByType[groupType] || { 0: [] };
    if (!groupMap[0]) {
      errors.push(`Missing group 0 for ${groupType}.`);
    }

    Object.keys(groupMap).forEach((gid) => {
      const groupId = normalizeGroupId(gid);
      (groupMap[gid] || []).forEach((entityId) => {
        const entity = entitiesById[entityId];
        if (!entity) {
          errors.push(`Group ${groupType}:${groupId} contains unknown entity ${entityId}.`);
          return;
        }
        const entityGroup = normalizeGroupId(entity.groups?.[groupType]);
        if (entityGroup !== groupId) {
          errors.push(`Group mismatch for ${entityId} in ${groupType}: entity=${entityGroup}, groupMap=${groupId}.`);
        }
      });
    });

    entityIds.forEach((entityId) => {
      const entity = entitiesById[entityId];
      const entityGroup = normalizeGroupId(entity.groups?.[groupType]);
      const members = groupsByType[groupType]?.[entityGroup] || [];
      if (!members.includes(entityId)) {
        errors.push(`Entity ${entityId} missing from ${groupType}:${entityGroup}.`);
      }
    });
    
    if ((assignedColors[groupType] || {})[0] !== defaultColor) {
      errors.push(`Group 0 color mismatch for ${groupType}.`);
    }
  });

  const edgeTypes = state.config?.EDGE_TYPES || ['bridge'];
  entityIds.forEach((entityId) => {
    const entity = entitiesById[entityId];
    
    edgeTypes.forEach(mode => {
        const edgeGroup = normalizeGroupId(entity.groups?.[mode]);
        const antec = entity.antecedents?.[mode] || (mode === 'bridge' ? entity.bridge_antec : '_');
        
        if (edgeGroup === 0) {
          if (antec && antec !== '_') {
            if (!entitiesById[antec]) {
              errors.push(`Ungrouped ${mode} entity ${entityId} points to missing antecedent ${antec}.`);
            }
          }
          return;
        }

        const members = sortByStart(groupsByType[mode]?.[edgeGroup] || []);
        const rootId = members[0] || null;
        const isEdgeRoot = rootId === entityId;

        if (isEdgeRoot) {
          if (antec && antec !== '_') {
            const antecEntity = entitiesById[antec];
            if (!antecEntity) {
              errors.push(`${mode} root ${entityId} points to missing antecedent ${antec}.`);
            }
          }
          return;
        }

        if (!antec || antec === '_') {
          errors.push(`${mode}-grouped entity ${entityId} is missing antecedent.`);
          return;
        }

        if (antec === entityId) {
          errors.push(`${mode} entity ${entityId} cannot point to itself.`);
          return;
        }

        const antecEntity = entitiesById[antec];
        if (!antecEntity) {
          errors.push(`${mode} entity ${entityId} points to missing antecedent ${antec}.`);
          return;
        }

        const antecGroup = normalizeGroupId(antecEntity.groups?.[mode]);
        if (antecGroup !== edgeGroup) {
          errors.push(`${mode} entity ${entityId} antecedent ${antec} is in different ${mode} group.`);
        }

        if (antecEntity.start >= entity.start) {
          errors.push(`${mode} entity ${entityId} antecedent ${antec} must precede anaphor.`);
        }
    });
  });

  if (errors.length > 0 && throwOnError) {
    throw new Error(`Spannotator state invariant violation:\n${errors.join('\n')}`);
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function addEntityMutation(nextState, { tokenIds, entityType }) {
  const tokIds = uniqueSortedNumbers(tokenIds || []);
  if (tokIds.length === 0) return;

  for (let i = 1; i < tokIds.length; i += 1) {
    if (tokIds[i] !== tokIds[i - 1] + 1) return;
  }

  const tokenById = {};
  nextState.tokens.forEach((t) => {
    tokenById[t.tid] = t;
  });

  const start = tokIds[0];
  const end = tokIds[tokIds.length - 1];
  const divId = `${start}-${end}`;
  if (nextState.entitiesById[divId]) return;

  const sentnum = tokenById[start]?.sentnum;
  if (!sentnum) return;
  if (tokIds.some((tid) => tokenById[tid]?.sentnum !== sentnum)) return;

  for (const existing of Object.values(nextState.entitiesById)) {
    if (hasCrossingOverlap(existing, start, end)) return;
  }
  
  const initialGroups = {};
  const initialAntecedents = {};
  const groupTypes = nextState.config?.GROUP_TYPES || ['coref'];
  const edgeTypes = nextState.config?.EDGE_TYPES || ['bridge'];
  
  groupTypes.forEach(mode => initialGroups[mode] = 0);
  edgeTypes.forEach(mode => {
     initialGroups[mode] = 0;
     initialAntecedents[mode] = '_';
  });

  const type = entityType || nextState.config.GLOBAL_DEFAULTS.DEFAULT_ENTITY_TYPE;
  nextState.entitiesById[divId] = {
    type,
    start,
    end,
    toks: tokIds,
    length: end - start + 1,
    div_id: divId,
    annos: { ...nextState.config.DEFAULT_ANNOS },
    salienceField: true,
    identity: '_',
    bridge_antec: '_',
    antecedents: initialAntecedents,
    next: {},
    groups: initialGroups
  };

  groupTypes.forEach(mode => ensureEntityInGroup(nextState.groupsByType, mode, 0, divId));
  edgeTypes.forEach(mode => ensureEntityInGroup(nextState.groupsByType, mode, 0, divId));

  nextState.uiState.activeEntityId = divId;
  nextState.uiState.selectedTokens = new Set();
  nextState.uiState.selectedEntities = new Set();
}

function groupSelectedMutation(nextState, { groupType }) {
  const groupTypes = nextState.config?.GROUP_TYPES || ['coref'];
  const edgeTypes = nextState.config?.EDGE_TYPES || ['bridge'];
  const isGroup = groupTypes.includes(groupType);
  const isEdge = edgeTypes.includes(groupType);
  if (!isGroup && !isEdge) return;
  
  const selectedIds = Array.from(nextState.uiState.selectedEntities || []).filter((id) => !!nextState.entitiesById[id]);
  if (selectedIds.length < 2) return;

  const involved = new Set();
  let hasZero = false;
  selectedIds.forEach((entityId) => {
    const gid = normalizeGroupId(nextState.entitiesById[entityId]?.groups?.[groupType]);
    if (gid > 0) involved.add(gid);
    if (gid === 0) hasZero = true;
  });

  const isSingleExistingGroupSelection = involved.size === 1 && !hasZero;
  const singleGroupId = isSingleExistingGroupSelection ? Array.from(involved)[0] : null;
  const singleGroupMembers = singleGroupId != null
    ? (nextState.groupsByType[groupType]?.[singleGroupId] || []).filter((id) => !!nextState.entitiesById[id])
    : [];
  const isEntireSingleGroupSelected = isSingleExistingGroupSelection
    && singleGroupMembers.length === selectedIds.length
    && singleGroupMembers.every((id) => selectedIds.includes(id));

  if (isEntireSingleGroupSelected) return;

  let targetGroup = Infinity;
  if (isSingleExistingGroupSelection) {
    targetGroup = nextGroupId(nextState.groupsByType, groupType);
  } else {
    involved.forEach((g) => {
      if (g < targetGroup) targetGroup = g;
    });
    if (targetGroup === Infinity) {
      targetGroup = nextGroupId(nextState.groupsByType, groupType);
    }

    involved.forEach((oldGroupId) => {
      const memberIds = nextState.groupsByType[groupType]?.[oldGroupId] || [];
      memberIds.forEach((memberId) => {
        assignGroupForEntity({
          entitiesById: nextState.entitiesById,
          groupsByType: nextState.groupsByType,
          assignedColors: nextState.assignedColors,
          groupType,
          entityId: memberId,
          newGroup: targetGroup,
          oldGroupHint: oldGroupId,
          defaultColor: nextState.config.GLOBAL_DEFAULTS.DEFAULT_COLOR,
          corefColors: nextState.config.COREF_COLORS
        });
      });
    });
  }

  selectedIds.forEach((entityId) => {
    assignGroupForEntity({
      entitiesById: nextState.entitiesById,
      groupsByType: nextState.groupsByType,
      assignedColors: nextState.assignedColors,
      groupType,
      entityId,
      newGroup: targetGroup,
      defaultColor: nextState.config.GLOBAL_DEFAULTS.DEFAULT_COLOR,
      corefColors: nextState.config.COREF_COLORS
    });
  });

  if (isGroup) {
    const members = nextState.groupsByType[groupType]?.[targetGroup] || [];
    if (members.length > 0) {
      const syncKey = String(nextState.config?.CAROUSEL_SYNC_KEY || nextState.config?.SALIENCE_SETTINGS?.key || 'salience').trim() || 'salience';
      const merged = mergeCheckValues(members.map((id) => nextState.entitiesById[id]?.annos?.[syncKey]), nextState.config, syncKey);
      members.forEach((id) => {
        if (!nextState.entitiesById[id]) return;
        nextState.entitiesById[id] = {
          ...nextState.entitiesById[id],
          annos: {
            ...nextState.entitiesById[id].annos,
            [syncKey]: merged
          },
          salienceField: true
        };
      });
      
      if (nextState.config?.GROUP_BEHAVIORS?.[groupType] === 'sametype') {
            enforceClusterSameType(nextState.entitiesById, members);
      }
    }
  }

  if (isEdge) {
    const minDivId = sortByStart(selectedIds)[0];
    selectedIds.forEach((entityId) => {
      if (entityId === minDivId) return;
      const entity = nextState.entitiesById[entityId];
      if (!entity) return;
      
      let nextAnnos = { ...entity.annos };
      if (groupType === 'bridge') {
         nextAnnos.infstat = entity.annos?.infstat === 'split' ? entity.annos.infstat : 'acc';
         nextAnnos.bridgetype = entity.annos?.bridgetype === 'nobridge' ? 'entity-associative' : entity.annos?.bridgetype;
      }
      
      nextState.entitiesById[entityId] = {
        ...entity,
        bridge_antec: groupType === 'bridge' ? minDivId : entity.bridge_antec,
        antecedents: {
            ...(entity.antecedents || {}),
            [groupType]: minDivId
        },
        annos: nextAnnos
      };
    });
  }

  nextState.uiState.selectedEntities = new Set();
}

function ungroupSelectedMutation(nextState, { groupType }) {
  const groupTypes = nextState.config?.GROUP_TYPES || ['coref'];
  const edgeTypes = nextState.config?.EDGE_TYPES || ['bridge'];
  const isGroup = groupTypes.includes(groupType);
  const isEdge = edgeTypes.includes(groupType);
  if (!isGroup && !isEdge) return;
  
  const selectedIds = Array.from(nextState.uiState.selectedEntities || []);
  if (selectedIds.length === 0) return;

  selectedIds.forEach((entityId) => {
    assignGroupForEntity({
      entitiesById: nextState.entitiesById,
      groupsByType: nextState.groupsByType,
      assignedColors: nextState.assignedColors,
      groupType,
      entityId,
      newGroup: 0,
      defaultColor: nextState.config.GLOBAL_DEFAULTS.DEFAULT_COLOR,
      corefColors: nextState.config.COREF_COLORS
    });

    if (isEdge && nextState.entitiesById[entityId]) {
      const entity = nextState.entitiesById[entityId];
      let nextAnnos = { ...entity.annos };
      
      if (groupType === 'bridge') {
          nextAnnos.bridgetype = 'nobridge';
          nextAnnos.infstat = nextAnnos.infstat === 'acc' ? 'auto' : nextAnnos.infstat;
      } else {
          const edgeConf = nextState.config.colors?.edges?.[groupType] || {};
          const typeKeys = Object.keys(edgeConf).filter(k => Array.isArray(edgeConf[k]));
          typeKeys.forEach(k => nextAnnos[k] = `no${groupType}`);
      }

      nextState.entitiesById[entityId] = {
        ...entity,
        bridge_antec: groupType === 'bridge' ? '_' : entity.bridge_antec,
        antecedents: {
            ...(entity.antecedents || {}),
            [groupType]: '_'
        },
        annos: nextAnnos
      };
    }
  });

  nextState.uiState.selectedEntities = new Set();
}

function isDevEnvironment() {
  try {
    return typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

export function spannotatorReducer(state, action) {
  const nextState = {
    ...state,
    tokens: [...state.tokens],
    entitiesById: { ...state.entitiesById },
    groupsByType: cloneGroupsByType(state.groupsByType),
    assignedColors: cloneAssignedColors(state.assignedColors, state.config.GLOBAL_DEFAULTS.DEFAULT_COLOR),
    uiState: {
      ...state.uiState,
      selectedTokens: new Set(state.uiState.selectedTokens || []),
      selectedEntities: new Set(state.uiState.selectedEntities || []),
      hoveredGroupEntities: new Set(state.uiState.hoveredGroupEntities || []),
      dialogs: { ...(state.uiState.dialogs || {}) },
      contextMenu: { ...(state.uiState.contextMenu || { open: false, x: 0, y: 0, entityId: '' }) }
    },
    summaries: [...(state.summaries || [])]
  };

  switch (action.type) {
    case 'REPLACE_ALL_STATE': {
      return createAnnotationState({
        tokens: action.payload.tokens,
        entitiesById: action.payload.entitiesById,
        groupsByType: action.payload.groupsByType,
        assignedColors: action.payload.assignedColors,
        uiState: action.payload.uiState,
        summaries: action.payload.summaries,
        config: action.payload.config || state.config
      });
    }
    case 'SET_TOKENS':
      nextState.tokens = [...(action.tokens || [])];
      break;
    case 'SET_UI_STATE':
      nextState.uiState = {
        ...nextState.uiState,
        ...(action.patch || {})
      };
      break;
    case 'ADD_ENTITY':
      addEntityMutation(nextState, {
        tokenIds: action.tokenIds,
        entityType: action.entityType
      });
      break;
    case 'DELETE_ENTITY':
      removeEntityFromState(nextState, action.entityId);
      break;
    case 'ASSIGN_GROUP':
      assignGroupForEntity({
        entitiesById: nextState.entitiesById,
        groupsByType: nextState.groupsByType,
        assignedColors: nextState.assignedColors,
        groupType: action.groupType,
        entityId: action.entityId,
        newGroup: action.newGroup,
        oldGroupHint: action.oldGroup,
        defaultColor: nextState.config.GLOBAL_DEFAULTS.DEFAULT_COLOR,
        corefColors: nextState.config.COREF_COLORS
      });
      if (action.newGroup > 0 && nextState.config?.GROUP_BEHAVIORS?.[action.groupType] === 'sametype') {
        const members = nextState.groupsByType[action.groupType]?.[action.newGroup] || [];
        enforceClusterSameType(nextState.entitiesById, members);
      }
      break;
    case 'GROUP_SELECTED':
      groupSelectedMutation(nextState, { groupType: action.groupType });
      break;
    case 'UNGROUP_SELECTED':
      ungroupSelectedMutation(nextState, { groupType: action.groupType });
      break;
    default:
      return state;
  }

  if (isDevEnvironment()) {
    assertStateInvariants(nextState, { throwOnError: true });
  }

  return nextState;
}

export function createSelectors() {
  let tokenRef = null;
  let tokensByIdCache = null;
  let sentenceRef = null;
  let sentenceMapCache = null;

  const getTokensById = (state) => {
    if (tokenRef === state.tokens && tokensByIdCache) return tokensByIdCache;
    tokenRef = state.tokens;
    tokensByIdCache = {};
    (state.tokens || []).forEach((tok) => {
      tokensByIdCache[tok.tid] = tok;
    });
    return tokensByIdCache;
  };

  const getSentenceMap = (state) => {
    if (sentenceRef === state.tokens && sentenceMapCache) return sentenceMapCache;
    sentenceRef = state.tokens;
    sentenceMapCache = {};
    (state.tokens || []).forEach((tok) => {
      if (!sentenceMapCache[tok.sentnum]) sentenceMapCache[tok.sentnum] = [];
      sentenceMapCache[tok.sentnum].push(tok.tid);
    });
    return sentenceMapCache;
  };

  const getEntitiesBySentence = (state) => {
    const tokensById = getTokensById(state);
    const bySentence = {};
    Object.values(state.entitiesById || {}).forEach((entity) => {
      const sent = tokensById[entity.start]?.sentnum;
      if (!sent) return;
      if (!bySentence[sent]) bySentence[sent] = [];
      bySentence[sent].push(entity.div_id);
    });
    Object.keys(bySentence).forEach((key) => {
      bySentence[key] = sortByStart(bySentence[key]);
    });
    return bySentence;
  };

  const getCorefTriggerIds = (state) => {
    const ids = new Set();
    const primaryGroup = state.config?.GROUP_TYPES?.[0] || 'coref';
    const corefGroups = state.groupsByType?.[primaryGroup] || {};
    Object.keys(corefGroups).forEach((gid) => {
      const groupId = normalizeGroupId(gid);
      const members = corefGroups[gid] || [];
      if (groupId === 0) {
        members.forEach((id) => ids.add(id));
        return;
      }
      const sorted = sortByStart(members);
      if (sorted.length > 0) ids.add(sorted[0]);
    });
    return ids;
  };

  const getParentChildrenMaps = (state) => {
    const parentMap = {};
    const childrenMap = {};
    const primaryEdge = state.config?.EDGE_TYPES?.[0] || 'bridge';
    Object.values(state.entitiesById || {}).forEach((entity) => {
      const antec = entity.antecedents?.[primaryEdge] || (primaryEdge === 'bridge' ? entity.bridge_antec : '_');
      if (antec && antec !== '_') {
        parentMap[entity.div_id] = antec;
        if (!childrenMap[antec]) childrenMap[antec] = [];
        childrenMap[antec].push(entity.div_id);
      }
    });
    Object.keys(childrenMap).forEach((id) => {
      childrenMap[id] = sortByStart(childrenMap[id]);
    });
    return { parentMap, childrenMap };
  };

  return {
    tokensById: getTokensById,
    sentenceMap: getSentenceMap,
    entitiesBySentence: getEntitiesBySentence,
    corefTriggerIds: getCorefTriggerIds,
    parentChildrenMaps: getParentChildrenMaps
  };
}
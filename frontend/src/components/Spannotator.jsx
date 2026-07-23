import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Bell,
  Landmark,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  FileDown,
  FileUp,
  Flame,
  FlaskConical,
  Group,
  HelpCircle,
  Leaf,
  Link,
  MapPin,
  PawPrint,
  Plus,
  Timeline,
  Unlink,
  User,
  PersonStanding,
  Box,
  X,
  XCircle,
  Clock3,
  Star
} from 'lucide-react';
import './spannotator/spannotator.css';
import {
  buildSpannotatorConfig,
  bridgeCoarseDefault,
  columnMajorOrder,
  createAnnotationState,
  countCheckValues,
  entityText,
  findEntitiesByTextAndType,
  getAnnotationCheckSettings,
  getAnnotationKind,
  getAnnotationKeys,
  getNamedEntityTypes,
  getAnnotationStarColor,
  hasCrossingOverlap,
  mergeCheckValues,
  nextGroupId,
  normalizeCheckValue,
  parseTextToTokens,
  priorityOrderBridge,
  spannotatorReducer,
  sortByStart
} from './spannotator/model';
import { exportSpannotatorData, importSpannotatorData } from './spannotator/io';

const SOCIALCALC_SIGNATURE = 'SocialCalcSpreadsheetControlSave';

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseConfigBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return false;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return false;
}

function getAllowedEntityAnnotationKeysFromConfig(config = {}) {
  const annotationRoot = (config?.entities?.annotations && typeof config.entities.annotations === 'object')
    ? config.entities.annotations
    : ((config?.annotations && typeof config.annotations === 'object') ? config.annotations : null);
  const colorsRoot = (config?.entities?.colors && typeof config.entities.colors === 'object')
    ? config.entities.colors
    : ((config?.colors && typeof config.colors === 'object') ? config.colors : null);

  const allowed = [];
  const addAllowed = (value) => {
    const key = String(value || '').trim();
    if (!key) return;
    if (!allowed.includes(key)) allowed.push(key);
  };

  const entityBlock = annotationRoot?.entity && typeof annotationRoot.entity === 'object'
    ? annotationRoot.entity
    : null;
  if (entityBlock) {
    const entityEntry = Object.entries(entityBlock).find(([, v]) => Array.isArray(v));
    if (entityEntry?.[0]) addAllowed(entityEntry[0]);
    if (typeof entityBlock.identity === 'string') addAllowed(entityBlock.identity);
  }

  const keyBlock = annotationRoot?.keys && typeof annotationRoot.keys === 'object' ? annotationRoot.keys : null;
  if (keyBlock) {
    Object.keys(keyBlock).forEach((key) => addAllowed(key));
  }

  const checkBlock = annotationRoot?.checks && typeof annotationRoot.checks === 'object' ? annotationRoot.checks : null;
  if (checkBlock) {
    Object.keys(checkBlock).forEach((key) => addAllowed(key));
  }

  const edgeBlocks = colorsRoot?.edges && typeof colorsRoot.edges === 'object' ? colorsRoot.edges : null;
  if (edgeBlocks) {
    Object.values(edgeBlocks).forEach((edgeBlock) => {
      if (!edgeBlock || typeof edgeBlock !== 'object') return;
      Object.entries(edgeBlock).forEach(([key, value]) => {
        if (['showcoarse', 'show_coarse', 'coarse_separator'].includes(key)) return;
        if (!Array.isArray(value)) return;
        addAllowed(key);
      });
    });
  }

  return allowed;
}

function isSocialCalcPayload(rawInput) {
  const raw = String(rawInput || '');
  return raw.includes(SOCIALCALC_SIGNATURE) || /^\s*socialcalc:version:/im.test(raw) || /^\s*cell:[A-Z]+\d+:/m.test(raw);
}

function isClientSideImportPayload(rawInput) {
  const raw = String(rawInput || '');
  if (isSocialCalcPayload(raw)) return true;
  if (raw.includes('#FORMAT=WebAnno')) return true;
  if (raw.includes('<entity') || raw.includes('<s>') || /^\s*<[^>]+>\s*$/m.test(raw)) return true;
  return false;
}

function encodeSocialCalcText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\b')
    .replace(/:/g, '\\c')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function buildSocialCalcBootstrapRaw(tokens, tokenHeader = 'tok') {
  const safeHeader = String(tokenHeader || 'tok').trim() || 'tok';
  const headerLine = `cell:A1:t:${encodeSocialCalcText(safeHeader)}:f:2`;
  const tokenLines = (tokens || []).map((tok, idx) => {
    const row = idx + 2;
    return `cell:A${row}:t:${encodeSocialCalcText(tok.word || '')}:f:1:tvf:1`;
  });
  const maxRow = Math.max(1, (tokens || []).length + 1);

  return [
    'socialcalc:version:1.0',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    '# SocialCalc Spreadsheet Control Save',
    'version:1.0',
    'part:sheet',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    'version:1.5',
    headerLine,
    ...tokenLines,
    `sheet:c:1:r:${maxRow}:tvf:2`,
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '--SocialCalcSpreadsheetControlSave--'
  ].join('\n');
}

const LEGACY_ICON_MAP = {
  user: User,
  personstanding: PersonStanding,
  clock3: Clock3,
  helpcircle: HelpCircle,
  mappin: MapPin,
  flaskconical: FlaskConical,
  pawprint: PawPrint,
  male: User,
  'clock-o': Clock3,
  cloud: Cloud,
  cube: Box,
  paw: PawPrint,
  pagelines: Leaf,
  'map-marker': MapPin,
  flask: FlaskConical,
  bank: Landmark,
  bell: Bell,
  question: HelpCircle
};

function LegacyEntityIcon({ iconName, title, className, size = 12 }) {
  const normalized = String(iconName || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const Icon = LEGACY_ICON_MAP[iconName] || LEGACY_ICON_MAP[normalized] || HelpCircle;
  return <Icon title={title} size={size} strokeWidth={1.9} className={className} />;
}

const TokenNode = React.memo(function TokenNode({ tok, selected, resizeClassName = '', onMouseDown, onMouseEnter, onClick }) {
  return (
    <div
      id={`t${tok.tid}`}
      toknum={tok.tid}
      className={`tok s${tok.sentnum} ${selected ? 'ui-selected' : ''} ${resizeClassName}`}
      onMouseDown={(event) => onMouseDown(event, tok.tid)}
      onMouseEnter={(event) => onMouseEnter(event, tok.tid)}
      onClick={(event) => onClick(event, tok.tid)}
    >
      {tok.word}
    </div>
  );
});

const EntityNode = React.memo(function EntityNode({
  child,
  childId,
  entityClassName,
  entityStyle,
  entityTitle,
  iconType,
  childType,
  starColor,
  salienceLabel,
  showEdgeIcons,
  edgeWarn,
  renderRange,
  onEntityClick,
  onEntityMouseMove,
  onEntityMouseDown,
  onEntityHover,
  onEntityDoubleClick,
  onOpenTypeMenu,
  onDeleteEntity,
  onEntityMouseLeave
}) {
  return (
    <div
      id={childId}
      data-entity-id={childId}
      className={entityClassName}
      style={entityStyle}
      onClick={(event) => onEntityClick(event, childId)}
      onMouseMove={(event) => onEntityMouseMove(event, childId)}
      onMouseDown={(event) => onEntityMouseDown(event, childId)}
      onMouseEnter={() => onEntityHover(childId)}
      onMouseLeave={() => onEntityMouseLeave(childId)}
      onDoubleClick={(event) => { event.stopPropagation(); onEntityDoubleClick(childId); }}
      title={entityTitle}
    >
      <div id={`icon${childId}`} className="entity_type" onMouseDown={(event) => onOpenTypeMenu(event, childId)} onClick={(event) => event.stopPropagation()}>
        <LegacyEntityIcon iconName={iconType} title={childType} className="entity_icon entity_type_icon" size={11} />
        <Star
          title="accessible"
          className="entity_icon highlight-star"
          style={starColor
            ? {
              display: 'inline-block',
              color: starColor,
              fill: starColor,
              stroke: 'rgba(0, 0, 0, 0.6)',
              strokeWidth: 1.8
            }
            : { display: 'none' }}
          size={11}
        />
        <span title="salience" className="entity_icon salience" style={{ display: salienceLabel ? 'inline-block' : 'none' }}>
          {salienceLabel}
        </span>
      </div>

      {renderRange(child.start, child.end, childId)}

      <div
        id={`bridge${childId}`}
        className="bridge"
        style={{ display: showEdgeIcons ? 'inline-block' : 'none', color: edgeWarn ? 'red' : 'green' }}
      >
        {showEdgeIcons ? (edgeWarn ? <AlertTriangle size={11} className="entity_icon" /> : <Check size={11} className="entity_icon" />) : null}
      </div>

      <div id={`close${childId}`} className="close" onMouseDown={(event) => onDeleteEntity(event, childId)}>
        <XCircle title="close" size={11} className="entity_icon" />
      </div>
    </div>
  );
});

export default function Spannotator({
  initialText = '',
  className = '',
  config = {},
  fontFamily = null,
  value,
  onChange,
  onImportSgml,
  onRunTool,
  mutationTools = {},
  onGuessIdentities,
  onFetchIdentitySuggestions,
  onMetadataChange,
  meta_dict = {},
  externalControlsHostId = ''
}) {
  const modelConfig = useMemo(() => buildSpannotatorConfig(config), [config]);
  
  // -- Dynamic Configuration Extraction --
  const configuredGroups = useMemo(() => {
    const raw = modelConfig?.GROUP_TYPES;
    if (Array.isArray(raw) && raw.length > 0) return raw;
    if (raw && typeof raw === 'object') {
      const keys = Object.keys(raw);
      if (keys.length > 0) return keys;
    }
    return [];
  }, [modelConfig]);

  const configuredEdges = useMemo(() => {
    const raw = modelConfig?.EDGE_TYPES;
    if (Array.isArray(raw) && raw.length > 0) return raw;
    if (raw && typeof raw === 'object') {
      const keys = Object.keys(raw);
      if (keys.length > 0) return keys;
    }
    return [];
  }, [modelConfig]);

  const allColorModes = useMemo(() => {
    return [...configuredGroups, ...configuredEdges];
  }, [configuredGroups, configuredEdges]);
  // --------------------------------------

  const {
    ICON_MAP,
    GLOBAL_DEFAULTS,
    DEFAULT_ANNOS,
    DRAG_TOL,
    ANNO_VALUES,
    BRIDGETYPE_PRIORITY,
    COREF_COLORS
  } = modelConfig;
  const summarySyncKey = String(modelConfig.CAROUSEL_SYNC_KEY || modelConfig.SALIENCE_SETTINGS?.key || 'salience').trim() || 'salience';
  const summarySyncSettings = useMemo(() => getAnnotationCheckSettings(modelConfig, summarySyncKey), [modelConfig, summarySyncKey]);
  const salienceSettings = modelConfig.SALIENCE_SETTINGS || { count: 5, falseChar: 'n', trueChar: 's' };
  const salienceFalseChar = String(salienceSettings.falseChar || 'n').charAt(0) || 'n';
  const salienceTrueChar = String(salienceSettings.trueChar || 's').charAt(0) || 's';
  const bridgeCoarseSeparator = String(modelConfig.BRIDGE_COARSE_SEPARATOR || '-');

  const rootRef = useRef(null);
  const summaryMeasureRef = useRef(null);
  const [tokens, setTokens] = useState(() => parseTextToTokens(initialText));
  const [entities, setEntities] = useState({});
  const annotationKeys = useMemo(() => {
    const configured = Array.isArray(modelConfig.ANNOTATION_KEYS)
      ? modelConfig.ANNOTATION_KEYS
      : getAnnotationKeys(modelConfig);
    const configuredNormalized = configured
      .map((key) => String(key || '').trim())
      .filter((key) => key.length > 0 && key !== 'entity');

    const allowedFromConfig = getAllowedEntityAnnotationKeysFromConfig(modelConfig)
      .map((key) => String(key || '').trim())
      .filter((key) => key.length > 0 && key !== 'entity');

    const sentenceKey = String(modelConfig?.sent || '').trim();

    if (allowedFromConfig.length === 0) {
      const observed = new Set();
      Object.values(entities || {}).forEach((entity) => {
        Object.keys(entity?.annos || {}).forEach((key) => {
          const normalized = String(key || '').trim();
          if (!normalized || normalized === 'entity') return;
          if (sentenceKey && normalized === sentenceKey) return;
          observed.add(normalized);
        });
      });
      return [...configuredNormalized, ...[...observed].filter((key) => !configuredNormalized.includes(key))];
    }

    const allowedSet = new Set(allowedFromConfig);
    const orderedAllowed = configuredNormalized.filter((key) => allowedSet.has(key));
    allowedFromConfig.forEach((key) => {
      if (!orderedAllowed.includes(key)) orderedAllowed.push(key);
    });
    return orderedAllowed;
  }, [entities, modelConfig]);

  // Initializations now defer to the data import/load logic, 
  // but provide generic defaults matching the config if completely empty.
  const [groups, setGroups] = useState({ coref: { 0: [] }, bridge: { 0: [] } });
  const [assignedColors, setAssignedColors] = useState({ coref: { 0: GLOBAL_DEFAULTS.DEFAULT_COLOR }, bridge: { 0: GLOBAL_DEFAULTS.DEFAULT_COLOR } });
  
  const [colorMode, setColorMode] = useState('entities');
  const [selectedTokens, setSelectedTokens] = useState(new Set());
  const [selectedEntities, setSelectedEntities] = useState(new Set());
  const [activeEntityId, setActiveEntityId] = useState('');
  const [sentenceMode, setSentenceMode] = useState('text');
  const [hoveredGroupEntities, setHoveredGroupEntities] = useState(new Set());
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0, entityId: '' });
  const [resizeHover, setResizeHover] = useState({ entityId: null, side: null });
  const [resizeDragUI, setResizeDragUI] = useState(null);
  const resizeDragRef = useRef(null);
  const tokenDragRef = useRef({ active: false, anchor: null, mode: 'replace', base: new Set() });
  const lastTokenClickRef = useRef(null);

  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [exportFormat, setExportFormat] = useState('webanno');
  const [socialcalcModel, setSocialcalcModel] = useState(null);

  const [showAnnotationDialog, setShowAnnotationDialog] = useState(false);
  const [selectedAnnoKey, setSelectedAnnoKey] = useState(() => annotationKeys[0] || '');
  const [showGranularSubtypes, setShowGranularSubtypes] = useState(false);
  const [showBridgeTriggers, setShowBridgeTriggers] = useState(false);
  const [summaries, setSummaries] = useState([]);
  const [activeSummaryIndex, setActiveSummaryIndex] = useState(0);
  const [hoveredEdgeEntityId, setHoveredEdgeEntityId] = useState('');
  const [summaryBarHeight, setSummaryBarHeight] = useState(0);
  const [showNamedEntityLinkingPanel, setShowNamedEntityLinkingPanel] = useState(false);
  const [namedEntityListing, setNamedEntityListing] = useState({});
  const [namedEntityIdentityInputs, setNamedEntityIdentityInputs] = useState({});
  const [namedEntityMatchIdsByInputKey, setNamedEntityMatchIdsByInputKey] = useState({});
  const [pendingNamedEntityIdentitySuggestions, setPendingNamedEntityIdentitySuggestions] = useState({});
  const [activeTools, setActiveTools] = useState({});
  const [isGuessIdentitiesRunning, setIsGuessIdentitiesRunning] = useState(false);
  const [identitySuggestions, setIdentitySuggestions] = useState({});
  const lastImportedValueRef = useRef(null);
  const lastEmittedValueRef = useRef(null);
  const hasHydratedControlledValueRef = useRef(false);
  const suppressNextControlledEmitRef = useRef(false);

  const showEntityLinking = parseConfigBoolean(
    modelConfig?.entities?.show_entity_linking ?? modelConfig?.show_entity_linking
  );
  const sentenceTooltipKey = String(
    config?.sentence_tooltip || 
    modelConfig?.sentence_tooltip || 
    'sp_who'
  ).trim();
  const showGuessIdentitiesButton = useMemo(() => {
    const rawValue = modelConfig?.entities?.guess_identities
      ?? config?.entities?.guess_identities
      ?? modelConfig?.guess_identities
      ?? config?.guess_identities;
    if (rawValue == null) return true;
    if (typeof rawValue === 'string' && rawValue.trim().length === 0) return true;
    return parseConfigBoolean(rawValue);
  }, [config, modelConfig]);
  const showFirstMentionsButton = useMemo(() => {
    const rawValue = modelConfig?.first_mentions
      ?? config?.first_mentions
      ?? modelConfig?.entities?.first_mentions
      ?? config?.entities?.first_mentions;
    if (rawValue == null) return true;
    if (typeof rawValue === 'string' && rawValue.trim().length === 0) return true;
    return parseConfigBoolean(rawValue);
  }, [config, modelConfig]);
  const identityAnnotationKey = String(
    modelConfig?.entities?.annotations?.entity?.identity
    || modelConfig?.annotations?.entity?.identity
    || 'identity'
  ).trim() || 'identity';
  const entityTypeAnnotationKey = String(modelConfig?.entity || 'entity').trim() || 'entity';

  const namedEntityInputKey = useCallback((entityType, textValue) => `${entityType}|||${textValue}`, []);

  const applyImportedData = useCallback((rawInput, options = {}) => {
    const isSocialCalcImport = isSocialCalcPayload(rawInput);
    
    // Unconditionally pass socialcalcModel so io.js can optionally merge on top of it.
    const importConfig = isSocialCalcImport
      ? {
        ...config,
        ...modelConfig,
        word: modelConfig.word || 'word',
        tok: modelConfig.tok || 'tok',
        meta_dict,
        socialcalc: socialcalcModel
      }
      : {
        ...config,
        ...modelConfig,
        meta_dict,
        socialcalc: socialcalcModel
      };

    const imported = importSpannotatorData(rawInput, importConfig);
    const shouldMergeIntoExistingSpreadsheet = Boolean(options.enforceSpreadsheetMerge) && isNonEmptyText(value);

    // If io.js detected matching token boundaries on a WebAnno import, 
    // it will have attached the preserved existing model here natively!
    let nextSocialcalcModel = imported.socialcalc || null;

    const canModelMapTokens = (model, tokenList) => {
      if (!model) return false;
      const hasPrimaryTokenColumn = (model.mappings?.wordCols?.length || 0) > 0 || (model.mappings?.tokCols?.length || 0) > 0;
      if (!hasPrimaryTokenColumn) return false;
      const tokenRowsByTid = model.tokenRowsByTid || {};
      return (tokenList || []).every((tok) => {
        const rowInfo = tokenRowsByTid?.[tok?.tid];
        return Boolean(rowInfo?.startRow && rowInfo?.endRow);
      });
    };

    if (shouldMergeIntoExistingSpreadsheet) {
      const existingTokenCount = tokens.length;
      const hasExistingTokens = existingTokenCount > 0;
      if (hasExistingTokens && existingTokenCount !== imported.tokens.length) {
        throw new Error(
          `Import canceled: token count mismatch (existing spreadsheet: ${existingTokenCount}, imported: ${imported.tokens.length}).`
        );
      }

      if (socialcalcModel?.raw) {
        nextSocialcalcModel = socialcalcModel;
      } else if (isSocialCalcPayload(value)) {
        const existingImported = importSpannotatorData(value, {
          ...config,
          ...modelConfig,
          word: modelConfig.word || 'word',
          tok: modelConfig.tok || 'tok',
          meta_dict
        });
        nextSocialcalcModel = existingImported.socialcalc || null;
      }

      const canReuseExistingModel = hasExistingTokens
        ? canModelMapTokens(nextSocialcalcModel, tokens)
        : canModelMapTokens(nextSocialcalcModel, imported.tokens);

      if (!canReuseExistingModel) {
        nextSocialcalcModel = imported.socialcalc || null;
      }

      if (hasExistingTokens && !nextSocialcalcModel) {
        throw new Error('Import canceled: existing spreadsheet content is not SocialCalc-backed, so merge-safe overwrite cannot be guaranteed.');
      }
    }

    if (!nextSocialcalcModel) {
      const bootstrapRaw = buildSocialCalcBootstrapRaw(imported.tokens, modelConfig.tok || 'tok');
      const bootstrapImported = importSpannotatorData(bootstrapRaw, {
        ...config,
        ...modelConfig,
        word: modelConfig.word || modelConfig.tok || 'tok',
        tok: modelConfig.tok || 'tok',
        meta_dict
      });
      nextSocialcalcModel = bootstrapImported.socialcalc || null;
    }

    const importedOwnedMeta = imported?.metadataOwned && typeof imported.metadataOwned === 'object'
      ? imported.metadataOwned
      : {};
    if (nextSocialcalcModel) {
      const baseMeta = nextSocialcalcModel.meta && typeof nextSocialcalcModel.meta === 'object'
        ? nextSocialcalcModel.meta
        : (meta_dict && typeof meta_dict === 'object' ? meta_dict : {});
      if (Object.keys(baseMeta).length > 0 || Object.keys(importedOwnedMeta).length > 0) {
        nextSocialcalcModel = {
          ...nextSocialcalcModel,
          meta: {
            ...baseMeta,
            ...importedOwnedMeta
          }
        }
      }
    }

    setTokens(imported.tokens);
    setEntities(imported.entities);
    setGroups(imported.groups);
    setAssignedColors(imported.assignedColors);
    setSummaries(imported.summaries);
    setSocialcalcModel(nextSocialcalcModel);
    setActiveSummaryIndex(0);
    setSelectedEntities(new Set());
    setSelectedTokens(new Set());

    if (options.closeDialog) {
      setShowImportDialog(false);
    }

    if (typeof onMetadataChange === 'function' && nextSocialcalcModel?.meta && typeof nextSocialcalcModel.meta === 'object') {
      onMetadataChange(nextSocialcalcModel.meta);
    }

    return imported;
  }, [config, meta_dict, modelConfig, onMetadataChange, socialcalcModel, tokens.length, value]);

  const harmonizeCorefSalience = (groupId, entityMap = entities) => {
    // Dynamic fallback for the primary grouping tier
    const primaryGroupType = configuredGroups[0] || 'coref';
    const members = groups[primaryGroupType]?.[groupId] || [];
    if (members.length === 0) return;
    const merged = mergeCheckValues(members.map((id) => entityMap[id]?.annos?.[summarySyncKey]), modelConfig, summarySyncKey);
    setEntities((prev) => {
      const next = { ...prev };
      members.forEach((id) => {
        if (!next[id]) return;
        next[id] = {
          ...next[id],
          annos: {
            ...next[id].annos,
            [summarySyncKey]: merged
          },
          salienceField: true
        };
      });
      return next;
    });
  };

  const tokensById = useMemo(() => {
    const m = {};
    tokens.forEach((t) => { m[t.tid] = t; });
    return m;
  }, [tokens]);

  const sentenceMap = useMemo(() => {
    const m = {};
    tokens.forEach((t) => {
      if (!m[t.sentnum]) m[t.sentnum] = [];
      m[t.sentnum].push(t.tid);
    });
    return m;
  }, [tokens]);

  const entitiesList = useMemo(() => Object.values(entities), [entities]);

  // Dynamically map dependents for ALL configured edge types
  const edgeDependentsByAntec = useMemo(() => {
    const map = {};
    configuredEdges.forEach(mode => map[mode] = {});
    
    entitiesList.forEach((entity) => {
      configuredEdges.forEach(mode => {
        const antec = entity.antecedents?.[mode] || (mode === 'bridge' ? entity.bridge_antec : '_');
        if (!antec || antec === '_') return;
        if (!map[mode][antec]) map[mode][antec] = [];
        map[mode][antec].push(entity.div_id);
      });
    });
    return map;
  }, [entitiesList, configuredEdges]);

  const bridgeTriggerIds = useMemo(() => {
    const ids = new Set();
    const primaryGroup = configuredGroups[0] || 'coref';
    Object.keys(groups[primaryGroup] || {}).forEach((gid) => {
      if (parseInt(gid, 10) === 0) {
        (groups[primaryGroup]?.[gid] || []).forEach((id) => ids.add(id));
        return;
      }
      const members = sortByStart(groups[primaryGroup]?.[gid] || []);
      if (members.length > 0) ids.add(members[0]);
    });
    return ids;
  }, [groups, configuredGroups]);

  const activeSummary = summaries[activeSummaryIndex] || '';
  const activeSummaryDisplay = summaries.length > 0 ? `${activeSummaryIndex + 1} ${activeSummary}` : '';

  useEffect(() => {
    if (annotationKeys.length === 0) return;
    if (!selectedAnnoKey || !annotationKeys.includes(selectedAnnoKey)) {
      setSelectedAnnoKey(annotationKeys[0]);
    }
  }, [annotationKeys, selectedAnnoKey]);

  const cycleSummaryIndex = (delta) => {
    if (summaries.length === 0) return;
    setActiveSummaryIndex((idx) => {
      const next = (idx + delta + summaries.length) % summaries.length;
      return next;
    });
  };

  useEffect(() => {
    if (summaries.length === 0) {
      setActiveSummaryIndex(0);
      setSummaryBarHeight(0);
      return;
    }
    if (activeSummaryIndex >= summaries.length) {
      setActiveSummaryIndex(0);
    }
  }, [summaries, activeSummaryIndex]);

  useEffect(() => {
    if (summaries.length === 0) {
      setSummaryBarHeight(0);
      return undefined;
    }

    const measure = () => {
      const container = summaryMeasureRef.current;
      if (!container) return;
      const heights = Array.from(container.querySelectorAll('.sp-summary-measure-item')).map((node) => node.getBoundingClientRect().height);
      const nextHeight = Math.ceil(Math.max(0, ...heights));
      setSummaryBarHeight(nextHeight);
    };

    const rafId = window.requestAnimationFrame(measure);
    const onResize = () => window.requestAnimationFrame(measure);
    window.addEventListener('resize', onResize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
    };
  }, [summaries]);

  useEffect(() => {
    if (!showNamedEntityLinkingPanel || typeof onFetchIdentitySuggestions !== 'function') return;

    Object.keys(namedEntityListing).forEach(async (entityType) => {
      // Skip if we already have the list loaded in the component state
      if (identitySuggestions[entityType]) return; 

      try {
        const suggestions = await onFetchIdentitySuggestions(entityType);
        if (Array.isArray(suggestions)) {
          setIdentitySuggestions((prev) => ({ ...prev, [entityType]: suggestions }));
        }
      } catch (e) {
        console.error(e);
      }
    });
  }, [showNamedEntityLinkingPanel, namedEntityListing, onFetchIdentitySuggestions, identitySuggestions]);

  useEffect(() => {
    const clearHoveredEdges = () => setHoveredEdgeEntityId('');
    window.addEventListener('scroll', clearHoveredEdges, true);
    window.addEventListener('wheel', clearHoveredEdges, { passive: true });
    return () => {
      window.removeEventListener('scroll', clearHoveredEdges, true);
      window.removeEventListener('wheel', clearHoveredEdges);
    };
  }, []);

  useEffect(() => {
    if (showFirstMentionsButton) return;
    setShowBridgeTriggers(false);
  }, [showFirstMentionsButton]);

  useEffect(() => {
    if (typeof value !== 'string') return;

    const nextValue = value || '';
    if (nextValue === lastImportedValueRef.current || nextValue === lastEmittedValueRef.current) {
      hasHydratedControlledValueRef.current = true;
      return;
    }

    suppressNextControlledEmitRef.current = true;

    try {
      applyImportedData(nextValue);
      lastImportedValueRef.current = nextValue;
      hasHydratedControlledValueRef.current = true;
    } catch (error) {
      suppressNextControlledEmitRef.current = false;
      const message = error instanceof Error ? error.message : String(error);
      window.alert(message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

    useEffect(() => {
      const onDocMouseDown = (e) => {
        if (!rootRef.current) return;
        if (!rootRef.current.contains(e.target)) {
          setContextMenu((cm) => ({ ...cm, open: false }));
        }
      };

      const onKeyUp = (e) => {

        if (e.key === 'Escape') {
          e.preventDefault();
          setShowImportDialog(false);
          setShowExportDialog(false);
          setShowAnnotationDialog(false);
          setContextMenu((cm) => ({ ...cm, open: false }));
          return;
        }

        if (e.ctrlKey && (e.key === '[' || e.code === 'BracketLeft')) {
          if (summaries.length > 0) {
            e.preventDefault();
            setActiveSummaryIndex((idx) => (idx - 1 + summaries.length) % summaries.length);
          }
          return;
        }

        if (e.ctrlKey && (e.key === ']' || e.code === 'BracketRight')) {
          if (summaries.length > 0) {
            e.preventDefault();
            setActiveSummaryIndex((idx) => (idx + 1) % summaries.length);
          }
          return;
        }

        if (e.ctrlKey && (e.key === '.' || e.code === 'Period')) {
          e.preventDefault();
          const options = Array.from(document.querySelectorAll('#color_mode option')).map((opt) => opt.value);
          if (options.length === 0) return;
          const currentIndex = options.indexOf(colorMode);
          const nextIndex = (currentIndex + 1) % options.length;
          if (currentIndex === options.length - 1) {
            setColorMode(options[0]);
          } else {
            setColorMode(options[nextIndex]);
          }
          return;
        }

      if (e.key === 'Enter') {
        if (selectedTokens.size > 0) {
          e.preventDefault();
          addEntity();
        } else if (selectedEntities.size > 0 && colorMode !== 'entities') {
          groupSelected();
        }
      }
      if (e.key === 'Delete' && selectedEntities.size > 0 && colorMode !== 'entities') {
        ungroupSelected();
      }
    };

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [selectedTokens, selectedEntities, colorMode, summaries.length]);

  useEffect(() => {
    const onMouseUp = () => {
      tokenDragRef.current = { active: false, anchor: null, mode: 'replace', base: new Set() };
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  const findNearestResizeToken = useCallback((clientX, clientY) => {
    const tokElements = Array.from(rootRef.current?.querySelectorAll('.tok') || []);
    if (tokElements.length === 0) return null;

    let bestTok = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    tokElements.forEach((tokEl) => {
      const rect = tokEl.getBoundingClientRect();
      if (rect.left > clientX) return;
      if (rect.bottom < clientY || rect.top > clientY) return;
      const d = Math.hypot(rect.left - clientX, rect.top - clientY);
      if (d < bestDistance) {
        bestDistance = d;
        bestTok = tokEl;
      }
    });

    if (!bestTok) return null;
    const targetTok = parseInt(bestTok.getAttribute('toknum') || '0', 10);
    if (Number.isNaN(targetTok) || targetTok < 1) return null;
    return targetTok;
  }, []);

  const getResizeProposal = useCallback((entityId, side, targetTok) => {
    const original = entities[entityId];
    if (!original) return { valid: false, tokIds: [] };

    let proposedStart;
    let proposedEnd;
    let adjustedTarget = targetTok;

    if (side === 'left' && adjustedTarget > 1) adjustedTarget -= 1;

    if (adjustedTarget > original.end) {
      proposedStart = original.start;
      proposedEnd = adjustedTarget;
    } else if ((adjustedTarget <= original.end && adjustedTarget > original.start) || (adjustedTarget < original.end && adjustedTarget >= original.start)) {
      if (side === 'right') {
        proposedStart = original.start;
        proposedEnd = adjustedTarget;
      } else {
        proposedStart = adjustedTarget;
        proposedEnd = original.end;
      }
    } else {
      proposedStart = adjustedTarget;
      proposedEnd = original.end;
    }

    if (side === 'left' && proposedStart > 1) proposedStart += 1;

    if (proposedStart === original.start && proposedEnd === original.end) {
      return { valid: false, tokIds: [], proposedStart, proposedEnd };
    }

    const newId = `${proposedStart}-${proposedEnd}`;
    if (entities[newId]) {
      return { valid: false, tokIds: [], proposedStart, proposedEnd };
    }

    const tokIds = [];
    for (let tid = proposedStart; tid <= proposedEnd; tid += 1) tokIds.push(tid);
    if (tokIds.length === 0 || tokIds.some((tid) => !tokensById[tid])) {
      return { valid: false, tokIds, proposedStart, proposedEnd };
    }

    const sentnum = tokensById[tokIds[0]].sentnum;
    if (tokIds.some((tid) => tokensById[tid].sentnum !== sentnum)) {
      return { valid: false, tokIds, proposedStart, proposedEnd };
    }

    const allOthers = entitiesList.filter((e) => e.div_id !== entityId);
    for (const e of allOthers) {
      if (hasCrossingOverlap(e, proposedStart, proposedEnd)) {
        return { valid: false, tokIds, proposedStart, proposedEnd };
      }
    }

    return { valid: true, tokIds, proposedStart, proposedEnd };
  }, [entities, tokensById, entitiesList]);

  useEffect(() => {
    const onMouseMove = (event) => {
      const drag = resizeDragRef.current;
      if (!drag) return;

      const targetTok = findNearestResizeToken(event.clientX, event.clientY);
      const proposal = targetTok == null ? { valid: false } : getResizeProposal(drag.entityId, drag.side, targetTok);

      setResizeDragUI((prev) => ({
        active: true,
        x: event.clientX,
        y: event.clientY,
        entityId: drag.entityId,
        side: drag.side,
        color: prev?.color || '#1f2937',
        targetTok,
        valid: !!proposal.valid
      }));
    };

    const onMouseUp = (event) => {
      const drag = resizeDragRef.current;
      if (!drag) return;

      const targetTok = findNearestResizeToken(event.clientX, event.clientY);
      if (targetTok == null) {
        resizeDragRef.current = null;
        setResizeDragUI(null);
        return;
      }

      const proposal = getResizeProposal(drag.entityId, drag.side, targetTok);
      if (!proposal.valid) {
        resizeDragRef.current = null;
        setResizeDragUI(null);
        return;
      }

      const original = entities[drag.entityId];
      if (!original) {
        resizeDragRef.current = null;
        setResizeDragUI(null);
        return;
      }

      const clonedGroups = { ...original.groups };
      const clonedAnnos = { ...original.annos };
      const clonedBridgeAntec = original.bridge_antec;
      const clonedAntecedents = { ...original.antecedents };
      const clonedType = original.type;

      deleteEntity(drag.entityId);
      addEntity(proposal.tokIds, clonedType);

      const createdId = `${proposal.tokIds[0]}-${proposal.tokIds[proposal.tokIds.length - 1]}`;
      setEntities((prev) => {
        const e = prev[createdId];
        if (!e) return prev;
        const next = { ...prev };
        next[createdId] = {
          ...e,
          annos: clonedAnnos,
          bridge_antec: clonedBridgeAntec,
          antecedents: clonedAntecedents,
          groups: { ...e.groups, ...clonedGroups }
        };
        return next;
      });

      Object.keys(clonedGroups).forEach((gtype) => {
        assignGroup(createdId, gtype, clonedGroups[gtype]);
      });

      setGroups((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((gtype) => {
          const gObj = { ...next[gtype] };
          Object.keys(gObj).forEach((gid) => {
            gObj[gid] = gObj[gid].map((id) => (id === drag.entityId ? createdId : id));
          });
          next[gtype] = gObj;
        });
        return next;
      });

      setSelectedEntities(new Set());
      resizeDragRef.current = null;
      setResizeDragUI(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [entities, findNearestResizeToken, getResizeProposal]);

  const assignGroup = (entityId, groupType, newGroupRaw, oldGroupHint = null) => {
    const newGroup = parseInt(newGroupRaw, 10);

    setEntities((prevEntities) => {
      const entity = prevEntities[entityId];
      if (!entity) return prevEntities;
      return {
        ...prevEntities,
        [entityId]: {
          ...entity,
          tgroups: { ...entity.groups, [groupType]: newGroup }
        }
      };
    });

    setGroups((prevGroups) => {
      const nextGroups = { ...prevGroups };
      if (!nextGroups[groupType]) nextGroups[groupType] = { 0: [] };
      nextGroups[groupType] = { ...nextGroups[groupType] };

      const groupEntries = nextGroups[groupType];
      if (!groupEntries[0]) groupEntries[0] = [];
      const detectedOldGroup = Object.keys(groupEntries).find((gid) => (groupEntries[gid] || []).includes(entityId));
      const oldGroup = oldGroupHint != null
        ? parseInt(oldGroupHint, 10)
        : (detectedOldGroup != null ? parseInt(detectedOldGroup, 10) : 0);

      if (!groupEntries[newGroup]) groupEntries[newGroup] = [];

      if (oldGroup !== newGroup && groupEntries[oldGroup]) {
        groupEntries[oldGroup] = groupEntries[oldGroup].filter((id) => id !== entityId);
        if (oldGroup !== 0 && groupEntries[oldGroup].length === 0) {
          delete groupEntries[oldGroup];
        } else if (oldGroup !== 0 && groupEntries[oldGroup].length === 1) {
          const dissolvedMembers = [...groupEntries[oldGroup]];
          dissolvedMembers.forEach((id) => {
            if (!groupEntries[0].includes(id)) groupEntries[0] = [...groupEntries[0], id];
          });
          delete groupEntries[oldGroup];

          setEntities((prevEntities) => {
            const nextEntities = { ...prevEntities };
            dissolvedMembers.forEach((id) => {
              const member = nextEntities[id];
              if (!member) return;

              const nextMember = {
                ...member,
                groups: { ...member.groups, [groupType]: 0 }
              };

              // Dynamic Cleanup for Edge modes
              if (configuredEdges.includes(groupType)) {
                nextMember.bridge_antec = groupType === 'bridge' ? '_' : nextMember.bridge_antec;
                nextMember.antecedents = {
                  ...(nextMember.antecedents || {}),
                  [groupType]: '_'
                };
                
                let nextAnnos = { ...nextMember.annos };
                // Cleanup related subtypes dynamically
                const edgeConf = modelConfig?.colors?.edges?.[groupType];
                if (edgeConf) {
                  const subtypeKeys = Object.keys(edgeConf).filter(k => Array.isArray(edgeConf[k]));
                  subtypeKeys.forEach(key => {
                     nextAnnos[key] = `no${groupType}`;
                  });
                }
                
                // Fallback for strict bridge behavior if configured explicitly
                if (groupType === 'bridge' && !edgeConf) {
                    nextAnnos.bridgetype = 'nobridge';
                    nextAnnos.infstat = nextAnnos.infstat === 'acc' ? 'auto' : nextAnnos.infstat;
                }
                nextMember.annos = nextAnnos;
              }

              nextEntities[id] = nextMember;
            });
            return nextEntities;
          });
        }
      }

      if (!groupEntries[newGroup]) groupEntries[newGroup] = [];
      if (!groupEntries[newGroup].includes(entityId)) {
        groupEntries[newGroup] = [...groupEntries[newGroup], entityId];
      }

      return nextGroups;
    });

    setAssignedColors((prev) => {
      const next = { ...prev };
      if (!next[groupType]) next[groupType] = { 0: GLOBAL_DEFAULTS.DEFAULT_COLOR };
      if (!(newGroup in next[groupType])) {
        next[groupType][newGroup] = newGroup === 0
          ? GLOBAL_DEFAULTS.DEFAULT_COLOR
          : (COREF_COLORS[newGroup - 1] || `#${Math.floor(Math.random() * 16777215).toString(16)}`);
      }
      return next;
    });
  };

  const addEntity = (forcedTokenIds = null, forcedType = null) => {
    const tokIds = forcedTokenIds ? [...forcedTokenIds] : Array.from(selectedTokens);
    if (tokIds.length === 0) return;

    tokIds.sort((a, b) => a - b);
    const start = tokIds[0];
    const end = tokIds[tokIds.length - 1];

    for (let i = 1; i < tokIds.length; i += 1) {
      if (tokIds[i] !== tokIds[i - 1] + 1) return;
    }

    const sentNum = tokensById[start]?.sentnum;
    if (!sentNum) return;
    if (tokIds.some((tid) => tokensById[tid]?.sentnum !== sentNum)) return;

    const divId = `${start}-${end}`;
    if (entities[divId]) return;

    for (const e of entitiesList) {
      if (hasCrossingOverlap(e, start, end)) return;
    }

    const entityType = forcedType || GLOBAL_DEFAULTS.DEFAULT_ENTITY_TYPE;
    
    const initialGroups = {};
    allColorModes.forEach(mode => initialGroups[mode] = 0);
    
    const initialAntecedents = {};
    configuredEdges.forEach(mode => initialAntecedents[mode] = '_');

    const nextEntity = {
      type: entityType,
      start,
      end,
      toks: tokIds,
      length: end - start + 1,
      div_id: divId,
      annos: { ...DEFAULT_ANNOS },
      salienceField: true,
      identity: '_',
      bridge_antec: '_', // mainting for backward compatibility with model.js imports
      antecedents: initialAntecedents,
      next: {},
      groups: initialGroups
    };

    setEntities((prev) => ({ ...prev, [divId]: nextEntity }));
    setGroups((prev) => {
      const next = { ...prev };
      allColorModes.forEach((gtype) => {
        if (!next[gtype]) next[gtype] = { 0: [] };
        if (!next[gtype][0]) next[gtype][0] = [];
        if (!next[gtype][0].includes(divId)) next[gtype][0] = [...next[gtype][0], divId];
      });
      return next;
    });

    setActiveEntityId(divId);
    setSelectedTokens(new Set());
    setSelectedEntities(new Set());
  };

  const deleteEntity = (entityId) => {
    setEntities((prev) => {
      if (!prev[entityId]) return prev;
      const next = { ...prev };
      delete next[entityId];
      return next;
    });

    setGroups((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((gtype) => {
        const gObj = { ...next[gtype] };
        if (!gObj[0]) gObj[0] = [];
        Object.keys(gObj).forEach((gid) => {
          gObj[gid] = gObj[gid].filter((id) => id !== entityId);
          if (parseInt(gid, 10) !== 0 && gObj[gid].length === 0) {
            delete gObj[gid];
          } else if (parseInt(gid, 10) !== 0 && gObj[gid].length === 1) {
            const [remainingId] = gObj[gid];
            if (remainingId && !gObj[0].includes(remainingId)) {
              gObj[0] = [...gObj[0], remainingId];
            }
            delete gObj[gid];

            setEntities((prevEntities) => {
              const remainingEntity = prevEntities[remainingId];
              if (!remainingEntity) return prevEntities;

              const nextEntities = {
                ...prevEntities,
                [remainingId]: {
                  ...remainingEntity,
                  groups: {
                    ...remainingEntity.groups,
                    [gtype]: 0
                  }
                }
              };

              // Dynamic Cleanup for Edges
              if (configuredEdges.includes(gtype)) {
                nextEntities[remainingId] = {
                  ...nextEntities[remainingId],
                  bridge_antec: gtype === 'bridge' ? '_' : nextEntities[remainingId].bridge_antec,
                  antecedents: {
                    ...(nextEntities[remainingId].antecedents || {}),
                    [gtype]: '_'
                  }
                };
                
                let nextAnnos = { ...nextEntities[remainingId].annos };
                const edgeConf = modelConfig?.colors?.edges?.[gtype];
                if (edgeConf) {
                  const subtypeKeys = Object.keys(edgeConf).filter(k => Array.isArray(edgeConf[k]));
                  subtypeKeys.forEach(key => {
                     nextAnnos[key] = `no${gtype}`;
                  });
                }
                if (gtype === 'bridge' && !edgeConf) {
                    nextAnnos.bridgetype = 'nobridge';
                    nextAnnos.infstat = nextAnnos.infstat === 'acc' ? 'auto' : nextAnnos.infstat;
                }
                nextEntities[remainingId].annos = nextAnnos;
              }

              return nextEntities;
            });
          }
        });
        next[gtype] = gObj;
      });
      return next;
    });

    setSelectedEntities((prev) => {
      const n = new Set(prev);
      n.delete(entityId);
      return n;
    });
    if (activeEntityId === entityId) setActiveEntityId('');
    setContextMenu({ open: false, x: 0, y: 0, entityId: '' });
  };

  const changeEntityAnno = (entityId, key, value) => {
    const kind = getAnnotationKind(modelConfig, key);
    setEntities((prev) => {
      const e = prev[entityId];
      if (!e) return prev;
      return {
        ...prev,
        [entityId]: {
          ...e,
          annos: {
            ...e.annos,
            [key]: kind === 'checks' ? normalizeCheckValue(value, modelConfig, key) : value
          },
          salienceField: kind === 'checks' ? true : e.salienceField
        }
      };
    });
  };

const changeEntityType = (entityId, entityType) => {
    setEntities((prev) => {
      const e = prev[entityId];
      if (!e) return prev;

      // 1. Update the targeted entity
      const nextEntities = { ...prev };
      nextEntities[entityId] = { ...e, type: entityType };

      // 2. Propagate to cluster members if the grouping behavior enforces 'sametype'
      const groupTypes = modelConfig?.GROUP_TYPES || [];
      groupTypes.forEach((gType) => {
        if (modelConfig?.GROUP_BEHAVIORS?.[gType] === 'sametype') {
          const groupId = parseInt(e.groups?.[gType] || 0, 10);
          
          // Ignore group zero (singletons)
          if (groupId > 0) {
            // Grab the cluster members using the component's 'groups' state
            const members = groups[gType]?.[groupId] || [];
            members.forEach((id) => {
              if (nextEntities[id] && nextEntities[id].type !== entityType) {
                // Apply the exact same user-selected type to the rest of the cluster
                nextEntities[id] = { ...nextEntities[id], type: entityType };
              }
            });
          }
        }
      });

      return nextEntities;
    });
  };

  const refreshNamedEntityListing = useCallback(() => {
    const source = {
      tokens,
      entitiesById: entities,
      socialcalc: socialcalcModel,
      entityTypeKey: entityTypeAnnotationKey
    };
    const byTypeRaw = getNamedEntityTypes(modelConfig, source);
    const sortedTypeKeys = Object.keys(byTypeRaw).sort((a, b) => a.localeCompare(b));

    const nextListing = {};
    const nextInputs = {};
    const nextMatchIds = {};
    sortedTypeKeys.forEach((typeName) => {
      const values = Array.isArray(byTypeRaw[typeName]) ? [...byTypeRaw[typeName]] : [];
      const sortedValues = values.sort((a, b) => a.localeCompare(b));
      nextListing[typeName] = sortedValues;

      sortedValues.forEach((textValue) => {
        const inputKey = namedEntityInputKey(typeName, textValue);
        const matches = findEntitiesByTextAndType(textValue, typeName, source);
        nextMatchIds[inputKey] = Array.from(new Set(matches.map((match) => String(match.entityId || '').trim()).filter((id) => id.length > 0)));
        const existingValues = Array.from(new Set(
          matches
            .map((match) => String(entities?.[match.entityId]?.annos?.[identityAnnotationKey] || '').trim())
            .filter((value) => value.length > 0)
        ));
        nextInputs[inputKey] = existingValues[0] || '';
      });
    });

    setNamedEntityListing(nextListing);
    setNamedEntityIdentityInputs(nextInputs);
    setNamedEntityMatchIdsByInputKey(nextMatchIds);
    setShowNamedEntityLinkingPanel(true);
  }, [entities, entityTypeAnnotationKey, identityAnnotationKey, modelConfig, namedEntityInputKey, socialcalcModel, tokens]);

  const onNamedEntityIdentityChange = useCallback((entityType, textValue, nextValue) => {
    const inputKey = namedEntityInputKey(entityType, textValue);
    const directMatchIds = namedEntityMatchIdsByInputKey[inputKey] || [];
    const source = {
      tokens,
      entitiesById: entities,
      socialcalc: socialcalcModel,
      entityTypeKey: entityTypeAnnotationKey
    };
    const fallbackMatchIds = findEntitiesByTextAndType(textValue, entityType, source)
      .map((match) => String(match.entityId || '').trim())
      .filter((id) => id.length > 0);
    const targetEntityIds = Array.from(new Set([...directMatchIds, ...fallbackMatchIds]));
    setNamedEntityIdentityInputs((prev) => ({
      ...prev,
      [inputKey]: nextValue
    }));
    setPendingNamedEntityIdentitySuggestions((prev) => {
      if (!prev[inputKey]) return prev;
      const next = { ...prev };
      delete next[inputKey];
      return next;
    });

    targetEntityIds.forEach((entityId) => {
      changeEntityAnno(entityId, identityAnnotationKey, nextValue);
    });
  }, [entities, entityTypeAnnotationKey, identityAnnotationKey, namedEntityInputKey, namedEntityMatchIdsByInputKey, socialcalcModel, tokens]);

  const confirmNamedEntityIdentitySuggestion = useCallback((entityType, textValue) => {
    const inputKey = namedEntityInputKey(entityType, textValue);
    const committedValue = namedEntityIdentityInputs[inputKey] || '';
    const directMatchIds = namedEntityMatchIdsByInputKey[inputKey] || [];
    const source = {
      tokens,
      entitiesById: entities,
      socialcalc: socialcalcModel,
      entityTypeKey: entityTypeAnnotationKey
    };
    const fallbackMatchIds = findEntitiesByTextAndType(textValue, entityType, source)
      .map((match) => String(match.entityId || '').trim())
      .filter((id) => id.length > 0);
    const targetEntityIds = Array.from(new Set([...directMatchIds, ...fallbackMatchIds]));

    targetEntityIds.forEach((entityId) => {
      changeEntityAnno(entityId, identityAnnotationKey, committedValue);
    });

    setPendingNamedEntityIdentitySuggestions((prev) => {
      if (!prev[inputKey]) return prev;
      const next = { ...prev };
      delete next[inputKey];
      return next;
    });
  }, [entities, entityTypeAnnotationKey, identityAnnotationKey, namedEntityIdentityInputs, namedEntityInputKey, namedEntityMatchIdsByInputKey, socialcalcModel, tokens]);

  const runGuessIdentities = useCallback(async () => {
    if (typeof onGuessIdentities !== 'function') return;
    const source = {
      tokens,
      entitiesById: entities,
      socialcalc: socialcalcModel,
      entityTypeKey: entityTypeAnnotationKey
    };
    const byTypeRaw = getNamedEntityTypes(modelConfig, source);
    const orderedTypes = Object.keys(byTypeRaw).sort((a, b) => a.localeCompare(b));
    const nextListing = {};
    const nextMatchIds = {};
    const orderedRows = [];

    orderedTypes.forEach((entityType) => {
      const values = Array.isArray(byTypeRaw[entityType]) ? [...byTypeRaw[entityType]] : [];
      const textValues = values.sort((a, b) => a.localeCompare(b));
      nextListing[entityType] = textValues;
      textValues.forEach((textValue) => {
        const inputKey = namedEntityInputKey(entityType, textValue);
        const matches = findEntitiesByTextAndType(textValue, entityType, source);
        nextMatchIds[inputKey] = Array.from(new Set(matches.map((match) => String(match.entityId || '').trim()).filter((id) => id.length > 0)));
        orderedRows.push({
          entityType,
          textValue,
          inputKey
        });
      });
    });

    if (orderedRows.length === 0) {
      alert('No named entities to identify.');
      return;
    }

    const entityPairs = orderedRows.map(({ textValue, entityType }) => [textValue, entityType]);
    setNamedEntityListing(nextListing);
    setNamedEntityMatchIdsByInputKey(nextMatchIds);
    setShowNamedEntityLinkingPanel(true);
    setIsGuessIdentitiesRunning(true);
    try {
      const identities = await onGuessIdentities(entityPairs);
      const nextIdentities = Array.isArray(identities) ? identities : [];

      setNamedEntityIdentityInputs((prev) => {
        const next = { ...prev };
        orderedRows.forEach((row, index) => {
          const identityValue = typeof nextIdentities[index] === 'string' ? nextIdentities[index] : '';
          const existing = String(prev?.[row.inputKey] || '').trim();
          if (existing.length === 0) {
            next[row.inputKey] = identityValue;
          }
        });
        return next;
      });

      setPendingNamedEntityIdentitySuggestions((prev) => {
        const next = { ...prev };
        orderedRows.forEach((row, index) => {
          const identityValue = typeof nextIdentities[index] === 'string' ? nextIdentities[index] : '';
          const existing = String(namedEntityIdentityInputs?.[row.inputKey] || '').trim();
          if (existing.length === 0 && identityValue.trim().length > 0) {
            next[row.inputKey] = identityValue;
          } else {
            delete next[row.inputKey];
          }
        });
        return next;
      });
    } finally {
      setIsGuessIdentitiesRunning(false);
    }
  }, [entities, entityTypeAnnotationKey, modelConfig, namedEntityIdentityInputs, namedEntityInputKey, onGuessIdentities, socialcalcModel, tokens]);

  const harmonizeCorefSalienceForMembers = (memberIds, entityMap = entities) => {
    if (!Array.isArray(memberIds) || memberIds.length === 0) return;
    const merged = mergeCheckValues(memberIds.map((id) => entityMap[id]?.annos?.[summarySyncKey]), modelConfig, summarySyncKey);
    setEntities((prev) => {
      const next = { ...prev };
      memberIds.forEach((id) => {
        if (!next[id]) return;
        next[id] = {
          ...next[id],
          annos: {
            ...next[id].annos,
            [summarySyncKey]: merged
          },
          salienceField: true
        };
      });
      return next;
    });
  };

  const dispatchModelMutation = useCallback((action) => {
    const currentState = createAnnotationState({
      tokens,
      entitiesById: entities,
      groupsByType: groups,
      assignedColors,
      uiState: {
        colorMode,
        selectedTokens,
        selectedEntities,
        activeEntityId,
        hoveredGroupEntities,
        hoveredEdgeEntityId,
        contextMenu,
        dialogs: {
          showImportDialog,
          showExportDialog,
          showAnnotationDialog
        }
      },
      summaries,
      config: modelConfig
    });

    const nextState = spannotatorReducer(currentState, action);
    setTokens(nextState.tokens);
    setEntities(nextState.entitiesById);
    setGroups(nextState.groupsByType);
    setAssignedColors(nextState.assignedColors);
    setSelectedTokens(new Set(nextState.uiState.selectedTokens || []));
    setSelectedEntities(new Set(nextState.uiState.selectedEntities || []));
    setActiveEntityId(nextState.uiState.activeEntityId || '');
  }, [
    tokens,
    entities,
    groups,
    assignedColors,
    colorMode,
    selectedTokens,
    selectedEntities,
    activeEntityId,
    hoveredGroupEntities,
    hoveredEdgeEntityId,
    contextMenu,
    showImportDialog,
    showExportDialog,
    showAnnotationDialog,
    summaries,
    modelConfig
  ]);

  const groupSelected = () => {
    if (colorMode === 'entities') return;
    dispatchModelMutation({
      type: 'GROUP_SELECTED',
      groupType: colorMode
    });
  };

  const ungroupSelected = () => {
    if (colorMode === 'entities') return;
    dispatchModelMutation({
      type: 'UNGROUP_SELECTED',
      groupType: colorMode
    });
  };

  const getEntityColor = useCallback((entity) => {
    if (colorMode === 'entities') {
      return ICON_MAP[entity.type]?.[1] || GLOBAL_DEFAULTS.DEFAULT_COLOR;
    }
    const gid = parseInt(entity.groups[colorMode] || 0, 10);
    if (gid === 0) return 'lightgray';
    return assignedColors[colorMode]?.[gid] || GLOBAL_DEFAULTS.DEFAULT_COLOR;
  }, [colorMode, ICON_MAP, GLOBAL_DEFAULTS.DEFAULT_COLOR, assignedColors]);

  const openTypeMenu = useCallback((event, entityId) => {
    event.preventDefault();
    event.stopPropagation();

    if (contextMenu.open && contextMenu.entityId === entityId) {
      setContextMenu((cm) => ({ ...cm, open: false }));
      return;
    }

    const rootEl = rootRef.current;
    const rootRect = rootEl?.getBoundingClientRect();
    const targetRect = event.currentTarget?.getBoundingClientRect();

    const scrollTop = rootEl?.scrollTop || 0;
    const scrollLeft = rootEl?.scrollLeft || 0;

    const menuX = rootRect && targetRect
      ? Math.max(0, targetRect.left - rootRect.left + scrollLeft)
      : event.clientX;
      
    const menuY = rootRect && targetRect
      ? Math.max(0, targetRect.bottom - rootRect.top + scrollTop + 2)
      : event.clientY;
      
    setActiveEntityId(entityId);
    setContextMenu({ open: true, x: menuX, y: menuY, entityId });
  }, [contextMenu.open, contextMenu.entityId]);

  const getTokenRange = (a, b) => {
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    const arr = [];
    for (let i = start; i <= end; i += 1) arr.push(i);
    return arr;
  };

  const getMentionSyncStyle = useCallback((entity) => {
    if (!summarySyncSettings) return { color: '#111827' };
    const syncValue = normalizeCheckValue(entity.annos?.[summarySyncKey], modelConfig, summarySyncKey);
    const hasAnyCheck = syncValue.includes(summarySyncSettings.trueChar);
    if (!entity.salienceField || !hasAnyCheck) return { color: '#111827' };
    if (activeSummaryIndex >= 0 && syncValue[activeSummaryIndex] === summarySyncSettings.trueChar) return { color: '#dc2626' };
    return { color: '#2563eb' };
  }, [activeSummaryIndex, modelConfig, summarySyncKey, summarySyncSettings]);

  const getEntityStarColor = useCallback((entity) => {
    for (const key of annotationKeys) {
      const starColor = getAnnotationStarColor(modelConfig, key, entity?.annos?.[key]);
      if (starColor) return starColor;
    }
    return '';
  }, [annotationKeys, modelConfig]);

  const getEntityRect = (entityId) => {
    const box = rootRef.current?.querySelector(`#${CSS.escape(entityId)}`);
    if (!box) return null;
    return box.getBoundingClientRect();
  };

  const getAnchorPoint = (rect, anchor) => {
    if (!rect) return null;
    switch (anchor) {
      case 'west': return { x: rect.left, y: rect.top + rect.height / 2 };
      case 'east': return { x: rect.right, y: rect.top + rect.height / 2 };
      case 'north': return { x: rect.left + rect.width / 2, y: rect.top };
      case 'south': return { x: rect.left + rect.width / 2, y: rect.bottom };
      case 'nw': return { x: rect.left, y: rect.top };
      case 'ne': return { x: rect.right, y: rect.top };
      case 'sw': return { x: rect.left, y: rect.bottom };
      case 'se': return { x: rect.right, y: rect.bottom };
      default: return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  };

  const chooseAnchors = (sourceRect, targetRect) => {
    const sx = sourceRect.left + sourceRect.width / 2;
    const sy = sourceRect.top + sourceRect.height / 2;
    const tx = targetRect.left + targetRect.width / 2;
    const ty = targetRect.top + targetRect.height / 2;
    const dx = tx - sx;
    const dy = ty - sy;

    if (Math.abs(dx) > Math.abs(dy) * 1.3) {
      return dx < 0
        ? { source: 'west', target: 'east' }
        : { source: 'east', target: 'west' };
    }

    if (Math.abs(dy) > Math.abs(dx) * 1.3) {
      return dy < 0
        ? { source: 'north', target: 'south' }
        : { source: 'south', target: 'north' };
    }

    if (dx < 0 && dy < 0) return { source: 'nw', target: 'se' };
    if (dx > 0 && dy < 0) return { source: 'ne', target: 'sw' };
    if (dx < 0 && dy > 0) return { source: 'sw', target: 'ne' };
    return { source: 'se', target: 'nw' };
  };

  const hoveredEdgeConnections = useMemo(() => {
    if (!configuredEdges.includes(colorMode)) return [];
    if (!hoveredEdgeEntityId || !entities[hoveredEdgeEntityId]) return [];

    const hovered = entities[hoveredEdgeEntityId];
    const connections = [];
    const mode = colorMode;

    const antec = hovered.antecedents?.[mode] || (mode === 'bridge' ? hovered.bridge_antec : '_');

    if (antec && antec !== '_' && entities[antec]) {
      const edgeGroup = parseInt(hovered.groups[mode] || 0, 10);
      if (edgeGroup > 0) {
        connections.push({
          sourceId: hovered.div_id,
          targetId: antec,
          color: getEntityColor(hovered)
        });
      }
    }

    const dependents = edgeDependentsByAntec[mode]?.[hoveredEdgeEntityId] || [];
    dependents.forEach((entityId) => {
      const entity = entities[entityId];
      if (!entity) return;
      const edgeGroup = parseInt(entity.groups[mode] || 0, 10);
      if (edgeGroup <= 0) return;
      connections.push({
        sourceId: entity.div_id,
        targetId: hoveredEdgeEntityId,
        color: getEntityColor(entity)
      });
    });

    return connections;
  }, [hoveredEdgeEntityId, entities, colorMode, assignedColors, edgeDependentsByAntec, configuredEdges, getEntityColor]);

  const edgeLinePaths = useMemo(() => {
    if (!rootRef.current || hoveredEdgeConnections.length === 0) return [];

    const rectCache = new Map();
    const getCachedRect = (entityId) => {
      if (rectCache.has(entityId)) return rectCache.get(entityId);
      const rect = getEntityRect(entityId);
      rectCache.set(entityId, rect);
      return rect;
    };

    return hoveredEdgeConnections
      .map((conn) => {
        const srcRect = getCachedRect(conn.sourceId);
        const trgRect = getCachedRect(conn.targetId);
        if (!srcRect || !trgRect) return null;

        const anchors = chooseAnchors(srcRect, trgRect);
        const start = getAnchorPoint(srcRect, anchors.source);
        const end = getAnchorPoint(trgRect, anchors.target);
        if (!start || !end) return null;

        const d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
        return { ...conn, d };
      })
      .filter(Boolean);
  }, [hoveredEdgeConnections]);

  const onTokenMouseDown = useCallback((event, tid) => {
    event.stopPropagation();
    setContextMenu((cm) => ({ ...cm, open: false }));
    setSelectedEntities(new Set());

    const isToggle = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;
    const prevAnchor = lastTokenClickRef.current;

    if (isShift && prevAnchor != null) {
      const range = getTokenRange(prevAnchor, tid);
      setSelectedTokens((prev) => {
        const next = new Set(isToggle ? prev : []);
        range.forEach((id) => next.add(id));
        return next;
      });
      tokenDragRef.current = { active: true, anchor: prevAnchor, mode: isToggle ? 'add' : 'replace', base: new Set(selectedTokens) };
      return;
    }

    setSelectedTokens((prev) => {
      const base = new Set(prev);
      let mode = 'replace';
      let next;

      if (isToggle) {
        if (base.has(tid)) {
          base.delete(tid);
          mode = 'remove';
        } else {
          base.add(tid);
          mode = 'add';
        }
        next = base;
      } else {
        next = new Set([tid]);
      }

      tokenDragRef.current = {
        active: true,
        anchor: tid,
        mode,
        base: isToggle ? new Set(prev) : new Set()
      };
      return next;
    });

    lastTokenClickRef.current = tid;
  }, [selectedTokens]);

  const onTokenMouseEnter = useCallback((event, tid) => {
    const drag = tokenDragRef.current;
    if (!drag.active || drag.anchor == null) return;
    event.stopPropagation();

    const range = getTokenRange(drag.anchor, tid);
    setSelectedTokens(() => {
      const next = new Set(drag.base);
      if (drag.mode === 'remove') {
        range.forEach((id) => next.delete(id));
      } else {
        range.forEach((id) => next.add(id));
      }
      return next;
    });
  }, []);

  const onTokenClick = useCallback((event, tid) => {
    event.stopPropagation();
    lastTokenClickRef.current = tid;
  }, []);

  const onEntityClick = useCallback((event, entityId) => {
    event.stopPropagation();
    setContextMenu((cm) => ({ ...cm, open: false })); // Close any open context menu
    setActiveEntityId(entityId);
    setSelectedTokens(new Set());
    setSelectedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  }, []);

  const onEntityHover = useCallback((entityId) => {
    if (configuredEdges.includes(colorMode)) setHoveredEdgeEntityId(entityId);
    else setHoveredEdgeEntityId('');
    
    if (colorMode === 'entities') {
      setHoveredGroupEntities(new Set());
      return;
    }
    const gid = parseInt(entities[entityId]?.groups[colorMode] || 0, 10);
    if (gid === 0) {
      setHoveredGroupEntities(new Set());
      return;
    }
    setHoveredGroupEntities(new Set(groups[colorMode]?.[gid] || []));
  }, [colorMode, groups, entities, configuredEdges]);

  const onEntityHoverOut = useCallback(() => {
    setHoveredEdgeEntityId('');
    setHoveredGroupEntities(new Set());
  }, []);

  const onEntityMouseMove = useCallback((event, entityId) => {
    if (resizeDragRef.current) return;
    const entityEl = event.currentTarget;
    const rect = entityEl.getBoundingClientRect();
    const xInside = event.clientX - rect.left;
    if (xInside < DRAG_TOL) {
      setResizeHover({ entityId, side: 'left' });
      return;
    }
    if (xInside + DRAG_TOL > rect.width) {
      setResizeHover({ entityId, side: 'right' });
      return;
    }
    setResizeHover((prev) => (prev.entityId === entityId ? { entityId: null, side: null } : prev));
  }, [DRAG_TOL]);

  const onEntityMouseDown = useCallback((event, entityId) => {
    const entityEl = event.currentTarget;
    const rect = entityEl.getBoundingClientRect();
    const xInside = event.clientX - rect.left;
    const entity = entities[entityId];
    const borderColor = entity ? getEntityColor(entity) : '#1f2937';

    if (xInside < DRAG_TOL) {
      resizeDragRef.current = { entityId, side: 'left' };
      setResizeDragUI({
        active: true,
        x: event.clientX,
        y: event.clientY,
        entityId,
        side: 'left',
        color: borderColor,
        targetTok: null,
        valid: false
      });
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (xInside + DRAG_TOL > rect.width) {
      resizeDragRef.current = { entityId, side: 'right' };
      setResizeDragUI({
        active: true,
        x: event.clientX,
        y: event.clientY,
        entityId,
        side: 'right',
        color: borderColor,
        targetTok: null,
        valid: false
      });
      event.preventDefault();
      event.stopPropagation();
    }
  }, [DRAG_TOL, entities, getEntityColor]);

  const onEntityMouseLeave = useCallback((entityId) => {
    onEntityHoverOut();
    setResizeHover((prev) => (prev.entityId === entityId ? { entityId: null, side: null } : prev));
  }, [onEntityHoverOut]);

  const onEntityDoubleClick = useCallback((entityId) => {
    setActiveEntityId(entityId);
    setShowAnnotationDialog(true);
  }, []);

  const onDeleteEntityMouseDown = useCallback((event, entityId) => {
    event.stopPropagation();
    deleteEntity(entityId);
  }, [deleteEntity]);

  const isFirstMentionHaloVisible = useCallback((entity) => {
    if (!showBridgeTriggers) return false;
    const primaryGroup = configuredGroups[0] || 'coref';
    const activeGroupVal = parseInt(entity.groups[primaryGroup] || 0, 10);
    if (activeGroupVal === 0) return true;
    const members = sortByStart(groups[primaryGroup]?.[activeGroupVal] || []);
    return members.length > 0 && members[0] === entity.div_id;
  }, [showBridgeTriggers, groups, configuredGroups]);

  const runExport = (format) => {
    const activeFormat = format || exportFormat;
    let nextText = exportSpannotatorData({
      format: activeFormat,
      tokens,
      tokensById,
      entities,
      groups,
      summaries,
      socialcalc: socialcalcModel,
      config: {
        ...config,
        ...modelConfig,
        meta_dict
      }
    });

    setExportText(nextText);
  };

  useEffect(() => {
    if (typeof onChange !== 'function') return;
    if (typeof value === 'string' && !hasHydratedControlledValueRef.current) return;

    let nextValue;
    try {
      nextValue = exportSpannotatorData({
        format: 'socialcalc',
        tokens,
        tokensById,
        entities,
        groups,
        summaries,
        socialcalc: socialcalcModel,
        config: { ...config, ...modelConfig }
      });
    } catch {
      return;
    }

    if (suppressNextControlledEmitRef.current) {
      suppressNextControlledEmitRef.current = false;
      lastEmittedValueRef.current = nextValue;
      return;
    }

    if (nextValue === lastEmittedValueRef.current || nextValue === value) {
      lastEmittedValueRef.current = nextValue;
      return;
    }

    lastEmittedValueRef.current = nextValue;
    onChange(nextValue);
  }, [config, entities, groups, modelConfig, onChange, socialcalcModel, summaries, tokens, tokensById, value]);

  const importViaBackendSgml = useCallback(async (rawSgml, options = {}) => {
    if (typeof onImportSgml !== 'function') {
      throw new Error('SGML import is not available.');
    }

    const importedSocialCalc = await onImportSgml(rawSgml);
    const nextValue = String(importedSocialCalc ?? '').trim();
    if (!nextValue) {
      throw new Error('Backend SGML import succeeded but returned no SocialCalc content.');
    }

    const parsedImported = importSpannotatorData(nextValue, {
      ...config,
      ...modelConfig,
      word: modelConfig.word || 'word',
      tok: modelConfig.tok || 'tok',
      meta_dict
    });

    if (options?.expectedTokenCount != null && parsedImported.tokens.length !== options.expectedTokenCount) {
      throw new Error(`Token count mismatch (existing ${options.expectedTokenCount}, returned ${parsedImported.tokens.length}).`);
    }

    applyImportedData(nextValue);
    return nextValue;
  }, [applyImportedData, config, meta_dict, modelConfig, onImportSgml]);

  const applyImport = async () => {
    try {
      const rawText = String(importText ?? '').trim();
      if (!rawText) return;

      if (isClientSideImportPayload(rawText) || typeof onImportSgml !== 'function') {
        const mergeOpts = isSocialCalcPayload(rawText) ? { enforceSpreadsheetMerge: true } : {};
        applyImportedData(rawText, { closeDialog: true, ...mergeOpts });
        setShowImportDialog(false);
        return;
      }

      await importViaBackendSgml(rawText);
      setShowImportDialog(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(message);
    }
  };

const runDynamicTool = useCallback(async (toolKey) => {
    if (typeof onRunTool !== 'function' || typeof onImportSgml !== 'function' || activeTools[toolKey]) return;

    setActiveTools((prev) => ({ ...prev, [toolKey]: true }));
    try {
      // Execute the mutation in the parent component using the specific toolKey
      const transformedText = await onRunTool(toolKey);
      const normalizedText = String(transformedText ?? '').trim();

      if (!normalizedText) {
        window.alert(`Tool execution failed: no importable content was returned.`);
        return;
      }

      const backendImportedSocialCalc = await onImportSgml(normalizedText);
      const nextValue = String(backendImportedSocialCalc ?? '').trim();
      if (!nextValue) {
        window.alert(`Tool execution failed: backend import returned no SocialCalc content.`);
        return;
      }

      const parsedImported = importSpannotatorData(nextValue, {
        ...config,
        ...modelConfig,
        word: modelConfig.word || 'word',
        tok: modelConfig.tok || 'tok',
        meta_dict
      });

      if (!Array.isArray(parsedImported.tokens) || parsedImported.tokens.length === 0) {
        window.alert(`Tool execution failed: returned content did not contain any tokens.`);
        return;
      }

      if (parsedImported.tokens.length !== tokens.length) {
        window.alert(
          `Tool execution failed: token count mismatch (existing ${tokens.length}, returned ${parsedImported.tokens.length}).`
        );
        return;
      }

      applyImportedData(nextValue);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Tool execution failed: ${message}`);
    } finally {
      setActiveTools((prev) => ({ ...prev, [toolKey]: false }));
    }
  }, [applyImportedData, config, activeTools, meta_dict, modelConfig, onRunTool, onImportSgml, tokens.length]);

  const activeEntity = activeEntityId && entities[activeEntityId] ? entities[activeEntityId] : null;
  const currentAnnoValue = activeEntity?.annos?.[selectedAnnoKey] || '';
  const currentAnnoKind = getAnnotationKind(modelConfig, selectedAnnoKey);
  const currentCheckSettings = getAnnotationCheckSettings(modelConfig, selectedAnnoKey);
  const currentEnumValues = useMemo(() => {
    const configured = Array.isArray(ANNO_VALUES?.[selectedAnnoKey])
      ? ANNO_VALUES[selectedAnnoKey].filter((value) => String(value || '').trim().length > 0)
      : [];
    if (configured.length > 0) return configured;

    const observed = [...new Set(
      Object.values(entities || {})
        .map((entity) => String(entity?.annos?.[selectedAnnoKey] || '').trim())
        .filter((value) => value.length > 0 && value !== '_')
    )];

    if (observed.length === 0 || observed.length > 30) return [];
    return observed.sort((a, b) => a.localeCompare(b));
  }, [ANNO_VALUES, entities, selectedAnnoKey]);
  
  const resolvedAnnoKind = currentAnnoKind === 'text'
    && !(selectedAnnoKey in (modelConfig.ANNOTATION_KINDS || {}))
    && currentEnumValues.length > 0
    ? 'enum'
    : currentAnnoKind;
  const bridgeValues = useMemo(() => {
    const raw = currentAnnoValue || 'nobridge';
    return raw.includes(';') ? raw.split(';').filter(Boolean) : [raw];
  }, [currentAnnoValue]);

  const currentCheckChars = useMemo(() => {
    if (!currentCheckSettings) return [];
    return normalizeCheckValue(currentAnnoValue, modelConfig, selectedAnnoKey).split('');
  }, [currentAnnoValue, currentCheckSettings, modelConfig, selectedAnnoKey]);

  const updateBridgeSelection = (value, checked) => {
    if (!activeEntity) return;
    const existing = new Set(bridgeValues);

    if (showGranularSubtypes) {
      if (checked) existing.add(value);
      else existing.delete(value);
    } else {
      const prefixed = Array.from(existing).filter((x) => x === value || x.startsWith(`${value}${bridgeCoarseSeparator}`));
      if (checked) {
        if (prefixed.length === 0) {
          existing.add(bridgeCoarseDefault(value, modelConfig));
        }
      } else {
        prefixed.forEach((x) => existing.delete(x));
      }
    }

    if (existing.size === 0) existing.add('nobridge');
    if (existing.size > 1 && existing.has('nobridge')) existing.delete('nobridge');

    const ordered = priorityOrderBridge(Array.from(existing), BRIDGETYPE_PRIORITY);
    changeEntityAnno(activeEntity.div_id, 'bridgetype', ordered.join(';'));
  };

  const toggleCheckIndex = (idx) => {
    if (!activeEntity) return;
    const chars = [...currentCheckChars];
    const curr = chars[idx];
    const settings = currentCheckSettings || { falseChar: salienceFalseChar, trueChar: salienceTrueChar };
    chars[idx] = curr === settings.trueChar ? settings.falseChar : settings.trueChar;
    const val = chars.join('');
    changeEntityAnno(activeEntity.div_id, selectedAnnoKey, val);

    const primaryGroup = configuredGroups[0] || 'coref';
    const corefGroup = parseInt(activeEntity.groups[primaryGroup] || 0, 10);
    if (corefGroup > 0) {
      const peers = groups[primaryGroup]?.[corefGroup] || [];
      setEntities((prev) => {
        const next = { ...prev };
        peers.forEach((eid) => {
          if (!next[eid]) return;
          next[eid] = {
            ...next[eid],
            annos: {
              ...next[eid].annos,
              [selectedAnnoKey]: val
            },
            salienceField: true
          };
        });
        return next;
      });
    }
  };

  const parentMap = useMemo(() => {
    const ids = Object.keys(entities);
    const map = {};
    ids.forEach((id) => {
      const e = entities[id];
      let parent = null;
      let parentLen = Infinity;
      ids.forEach((otherId) => {
        if (id === otherId) return;
        const o = entities[otherId];
        const contains = o.start <= e.start && o.end >= e.end;
        if (!contains) return;
        const len = o.length;
        if (len > e.length && len < parentLen) {
          parent = otherId;
          parentLen = len;
        }
      });
      map[id] = parent;
    });
    return map;
  }, [entities]);

  const childrenByParent = useMemo(() => {
    const map = {};
    Object.keys(entities).forEach((id) => {
      const parent = parentMap[id] || '__root__';
      if (!map[parent]) map[parent] = [];
      map[parent].push(id);
    });
    Object.keys(map).forEach((k) => {
      map[k].sort((a, b) => {
        const ea = entities[a];
        const eb = entities[b];
        if (ea.start !== eb.start) return ea.start - eb.start;
        return eb.end - ea.end;
      });
    });
    return map;
  }, [entities, parentMap]);

  const renderRange = useCallback((start, end, parentId = null) => {
    const parentKey = parentId || '__root__';
    const children = (childrenByParent[parentKey] || []).filter((id) => {
      const e = entities[id];
      return e.start >= start && e.end <= end;
    });

    const out = [];
    let cur = start;
    children.forEach((childId) => {
      const child = entities[childId];
      while (cur < child.start) {
        const tok = tokensById[cur];
        if (tok) {
          const resizeClassName = resizeDragUI?.targetTok === tok.tid
            ? (resizeDragUI.valid ? 'tok-resize-target-valid' : 'tok-resize-target-invalid')
            : '';
          out.push(
            <TokenNode
              key={`t-${tok.tid}`}
              tok={tok}
              selected={selectedTokens.has(tok.tid)}
              resizeClassName={resizeClassName}
              onMouseDown={onTokenMouseDown}
              onMouseEnter={onTokenMouseEnter}
              onClick={onTokenClick}
            />
          );
        }
        cur += 1;
      }

      const iconType = ICON_MAP[child.type]?.[0] || GLOBAL_DEFAULTS.DEFAULT_ICON;
      const borderColor = getEntityColor(child);
      const starColor = getEntityStarColor(child);
      
      const activeEdgeModes = configuredEdges.filter(mode => {
         const antec = child.antecedents?.[mode] || (mode === 'bridge' ? child.bridge_antec : '_');
         return antec !== '_';
      });
      const showEdgeIcons = activeEdgeModes.length > 0;
      
      let edgeWarn = false;
      activeEdgeModes.forEach(mode => {
         const edgeConf = modelConfig?.colors?.edges?.[mode] || {};
         const typeKeys = Object.keys(edgeConf).filter(k => Array.isArray(edgeConf[k]));
         if (typeKeys.length > 0) {
            const key = typeKeys[0];
            const val = child.annos?.[key];
            if (!val || val === `no${mode}`) edgeWarn = true;
         } else if (mode === 'bridge') {
            const hasSubtype = !!child.annos?.bridgetype && child.annos.bridgetype !== 'nobridge';
            if (!hasSubtype) edgeWarn = true;
         }
      });
      
      const salienceCount = child.salienceField ? countCheckValues(child.annos?.[summarySyncKey], modelConfig, summarySyncKey) : null;
      const salienceLabel = child.salienceField && (salienceCount ?? 0) > 0 ? `+${salienceCount}` : '';
      const firstMentionHalo = isFirstMentionHaloVisible(child);
      const mentionFontStyle = getMentionSyncStyle(child);
      const entityClassName = `entity s${tokensById[child.start]?.sentnum || 1} ${selectedEntities.has(childId) ? 'selected-entity' : ''} ${hoveredGroupEntities.has(childId) && !selectedEntities.has(childId) ? 'hovered-group-entity' : ''} ${resizeHover.entityId === childId && resizeHover.side === 'left' ? 'entity-border-hover-left' : ''} ${resizeHover.entityId === childId && resizeHover.side === 'right' ? 'entity-border-hover-right' : ''}`;
      const entityStyle = {
        borderColor,
        color: mentionFontStyle.color,
        fontWeight: mentionFontStyle.fontWeight,
        boxShadow: firstMentionHalo ? '0 0 8px 4px rgba(0, 150, 255, 0.3)' : undefined
      };

      out.push(
        <EntityNode
          key={`e-${childId}`}
          child={child}
          childId={childId}
          entityClassName={entityClassName}
          entityStyle={entityStyle}
          entityTitle={entityText(child, tokensById)}
          iconType={iconType}
          childType={child.type}
          starColor={starColor}
          salienceLabel={salienceLabel}
          showEdgeIcons={showEdgeIcons}
          edgeWarn={edgeWarn}
          renderRange={renderRange}
          onEntityClick={onEntityClick}
          onEntityMouseMove={onEntityMouseMove}
          onEntityMouseDown={onEntityMouseDown}
          onEntityHover={onEntityHover}
          onEntityMouseLeave={onEntityMouseLeave}
          onEntityDoubleClick={onEntityDoubleClick}
          onOpenTypeMenu={openTypeMenu}
          onDeleteEntity={onDeleteEntityMouseDown}
        />
      );

      cur = child.end + 1;
    });

    while (cur <= end) {
      const tok = tokensById[cur];
      if (tok) {
        const resizeClassName = resizeDragUI?.targetTok === tok.tid
          ? (resizeDragUI.valid ? 'tok-resize-target-valid' : 'tok-resize-target-invalid')
          : '';
        out.push(
          <TokenNode
            key={`t-${tok.tid}`}
            tok={tok}
            selected={selectedTokens.has(tok.tid)}
            resizeClassName={resizeClassName}
            onMouseDown={onTokenMouseDown}
            onMouseEnter={onTokenMouseEnter}
            onClick={onTokenClick}
          />
        );
      }
      cur += 1;
    }

    return out;
  }, [
    childrenByParent,
    entities,
    tokensById,
    selectedTokens,
    selectedEntities,
    hoveredGroupEntities,
    resizeHover,
    resizeDragUI,
    ICON_MAP,
    GLOBAL_DEFAULTS.DEFAULT_ICON,
    onTokenMouseDown,
    onTokenMouseEnter,
    onTokenClick,
    getEntityColor,
    isFirstMentionHaloVisible,
    getMentionSyncStyle,
    getEntityStarColor,
    onEntityClick,
    onEntityMouseMove,
    onEntityMouseDown,
    onEntityHover,
    onEntityHoverOut,
    onEntityMouseLeave,
    onEntityDoubleClick,
    openTypeMenu,
    onDeleteEntityMouseDown,
    configuredEdges,
    modelConfig
  ]);

  const sentenceNumbers = Object.keys(sentenceMap).map(Number).sort((a, b) => a - b);
  const nlpActionButtonClass = 'px-3 py-1.5 text-sm font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed';
  const externalControlsHost = (typeof window !== 'undefined' && externalControlsHostId)
    ? document.getElementById(externalControlsHostId)
    : null;
  const entityLinkingControls = showEntityLinking ? (
    <div style={{ marginTop: 0 }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className={nlpActionButtonClass}
          type="button"
          onClick={() => {
            if (showNamedEntityLinkingPanel) {
              setShowNamedEntityLinkingPanel(false);
              return;
            }
            refreshNamedEntityListing();
          }}
        >
          {showNamedEntityLinkingPanel ? 'Hide Named Entities' : 'List Named Entities'}
        </button>

        {/* Dynamic Configured Tools */}
        {Object.entries(mutationTools || {}).map(([toolKey, toolConfig]) => {
          if (toolConfig.editor !== 'spannotator') return null;

          const isRunning = activeTools[toolKey];
          // Use config color if provided, fallback to the default indigo class
          const btnClass = toolConfig.color 
            ? `px-3 py-1.5 text-sm font-medium rounded bg-${toolConfig.color}-600 text-white hover:bg-${toolConfig.color}-700 disabled:opacity-50 disabled:cursor-not-allowed`
            : nlpActionButtonClass;

          return (
            <button
              key={toolKey}
              className={btnClass}
              type="button"
              onClick={() => runDynamicTool(toolKey)}
              disabled={isRunning}
              title={toolConfig.caption}
            >
              {isRunning ? `${toolConfig.caption}...` : toolConfig.caption}
            </button>
          );
        })}
      </div>

      {showNamedEntityLinkingPanel ? (
        <div className="mt-2 border border-slate-300 rounded-md p-3 bg-slate-50 shadow-sm">
          {Object.keys(namedEntityListing).length === 0 ? (
            <div>No named entities</div>
          ) : (
            <>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                {Object.keys(namedEntityListing).sort((a, b) => a.localeCompare(b)).map((entityType) => (
                  <li key={entityType} style={{ marginBottom: '8px' }}>
                    <strong>{entityType}</strong>
                    <ul style={{ marginTop: '6px', paddingLeft: 0, border: '1px solid #d1d5db', borderRadius: '4px', overflow: 'hidden' }}>
                      {(namedEntityListing[entityType] || []).map((textValue, rowIndex, rows) => {
                        const inputKey = namedEntityInputKey(entityType, textValue);
                        const hasPendingSuggestion = Boolean(pendingNamedEntityIdentitySuggestions[inputKey]);
                        return (
                          <li key={`${entityType}-${textValue}`} style={{ marginBottom: 0, listStyle: 'none', borderBottom: rowIndex < rows.length - 1 ? '1px solid #d1d5db' : 0 }}>
                            <label
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(0, 7fr) minmax(140px, 3fr) auto',
                                columnGap: '8px',
                                alignItems: 'center',
                                width: '100%',
                                overflow: 'hidden',
                                background: '#ffffff'
                              }}
                            >
                              <span style={{ overflowWrap: 'anywhere', padding: '6px 8px', borderRight: '1px solid #d1d5db', background: '#f8fafc' }}>{textValue}</span>
                              <input
                                type="text"
                                list={`suggestions-${entityType}`}
                                value={namedEntityIdentityInputs[inputKey] || ''}
                                onChange={(e) => onNamedEntityIdentityChange(entityType, textValue, e.target.value)}
                                style={{
                                  width: '100%',
                                  minWidth: '140px',
                                  border: 0,
                                  borderRadius: 0,
                                  padding: '6px 8px',
                                  background: hasPendingSuggestion ? '#dbeafe' : '#ffffff'
                                }}
                              />
                              <datalist id={`suggestions-${entityType}`}>
                                {(identitySuggestions[entityType] || []).map((suggestion) => (
                                  <option key={suggestion} value={suggestion} />
                                ))}
                              </datalist>

                              {hasPendingSuggestion ? (
                                <button
                                  type="button"
                                  onClick={() => confirmNamedEntityIdentitySuggestion(entityType, textValue)}
                                  title="Confirm suggested identity"
                                  style={{
                                    marginRight: '8px',
                                    width: '28px',
                                    height: '28px',
                                    border: '1px solid #94a3b8',
                                    borderRadius: '4px',
                                    background: '#ffffff',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#0f172a',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <Check size={14} strokeWidth={2.2} />
                                </button>
                              ) : <span style={{ width: '28px', marginRight: '8px' }} />}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>

              {showGuessIdentitiesButton && typeof onGuessIdentities === 'function' ? (
                <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className={nlpActionButtonClass}
                    type="button"
                    onClick={runGuessIdentities}
                    disabled={isGuessIdentitiesRunning}
                    title="Use NLP to guess identity values for listed named entities"
                  >
                    {isGuessIdentitiesRunning ? 'Guessing Identities...' : 'Guess Identities'}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  ) : null;

  // Transform the 1D array into a fast dictionary keyed by the cell 'ref' (e.g., "A1")
  const socialCalcCellMap = useMemo(() => {
    const map = {};
    const cells = socialcalcModel?.sheet?.cells;
    
    if (Array.isArray(cells)) {
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (cell && cell.ref) {
          map[cell.ref] = cell;
        }
      }
    }
    return map;
  }, [socialcalcModel]);

  const getSentenceTooltip = useCallback((startTok, endTok) => {
    if (!sentenceTooltipKey || !socialCalcCellMap) return undefined;

    // Helper to extract text from cell object structure
    const getCellText = (cell) => {
      if (!cell) return '';
      return String(cell.rawValue ?? cell.datastr ?? cell.t ?? cell.v ?? '').trim();
    };

    // 1. Find all columns where Row 1 (header) matches our target key
    const matchingCols = [];
    for (const [ref, cell] of Object.entries(socialCalcCellMap)) {
      const match = ref.match(/^([A-Z]+)1$/);
      if (match && getCellText(cell) === sentenceTooltipKey) {
        matchingCols.push(match[1]);
      }
    }

    if (matchingCols.length === 0) return undefined;

    // Sort alphabetically so we take the leftmost matching column
    matchingCols.sort();

    // 2. Resolve the spreadsheet rows for the sentence tokens
    const startRow = socialcalcModel.tokenRowsByTid?.[startTok]?.startRow ?? (startTok + 1);
    const endRow = socialcalcModel.tokenRowsByTid?.[endTok]?.endRow ?? (endTok + 1);

    // 3. Scan the column for an overlapping value
    for (const col of matchingCols) {
      // First, check within the sentence's explicit token boundaries
      for (let r = startRow; r <= endRow; r++) {
        const cellText = getCellText(socialCalcCellMap[`${col}${r}`]);
        if (cellText && cellText !== '_') return cellText;
      }

      // If empty, scan upwards from just above the sentence to catch labels 
      // that started BEFORE the sentence began
      for (let r = startRow - 1; r >= 2; r--) {
        const cellText = getCellText(socialCalcCellMap[`${col}${r}`]);
        if (cellText && cellText !== '_') return cellText;
      }
    }

    return undefined;
  }, [sentenceTooltipKey, socialcalcModel, socialCalcCellMap]);

  return (
    <>
      <div id="spannotator-root" ref={rootRef} className={className} style={fontFamily ? { fontFamily } : undefined}>
        <input type="hidden" name="active_entity" id="active_entity" value={activeEntityId} readOnly />

      <ul
        id="anno-context"
        className={`custom-menu ${contextMenu.open ? 'open' : ''}`}
        style={{ top: contextMenu.y, left: contextMenu.x }}
      >
        {Object.keys(ICON_MAP).sort().map((annoVal) => (
          <li
            key={annoVal}
            onClick={() => {
              if (contextMenu.entityId) changeEntityType(contextMenu.entityId, annoVal);
              setContextMenu({ open: false, x: 0, y: 0, entityId: '' });
            }}
          >
            <LegacyEntityIcon iconName={ICON_MAP[annoVal][0]} className="sp-inline-icon" size={11} /> {annoVal}
          </li>
        ))}
      </ul>

      <div id="spannotator">
        <div id="toolbar" style={{paddingLeft: '8px'}}>
          <button type="button" className="btn" onClick={() => addEntity()} title="Add span (Enter)">
            <Plus size={14} className="sp-btn-icon" />
          </button>
          <button type="button" className="btn" onClick={groupSelected} title="Group spans (Enter)" id="btn_group" disabled={colorMode === 'entities'}>
            <Link size={14} className="sp-btn-icon" />
          </button>
          <button type="button" className="btn" onClick={ungroupSelected} title="Ungroup spans (Del)" id="btn_ungroup" disabled={colorMode === 'entities'}>
            <Unlink size={14} className="sp-btn-icon" />
          </button>
          <button type="button" className="btn" onClick={() => setSentenceMode((m) => (m === 'text' ? 'sent' : 'text'))} title="Toggle sentence view">
            <Timeline size={14} className="sp-btn-icon" />
          </button>
          <button type="button" className="btn" onClick={() => { setImportText(''); setShowImportDialog(true); }} title="Paste data">
            <FileUp size={14} className="sp-btn-icon" />
          </button>
          <button type="button" className="btn" onClick={() => { setShowExportDialog(true); runExport(exportFormat); }} title="Export data">
            <FileDown size={14} className="sp-btn-icon" />
          </button>
          
          {allColorModes.length > 0 ? (
            <>
              <span className="toolbar-spacer">| use colors for:</span>
              <select id="color_mode" className="toolbar-select" value={colorMode} onChange={(e) => setColorMode(e.target.value)}>
                <option value="entities">entity types</option>
                {allColorModes.map(mode => (
                  <option key={mode} value={mode}>{mode}</option>
                ))}
              </select>
            </>
          ) : null}
          
          {showFirstMentionsButton ? (
            <button type="button" className="btn" onClick={() => setShowBridgeTriggers((prev) => !prev)} title="Highlight first mentions">
              <Flame size={14} className="sp-btn-icon" />
            </button>
          ) : null}
          {summaries.length > 0 ? (
            <div className="sp-summary-row" style={summaryBarHeight > 0 ? { height: `${summaryBarHeight}px` } : undefined} title={activeSummaryDisplay || undefined}>
              <button type="button" className="sp-btn sp-summary-nav" onClick={() => cycleSummaryIndex(-1)} aria-label="Previous summary">
                <ChevronUp size={10} className="sp-btn-icon" />
              </button>
              <button type="button" className="sp-btn sp-summary-nav" onClick={() => cycleSummaryIndex(1)} aria-label="Next summary">
                <ChevronDown size={10} className="sp-btn-icon" />
              </button>
              <div className="sp-summary-display">{activeSummaryDisplay}</div>
            </div>
          ) : null}
          {summaries.length > 0 ? (
            <div ref={summaryMeasureRef} className="sp-summary-measure" aria-hidden="true">
              {summaries.map((summary, idx) => (
                <div key={`${idx}-${summary}`} className="sp-summary-measure-row">
                  <div className="sp-summary-measure-btn" />
                  <div className="sp-summary-measure-btn" />
                  <div className="sp-summary-measure-item">{`${idx + 1} ${summary}`}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div id="editor" onClick={() => { setSelectedEntities(new Set()); setContextMenu((cm) => ({ ...cm, open: false })); }}>
          {resizeDragUI?.active ? (
            <div
              className={`sp-resize-guide ${resizeDragUI.valid ? 'valid' : 'invalid'}`}
              style={{ left: `${resizeDragUI.x}px`, top: `${resizeDragUI.y}px` }}
              aria-hidden="true"
            >
              <div className="sp-resize-guide-line" style={{ borderColor: resizeDragUI.color }} />
              <div className="sp-resize-guide-badge" style={{ borderColor: resizeDragUI.color, color: resizeDragUI.color }}>
                {resizeDragUI.side === 'left' ? 'L' : 'R'}
              </div>
            </div>
          ) : null}
          <div id="selectable">
            {sentenceMode === 'sent' ? (
              sentenceNumbers.map((snum) => {
                const tids = sentenceMap[snum];
                const start = Math.min(...tids);
                const end = Math.max(...tids);
                
                // Fetch the tooltip directly from the spreadsheet model
                const tooltipValue = getSentenceTooltip(start, end);

                return (
                  <div key={`sent-${snum}`} className="sent_row">
                    <span 
                      id={`s${snum}`} 
                      className={`sent s${snum} numbered offset`} 
                      title={tooltipValue} 
                    />
                    {renderRange(start, end, null)}
                  </div>
                );
              })
            ) : (
              renderRange(1, tokens.length, null)
            )}
          </div>
        </div>

      </div>

      {showImportDialog ? (
        <div className="sp-modal-backdrop" onMouseDown={() => setShowImportDialog(false)}>
          <div className="sp-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sp-modal-title">Import data</div>
            <div style={{ marginBottom: '6px' }}>Paste text, WebAnno, TT/SGML, or SocialCalc:</div>
            <textarea className="sp-modal-textarea" value={importText} onChange={(e) => setImportText(e.target.value)} />
            <div className="sp-modal-actions">
              <button className="sp-btn" type="button" onClick={() => setShowImportDialog(false)}>Close</button>
              <button className="sp-btn" type="button" onClick={applyImport}>Import</button>
            </div>
          </div>
        </div>
      ) : null}

      <svg className="sp-bridge-overlay" aria-hidden="true">
        {edgeLinePaths.map((line) => (
          <path
            key={`${line.sourceId}->${line.targetId}`}
            d={line.d}
            fill="none"
            stroke={line.color}
            strokeWidth="2"
            strokeLinecap="round"
          />
        ))}
      </svg>

      {showExportDialog ? (
        <div className="sp-modal-backdrop" onMouseDown={() => setShowExportDialog(false)}>
          <div className="sp-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sp-modal-title">Export data</div>
            <div style={{ marginBottom: '6px' }}>
              <label style={{ marginRight: '8px' }}>
                <input type="radio" name="export_format" value="webanno" checked={exportFormat === 'webanno'} onChange={() => { setExportFormat('webanno'); runExport('webanno'); }} /> WebAnno
              </label>
              <label>
                <input type="radio" name="export_format" value="tt" checked={exportFormat === 'tt'} onChange={() => { setExportFormat('tt'); runExport('tt'); }} /> TT/CWB SGML
              </label>
              <label style={{ marginLeft: '8px' }}>
                <input type="radio" name="export_format" value="socialcalc" checked={exportFormat === 'socialcalc'} onChange={() => { setExportFormat('socialcalc'); runExport('socialcalc'); }} /> SocialCalc
              </label>
            </div>
            <textarea className="sp-modal-textarea" value={exportText} onChange={(e) => setExportText(e.target.value)} />
            <div className="sp-modal-actions">
              <button className="sp-btn" type="button" onClick={() => setShowExportDialog(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {showAnnotationDialog && activeEntity ? (
        <div className="sp-modal-backdrop" onMouseDown={() => setShowAnnotationDialog(false)}>
          <div className="sp-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sp-modal-title">Annotate entity</div>
            <div id="anno_entity_text">{entityText(activeEntity, tokensById)}</div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <select value={selectedAnnoKey} onChange={(e) => setSelectedAnnoKey(e.target.value)}>
                {annotationKeys.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>

              {resolvedAnnoKind === 'enum' && selectedAnnoKey !== 'bridgetype' ? (
                <select value={currentAnnoValue || ''} onChange={(e) => changeEntityAnno(activeEntity.div_id, selectedAnnoKey, e.target.value)}>
                  {currentEnumValues.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : null}

              {resolvedAnnoKind === 'text' ? (
                <input
                  type="text"
                  value={currentAnnoValue || ''}
                  onChange={(e) => changeEntityAnno(activeEntity.div_id, selectedAnnoKey, e.target.value)}
                  style={{ minWidth: '220px' }}
                />
              ) : null}
            </div>

            {currentAnnoKind === 'checks' ? (
              <div style={{ marginBottom: '8px' }}>
                {currentCheckChars.map((v, idx) => (
                  <label key={`sal-${idx}`} style={{ marginRight: '8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="checkbox"
                      checked={v === (currentCheckSettings?.trueChar || salienceTrueChar)}
                      onChange={() => toggleCheckIndex(idx)}
                    />
                    {idx + 1}
                  </label>
                ))}
              </div>
            ) : null}

            {selectedAnnoKey === 'bridgetype' ? (
              <div style={{ marginBottom: '8px' }}>
                <button className="sp-btn" type="button" onClick={() => setShowGranularSubtypes((x) => !x)} style={{ marginBottom: '6px' }}>
                  Toggle subtype granularity
                </button>
                <div className="sp-anno-grid">
                  {(showGranularSubtypes
                    ? columnMajorOrder(ANNO_VALUES.bridgetype, 2)
                    : columnMajorOrder(Array.from(new Set(ANNO_VALUES.bridgetype.map((x) => x.split(bridgeCoarseSeparator)[0]))), 2)).map((v) => {
                      const checked = bridgeValues.includes(v) || bridgeValues.some((x) => x.startsWith(`${v}${bridgeCoarseSeparator}`));
                      return (
                        <label key={v} className="sp-anno-label">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => updateBridgeSelection(v, e.target.checked)}
                          /> {v}
                        </label>
                      );
                    })}
                </div>
              </div>
            ) : null}

            <div className="sp-modal-actions">
              <button className="sp-btn" type="button" onClick={() => setShowAnnotationDialog(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
      </div>

      {externalControlsHost ? createPortal(entityLinkingControls, externalControlsHost) : entityLinkingControls}
    </>
  );
}
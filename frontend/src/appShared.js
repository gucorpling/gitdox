
// --- PROJECT CONFIGURATION ---
// Configure the frontend's active project name.
// 
// If left empty/null, it defaults to the backend's generic gitdox-config.yaml.
export const FRONTEND_PROJECT_NAME = (typeof window !== 'undefined' && window.GITDOX_PROJECT) || 'example';

// Optional frontend route base fallback (used only if no runtime/env base path is detected).
export const normalizeFrontendBasePath = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
};

export const resolveFrontendBasePath = () => {
  const runtimeBase = typeof window !== 'undefined'
    ? window.GITDOX_FRONTEND_BASE_PATH || window.GITDOX_BASE_PATH
    : '';

  const envBase = typeof import.meta !== 'undefined' && import.meta?.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : '';

  return normalizeFrontendBasePath(runtimeBase || envBase || '');
};
export const FRONTEND_BASE_PATH = resolveFrontendBasePath();
export const FRONTEND_BASE_PATH_FALLBACK = '';
export const EFFECTIVE_FRONTEND_BASE_PATH = FRONTEND_BASE_PATH || normalizeFrontendBasePath(FRONTEND_BASE_PATH_FALLBACK);

// API endpoint configuration:
// - API_BASE defaults to the current page origin so production uses the same host
// - In local dev (localhost/127.0.0.1/::1), if frontend is not on :8008, default API_BASE becomes :8008
// - window.GITDOX_API_BASE (or Vite env VITE_GITDOX_API_BASE) can override API_BASE
// - window.GITDOX_API_PREFIX can override the default route prefix at runtime
// - API_ROOT is the effective fetch base used by the app (API_BASE + prefix) - by default ...:8008/gdapi
export const resolveApiBase = () => {
  const runtimeBase = typeof window !== 'undefined' ? window.GITDOX_API_BASE : '';
  const envBase = typeof import.meta !== 'undefined' && import.meta?.env?.VITE_GITDOX_API_BASE
    ? import.meta.env.VITE_GITDOX_API_BASE
    : '';

  const explicitBase = (runtimeBase || envBase || '').toString().trim();
  if (explicitBase) {
    return explicitBase.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    const { hostname, port, origin } = window.location;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';

    if (isLocalHost && port !== '8008') {
      try {
        const devApiUrl = new URL(origin);
        devApiUrl.port = '8008';
        devApiUrl.pathname = '';
        devApiUrl.search = '';
        devApiUrl.hash = '';
        return devApiUrl.toString().replace(/\/+$/, '');
      } catch {
        return 'http://localhost:8008';
      }
    }

    return origin.replace(/\/+$/, '');
  }

  return 'http://localhost:8008';
};

export const API_BASE = resolveApiBase();
export const API_PREFIX = (typeof window !== 'undefined' && window.GITDOX_API_PREFIX) || '/gdapi';

export const normalizeApiPrefix = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash === '/' ? '' : withLeadingSlash.replace(/\/+$/, '');
};

export const buildApiRoot = (base, prefix) => {
  const normalizedBase = typeof base === 'string' ? base.trim().replace(/\/+$/, '') : '';
  const normalizedPrefix = normalizeApiPrefix(prefix);

  if (!normalizedBase) return normalizedPrefix;
  if (!normalizedPrefix) return normalizedBase;
  if (normalizedBase.endsWith(normalizedPrefix)) return normalizedBase;

  return `${normalizedBase}${normalizedPrefix}`;
};

export const API_ROOT = buildApiRoot(API_BASE, API_PREFIX);


export const buildFrontendPath = (pathname, basePath = FRONTEND_BASE_PATH) => {
  const normalizedPath = (typeof pathname === 'string' && pathname.trim())
    ? (pathname.startsWith('/') ? pathname : `/${pathname}`)
    : '/';
  const normalizedBase = normalizeFrontendBasePath(basePath);

  if (!normalizedBase) return normalizedPath;
  if (normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`)) return normalizedPath;

  return `${normalizedBase}${normalizedPath}`;
};

export const stripFrontendBasePath = (pathname, basePath = FRONTEND_BASE_PATH) => {
  const normalizedPath = (typeof pathname === 'string' && pathname.trim())
    ? (pathname.startsWith('/') ? pathname : `/${pathname}`)
    : '/';
  const normalizedBase = normalizeFrontendBasePath(basePath);

  if (!normalizedBase) return normalizedPath;
  if (normalizedPath === normalizedBase) return '/';
  if (normalizedPath.startsWith(`${normalizedBase}/`)) return normalizedPath.slice(normalizedBase.length) || '/';

  return normalizedPath;
};

export const resolveFrontendAssetPath = (value, basePath = FRONTEND_BASE_PATH) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^(https?:|data:|blob:)/i.test(trimmed) || trimmed.startsWith('//')) return trimmed;
  if (trimmed.includes('..')) return null;

  const withoutLeadingDotSlash = trimmed.replace(/^\.\//, '');
  const normalizedPath = withoutLeadingDotSlash.startsWith('/')
    ? withoutLeadingDotSlash
    : `/${withoutLeadingDotSlash}`;

  return buildFrontendPath(normalizedPath, basePath);
};

export const DEFAULT_PROJECT = 'main_project';
export const DEFAULT_DISPLAY_NAME = 'GitDOX';
export const EMPTY_VALIDATION = { id: '', document: '', corpus: '', domain: 'spreadsheet', key: '', operator: 'exists', value: '' };
export const DEFAULT_STATUS_CATEGORIES = ['init', 'review', 'published'];
const EDITOR_DEFINITIONS = {
  xml: { key: 'xml', mode: 'xml', label: 'xml' },
  spreadsheet: { key: 'spreadsheet', mode: 'spreadsheet', label: 'spreadsheet' },
  entities: { key: 'entities', mode: 'entities', label: 'entities' },
  dendroid: { key: 'dendroid', mode: 'dendroid', label: 'dendroid' }
};
const DEFAULT_EDITOR_OPTIONS = Object.freeze([
  { key: 'xml', mode: 'xml', label: 'xml' }
]);

export const normalizeConfiguredEditors = (value) => {
  const sourceEntries = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value)
    : [];
  const normalizedByMode = new Map();

  sourceEntries.forEach(([rawKey, rawLabel]) => {
    const normalizedKey = String(rawKey || '').trim().toLowerCase();
    const definition = EDITOR_DEFINITIONS[normalizedKey];
    if (!definition) return;

    const label = typeof rawLabel === 'string' && rawLabel.trim().length > 0
      ? rawLabel.trim()
      : definition.label;

    normalizedByMode.delete(definition.mode);
    normalizedByMode.set(definition.mode, {
      key: definition.key,
      mode: definition.mode,
      label
    });
  });

  if (normalizedByMode.size === 0) {
    return DEFAULT_EDITOR_OPTIONS.map((option) => ({ ...option }));
  }

  return Array.from(normalizedByMode.values());
};

export const normalizeAllowedEditors = (value, editorOptions = []) => {
  const configuredModes = Array.isArray(editorOptions) && editorOptions.length > 0
    ? editorOptions.map((option) => String(option?.mode || option?.key || '').trim().toLowerCase()).filter(Boolean)
    : DEFAULT_EDITOR_OPTIONS.map((option) => option.mode);

  const normalizedModes = Array.from(new Set(configuredModes));
  if (normalizedModes.length === 0) return {};

  const parseSource = () => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return {};
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // ignore invalid JSON; fall through below
      }
      return Object.fromEntries(
        trimmed.split(',').map((token) => [String(token).trim().toLowerCase(), true]).filter(([mode]) => mode)
      );
    }
    if (Array.isArray(value)) {
      return Object.fromEntries(value.map((mode) => [String(mode).trim().toLowerCase(), true]).filter(([mode]) => mode));
    }
    return {};
  };

  const source = parseSource();
  return normalizedModes.reduce((acc, mode) => {
    const hasExplicitValue = Object.prototype.hasOwnProperty.call(source, mode);
    const rawValue = hasExplicitValue ? source[mode] : true;
    acc[mode] = rawValue === true || rawValue === 'true' || rawValue === 1 || rawValue === '1';
    return acc;
  }, {});
};

export const getAllowedEditorModes = (user, editorOptions = []) => {
  const configuredModes = Array.isArray(editorOptions) && editorOptions.length > 0
    ? editorOptions.map((option) => String(option?.mode || option?.key || '').trim().toLowerCase()).filter(Boolean)
    : DEFAULT_EDITOR_OPTIONS.map((option) => option.mode);

  if (!configuredModes.length) return [];
  if ((user?.adminlevel ?? 0) >= 2) return configuredModes;

  const allowedEditors = normalizeAllowedEditors(user?.allowed_editors, editorOptions);
  return configuredModes.filter((mode) => allowedEditors[mode] !== false);
};

export const isEditorModeAllowedForUser = (user, mode, editorOptions = []) => {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (!normalizedMode) return true;
  if ((user?.adminlevel ?? 0) >= 2) return true;

  const allowedModes = getAllowedEditorModes(user, editorOptions);
  return allowedModes.includes(normalizedMode);
};

export const normalizeAllowedCorporaPattern = (value) => {
  if (value === undefined || value === null || value === '') return '.*';
  const normalized = String(value).trim();
  return normalized || '.*';
};

export const isCorpusAllowedForUser = (user, corpus) => {
  const adminLevel = Number(user?.adminlevel ?? 0);
  if (adminLevel >= 2) return true;
  const corpusName = String(corpus || '').trim();
  if (!corpusName) return true;

  const pattern = normalizeAllowedCorporaPattern(user?.allowed_corpora);
  try {
    return new RegExp(pattern).test(corpusName);
  } catch {
    return true;
  }
};

export const getDefaultEditorMode = (editorOptions) => {
  if (Array.isArray(editorOptions) && editorOptions.length > 0) {
    return editorOptions[0].mode;
  }
  return DEFAULT_EDITOR_OPTIONS[0].mode;
};

export const normalizeStatusCategories = (value) => {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.status_categories)
      ? value.status_categories
      : Array.isArray(value?.categories)
        ? value.categories
        : [];

  const seen = new Set();
  return source.reduce((acc, item) => {
    const label = typeof item === 'string' ? item.trim() : '';
    if (!label || seen.has(label)) return acc;
    seen.add(label);
    acc.push(label);
    return acc;
  }, []);
};

export const formatStatusCategoryLabel = (value) => {
  return (value || '').toString();
};

export const normalizeCssStyleValue = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const isDarkColor = (color) => {
  if (!color) return false;
  const c = color.trim().toLowerCase();
  if (c === 'transparent' || c === 'inherit' || c === 'none') return false;

  // Hex (#fff, #123456)
  const hexMatch = c.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000 < 128;
  }

  // RGB / RGBA
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000 < 128;
  }

  // HSL / HSLA
  const hslMatch = c.match(/^hsla?\(\s*\d+\s*,\s*[\d.]+%,\s*([\d.]+)%/i);
  if (hslMatch) {
    return parseFloat(hslMatch[1]) < 50;
  }

  // Common named dark colors fallback
  const darkNames = ['black', 'navy', 'darkblue', 'darkgreen', 'darkred', 'purple', 'indigo', 'maroon', 'midnightblue', 'darkslategray'];
  if (darkNames.includes(c)) return true;

  return false;
};

export const EMPTY_DASHBOARD_FILTERS = {
  id: '',
  corpus: '',
  docname: '',
  validation: '',
  status: '',
  assigned: '',
  mode: ''
};

export const normalizeDashboardViewState = (value) => {
  const rawFilters = value?.columnFilters && typeof value.columnFilters === 'object'
    ? value.columnFilters
    : {};

  const columnFilters = {
    ...EMPTY_DASHBOARD_FILTERS,
    ...Object.fromEntries(
      Object.entries(rawFilters).map(([key, filterValue]) => [key, (filterValue ?? '').toString()])
    )
  };

  const rawScrollY = Number(value?.scrollY);
  const scrollY = Number.isFinite(rawScrollY) && rawScrollY > 0 ? rawScrollY : 0;

  return { columnFilters, scrollY };
};

export const areColumnFiltersEqual = (left = EMPTY_DASHBOARD_FILTERS, right = EMPTY_DASHBOARD_FILTERS) => {
  return Object.keys(EMPTY_DASHBOARD_FILTERS).every((key) => (left?.[key] ?? '') === (right?.[key] ?? ''));
};

export const normalizeFontFamily = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/;+$/, '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizePreferredColumnOrder = (value) => {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
};

export const normalizeBackgroundImageValue = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^none$/i.test(trimmed)) return 'none';

  const urlMatch = trimmed.match(/^url\(\s*(['"]?)(.*?)\1\s*\)$/i);
  if (urlMatch) {
    const rawUrl = (urlMatch[2] || '').trim();
    if (!rawUrl) return null;

    if (/^var\(/i.test(rawUrl) || /^(https?:|data:|blob:)/i.test(rawUrl) || rawUrl.startsWith('//')) {
      return trimmed;
    }

    const normalizedPath = resolveFrontendAssetPath(rawUrl, EFFECTIVE_FRONTEND_BASE_PATH);
    if (!normalizedPath) return null;
    return `url("${normalizedPath}")`;
  }

  if (/^(linear-gradient\(|radial-gradient\(|conic-gradient\(|repeating-linear-gradient\(|repeating-radial-gradient\(|image-set\(|var\()/i.test(trimmed)) {
    return trimmed;
  }

  if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(trimmed)) {
    return trimmed;
  }

  const normalizedPath = resolveFrontendAssetPath(trimmed, EFFECTIVE_FRONTEND_BASE_PATH);
  if (!normalizedPath) return null;

  return `url("${normalizedPath}")`;
};

export const isSpreadsheetBackedMode = (mode) => mode === 'spreadsheet' || mode === 'entities';

// Internal helpers needed for the exported validation functions below
const normalizeValidation = (validation) => {
  if (!validation) return { status: 'ready', rules_run: 0, results: [] };

  if (typeof validation === 'string') {
    if (validation === 'valid') return { status: 'ready', rules_run: 0, results: [] };
    if (validation === 'validating') return { status: 'validating', rules_run: 0, results: [] };
    return {
      status: 'ready',
      rules_run: 0,
      results: [{ rule: validation, violations: [] }]
    };
  }

  return {
    status: typeof validation?.status === 'string' ? validation.status : 'ready',
    rules_run: Number.isFinite(validation?.rules_run)
      ? validation.rules_run
      : (Array.isArray(validation?.results) ? validation.results.length : 0),
    results: Array.isArray(validation?.results) ? validation.results : []
  };
};

const hasMeaningfulContent = (value) => typeof value === 'string' && value.trim().length > 0;

const shouldIncludeValidationResult = (result, options = {}) => {
  const domain = typeof result?.domain === 'string' ? result.domain.toLowerCase() : '';
  const mode = typeof options?.mode === 'string' ? options.mode.toLowerCase() : '';
  const isTabularMode = isSpreadsheetBackedMode(mode);

  if (!domain || !mode) return true;
  if (domain === 'metadata') return true;

  if (mode === 'xml' && domain === 'spreadsheet' && !hasMeaningfulContent(options?.spreadsheetContent)) {
    return false;
  }
  if (mode === 'xml' && domain === 'entities' && !hasMeaningfulContent(options?.spreadsheetContent)) {
    return false;
  }
  if (isTabularMode && domain === 'xml' && !hasMeaningfulContent(options?.xmlContent)) {
    return false;
  }

  return true;
};

export const getValidationSummary = (validation, options = {}) => {
  const normalized = normalizeValidation(validation);

  if (normalized.status === 'validating' || normalized.status === 'queued' || normalized.status === 'processing') {
    return {
      status: 'validating',
      label: 'Validating',
      filterText: 'validating pending in-progress',
      title: 'Validation is in progress'
    };
  }

  const failing = normalized.results.filter(
    (result) =>
      Array.isArray(result?.violations) &&
      result.violations.length > 0 &&
      shouldIncludeValidationResult(result, options)
  );

  if (failing.length === 0) {
    return {
      status: 'valid',
      label: normalized.rules_run > 0 ? `Valid (${normalized.rules_run})` : 'Valid',
      filterText: `valid ${normalized.rules_run} 0`,
      title: normalized.rules_run > 0
        ? `${normalized.rules_run} validation rule(s) run, no violations`
        : 'No validation violations'
    };
  }

  const totalViolations = failing.reduce((sum, result) => sum + result.violations.length, 0);

  return {
    status: 'invalid',
    label: `Invalid (${failing.length})`,
    filterText: `invalid ${normalized.rules_run} ${failing.length} ${totalViolations} ${failing.map((r) => r.rule).join(' ')}`,
    title: failing
      .map((result) => `${result.rule}: ${result.violations.join(', ')}`)
      .join('\n')
  };
};

const METADATA_KEY_CAPTURE_PATTERN = /^metadata(?:\.|:)\s*([^\s,:=<>!|]+)/i;
const METADATA_KEY_PREFIX_PATTERN = /^([^\s,:=<>!|]+)\s*(?:is\s+required|missing|not\s+found|does\s+not\s+exist|must\b|should\b|expected\b)/i;

const extractMetadataKeyFromViolation = (violation) => {
  if (typeof violation !== 'string') return null;
  const trimmed = violation.trim();
  if (!trimmed) return null;

  const explicitMetadataMatch = trimmed.match(METADATA_KEY_CAPTURE_PATTERN);
  if (explicitMetadataMatch?.[1]) return explicitMetadataMatch[1].trim();

  const prefixedKeyMatch = trimmed.match(METADATA_KEY_PREFIX_PATTERN);
  if (prefixedKeyMatch?.[1]) return prefixedKeyMatch[1].trim();

  return trimmed;
};

export const getMetadataValidationViolationKeys = (validation, metadataRows = []) => {
  const normalized = normalizeValidation(validation);
  const metadataKeyLookup = new Map();

  metadataRows.forEach((row) => {
    const key = typeof row?.k === 'string' ? row.k.trim() : '';
    if (!key) return;
    metadataKeyLookup.set(key.toLowerCase(), key);
  });

  if (metadataKeyLookup.size === 0) return [];

  const violatingKeys = new Set();

  normalized.results.forEach((result) => {
    const violations = Array.isArray(result?.violations) ? result.violations : [];
    if (violations.length === 0) return;

    if (typeof result?.domain === 'string' && result.domain.toLowerCase() === 'metadata') {
      const ruleKey = typeof result?.key === 'string' ? result.key.trim().toLowerCase() : '';
      if (ruleKey && metadataKeyLookup.has(ruleKey)) {
        violatingKeys.add(metadataKeyLookup.get(ruleKey));
      }
    }

    violations.forEach((violation) => {
      const extractedKey = extractMetadataKeyFromViolation(violation);
      if (!extractedKey) return;

      const resolvedKey = metadataKeyLookup.get(extractedKey.toLowerCase());
      if (resolvedKey) {
        violatingKeys.add(resolvedKey);
      }
    });
  });

  return [...violatingKeys];
};
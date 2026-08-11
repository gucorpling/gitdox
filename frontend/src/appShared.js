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
  entities: { key: 'entities', mode: 'entities', label: 'entities' }
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
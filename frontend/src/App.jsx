import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FileText, Users, LogOut, AlertCircle } from 'lucide-react';
import DocumentEditor from './components/DocumentEditor';
import AdminView from './components/AdminView';
import DashboardView from './components/DashboardView';
import LoginView from './components/LoginView';
import {
  API_ROOT,
  FRONTEND_BASE_PATH,
  buildFrontendPath,
  normalizeFrontendBasePath,
  resolveFrontendAssetPath,
  stripFrontendBasePath,
  DEFAULT_PROJECT,
  DEFAULT_DISPLAY_NAME,
  DEFAULT_STATUS_CATEGORIES,
  normalizeConfiguredEditors,
  normalizeStatusCategories,
  normalizeCssStyleValue,
} from './appShared';

// --- PROJECT CONFIGURATION ---
// Configure the frontend's active project name.
// 
// If left empty/null, it defaults to the backend's generic gitdox-config.yaml.
const FRONTEND_PROJECT_NAME = (typeof window !== 'undefined' && window.GITDOX_PROJECT) || 'scriptorium'; //ling4427

// Optional frontend route base fallback (used only if no runtime/env base path is detected).
const FRONTEND_BASE_PATH_FALLBACK = ''; //gitdox2/scriptorium
const EFFECTIVE_FRONTEND_BASE_PATH = FRONTEND_BASE_PATH || normalizeFrontendBasePath(FRONTEND_BASE_PATH_FALLBACK);

const EMBEDDED_FONT_STYLE_ELEMENT_ID = 'gitdox-embedded-font-faces';

// Helper to determine if a CSS color value is dark, to dynamically adjust text colors
// Default values, will be updated in App based on config:
export var isNavDark = false; 
export var isMainDark = false;
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

const DASHBOARD_PATH = '/dashboard';
const LOGIN_PATH = '/login';
const ADMIN_PATH = '/admin';
const DOCUMENTS_PATH_PREFIX = '/docs';

const normalizePathname = (pathname = '/') => {
  const cleaned = pathname.replace(/\/+$/, '');
  return cleaned || '/';
};

const buildDocumentPath = (docId) => `${DOCUMENTS_PATH_PREFIX}/${encodeURIComponent(String(docId))}`;

const resolveRouteFromPathname = (pathname = '/') => {
  const normalized = normalizePathname(pathname);

  if (normalized === '/' || normalized === DASHBOARD_PATH) {
    return { view: 'dashboard' };
  }

  if (normalized === LOGIN_PATH) {
    return { view: 'login' };
  }

  if (normalized === ADMIN_PATH) {
    return { view: 'admin' };
  }

  const documentMatch = normalized.match(/^\/docs\/([^/]+)$/);
  if (documentMatch) {
    return { view: 'document', docId: decodeURIComponent(documentMatch[1]) };
  }

  return { view: 'dashboard' };
};

const buildRouteState = (view, nextDashboardState = null, extra = {}) => ({
  gitdox: true,
  view,
  dashboardViewState: normalizeDashboardViewState(nextDashboardState),
  ...extra,
});

export const areColumnFiltersEqual = (left = EMPTY_DASHBOARD_FILTERS, right = EMPTY_DASHBOARD_FILTERS) => {
  return Object.keys(EMPTY_DASHBOARD_FILTERS).every((key) => (left?.[key] ?? '') === (right?.[key] ?? ''));
};

const areDashboardViewStatesEqual = (left, right) => {
  const normalizedLeft = normalizeDashboardViewState(left);
  const normalizedRight = normalizeDashboardViewState(right);

  return (
    normalizedLeft.scrollY === normalizedRight.scrollY &&
    areColumnFiltersEqual(normalizedLeft.columnFilters, normalizedRight.columnFilters)
  );
};

export const normalizeFontFamily = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/;+$/, '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizePreferredColumnOrder = (value) => {
  // Should be an array of strings, return empty array otherwise
  if (!Array.isArray(value)) return [];
  return value .filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
};

const normalizeCssLength = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?(px|rem|em|vw|vh|%)$/i.test(trimmed)) return trimmed;
  return null;
};

const normalizeDisplayImageConfig = (value) => {
  if (!Array.isArray(value) || value.length === 0) return null;

  const src = normalizeEmbeddedFontPath(value[0]);
  if (!src) return null;

  const width = normalizeCssLength(value[1]);
  const height = normalizeCssLength(value[2]);

  return { src, width, height };
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

    // Keep CSS variables and external/data URLs untouched.
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

const normalizeEmbeddedFontPath = (value) => {
  return resolveFrontendAssetPath(value, EFFECTIVE_FRONTEND_BASE_PATH);
};

const inferFontFormatFromPath = (value) => {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (lower.endsWith('.woff2')) return 'woff2';
  if (lower.endsWith('.woff')) return 'woff';
  if (lower.endsWith('.ttf')) return 'truetype';
  if (lower.endsWith('.otf')) return 'opentype';
  if (lower.endsWith('.eot')) return 'embedded-opentype';
  return null;
};

const normalizeEmbeddedFontSource = (source) => {
  if (typeof source === 'string') {
    const path = normalizeEmbeddedFontPath(source);
    if (!path) return null;
    return { path, format: inferFontFormatFromPath(path) };
  }

  if (!source || typeof source !== 'object') return null;
  const path = normalizeEmbeddedFontPath(source.path);
  if (!path) return null;

  const format = typeof source.format === 'string' && source.format.trim()
    ? source.format.trim().toLowerCase()
    : inferFontFormatFromPath(path);

  return { path, format };
};

const normalizeEmbeddedFontFace = (face) => {
  if (!face || typeof face !== 'object') return null;

  const family = normalizeFontFamily(face.family);
  if (!family) return null;

  const rawSources = Array.isArray(face.sources)
    ? face.sources
    : (Array.isArray(face.src) ? face.src : []);
  const sources = rawSources
    .map(normalizeEmbeddedFontSource)
    .filter(Boolean);
  if (sources.length === 0) return null;

  const style = typeof face.style === 'string' && face.style.trim()
    ? face.style.trim()
    : 'normal';
  const weight = typeof face.weight === 'string' || typeof face.weight === 'number'
    ? String(face.weight).trim()
    : '400';
  const display = typeof face.display === 'string' && face.display.trim()
    ? face.display.trim()
    : 'swap';

  return { family, style, weight, display, sources };
};

const buildEmbeddedFontCss = (fontFaces) => {
  if (!Array.isArray(fontFaces) || fontFaces.length === 0) return '';

  return fontFaces.map((face) => {
    const srcValue = face.sources
      .map((source) => source.format
        ? `url("${source.path}") format("${source.format}")`
        : `url("${source.path}")`)
      .join(', ');

    return [
      '@font-face {',
      `  font-family: "${face.family}";`,
      `  src: ${srcValue};`,
      `  font-style: ${face.style};`,
      `  font-weight: ${face.weight};`,
      `  font-display: ${face.display};`,
      '}'
    ].join('\n');
  }).join('\n\n');
};

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

export const isSpreadsheetBackedMode = (mode) => mode === 'spreadsheet' || mode === 'entities';

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
      label: 'Validating...',
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

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
};

const toAttrSpec = (name, value, global = false) => {
  if (typeof name !== 'string' || !name.trim()) return null;

  const attrName = name.trim();
  const values = toStringArray(value);
  const attr = { name: attrName };

  if (values.length > 0) {
    attr.values = values;
  }

  if (global) {
    attr.global = true;
  }

  return attr;
};

const normalizeCm6XmlSchema = (schema) => {
  if (!isPlainObject(schema)) return null;
  if (!Array.isArray(schema.elements)) return null;

  const elements = schema.elements
    .map((element) => {
      if (!isPlainObject(element)) return null;
      if (typeof element.name !== 'string' || !element.name.trim()) return null;

      const normalized = { name: element.name.trim() };
      const children = toStringArray(element.children);
      if (children.length > 0) normalized.children = children;

      const textContent = toStringArray(element.textContent);
      if (textContent.length > 0) normalized.textContent = textContent;

      if (typeof element.top === 'boolean') {
        normalized.top = element.top;
      }

      if (Array.isArray(element.attributes)) {
        const attributes = element.attributes
          .map((attr) => {
            if (typeof attr === 'string') {
              return attr.trim() || null;
            }
            if (!isPlainObject(attr)) return null;
            return toAttrSpec(attr.name, attr.values, Boolean(attr.global));
          })
          .filter(Boolean);

        if (attributes.length > 0) normalized.attributes = attributes;
      }

      return normalized;
    })
    .filter(Boolean);

  if (elements.length === 0) return null;

  const attributes = Array.isArray(schema.attributes)
    ? schema.attributes
      .map((attr) => {
        if (!isPlainObject(attr)) return null;
        return toAttrSpec(attr.name, attr.values, Boolean(attr.global));
      })
      .filter(Boolean)
    : [];

  return attributes.length > 0 ? { elements, attributes } : { elements };
};

const normalizeLegacyXmlSchema = (schema) => {
  if (!isPlainObject(schema)) return null;

  const topLevel = new Set(toStringArray(schema['!top']));
  const globalAttrs = isPlainObject(schema['!attrs']) ? schema['!attrs'] : {};

  const elements = Object.entries(schema)
    .filter(([key]) => typeof key === 'string' && key && !key.startsWith('!'))
    .map(([name, spec]) => {
      const normalized = { name };
      if (topLevel.has(name)) {
        normalized.top = true;
      }

      const children = toStringArray(spec?.children);
      if (children.length > 0) {
        normalized.children = children;
      }

      const textContent = toStringArray(spec?.textContent);
      if (textContent.length > 0) {
        normalized.textContent = textContent;
      }

      const attrSpecs = [];
      if (isPlainObject(globalAttrs)) {
        Object.entries(globalAttrs).forEach(([attrName, attrValues]) => {
          const parsed = toAttrSpec(attrName, attrValues);
          if (parsed) attrSpecs.push(parsed);
        });
      }
      if (isPlainObject(spec?.attrs)) {
        Object.entries(spec.attrs).forEach(([attrName, attrValues]) => {
          const parsed = toAttrSpec(attrName, attrValues);
          if (parsed) attrSpecs.push(parsed);
        });
      }

      if (attrSpecs.length > 0) {
        normalized.attributes = attrSpecs;
      }

      return normalized;
    });

  return elements.length > 0 ? { elements } : null;
};

const buildXmlCompletionConfig = (schema) => {
  return normalizeCm6XmlSchema(schema) || normalizeLegacyXmlSchema(schema);
};

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('auth_token') || null);
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('auth_user')) || null);
  const [currentView, setCurrentView] = useState(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const route = resolveRouteFromPathname(stripFrontendBasePath(window.location.pathname, EFFECTIVE_FRONTEND_BASE_PATH));
    return route.view === 'document' && route.docId ? `document:${route.docId}` : route.view;
  });
  const [dashboardViewState, setDashboardViewState] = useState(() => normalizeDashboardViewState());
  const [dashboardRestoreRequestId, setDashboardRestoreRequestId] = useState(0);
  const [error, setError] = useState('');
  const [appConfig, setAppConfig] = useState(null);
  const [isAppConfigLoaded, setIsAppConfigLoaded] = useState(false);
  const [statusCategories, setStatusCategories] = useState(DEFAULT_STATUS_CATEGORIES);
  const pendingRouteRef = useRef(null);

  useEffect(() => {
    if (!token) setCurrentView('login');
  }, [token]);

  useEffect(() => {
    const loadAppConfig = async () => {
      try {
        // Appends the configured project to the backend request dynamically
        const queryParams = FRONTEND_PROJECT_NAME ? `?project=${encodeURIComponent(FRONTEND_PROJECT_NAME)}` : '';
        const response = await fetch(`${API_ROOT}/app-config${queryParams}`, { cache: 'no-store' });
        
        if (!response.ok) {
          setAppConfig(null);
          return;
        }
        const data = await response.json();
        setAppConfig(data);
      } catch (err) {
        setAppConfig(null);
      } finally {
        setIsAppConfigLoaded(true);
      }
    };

    loadAppConfig();
  }, []);

  useEffect(() => {
    const existing = document.getElementById(EMBEDDED_FONT_STYLE_ELEMENT_ID);
    const styleEl = existing || document.createElement('style');
    if (!existing) {
      styleEl.id = EMBEDDED_FONT_STYLE_ELEMENT_ID;
      document.head.appendChild(styleEl);
    }

    const normalizedFaces = Array.isArray(appConfig?.ui?.embedded_fonts)
      ? appConfig.ui.embedded_fonts.map(normalizeEmbeddedFontFace).filter(Boolean)
      : [];
    styleEl.textContent = buildEmbeddedFontCss(normalizedFaces);

    return () => {
      if (styleEl && styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
    };
  }, [appConfig]);

  // Use the frontend assigned project name first, falling back to what the backend config says, then defaults
  const projectName = FRONTEND_PROJECT_NAME || appConfig?.instance?.project || DEFAULT_PROJECT;
  
  const displayName = appConfig?.instance?.display_name || DEFAULT_DISPLAY_NAME;
  const helpMessage = appConfig?.instance?.help_message || "";
  const displayImage = normalizeDisplayImageConfig(appConfig?.instance?.display_image);
  const toolConfig = appConfig?.tools || {};
  const editorOptions = useMemo(
    () => normalizeConfiguredEditors(appConfig?.instance?.editors),
    [appConfig?.instance?.editors]
  );
  const xmlTagCompletion = useMemo(
    () => buildXmlCompletionConfig(appConfig?.xml?.tags_schema),
    [appConfig?.xml?.tags_schema]
  );
  const spreadsheetColumnOrder = appConfig?.spreadsheet?.column_order
    ?? appConfig?.spreadsheet?.preferred_column_order
    ?? appConfig?.['spreadsheet.column_order']
    ?? [];

  const navBackgroundColor = normalizeCssStyleValue(appConfig?.ui?.nav_background_color);
  isNavDark = isDarkColor(navBackgroundColor);

  const mainFontFamily = normalizeFontFamily(appConfig?.ui?.font);
  const mainBackgroundColor = normalizeCssStyleValue(appConfig?.ui?.background_color);
  const isMainDark = isDarkColor(mainBackgroundColor);

  const mainBackgroundImage = normalizeBackgroundImageValue(appConfig?.ui?.background_image);
  
  const mainStyle = {
    ...(mainFontFamily ? { fontFamily: mainFontFamily } : {}),
    ...(mainBackgroundColor ? { backgroundColor: mainBackgroundColor } : {}),
    ...(mainBackgroundImage
      ? {
          backgroundImage: mainBackgroundImage,
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center'
        }
      : {})
  };

const apiCall = async (endpoint, method = 'GET', body = null, options = {}) => {
    // Endpoints that are allowed to run without a token
    const publicEndpoints = ['/auth', '/init'];

    // If there's no token and it's a protected route, abort early
    if (!token && !publicEndpoints.includes(endpoint)) {
      return Promise.reject(new Error('SILENT_ABORT'));
    }

    setError('');
    const isFormData = options?.isFormData || body instanceof FormData;
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token && { 'token': token })
    };
    
    try {
      const response = await fetch(`${API_ROOT}${endpoint}`, {
        method,
        headers,
        body: body ? (isFormData ? body : JSON.stringify(body)) : null
      });
      const responseText = await response.text();
      let data = {};
      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch {
          data = { detail: responseText };
        }
      }
      if (!response.ok) throw new Error(data.detail || 'API Error');
      return data;
    } catch (err) {
      // Only set the global UI error if it isn't a silent abort, e.g. on logout
      if (err.message !== 'SILENT_ABORT') {
        setError(err.message);
        if (err.message.includes('token')) handleLogout();
      }
      throw err;
    }
  };

  const refreshStatusCategories = async () => {
    try {
      const data = await apiCall(`/projects/${projectName}/status-categories`);
      const nextStatusCategories = normalizeStatusCategories(data);
      setStatusCategories(nextStatusCategories);
      return nextStatusCategories;
    } catch (err) {
      setStatusCategories(DEFAULT_STATUS_CATEGORIES);
      return DEFAULT_STATUS_CATEGORIES;
    }
  };

  useEffect(() => {
    if (!projectName) return;
    refreshStatusCategories();
  }, [projectName, token]);

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setCurrentView('login');
    pendingRouteRef.current = null;
    if (typeof window !== 'undefined') {
      window.history.replaceState(
        buildRouteState('login', normalizeDashboardViewState()),
        '',
        buildFrontendPath(LOGIN_PATH, EFFECTIVE_FRONTEND_BASE_PATH)
      );
    }
  };

  const replaceRouteState = (pathname, view, nextDashboardState = dashboardViewState, extra = {}) => {
    if (typeof window === 'undefined') return;
    window.history.replaceState(
      buildRouteState(view, nextDashboardState, extra),
      '',
      buildFrontendPath(pathname, EFFECTIVE_FRONTEND_BASE_PATH)
    );
  };

  const pushRouteState = (pathname, view, nextDashboardState = dashboardViewState, extra = {}) => {
    if (typeof window === 'undefined') return;
    window.history.pushState(
      buildRouteState(view, nextDashboardState, extra),
      '',
      buildFrontendPath(pathname, EFFECTIVE_FRONTEND_BASE_PATH)
    );
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncRoute = (pathname, state = window.history.state) => {
      const localPath = stripFrontendBasePath(pathname, EFFECTIVE_FRONTEND_BASE_PATH);
      const route = resolveRouteFromPathname(localPath);
      const restoredDashboardState = normalizeDashboardViewState(state?.dashboardViewState);

      if (route.view === 'login') {
        setCurrentView('login');
        replaceRouteState(LOGIN_PATH, 'login', restoredDashboardState);
        return;
      }

      if (!token) {
        pendingRouteRef.current = route.view === 'document' || route.view === 'admin' || route.view === 'dashboard'
          ? route
          : null;
        setCurrentView('login');
        replaceRouteState(LOGIN_PATH, 'login', restoredDashboardState);
        return;
      }

      pendingRouteRef.current = null;

      if (route.view === 'document' && route.docId) {
        setCurrentView(`document:${route.docId}`);
        replaceRouteState(buildDocumentPath(route.docId), 'document', restoredDashboardState, { docId: route.docId });
        return;
      }

      if (route.view === 'admin') {
        setCurrentView('admin');
        replaceRouteState(ADMIN_PATH, 'admin', restoredDashboardState);
        return;
      }

      setCurrentView('dashboard');
      setDashboardViewState((prev) => (
        areColumnFiltersEqual(prev.columnFilters, restoredDashboardState.columnFilters) && prev.scrollY === restoredDashboardState.scrollY
          ? prev
          : restoredDashboardState
      ));
      if (route.view === 'dashboard') {
        setDashboardRestoreRequestId((prev) => prev + 1);
      }
      replaceRouteState(DASHBOARD_PATH, 'dashboard', restoredDashboardState);
    };

    syncRoute(window.location.pathname);

    const handlePopState = (event) => {
      const state = event.state;
      if (state?.gitdox && typeof state.view === 'string') {
        const restoredDashboardState = normalizeDashboardViewState(state.dashboardViewState);
        setDashboardViewState(restoredDashboardState);

        if (state.view === 'document' && state.docId) {
          setCurrentView(`document:${state.docId}`);
        } else if (state.view === 'admin') {
          setCurrentView('admin');
        } else if (state.view === 'login') {
          setCurrentView('login');
        } else {
          setCurrentView('dashboard');
        }

        if (state.view === 'dashboard') {
          setDashboardRestoreRequestId((prev) => prev + 1);
        }
        return;
      }

      const localPath = stripFrontendBasePath(window.location.pathname, EFFECTIVE_FRONTEND_BASE_PATH);
      syncRoute(localPath, state);
      if (resolveRouteFromPathname(localPath).view === 'dashboard') {
        setDashboardRestoreRequestId((prev) => prev + 1);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (currentView !== 'dashboard') return;
    replaceRouteState(DASHBOARD_PATH, 'dashboard', dashboardViewState);
  }, [currentView, dashboardViewState]);

  // Window Title Management
  useEffect(() => {
    const baseTitle = displayName || 'GitDOX';

    if (currentView === 'dashboard') {
      document.title = `${baseTitle} - Dashboard`;
    } else if (currentView === 'admin') {
      document.title = `${baseTitle} - Admin`;
    } else if (currentView === 'login') {
      document.title = `${baseTitle} - Login`;
    } else if (currentView.startsWith('document:')) {
      // Set a temporary loading state until DocumentEditor fetches the real name
      document.title = `Loading Document... | ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }
  }, [currentView, displayName]);

  const navigateToDashboard = ({ nextDashboardState, push = true, restore = true } = {}) => {
    const normalizedState = normalizeDashboardViewState(nextDashboardState);
    setDashboardViewState(normalizedState);
    setCurrentView('dashboard');
    pendingRouteRef.current = null;
    if (restore) {
      setDashboardRestoreRequestId((prev) => prev + 1);
    }

    if (push) {
      pushRouteState(DASHBOARD_PATH, 'dashboard', normalizedState);
    } else {
      replaceRouteState(DASHBOARD_PATH, 'dashboard', normalizedState);
    }
  };

  const navigateToDocument = (docId) => {
    const snapshot = normalizeDashboardViewState(dashboardViewState);
    const documentView = `document:${docId}`;
    setCurrentView(documentView);
    pendingRouteRef.current = null;
    pushRouteState(buildDocumentPath(docId), 'document', snapshot, { docId: String(docId) });
  };

  const navigateToAdmin = () => {
    pendingRouteRef.current = null;
    setCurrentView('admin');
    pushRouteState(ADMIN_PATH, 'admin', dashboardViewState);
  };

  const handleDashboardViewStateChange = useCallback((nextState) => {
    const normalizedNext = normalizeDashboardViewState(nextState);
    setDashboardViewState((prev) => (
      areDashboardViewStatesEqual(prev, normalizedNext)
        ? prev
        : normalizedNext
    ));
  }, []);

  const goToDashboard = () => {
    navigateToDashboard({ nextDashboardState: normalizeDashboardViewState(), push: true, restore: true });
  };

  const handleLoginSuccess = () => {
    const pendingRoute = pendingRouteRef.current;
    pendingRouteRef.current = null;

    if (pendingRoute?.view === 'document' && pendingRoute.docId) {
      navigateToDocument(pendingRoute.docId);
      return;
    }

    if (pendingRoute?.view === 'admin') {
      navigateToAdmin();
      return;
    }

    navigateToDashboard({ nextDashboardState: dashboardViewState, push: false, restore: true });
  };

  const goToDashboardWithCorpusFilter = (corpusName = '') => {
    const normalizedCorpus = (corpusName ?? '').toString();
    navigateToDashboard({
      nextDashboardState: {
        columnFilters: {
          ...EMPTY_DASHBOARD_FILTERS,
          corpus: normalizedCorpus
        },
        scrollY: 0
      },
      push: true,
      restore: true
    });
  };

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors bg-slate-50 text-slate-800`}>
      {/* Top Navigation */}
{token && (
  <nav
    className={`shadow-sm border-b px-6 py-4 flex justify-between items-center transition-colors ${
      navBackgroundColor 
        ? (isNavDark ? 'border-white/10 text-white' : 'border-slate-200 text-slate-800') 
        : 'bg-white border-slate-200 text-slate-800'
    }`}
    style={navBackgroundColor ? { background: navBackgroundColor } : undefined}
  >
    <div className="flex items-center space-x-6">
      {/* 1. Grouped Logo and Help Message into a vertical block */}
      <div className="flex flex-col items-start space-y-0.5">
        <h1 className={`text-xl font-bold flex items-center gap-2 ${isNavDark ? 'text-indigo-100' : 'text-indigo-600'}`}>
          <FileText size={24} /> GitDOX
        </h1>
        
        {/* 2. Added the dynamic raw HTML help message layout */}
        {helpMessage && (
          <div 
            className={`text-xs opacity-80 [&_a]:underline ${
              isNavDark ? 'text-slate-300 [&_a]:text-indigo-200 hover:[&_a]:text-white' : 'text-slate-500 [&_a]:text-indigo-600 hover:[&_a]:text-indigo-800'
            }`}
            dangerouslySetInnerHTML={{ __html: helpMessage }}
          />
        )}
      </div>

      <div className="hidden md:flex space-x-2">
        <a
          href="#dashboard"
          onClick={(e) => {
            e.preventDefault();
            goToDashboard();
          }}
          className={`px-3 py-2 rounded-md flex items-center gap-2 transition-colors ${
            currentView === 'dashboard' 
              ? (isNavDark ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-700') 
              : (isNavDark ? 'text-slate-200 hover:bg-white/10 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
          }`}
        >
          <FileText size={18} /> Dashboard
        </a>
        {user?.adminlevel >= 1 && (
          <a
            href={buildFrontendPath(ADMIN_PATH, EFFECTIVE_FRONTEND_BASE_PATH)}
            onClick={(e) => {
              if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                navigateToAdmin();
              }
            }}
            className={`px-3 py-2 rounded-md flex items-center gap-2 transition-colors ${
              currentView === 'admin' 
                ? (isNavDark ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-700') 
                : (isNavDark ? 'text-slate-200 hover:bg-white/10 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
            }`}
          >
            <Users size={18} /> Admin
          </a>
        )}
      </div>
    </div>
          <div className="flex items-center space-x-4">
  
            <div className={`text-sm hidden sm:block ${isNavDark ? 'text-slate-300' : 'text-slate-600'}`}>
              Signed in as{' '}
              <span className={`font-semibold ${isNavDark ? 'text-slate-100' : 'text-slate-800'}`}>
                {user?.username}
              </span>
              <span className="ml-1 text-xs opacity-80">
                (Lvl {user?.adminlevel})
              </span>
            </div>

            {/* Distinct Logout Button */}
            <button
              onClick={handleLogout}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                isNavDark 
                  ? 'bg-white/10 text-slate-200 hover:bg-red-500 hover:text-white' 
                  : 'bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-600'
              }`}
              aria-label="Logout"
              title="Logout"
            >
              <LogOut size={16} />
              Logout
            </button>

            {displayImage ? (
              <img
                src={displayImage.src}
                alt={displayName}
                style={{
                  ...(displayImage.width ? { width: displayImage.width } : {}),
                  ...(displayImage.height ? { height: displayImage.height } : {})
                }}
                className="object-contain"
              />
            ) : (
              <span className={`text-base font-bold ${isNavDark ? 'text-white' : 'text-slate-700'}`}>
                {displayName}
              </span>
            )}
          </div>
        </nav>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 m-6 mb-0 rounded flex items-center gap-3 text-red-700">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}

      {/* Main Content Area */}
      <main className="p-6 flex-1" style={Object.keys(mainStyle).length > 0 ? mainStyle : undefined}>
        {!token && <LoginView setToken={setToken} setUser={setUser} onLoginSuccess={handleLoginSuccess} apiCall={apiCall} projectName={projectName} isMainDark={isMainDark} />}
        {token && currentView === 'dashboard' && <DashboardView apiCall={apiCall} user={user} openDoc={navigateToDocument} projectName={projectName} uiConfig={appConfig?.ui || {}} dashboardViewState={dashboardViewState} dashboardRestoreRequestId={dashboardRestoreRequestId} onDashboardViewStateChange={handleDashboardViewStateChange} statusCategories={statusCategories} editorOptions={editorOptions} isMainDark={isMainDark} frontendBasePath={EFFECTIVE_FRONTEND_BASE_PATH}/>}
        {token && currentView.startsWith('document:') && <DocumentEditor apiCall={apiCall} docId={currentView.split(':')[1]} goBack={goToDashboard} goBackToCorpus={goToDashboardWithCorpusFilter} user={user} projectName={projectName} mutationTools={toolConfig} spannotatorConfig={appConfig?.entities || {}} editorOptions={editorOptions} editorFonts={{ ui: appConfig?.ui, xml: appConfig?.xml, entities: appConfig?.entities, spreadsheet: appConfig?.spreadsheet }} spreadsheetColumnOrderConfig={spreadsheetColumnOrder} xmlTagCompletion={xmlTagCompletion} statusCategories={statusCategories} isMainDark={isMainDark} isAppConfigLoaded={isAppConfigLoaded} />}
        {token && currentView === 'admin' && <AdminView apiCall={apiCall} user={user} token={token} projectName={projectName} uiConfig={appConfig?.ui || {}} statusCategories={statusCategories} refreshStatusCategories={refreshStatusCategories} isMainDark={isMainDark} />}
      </main>
    </div>
  );
}
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Plus, Trash2, Edit, Check, AlertCircle, Sheet, Code2, Users, Loader2, ChevronDown, GitBranch, Ban } from 'lucide-react';
import { DEFAULT_STATUS_CATEGORIES, formatStatusCategoryLabel, normalizeCssStyleValue, buildFrontendPath, getDefaultEditorMode, getValidationSummary, normalizeDashboardViewState, areColumnFiltersEqual, isEditorModeAllowedForUser, isCorpusAllowedForUser } from '../appShared';

const getDocumentFieldValue = (doc, field) => {
  if (field === 'validation') {
    return getValidationSummary(doc?.validation).filterText;
  }
  return doc?.[field] ?? '';
};

const hashString = (value) => {
  const normalized = String(value || '').trim().toLowerCase() + "d";
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const hslToRgb = (h, s, l) => {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs((2 * light) - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - (c / 2);

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
};

const getContrastTextColor = (h, s, l) => {
  const rgb = hslToRgb(h, s, l);
  const luminance = ((0.2126 * rgb.r) + (0.7152 * rgb.g) + (0.0722 * rgb.b)) / 255;
  return luminance > 0.55 ? '#0f172a' : '#ffffff';
};

const buildStatusPalette = (labels) => {
  const uniqueLabels = Array.from(new Set((labels || []).filter(Boolean).map((label) => String(label))));
  const sortedLabels = uniqueLabels.sort((a, b) => a.localeCompare(b));
  const palette = {};
  const usedHues = [];

  const hueDistance = (a, b) => {
    const distance = Math.abs(a - b);
    return Math.min(distance, 360 - distance);
  };

  sortedLabels.forEach((label) => {
    const seed = hashString(label);
    let hue = Math.round((seed * 137.50776405) % 360);
    let attempts = 0;
    while (usedHues.some((existingHue) => hueDistance(existingHue, hue) < 24) && attempts < 24) {
      hue = (hue + 29) % 360;
      attempts += 1;
    }
    usedHues.push(hue);

    const saturation = 68 + (seed % 12);
    const lightness = 46 + (seed % 8);
    const textColor = getContrastTextColor(hue, saturation, lightness);

    palette[label] = {
      backgroundColor: `hsl(${hue} ${saturation}% ${lightness}%)`,
      borderColor: `hsl(${hue} ${Math.min(90, saturation + 8)}% ${Math.max(28, lightness - 14)}%)`,
      textColor,
      chipBackgroundColor: `hsl(${hue} ${Math.min(92, saturation + 6)}% ${Math.min(88, lightness + 32)}%)`,
      chipTextColor: `hsl(${hue} ${Math.min(92, saturation + 8)}% ${Math.max(16, lightness - 24)}%)`
    };
  });

  return palette;
};

// Sorting Helpers (Moved outside component so they don't trigger missing dependency warnings)
const normalizedValue = (value) => (value ?? '').toString().toLowerCase();

const parseIdForSort = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
};

const compareField = (a, b, field, direction = 'asc') => {
  let result;
  if (field === 'id') {
    const aId = parseIdForSort(a.id);
    const bId = parseIdForSort(b.id);
    result = aId - bId;
    if (result === 0) {
      result = normalizedValue(a.id).localeCompare(normalizedValue(b.id));
    }
  } else {
    result = normalizedValue(getDocumentFieldValue(a, field)).localeCompare(
      normalizedValue(getDocumentFieldValue(b, field))
    );
  }
  return direction === 'desc' ? -result : result;
};

const documentRowPropsAreEqual = (prevProps, nextProps) => {
  return (
    prevProps.doc === nextProps.doc &&
    prevProps.isStatusMenuOpen === nextProps.isStatusMenuOpen &&
    prevProps.isSavingStatus === nextProps.isSavingStatus &&
    prevProps.isSavingAssigned === nextProps.isSavingAssigned &&
    prevProps.editorLabelByMode === nextProps.editorLabelByMode
  );
};

const DocumentRow = React.memo(({
  doc,
  isStatusMenuOpen,
  isSavingStatus,
  isSavingAssigned,
  statusPalette,
  baseStatusOptions,
  baseUsernames,
  editorLabelByMode,
  canEditAssignee,
  user,
  frontendBasePath,
  editorOptions,
  menuRef,
  onToggleMenu,
  onUpdateField,
  onDelete,
  openDoc
}) => {
  const [openUpwards, setOpenUpwards] = useState(false);
  const validationSummary = getValidationSummary(doc.validation);

  const handleMenuClick = (e) => {
    if (!isStatusMenuOpen) {
      const rect = e.currentTarget.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const menuHeightEstimate = 250; 
      
      setOpenUpwards(spaceBelow < menuHeightEstimate && spaceAbove > spaceBelow);
    }
    onToggleMenu(doc.id);
  };

  const statusOptions = doc?.status && !baseStatusOptions.includes(doc.status)
    ? [...baseStatusOptions, doc.status]
    : baseStatusOptions;

  const assigned = String(doc?.assigned || '').trim();
  const assigneeOptions = assigned && !baseUsernames.includes(assigned)
    ? [assigned, ...baseUsernames]
    : baseUsernames;

  const safeStatus = String(doc.status || '').trim();
  const statusColors = statusPalette[safeStatus] || statusPalette[DEFAULT_STATUS_CATEGORIES[0]];
  const modeLabel = editorLabelByMode[doc.mode] || doc.mode;
  const isModeBlocked = !isEditorModeAllowedForUser(user, doc?.mode, editorOptions);
  const statusButtonStyle = {
    backgroundColor: statusColors?.backgroundColor || '#475569',
    borderColor: statusColors?.borderColor || '#334155',
    color: statusColors?.textColor || '#ffffff'
  };

  const getStatusMenuItemStyle = (status, isSelected) => {
    const safeMenuStatus = String(status || '').trim();
    const menuStatusColors = statusPalette[safeMenuStatus] || statusPalette[DEFAULT_STATUS_CATEGORIES[0]];
    return {
      backgroundColor: isSelected ? (menuStatusColors?.chipBackgroundColor || '#e2e8f0') : 'transparent',
      color: isSelected ? (menuStatusColors?.chipTextColor || '#0f172a') : '#1e293b'
    };
  };

  return (
    <tr className="border-b last:border-0 hover:bg-slate-50">
      <td className="p-4 font-mono text-sm text-indigo-600">{doc.id}</td>
      <td className="p-4">{doc.corpus}</td>
      <td className="p-4 font-medium">{doc.docname}</td>
      <td className="p-4">
        <div className="flex items-center gap-2">
          <div className="relative" ref={isStatusMenuOpen ? menuRef : null}>
            <button
              type="button"
              className="inline-flex min-w-36 items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:brightness-95"
              style={statusButtonStyle}
              onClick={handleMenuClick}
              aria-haspopup="menu"
              aria-expanded={isStatusMenuOpen}
            >
              <span className="truncate">{formatStatusCategoryLabel(doc.status || '')}</span>
              <ChevronDown size={14} />
            </button>

            {isStatusMenuOpen && (
              <div
                className={`absolute left-0 z-20 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg overflow-y-auto max-h-64 ${
                  openUpwards ? 'bottom-full mb-2' : 'mt-2'
                }`}
                role="menu"
              >
                {statusOptions.map((status) => {
                  const isSelected = status === doc.status;
                  return (
                    <button
                      key={status}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      onClick={() => onUpdateField(doc, 'status', status)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs"
                      style={getStatusMenuItemStyle(status, isSelected)}
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: statusPalette[String(status)]?.backgroundColor || '#64748b' }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{formatStatusCategoryLabel(status)}</span>
                      {isSelected ? <Check size={12} className="ml-auto" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <span className="inline-flex h-4 w-4 items-center justify-center text-slate-400" title={isSavingStatus ? 'Saving status update' : undefined}>
            {isSavingStatus ? <Loader2 size={12} className="animate-spin" /> : null}
          </span>
        </div>
      </td>
      <td className="p-4">
        <div className="flex items-center gap-2">
          <select
            className="w-full min-w-32 border border-slate-200 rounded px-2 py-1 text-xs bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
            value={doc.assigned || ''}
            onChange={(e) => onUpdateField(doc, 'assigned', e.target.value)}
            disabled={!canEditAssignee}
            title={!canEditAssignee ? 'Only admins can reassign documents.' : undefined}
          >
            {assigneeOptions.map((username) => (
              <option key={username} value={username}>{username}</option>
            ))}
          </select>
          <span className="inline-flex h-4 w-4 items-center justify-center text-slate-400" title={isSavingAssigned ? 'Saving assignee update' : undefined}>
            {isSavingAssigned ? <Loader2 size={12} className="animate-spin" /> : null}
          </span>
        </div>
      </td>
      <td className="p-4 text-sm text-slate-500">
        {doc.mode === 'spreadsheet' ? (
          <span className="inline-flex items-center" title={modeLabel}><Sheet size={16} /></span>
        ) : doc.mode === 'entities' ? (
          <span className="inline-flex items-center" title={modeLabel}><Users size={16} /></span>
        ) : doc.mode === 'xml' ? (
          <span className="inline-flex items-center" title={modeLabel}><Code2 size={16} /></span>
        ) : doc.mode === 'dendroid' ? (
          <span className="inline-flex items-center" title={modeLabel}><GitBranch size={16} /></span>
        ) : (
          modeLabel
        )}
      </td>
      <td className="p-4">
        {validationSummary.status === 'validating' ? (
          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs cursor-default" title={validationSummary.title}>
            <Loader2 size={12} className="animate-spin" /> {validationSummary.label}
          </span>
        ) : validationSummary.status === 'valid' ? (
          <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 px-2 py-1 rounded text-xs cursor-default" title={validationSummary.title}>
            <Check size={12} /> {validationSummary.label}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 px-2 py-1 rounded text-xs cursor-help whitespace-pre-line" title={validationSummary.title}>
            <AlertCircle size={12} /> {validationSummary.label}
          </span>
        )}
      </td>
      <td className="p-4 text-right">
        <div className="inline-flex items-center gap-2 whitespace-nowrap">
          {isModeBlocked ? (
            <span
              className="inline-flex items-center justify-center text-red-500 p-2"
              title={`This document is in the ${doc.mode || 'unknown'} mode, but your account does not allow that editor. Please contact an admin if you need access.`}
            >
              <Ban size={18} />
            </span>
          ) : (
            <a
              href={buildFrontendPath(`/docs/${encodeURIComponent(String(doc.id))}`, frontendBasePath)}
              onClick={(e) => {
                if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  openDoc(doc.id);
                }
              }}
              className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800 p-2"
              title={`Open document ${doc.id}`}
            >
              <Edit size={18} />
            </a>
          )}
          <button disabled={user.adminlevel <= 1} onClick={() => onDelete(doc.id)} className="text-red-500 hover:text-red-700 p-2 disabled:opacity-30">
            <Trash2 size={18} />
          </button>
        </div>
      </td>
    </tr>
  );
}, documentRowPropsAreEqual);

export default function DashboardView({ apiCall, user, openDoc, projectName, isNavDark, uiConfig = {}, dashboardViewState, dashboardRestoreRequestId = 0, onDashboardViewStateChange, statusCategories = [], editorOptions = [], frontendBasePath = ''}) {
  const defaultEditorMode = getDefaultEditorMode(editorOptions);
  const [documents, setDocuments] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [savingFieldKeys, setSavingFieldKeys] = useState([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [openStatusMenuDocId, setOpenStatusMenuDocId] = useState(null);
  const [columnFilters, setColumnFilters] = useState(() => normalizeDashboardViewState(dashboardViewState).columnFilters);
  const [primarySort, setPrimarySort] = useState({ key: 'corpus', direction: 'asc' });
  const statusMenuRef = useRef(null);
  const canEditAssignee = (user?.adminlevel ?? 0) > 0;
  
  const [newDoc, setNewDoc] = useState({ corpus: '', docname: '', mode: defaultEditorMode, status: DEFAULT_STATUS_CATEGORIES[0], assigned: user.username });

  const fetchDocs = useCallback(async () => {
    try {
      const data = await apiCall(`/projects/${projectName}/documents`);
      setDocuments(data);
    } catch (err) {
      console.warn("Error fetching documents:", err);
    } finally {
      setIsInitialLoad(false);
    }
  }, [apiCall, projectName]);

  useEffect(() => {
    const initLoad = async () => {
      await fetchDocs();
    };
    initLoad();
  }, [fetchDocs]);

  useEffect(() => {
    const syncStatus = async () => {
      if (!statusCategories.length) return;
      setNewDoc((prev) => {
        if (statusCategories.includes(prev.status)) return prev;
        return { ...prev, status: statusCategories[0] };
      });
    };
    syncStatus();
  }, [statusCategories]);

  useEffect(() => {
    const syncMode = async () => {
      setNewDoc((prev) => {
        if (prev.mode === defaultEditorMode) return prev;
        return { ...prev, mode: defaultEditorMode };
      });
    };
    syncMode();
  }, [defaultEditorMode]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!statusMenuRef.current) return;
      if (!statusMenuRef.current.contains(event.target)) {
        setOpenStatusMenuDocId(null);
      }
    };

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpenStatusMenuDocId(null);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (dashboardRestoreRequestId <= 0) return;
    
    const applyRestore = async () => {
      const restored = normalizeDashboardViewState(dashboardViewState);
      setColumnFilters((prev) => (
        areColumnFiltersEqual(prev, restored.columnFilters)
          ? prev
          : restored.columnFilters
      ));
      requestAnimationFrame(() => {
        window.scrollTo({ top: restored.scrollY, behavior: 'auto' });
      });
    };
    applyRestore();
  }, [dashboardRestoreRequestId, dashboardViewState]);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!canEditAssignee) {
        setUsersList([]);
        return;
      }
      try {
        const users = await apiCall(`/projects/${projectName}/users`);
        setUsersList(Array.isArray(users) ? users : []);
      } catch (err) {
        console.warn("Error fetching users:", err);
        setUsersList([]);
      }
    };

    fetchUsers();
  }, [projectName, canEditAssignee, apiCall]);

  useEffect(() => {
    if (typeof onDashboardViewStateChange !== 'function') return;

    let timeoutId;
    const handleScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        onDashboardViewStateChange({
          columnFilters,
          scrollY: window.scrollY
        });
      }, 150); 
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
  }, [columnFilters, onDashboardViewStateChange]);

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
      await apiCall(`/documents/${id}`, 'DELETE');
      fetchDocs();
    } catch (err) {
      console.warn(`Error deleting document ${id}:`, err);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      const nextStatus = statusCategories.includes(newDoc.status)
        ? newDoc.status
        : (statusCategories[0] || DEFAULT_STATUS_CATEGORIES[0]);
      await apiCall('/documents', 'POST', {
        ...newDoc,
        status: nextStatus,
        project: projectName,
        repo: '',
        validation: {},
        content_xml: '',
        content_spreadsheet: '',
        metadata: {}
      });
      setShowAdd(false);
      fetchDocs();
      setNewDoc({ corpus: '', docname: '', mode: defaultEditorMode, status: statusCategories[0] || DEFAULT_STATUS_CATEGORIES[0], assigned: user.username });
    } catch (err) {
      console.warn("Error adding new document:", err);
    }
  };

  const visibleDocuments = useMemo(() => {
    return documents.filter((doc) => isCorpusAllowedForUser(user, doc?.corpus));
  }, [documents, user]);

  const filteredAndSortedDocuments = useMemo(() => {
    const filtered = visibleDocuments.filter((doc) => {
      return Object.entries(columnFilters).every(([field, filterValue]) => {
        if (!filterValue) return true;
        return normalizedValue(getDocumentFieldValue(doc, field)).includes(normalizedValue(filterValue));
      });
    });

    return [...filtered].sort((a, b) => {
      const primaryResult = compareField(a, b, primarySort.key, primarySort.direction);
      if (primaryResult !== 0) return primaryResult;

      const corpusResult = compareField(a, b, 'corpus', 'asc');
      if (corpusResult !== 0) return corpusResult;

      const docnameResult = compareField(a, b, 'docname', 'asc');
      if (docnameResult !== 0) return docnameResult;

      return compareField(a, b, 'id', 'asc');
    });
  }, [visibleDocuments, columnFilters, primarySort]);

  const hasPendingValidations = useMemo(
    () => documents.some((doc) => {
      const status = String(doc?.validation?.status || '').toLowerCase();
      return status === 'validating' || status === 'queued' || status === 'processing';
    }),
    [documents]
  );

  useEffect(() => {
    if (!hasPendingValidations) return undefined;

    const intervalId = window.setInterval(() => {
      void fetchDocs();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasPendingValidations, projectName, fetchDocs]);

  const togglePrimarySort = (key) => {
    setPrimarySort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const sortIndicator = (key) => {
    if (primarySort.key !== key) return '';
    return primarySort.direction === 'asc' ? ' ▲' : ' ▼';
  };

  const handleFilterChange = (field, value) => {
    setColumnFilters((prev) => ({ ...prev, [field]: value }));
  };

  const baseStatusOptions = useMemo(() => {
    return Array.isArray(statusCategories) && statusCategories.length > 0
      ? statusCategories
      : DEFAULT_STATUS_CATEGORIES;
  }, [statusCategories]);

  const baseUsernames = useMemo(() => {
    return usersList
      .map((u) => String(u?.username || '').trim())
      .filter((name) => name.length > 0);
  }, [usersList]);

  const allStatusLabels = useMemo(() => {
    const labels = [
      ...DEFAULT_STATUS_CATEGORIES,
      ...(Array.isArray(statusCategories) ? statusCategories : []),
      ...documents.map((doc) => doc?.status).filter(Boolean)
    ];
    return Array.from(new Set(labels.map((label) => String(label))));
  }, [statusCategories, documents]);

  const statusPalette = useMemo(() => buildStatusPalette(allStatusLabels), [allStatusLabels]);
  const editorLabelByMode = useMemo(() => {
    return editorOptions.reduce((acc, option) => {
      acc[option.mode] = option.label;
      return acc;
    }, {});
  }, [editorOptions]);
  
  const modeFilterPlaceholder = useMemo(() => {
    const labels = editorOptions.map((option) => option.label).filter(Boolean);
    return labels.length > 0 ? labels.join('/') : 'mode';
  }, [editorOptions]);

  const parseMetadataForUpdate = (metadata) => {
    if (!metadata) return {};
    if (typeof metadata === 'string') {
      try {
        const parsed = JSON.parse(metadata);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (err) {
        console.warn("Failed to parse metadata JSON string:", err);
        return {};
      }
    }
    return typeof metadata === 'object' ? metadata : {};
  };

  const handleInlineDocumentFieldUpdate = async (doc, field, value) => {
    if (!doc || doc[field] === value) return;

    const previousDoc = doc;
    const optimisticDoc = { ...doc, [field]: value };
    const savingFieldKey = `${doc.id}:${field}`;
    setDocuments((prev) => prev.map((item) => (item.id === doc.id ? optimisticDoc : item)));
    setSavingFieldKeys((prev) => (prev.includes(savingFieldKey) ? prev : [...prev, savingFieldKey]));

    try {
      const response = await apiCall(`/documents/${doc.id}`, 'PUT', {
        corpus: optimisticDoc.corpus,
        docname: optimisticDoc.docname,
        repo: optimisticDoc.repo || '',
        mode: optimisticDoc.mode,
        status: optimisticDoc.status,
        assigned: optimisticDoc.assigned,
        metadata: parseMetadataForUpdate(optimisticDoc.metadata)
      });

      const persistedDoc = response?.validation
        ? { ...optimisticDoc, validation: response.validation }
        : optimisticDoc;
      setDocuments((prev) => prev.map((item) => (item.id === doc.id ? persistedDoc : item)));
    } catch (err) {
      setDocuments((prev) => prev.map((item) => (item.id === doc.id ? previousDoc : item)));
      alert(`Failed to update ${field}: ${err.message}`);
    } finally {
      setSavingFieldKeys((prev) => prev.filter((key) => key !== savingFieldKey));
    }
  };

  const panelBackgroundColor = normalizeCssStyleValue(uiConfig?.panel_background_color);
  const tableHeaderBackgroundColor = normalizeCssStyleValue(uiConfig?.table_header_background_color);
  const panelStyle = panelBackgroundColor ? { backgroundColor: panelBackgroundColor } : undefined;
  const tableHeaderStyle = tableHeaderBackgroundColor ? { backgroundColor: tableHeaderBackgroundColor } : undefined;

  return (
    <div className="max-w-6xl mx-auto space-y-6" style={{ maxWidth: '100%' }}>
      <div className="flex justify-between items-center">
        <h2 className={`text-2xl font-semibold flex items-baseline gap-2 ${
        (isNavDark ? 'border-white/10 text-white' : 'border-slate-200 text-slate-800')
        }`}>
        Document Dashboard
        <span className={`text-sm font-normal ${isNavDark ? 'text-slate-300' : 'text-slate-700'}`}>
          (Showing {filteredAndSortedDocuments.length}/{documents.length} documents)
        </span>
      </h2>
        {user.adminlevel > 0 && (
          <button onClick={() => setShowAdd(!showAdd)} className="bg-indigo-600 text-white px-4 py-2 rounded-md flex items-center gap-2 hover:bg-indigo-700">
            <Plus size={18} /> New Document
          </button>
        )}
      </div>

      {showAdd && (
        <div className={`p-6 rounded-xl shadow-sm border border-slate-200 ${panelBackgroundColor ? '' : 'bg-white'}`} style={panelStyle}>
          <h3 className="font-semibold mb-4">Create New Document</h3>
          <form onSubmit={handleAdd} className="flex gap-4 items-end">
            <div className="flex-1"><label className="block text-xs text-slate-500">Corpus</label><input required className="w-full border p-2 rounded" value={newDoc.corpus} onChange={e=>setNewDoc({...newDoc, corpus: e.target.value})} /></div>
            <div className="flex-1"><label className="block text-xs text-slate-500">Document</label><input required className="w-full border p-2 rounded" value={newDoc.docname} onChange={e=>setNewDoc({...newDoc, docname: e.target.value})} /></div>
            <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Create</button>
          </form>
        </div>
      )}

      <div className={`rounded-xl shadow-sm border border-slate-200 overflow-x-auto pb-4 overflow-y-hidden ${panelBackgroundColor ? '' : 'bg-white'}`} style={panelStyle}>
        <table className="w-full text-left">
          <thead className={`text-slate-600 border-b ${tableHeaderStyle ? '' : 'bg-slate-50'}`} style={tableHeaderStyle}>
            <tr>
              <th className="p-4 font-medium first:rounded-tl-xl">
                <button type="button" className="hover:text-indigo-700" onClick={() => togglePrimarySort('id')}>ID{sortIndicator('id')}</button>
              </th>
              <th className="p-4 font-medium">
                <button type="button" className="hover:text-indigo-700" onClick={() => togglePrimarySort('corpus')}>Corpus{sortIndicator('corpus')}</button>
              </th>
              <th className="p-4 font-medium">
                <button type="button" className="hover:text-indigo-700" onClick={() => togglePrimarySort('docname')}>Document{sortIndicator('docname')}</button>
              </th>
              <th className="p-4 font-medium">
                <button type="button" className="hover:text-indigo-700" onClick={() => togglePrimarySort('status')}>Status{sortIndicator('status')}</button>
              </th>
              <th className="p-4 font-medium">
                <button type="button" className="hover:text-indigo-700" onClick={() => togglePrimarySort('assigned')}>Assigned{sortIndicator('assigned')}</button>
              </th>
              <th className="p-4 font-medium">
                <button type="button" className="hover:text-indigo-700" onClick={() => togglePrimarySort('mode')}>Mode{sortIndicator('mode')}</button>
              </th>
              <th className="p-4 font-medium">
                <button type="button" className="hover:text-indigo-700" onClick={() => togglePrimarySort('validation')}>Validation{sortIndicator('validation')}</button>
              </th>
              <th className="p-4 font-medium text-right last:rounded-tr-xl">Actions</th>
            </tr>
            <tr className="border-t border-slate-200">
              <th className="p-2">
                <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Filter ID" value={columnFilters.id} onChange={(e) => handleFilterChange('id', e.target.value)} />
              </th>
              <th className="p-2">
                <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Filter corpus" value={columnFilters.corpus} onChange={(e) => handleFilterChange('corpus', e.target.value)} />
              </th>
              <th className="p-2">
                <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Filter document" value={columnFilters.docname} onChange={(e) => handleFilterChange('docname', e.target.value)} />
              </th>
              <th className="p-2">
                <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Filter status" value={columnFilters.status} onChange={(e) => handleFilterChange('status', e.target.value)} />
              </th>
              <th className="p-2">
                <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Filter assignee" value={columnFilters.assigned} onChange={(e) => handleFilterChange('assigned', e.target.value)} />
              </th>
              <th className="p-2">
                <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder={modeFilterPlaceholder} value={columnFilters.mode} onChange={(e) => handleFilterChange('mode', e.target.value)} />
              </th>
              <th className="p-2">
                <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Filter validation" value={columnFilters.validation} onChange={(e) => handleFilterChange('validation', e.target.value)} />
              </th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
              {isInitialLoad && (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 size={18} className="animate-spin text-indigo-600" />
                      <span>Loading documents...</span>
                    </div>
                  </td>
                </tr>
              )}

              {!isInitialLoad && filteredAndSortedDocuments.length === 0 && (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-slate-500">
                    No documents found.
                  </td>
                </tr>
              )}

              {filteredAndSortedDocuments.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  isStatusMenuOpen={openStatusMenuDocId === doc.id}
                  isSavingStatus={savingFieldKeys.includes(`${doc.id}:status`)}
                  isSavingAssigned={savingFieldKeys.includes(`${doc.id}:assigned`)}
                  statusPalette={statusPalette}
                  baseStatusOptions={baseStatusOptions}
                  baseUsernames={baseUsernames}
                  editorLabelByMode={editorLabelByMode}
                  canEditAssignee={canEditAssignee}
                  user={user}
                  frontendBasePath={frontendBasePath}
                  editorOptions={editorOptions}
                  menuRef={statusMenuRef}
                  onToggleMenu={(id) => setOpenStatusMenuDocId((prev) => (prev === id ? null : id))}
                  onUpdateField={(docToUpdate, field, value) => {
                    setOpenStatusMenuDocId(null);
                    handleInlineDocumentFieldUpdate(docToUpdate, field, value);
                  }}
                  onDelete={handleDelete}
                  openDoc={openDoc}
                />
              ))}
            </tbody>
        </table>
      </div>
    </div>
  );
}
import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Edit, Check, AlertCircle, Sheet, Code2, Users, Loader2 } from 'lucide-react';
import { DEFAULT_STATUS_CATEGORIES, formatStatusCategoryLabel, normalizeCssStyleValue } from '../appShared';
import { EMPTY_DASHBOARD_FILTERS, normalizeDashboardViewState, areColumnFiltersEqual, getValidationSummary, isNavDark } from '../App';

const getDocumentFieldValue = (doc, field) => {
  if (field === 'validation') {
    return getValidationSummary(doc?.validation).filterText;
  }
  return doc?.[field] ?? '';
};

export default function DashboardView({ apiCall, user, openDoc, projectName, uiConfig = {}, dashboardViewState, dashboardRestoreRequestId = 0, onDashboardViewStateChange, statusCategories = [] }) {
  const [documents, setDocuments] = useState([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [columnFilters, setColumnFilters] = useState(() => normalizeDashboardViewState(dashboardViewState).columnFilters);
  const [primarySort, setPrimarySort] = useState({ key: 'corpus', direction: 'asc' });
  
  // New document form state
  const [newDoc, setNewDoc] = useState({ corpus: '', docname: '', mode: 'spreadsheet', status: DEFAULT_STATUS_CATEGORIES[0], assigned: user.username });

  const fetchDocs = async () => {
    try {
      const data = await apiCall(`/projects/${projectName}/documents`);
      setDocuments(data);
    } catch (err) {
      // Keep existing error handling
    } finally {
      setIsInitialLoad(false);
    }
  };

  useEffect(() => { fetchDocs(); }, []);

  useEffect(() => {
    if (!statusCategories.length) return;
    setNewDoc((prev) => {
      if (statusCategories.includes(prev.status)) return prev;
      return { ...prev, status: statusCategories[0] };
    });
  }, [statusCategories]);

  useEffect(() => {
    if (dashboardRestoreRequestId <= 0) return;
    const restored = normalizeDashboardViewState(dashboardViewState);
    setColumnFilters((prev) => (
      areColumnFiltersEqual(prev, restored.columnFilters)
        ? prev
        : restored.columnFilters
    ));
    requestAnimationFrame(() => {
      window.scrollTo({ top: restored.scrollY, behavior: 'auto' });
    });
  }, [dashboardRestoreRequestId]);

  useEffect(() => {
    if (typeof onDashboardViewStateChange !== 'function') return;
    onDashboardViewStateChange({
      columnFilters,
      scrollY: typeof window !== 'undefined' ? window.scrollY : 0
    });
  }, [columnFilters, onDashboardViewStateChange]);

  useEffect(() => {
    if (typeof onDashboardViewStateChange !== 'function') return;

    const handleScroll = () => {
      onDashboardViewStateChange({
        columnFilters,
        scrollY: window.scrollY
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [columnFilters, onDashboardViewStateChange]);

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
      await apiCall(`/documents/${id}`, 'DELETE');
      fetchDocs();
    } catch (err) {}
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
      setNewDoc({ corpus: '', docname: '', mode: 'spreadsheet', status: 'init', assigned: user.username });
    } catch (err) {}
  };

  const normalizedValue = (value) => (value ?? '').toString().toLowerCase();

  const parseIdForSort = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  };

  const compareField = (a, b, field, direction = 'asc') => {
    let result = 0;
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

  const filteredAndSortedDocuments = useMemo(() => {
    const filtered = documents.filter((doc) => {
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

      return compareField(a, b, 'id', 'asc');
    });
  }, [documents, columnFilters, primarySort]);

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
      fetchDocs();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasPendingValidations, projectName]);

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

  const panelBackgroundColor = normalizeCssStyleValue(uiConfig?.panel_background_color);
  const tableHeaderBackgroundColor = normalizeCssStyleValue(uiConfig?.table_header_background_color);
  const panelStyle = panelBackgroundColor ? { backgroundColor: panelBackgroundColor } : undefined;
  const tableHeaderStyle = tableHeaderBackgroundColor ? { backgroundColor: tableHeaderBackgroundColor } : undefined;

  return (
    <div className="max-w-6xl mx-auto space-y-6" style={{ maxWidth: '100%' }}>
      <div className="flex justify-between items-center">
        <h2 className={`text-2xl font-semibold ${
            (isNavDark ? 'border-white/10 text-white' : 'border-slate-200 text-slate-800')
          }`}>Document Dashboard</h2>
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

      <div className={`rounded-xl shadow-sm border border-slate-200 overflow-hidden ${panelBackgroundColor ? '' : 'bg-white'}`} style={panelStyle}>
        <table className="w-full text-left">
          <thead className={`text-slate-600 border-b ${tableHeaderStyle ? '' : 'bg-slate-50'}`} style={tableHeaderStyle}>
            <tr>
              <th className="p-4 font-medium">
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
              <th className="p-4 font-medium text-right">Actions</th>
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
                <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="xml/spread/entities" value={columnFilters.mode} onChange={(e) => handleFilterChange('mode', e.target.value)} />
              </th>
              <th className="p-2">
                <input className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Filter validation" value={columnFilters.validation} onChange={(e) => handleFilterChange('validation', e.target.value)} />
              </th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {/* Display loading message */}
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

            {/* No documents found*/}
            {!isInitialLoad && filteredAndSortedDocuments.length === 0 && (
              <tr>
                <td colSpan="8" className="p-8 text-center text-slate-500">
                  No documents found.
                </td>
              </tr>
            )}
            {filteredAndSortedDocuments.map(doc => {
              const validationSummary = getValidationSummary(doc.validation);
              return (
                <tr key={doc.id} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="p-4 font-mono text-sm text-indigo-600">{doc.id}</td>
                  <td className="p-4">{doc.corpus}</td>
                  <td className="p-4 font-medium">{doc.docname}</td>
                  <td className="p-4"><span className="bg-slate-100 px-2 py-1 rounded text-xs">{doc.status}</span></td>
                  <td className="p-4">{doc.assigned}</td>
                  <td className="p-4 text-sm text-slate-500">
                    {doc.mode === 'spreadsheet' ? (
                      <span className="inline-flex items-center" title="spreadsheet" aria-label="spreadsheet">
                        <Sheet size={16} />
                      </span>
                    ) : doc.mode === 'entities' ? (
                      <span className="inline-flex items-center" title="entities" aria-label="entities">
                        <Users size={16} />
                      </span>
                    ) : doc.mode === 'xml' ? (
                      <span className="inline-flex items-center" title="xml" aria-label="xml">
                        <Code2 size={16} />
                      </span>
                    ) : (
                      doc.mode
                    )}
                  </td>
                  <td className="p-4">
                    {validationSummary.status === 'validating' ? (
                      <span
                        className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs cursor-default"
                        title={validationSummary.title}
                      >
                        <Loader2 size={12} className="animate-spin" /> {validationSummary.label}
                      </span>
                    ) : validationSummary.status === 'valid' ? (
                      <span
                        className="inline-flex items-center gap-1 bg-green-100 text-green-800 px-2 py-1 rounded text-xs cursor-default"
                        title={validationSummary.title}
                      >
                        <Check size={12} /> {validationSummary.label}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 bg-red-100 text-red-800 px-2 py-1 rounded text-xs cursor-help whitespace-pre-line"
                        title={validationSummary.title}
                      >
                        <AlertCircle size={12} /> {validationSummary.label}
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    <div className="inline-flex items-center gap-1 whitespace-nowrap">
                      <a
                        href={`/docs/${encodeURIComponent(String(doc.id))}`}
                        onClick={(e) => {
                          if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                            e.preventDefault();
                            openDoc(doc.id);
                          }
                        }}
                        className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800 p-2"
                        aria-label={`Open document ${doc.id}`}
                        title={`Open document ${doc.id}`}
                      >
                        <Edit size={18} />
                      </a>
                      <button disabled={user.adminlevel <= 1} onClick={() => handleDelete(doc.id)} className="text-red-500 hover:text-red-700 p-2 disabled:opacity-30"><Trash2 size={18} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
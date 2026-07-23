import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Plus, Trash2, Edit, X, Upload, Download, Shield, ShieldPlus, ArrowUpFromLine, User } from 'lucide-react';
import {
  API_ROOT,
  DEFAULT_STATUS_CATEGORIES,
  EMPTY_VALIDATION,
  formatStatusCategoryLabel,
  normalizeCssStyleValue,
  normalizeStatusCategories,
} from '../appShared';
import { isNavDark   } from '../App';

export default function AdminView({ apiCall, user, token, projectName, uiConfig = {}, statusCategories = [], refreshStatusCategories }) {
  const adminLevel = user?.adminlevel ?? 0;
  const canManageUsers = adminLevel >= 2;
  const canManageAssignments = adminLevel >= 1;
  const canDeleteUsers = adminLevel >= 3;
  const canManageValidations = adminLevel >= 1;
  const canBatchImportCorpus = adminLevel >= 2;
  const canRenameCorpus = adminLevel >= 1;
  const canDeleteCorpus = adminLevel >= 2;

  const [activeTab, setActiveTab] = useState(canManageUsers ? 'users' : canManageAssignments ? 'assignments' : 'validations');
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', realname: '', email: '', adminlevel: 0, git_username: '', token: '' });
  const [isEditing, setIsEditing] = useState(false);
  const [validations, setValidations] = useState([]);
  const [validationSort, setValidationSort] = useState({ key: null, dir: 'asc' });
  const [validationFilters, setValidationFilters] = useState({
    corpus: '',
    document: '',
    domain: '',
    key: '',
    operator: '',
    value: ''
  });
  const [validationForm, setValidationForm] = useState(EMPTY_VALIDATION);
  const [isEditingValidation, setIsEditingValidation] = useState(false);
  const [showValidationForm, setShowValidationForm] = useState(false);
  const [corpusUploadType, setCorpusUploadType] = useState('xml');
  const [corpusZipFile, setCorpusZipFile] = useState(null);
  const [isUploadingCorpus, setIsUploadingCorpus] = useState(false);
  const [corpusUploadResult, setCorpusUploadResult] = useState(null);
  const [corpora, setCorpora] = useState([]);
  const [selectedCorpus, setSelectedCorpus] = useState('');
  const [renameCorpusName, setRenameCorpusName] = useState('');
  const [isCorpusListLoading, setIsCorpusListLoading] = useState(false);
  const [isRenamingCorpus, setIsRenamingCorpus] = useState(false);
  const [isDeletingCorpus, setIsDeletingCorpus] = useState(false);
  const [corpusActionResult, setCorpusActionResult] = useState(null);
  const [corpusExportMode, setCorpusExportMode] = useState('xml');
  const [corpusExportConfig, setCorpusExportConfig] = useState('');
  const [corpusExportExtension, setCorpusExportExtension] = useState('');
  const [exportConfigs, setExportConfigs] = useState([]);
  const [isExportConfigsLoading, setIsExportConfigsLoading] = useState(false);
  const [isExportingCorpusZip, setIsExportingCorpusZip] = useState(false);
  const [corpusExportResult, setCorpusExportResult] = useState(null);
  const [assignmentForm, setAssignmentForm] = useState({ user: '', corpus: '', document: '' });
  const [assignmentResult, setAssignmentResult] = useState(null);
  const [newStatusCategory, setNewStatusCategory] = useState('');
  const [selectedStatusCategories, setSelectedStatusCategories] = useState([]);
  const [statusCategoryResult, setStatusCategoryResult] = useState(null);
  const [isSavingStatusCategories, setIsSavingStatusCategories] = useState(false);
  const [statusChangeForm, setStatusChangeForm] = useState({ fromStatus: '', toStatus: '' });
  const [statusChangeResult, setStatusChangeResult] = useState(null);
  
// State variables for Bulk Status Assignment
  const [bulkStatusForm, setBulkStatusForm] = useState({ corpus: '', document: '', status: '' });
  const [bulkStatusResult, setBulkStatusResult] = useState(null);
  
  // State variables for global metadata management
  const [metadataForm, setMetadataForm] = useState({ corpus: '', document: '', key: '', value: '', repository: '' });
  const [metadataActionResult, setMetadataActionResult] = useState(null);

  // Button states
  const [statusChangePhase, setStatusChangePhase] = useState('idle'); // 'idle' | 'checking' | 'updating'
  const [bulkStatusPhase, setBulkStatusPhase] = useState('idle');     // 'idle' | 'checking' | 'updating'
  const [metadataPhase, setMetadataPhase] = useState('idle');         // 'idle' | 'checking' | 'updating'
  const [assignmentPhase, setAssignmentPhase] = useState('idle');       // 'idle' | 'c

  const validationFileInputRef = useRef(null);
  const [isImportingValidations, setIsImportingValidations] = useState(false);
  const [isDeletingAllValidations, setIsDeletingAllValidations] = useState(false);

  const panelBackgroundColor = normalizeCssStyleValue(uiConfig?.panel_background_color);
  const panelStyle = panelBackgroundColor ? { backgroundColor: panelBackgroundColor } : undefined;
  const tableHeaderBackgroundColor = normalizeCssStyleValue(uiConfig?.table_header_background_color);
  const tableHeaderStyle = tableHeaderBackgroundColor ? { backgroundColor: tableHeaderBackgroundColor } : undefined;
  const availableStatusCategories = useMemo(() => {
    return normalizeStatusCategories(statusCategories);
  }, [statusCategories]);

  useEffect(() => {
    setStatusChangeForm((prev) => {
      if (!availableStatusCategories.length) {
        if (!prev.fromStatus && !prev.toStatus) return prev;
        return { fromStatus: '', toStatus: '' };
      }

      const nextFrom = availableStatusCategories.includes(prev.fromStatus)
        ? prev.fromStatus
        : availableStatusCategories[0];
      const nextTo = availableStatusCategories.find((status) => status !== nextFrom)
        || availableStatusCategories[0]
        || '';

      if (prev.fromStatus === nextFrom && prev.toStatus === nextTo) {
        return prev;
      }

      return { fromStatus: nextFrom, toStatus: nextTo };
    });
  }, [availableStatusCategories]);

  const fetchUsers = async () => {
    try {
      const data = await apiCall(`/projects/${projectName}/users`);
      setUsers(data);
    } catch (err) {}
  };

  const fetchValidations = async () => {
    try {
      const data = await apiCall(`/projects/${projectName}/validations`);
      setValidations(Array.isArray(data) ? data : []);
    } catch (err) {}
  };

  const fetchCorpora = async () => {
    setIsCorpusListLoading(true);
    try {
      const data = await apiCall(`/projects/${projectName}/corpora`);
      const corporaList = Array.isArray(data?.corpora) ? data.corpora : [];
      setCorpora(corporaList);
    } catch (err) {
      setCorpora([]);
    } finally {
      setIsCorpusListLoading(false);
    }
  };

  const fetchExportConfigs = async () => {
    setIsExportConfigsLoading(true);
    try {
      const data = await apiCall('/configs');
      const configs = Array.isArray(data?.configs)
        ? data.configs.filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim())
        : [];
      setExportConfigs(configs);
    } catch (err) {
      setExportConfigs([]);
    } finally {
      setIsExportConfigsLoading(false);
    }
  };

  useEffect(() => {
    if (canManageUsers || canManageAssignments) {
      fetchUsers();
    }
    if (canManageValidations) {
      fetchValidations();
    }
    fetchCorpora();
  }, [canManageUsers, canManageAssignments, canManageValidations, projectName]);

  useEffect(() => {
    if (activeTab === 'users' && !canManageUsers) {
      setActiveTab(canManageAssignments ? 'assignments' : (canManageValidations ? 'validations' : 'corpus-management'));
      return;
    }
    if (activeTab === 'assignments' && !canManageAssignments) {
      setActiveTab(canManageUsers ? 'users' : (canManageValidations ? 'validations' : 'corpus-management'));
    }
  }, [activeTab, canManageUsers, canManageAssignments, canManageValidations]);

  useEffect(() => {
    if (!corpora.length) {
      setSelectedCorpus('');
      return;
    }
    if (!selectedCorpus || !corpora.includes(selectedCorpus)) {
      setSelectedCorpus(corpora[0]);
    }
  }, [corpora, selectedCorpus]);

  useEffect(() => {
    setRenameCorpusName(selectedCorpus || '');
  }, [selectedCorpus]);

  useEffect(() => {
    if (corpusExportMode !== 'spreadsheet') {
      setCorpusExportConfig('');
      return;
    }

    if (!exportConfigs.length && !isExportConfigsLoading) {
      fetchExportConfigs();
    }
  }, [corpusExportMode]);

  useEffect(() => {
    if (!exportConfigs.length) {
      setCorpusExportConfig('');
      return;
    }
    if (!corpusExportConfig || !exportConfigs.includes(corpusExportConfig)) {
      setCorpusExportConfig(exportConfigs[0]);
    }
  }, [exportConfigs, corpusExportConfig]);

  useEffect(() => {
    if (!showValidationForm) return undefined;

    const originalOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        resetValidationForm();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showValidationForm]);

  const handleAddOrUpdateUser = async (e) => {
    e.preventDefault();
    try {
      if (isEditing) {
        await apiCall(`/projects/${projectName}/users/${newUser.username}`, 'PUT', newUser);
        setIsEditing(false);
      } else {
        await apiCall(`/projects/${projectName}/users`, 'POST', newUser);
      }
      fetchUsers();
      setNewUser({ username: '', password: '', realname: '', email: '', adminlevel: 0, git_username: '', token: '' });
    } catch (err) {}
  };

  const handleEditClick = (u) => {
    setNewUser({ ...u, password: '' });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setNewUser({ username: '', password: '', realname: '', email: '', adminlevel: 0, git_username: '', token: '' });
  };

  const handleDeleteUser = async (username) => {
    if (adminLevel < 3) return;
    if (!confirm(`Delete user ${username}?`)) return;
    try {
      await apiCall(`/projects/${projectName}/users/${username}`, 'DELETE');
      fetchUsers();
    } catch (err) {}
  };

  const resetValidationForm = () => {
    setValidationForm(EMPTY_VALIDATION);
    setIsEditingValidation(false);
    setShowValidationForm(false);
  };

  const handleValidationSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...validationForm,
        document: validationForm.document.trim(),
        corpus: validationForm.corpus.trim(),
        domain: validationForm.domain.trim(),
        key: validationForm.key.trim(),
        operator: validationForm.operator,
        value: validationForm.value
      };

      if (payload.id) {
        await apiCall(`/projects/${projectName}/validations/${payload.id}`, 'PUT', payload);
      } else {
        delete payload.id;
        await apiCall(`/projects/${projectName}/validations`, 'POST', payload);
      }
      await fetchValidations();
      resetValidationForm();
    } catch (err) {}
  };

  const handleValidationDomainChange = (domain) => {
    setValidationForm((prev) => ({
      ...prev,
      domain,
      operator: domain === 'spreadsheet' || (prev.operator !== '&' && prev.operator !== 'nelink') ? prev.operator : 'exists'
    }));
  };

  const handleEditValidation = (validation) => {
    setValidationForm({
      id: validation.id || '',
      document: validation.document || '',
      corpus: validation.corpus || '',
      domain: validation.domain || '',
      key: validation.key || '',
      operator: validation.operator || 'exists',
      value: validation.value || ''
    });
    setIsEditingValidation(true);
    setShowValidationForm(true);
    setActiveTab('validations');
  };

  const handleAddValidation = () => {
    setValidationForm(EMPTY_VALIDATION);
    setIsEditingValidation(false);
    setShowValidationForm(true);
    setActiveTab('validations');
  };

  const handleDeleteValidation = async (validationId) => {
    if (!confirm('Delete this validation rule?')) return;
    try {
      await apiCall(`/projects/${projectName}/validations/${validationId}`, 'DELETE');
      await fetchValidations();
      if (validationForm.id === validationId) {
        resetValidationForm();
      }
    } catch (err) {}
  };

  const handleValidationFilterChange = (field, value) => {
    setValidationFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handleExportValidations = () => {
    const headers = ['document', 'corpus', 'domain', 'key', 'operator', 'value'];
    const rows = validations.map(v => [
      v.document || '',
      v.corpus || '',
      v.domain || '',
      v.key || '',
      v.operator || '',
      v.value || ''
    ].join('\t'));
    const tsv = [headers.join('\t'), ...rows].join('\n');
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}-validations.tab`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteAllValidations = async () => {
    if (adminLevel < 2) return;
    if (!window.confirm('Are you sure you want to delete ALL validation rules? This action cannot be undone.')) return;
    
    setIsDeletingAllValidations(true);
    try {
      for (const v of validations) {
        await apiCall(`/projects/${projectName}/validations/${v.id}`, 'DELETE');
      }
      await fetchValidations();
    } catch (err) {
      alert('Error deleting some rules: ' + err.message);
    } finally {
      setIsDeletingAllValidations(false);
    }
  };

  const handleImportValidations = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
    if (!lines.length) {
      e.target.value = null;
      return;
    }

    let startIndex = 0;
    let headers = ['document', 'corpus', 'domain', 'key', 'operator', 'value'];
    const firstLineCols = lines[0].split('\t').map(c => c.toLowerCase().trim());
    if (firstLineCols.includes('domain') && firstLineCols.includes('key')) {
       headers = firstLineCols;
       startIndex = 1;
    }

    const toAdd = [];
    const existingSet = new Set(validations.map(v => {
      const doc = (v.document || '').trim();
      const corp = (v.corpus || '').trim();
      const domRaw = (v.domain || '').trim().toLowerCase();
      const dom = domRaw === 'xml' ? 'XML' : domRaw;
      const key = (v.key || '').trim();
      const op = (v.operator || '').trim();
      const val = (v.value || '').trim();
      return [doc, corp, dom, key, op, val].join('|||');
    }));

    const allowedDomains = ['xml', 'spreadsheet', 'metadata'];
    const allowedOperators = ['exists', '!exists', '=', '~', '==', '|', '&', '>', 'nelink'];
    const ssOnlyOperators = ['>', '|', '==', 'nelink'];

    for (let i = startIndex; i < lines.length; i++) {
       const cols = lines[i].split('\t');
       const rowObj = {};
       headers.forEach((h, idx) => { rowObj[h] = cols[idx] || ''; });

       let doc = (rowObj.document || '').trim();
       let corp = (rowObj.corpus || '').trim();
       let domRaw = (rowObj.domain || '').trim().toLowerCase();
       let dom = domRaw === 'xml' ? 'XML' : domRaw; // Match normalized domain casing in UI
       let key = (rowObj.key || '').trim();
       let op = (rowObj.operator || '').trim();
       let val = (rowObj.value || '').trim(); 

       if (/\s/.test(doc) || /\s/.test(corp) || /\s/.test(domRaw) || /\s/.test(key) || /\s/.test(op)) {
          alert(`Import rejected. Error on line ${i+1}: Columns other than Value cannot contain spaces.`);
          e.target.value = null; return;
       }
       if (!allowedDomains.includes(domRaw)) {
          alert(`Import rejected. Error on line ${i+1}: Invalid domain '${domRaw}'.`);
          e.target.value = null; return;
       }
       if (!allowedOperators.includes(op)) {
          alert(`Import rejected. Error on line ${i+1}: Invalid operator '${op}'.`);
          e.target.value = null; return;
       }
       if (ssOnlyOperators.includes(op) && dom !== 'spreadsheet') {
          alert(`Import rejected. Error on line ${i+1}: Operator '${op}' is only allowed in 'spreadsheet' domain.`);
          e.target.value = null; return;
       }
       if (!key) {
          alert(`Import rejected. Error on line ${i+1}: Key is required.`);
          e.target.value = null; return;
       }

       const sig = [doc, corp, dom, key, op, val].join('|||');
       if (!existingSet.has(sig)) {
          toAdd.push({ document: doc, corpus: corp, domain: dom, key, operator: op, value: val });
          existingSet.add(sig); // Prevent duplicates inside the file itself
       }
    }

    if (toAdd.length === 0) {
       alert('No new rules to add (all were duplicates of existing rules).');
       e.target.value = null;
       return;
    }

    setIsImportingValidations(true);
    try {
       for (const rule of toAdd) {
         await apiCall(`/projects/${projectName}/validations`, 'POST', rule);
       }
       await fetchValidations();
       alert(`Successfully imported ${toAdd.length} new validation rules.`);
    } catch (err) {
       alert('Error during import: ' + err.message);
    } finally {
       setIsImportingValidations(false);
       e.target.value = null;
    }
  };

  const getCorpusIssues = (result) => {
    if (!Array.isArray(result?.results)) return [];
    return result.results.filter((entry) => {
      if (entry?.error) return true;
      const status = String(entry?.status || '').toLowerCase();
      return status && !['created', 'ok', 'success'].includes(status);
    });
  };

  const handleMetadataSubmit = async (e) => {
    e.preventDefault();
    const { corpus, document: docSubstring, key, value } = metadataForm;
    const corpusQuery = corpus.trim().toLowerCase();
    const documentQuery = docSubstring.trim().toLowerCase();
    const metaKey = key.trim();

    if (!metaKey) {
      setMetadataActionResult({ ok: false, message: 'Metadata key is required.' });
      return;
    }

    setMetadataPhase('checking');
    setMetadataActionResult(null);

    let docs = [];
    try {
      docs = await fetchProjectDocuments();
    } catch (err) {
      setMetadataActionResult({ ok: false, message: err?.message || 'Unable to load documents for metadata update.' });
      setMetadataPhase('idle');
      return;
    }

    const matchingDocuments = docs.filter((doc) => {
      const corpusMatch = corpusQuery ? String(doc.corpus || '').toLowerCase().includes(corpusQuery) : true;
      const documentMatch = documentQuery ? String(doc.docname || '').toLowerCase().includes(documentQuery) : true;
      return corpusMatch && documentMatch;
    });

    if (!matchingDocuments.length) {
      setMetadataActionResult({ ok: false, message: 'No documents matched the provided filters.' });
      setMetadataPhase('idle');
      return;
    }

    const uniqueCorpora = new Set(matchingDocuments.map(d => d.corpus)).size;

    if (!window.confirm(`This will affect ${matchingDocuments.length} document(s) in ${uniqueCorpora} ${uniqueCorpora === 1 ? 'corpus' : 'corpora'}. Continue?`)) {
      setMetadataPhase('idle');
      return;
    }

    setMetadataPhase('updating');

    try {
      for (const doc of matchingDocuments) {
        const updatedMetadata = {
          ...(doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {}),
          [metaKey]: value
        };

        await apiCall(`/documents/${doc.id}`, 'PUT', {
          corpus: doc.corpus || '',
          docname: doc.docname || '',
          repo: doc.repo || '',
          mode: doc.mode || 'spreadsheet',
          status: doc.status || '',
          assigned: doc.assigned || '',
          metadata: updatedMetadata
        });
      }

      setMetadataActionResult({ ok: true, message: `Successfully added metadata to ${matchingDocuments.length} document(s).` });
      setMetadataForm({ corpus: '', document: '', key: '', value: '' });
    } catch (err) {
      setMetadataActionResult({ ok: false, message: err?.message || 'Bulk metadata update failed.' });
    } finally {
      setMetadataPhase('idle');
    }
  };

  const handleRepoBulkSubmit = async (e) => {
    if (e) e.preventDefault();
    const { corpus, document: docSubstring, repository } = metadataForm;
    const corpusQuery = corpus.trim().toLowerCase();
    const documentQuery = docSubstring.trim().toLowerCase();
    const newRepo = repository.trim();

    if (!/^[^\s/]+(?:\/[^\s/]+)+$/.test(newRepo)) {
      setMetadataActionResult({ ok: false, message: 'Repository must contain no whitespace and at least one slash (e.g., org/repo).' });
      return;
    }

    setMetadataPhase('checking');
    setMetadataActionResult(null);

    let docs = [];
    try {
      docs = await fetchProjectDocuments();
    } catch (err) {
      setMetadataActionResult({ ok: false, message: err?.message || 'Unable to load documents for repository update.' });
      setMetadataPhase('idle');
      return;
    }

    const matchingDocuments = docs.filter((doc) => {
      const corpusMatch = corpusQuery ? String(doc.corpus || '').toLowerCase().includes(corpusQuery) : true;
      const documentMatch = documentQuery ? String(doc.docname || '').toLowerCase().includes(documentQuery) : true;
      return corpusMatch && documentMatch;
    });

    if (!matchingDocuments.length) {
      setMetadataActionResult({ ok: false, message: 'No documents matched the provided filters.' });
      setMetadataPhase('idle');
      return;
    }

    const uniqueCorpora = new Set(matchingDocuments.map(d => d.corpus)).size;

    if (!window.confirm(`This will update the repository for ${matchingDocuments.length} document(s) in ${uniqueCorpora} ${uniqueCorpora === 1 ? 'corpus' : 'corpora'}. Continue?`)) {
      setMetadataPhase('idle');
      return;
    }

    setMetadataPhase('updating');

    try {
      for (const doc of matchingDocuments) {
        await updateDocumentRecord(doc, doc.status, doc.assigned, newRepo);
      }

      setMetadataActionResult({ ok: true, message: `Successfully updated repository for ${matchingDocuments.length} document(s).` });
      setMetadataForm(prev => ({ ...prev, repository: '' }));
    } catch (err) {
      setMetadataActionResult({ ok: false, message: err?.message || 'Bulk repository update failed.' });
    } finally {
      setMetadataPhase('idle');
    }
  };

  const handleCorpusUpload = async (e) => {
    e.preventDefault();
    if (!corpusZipFile) return;

    setIsUploadingCorpus(true);
    setCorpusUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file_type', corpusUploadType);
      formData.append('zip_file', corpusZipFile);

      const result = await apiCall(
        `/projects/${projectName}/documents/import-zip`,
        'POST',
        formData,
        { isFormData: true }
      );
      setCorpusUploadResult({ ok: true, payload: result });
      setCorpusZipFile(null);
    } catch (err) {
      setCorpusUploadResult({
        ok: false,
        message: err?.message || 'Upload failed.'
      });
    } finally {
      setIsUploadingCorpus(false);
    }
  };

  const handleRenameCorpus = async (e) => {
    e.preventDefault();
    const oldName = (selectedCorpus || '').trim();
    const newName = (renameCorpusName || '').trim();

    if (!canRenameCorpus) {
      setCorpusActionResult({
        ok: false,
        message: 'Insufficient permissions: corpus rename requires admin level 1 or higher.'
      });
      return;
    }
    if (!oldName) return;
    if (!newName) {
      setCorpusActionResult({ ok: false, message: 'New corpus name cannot be empty.' });
      return;
    }
    if (newName === oldName) {
      setCorpusActionResult({ ok: false, message: 'New corpus name must be different from the current name.' });
      return;
    }

    setIsRenamingCorpus(true);
    setCorpusActionResult(null);
    try {
      const result = await apiCall(
        `/projects/${projectName}/corpora/${encodeURIComponent(oldName)}/rename`,
        'PUT',
        { new_corpus_name: newName }
      );
      setCorpusActionResult({
        ok: true,
        kind: 'rename',
        message: result?.message || `Corpus '${oldName}' renamed to '${newName}'.`,
        count: result?.updated_count ?? 0
      });
      await fetchCorpora();
      setSelectedCorpus(newName);
    } catch (err) {
      setCorpusActionResult({ ok: false, message: err?.message || 'Rename failed.' });
    } finally {
      setIsRenamingCorpus(false);
    }
  };

  const handleDeleteCorpus = async () => {
    const corpusName = (selectedCorpus || '').trim();
    if (!canDeleteCorpus) {
      setCorpusActionResult({
        ok: false,
        message: 'Insufficient permissions: corpus deletion requires admin level 2 or higher.'
      });
      return;
    }
    if (!corpusName) return;
    if (!confirm(`Delete corpus '${corpusName}' and all its documents?`)) return;

    setIsDeletingCorpus(true);
    setCorpusActionResult(null);
    try {
      const result = await apiCall(
        `/projects/${projectName}/corpora/${encodeURIComponent(corpusName)}`,
        'DELETE'
      );
      setCorpusActionResult({
        ok: true,
        kind: 'delete',
        message: result?.message || `Corpus '${corpusName}' deleted.`,
        count: result?.deleted_count ?? 0
      });
      await fetchCorpora();
    } catch (err) {
      setCorpusActionResult({ ok: false, message: err?.message || 'Delete failed.' });
    } finally {
      setIsDeletingCorpus(false);
    }
  };

  const parseFilenameFromContentDisposition = (value) => {
    if (!value || typeof value !== 'string') return null;

    const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return utf8Match[1];
      }
    }

    const asciiMatch = value.match(/filename="?([^";]+)"?/i);
    return asciiMatch?.[1] || null;
  };

  const fetchProjectDocuments = async () => {
    const data = await apiCall(`/projects/${projectName}/documents`);
    return Array.isArray(data) ? data : [];
  };

  // Allow repoOverride so we can pass a specific repo without overriding current assignments or status
  const updateDocumentRecord = async (doc, status, assigned, repoOverride) => {
    await apiCall(`/documents/${doc.id}`, 'PUT', {
      corpus: doc.corpus || '',
      docname: doc.docname || '',
      repo: repoOverride !== undefined ? repoOverride : (doc.repo || ''),
      mode: doc.mode || 'spreadsheet',
      status,
      assigned,
      metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {}
    });
  };

  const handleAssignmentSubmit = async (e) => {
    e.preventDefault();

    const targetUser = assignmentForm.user.trim();
    const corpusQuery = assignmentForm.corpus.trim().toLowerCase();
    const documentQuery = assignmentForm.document.trim().toLowerCase();

    if (!targetUser) {
      setAssignmentResult({ ok: false, message: 'Please select a user first.' });
      return;
    }
    if (!corpusQuery && !documentQuery) {
      setAssignmentResult({ ok: false, message: 'Enter a corpus substring or document substring before assigning.' });
      return;
    }

    setAssignmentPhase('checking');
    setAssignmentResult(null);

    let matchingDocuments = [];
    try {
      const docs = await fetchProjectDocuments();
      matchingDocuments = docs.filter((doc) => {
        const corpusMatch = corpusQuery && String(doc.corpus || '').toLowerCase().includes(corpusQuery);
        const documentMatch = documentQuery && String(doc.docname || '').toLowerCase().includes(documentQuery);
        return corpusMatch || documentMatch;
      });
    } catch (err) {
      setAssignmentResult({ ok: false, message: err?.message || 'Unable to load documents for assignment.' });
      setAssignmentPhase('idle');
      return;
    }

    if (!matchingDocuments.length) {
      setAssignmentResult({ ok: false, message: 'No documents matched the provided filters.' });
      setAssignmentPhase('idle');
      return;
    }

    if (!window.confirm(`Assign ${matchingDocuments.length} document(s) to ${targetUser}? This will update every matching document immediately.`)) {
      setAssignmentPhase('idle');
      return;
    }

    setAssignmentPhase('updating');
    try {
      for (const doc of matchingDocuments) {
        const nextStatus = doc.status || availableStatusCategories[0] || DEFAULT_STATUS_CATEGORIES[0];
        await updateDocumentRecord(doc, nextStatus, targetUser);
      }

      setAssignmentResult({ ok: true, message: `Assigned ${matchingDocuments.length} document(s) to ${targetUser}.` });
      setAssignmentForm({ user: targetUser, corpus: '', document: '' });
    } catch (err) {
      setAssignmentResult({ ok: false, message: err?.message || 'Bulk assignment failed.' });
    } finally {
      setAssignmentPhase('idle');
    }
  };

  const handleAddStatusCategory = async (e) => {
    e.preventDefault();
    const nextStatus = newStatusCategory.trim();
    if (!nextStatus) {
      setStatusCategoryResult({ ok: false, message: 'Enter a status label to add.' });
      return;
    }

    const nextStatusCategories = [...availableStatusCategories];
    if (nextStatusCategories.includes(nextStatus)) {
      setStatusCategoryResult({ ok: false, message: `Status category '${nextStatus}' already exists.` });
      return;
    }

    nextStatusCategories.push(nextStatus);
    setIsSavingStatusCategories(true);
    setStatusCategoryResult(null);
    try {
      await apiCall(`/projects/${projectName}/status-categories`, 'PUT', { categories: nextStatusCategories });
      if (typeof refreshStatusCategories === 'function') {
        await refreshStatusCategories();
      }
      setNewStatusCategory('');
      setStatusCategoryResult({ ok: true, message: `Added status category '${nextStatus}'.` });
    } catch (err) {
      setStatusCategoryResult({ ok: false, message: err?.message || 'Failed to add status category.' });
    } finally {
      setIsSavingStatusCategories(false);
    }
  };

  const handleDeleteStatusCategories = async () => {
    const categoriesToRemove = selectedStatusCategories.filter((category) => availableStatusCategories.includes(category));
    if (!categoriesToRemove.length) {
      setStatusCategoryResult({ ok: false, message: 'Select one or more status categories to remove.' });
      return;
    }

    let docs = [];
    try {
      docs = await fetchProjectDocuments();
    } catch (err) {
      setStatusCategoryResult({ ok: false, message: err?.message || 'Unable to inspect documents before removal.' });
      return;
    }

    const normalizeCategory = (value) => String(value || '').trim().toLowerCase();
    const blockingCounts = categoriesToRemove
      .map((category) => {
        const normalizedCategory = normalizeCategory(category);
        return {
          category,
          count: docs.filter((doc) => normalizeCategory(doc.status) === normalizedCategory).length
        };
      })
      .filter((entry) => entry.count > 0);

    if (blockingCounts.length > 0) {
      const summary = blockingCounts.map((entry) => `${entry.category} (${entry.count})`).join(', ');
      setStatusCategoryResult({
        ok: false,
        message: `Cannot remove ${summary} because documents still use those statuses. Reclassify those documents first.`
      });
      return;
    }

    const nextStatusCategories = availableStatusCategories.filter((category) => !categoriesToRemove.includes(category));
    setIsSavingStatusCategories(true);
    setStatusCategoryResult(null);
    try {
      await apiCall(`/projects/${projectName}/status-categories`, 'PUT', { categories: nextStatusCategories });
      if (typeof refreshStatusCategories === 'function') {
        await refreshStatusCategories();
      }
      setSelectedStatusCategories([]);
      setStatusCategoryResult({ ok: true, message: `Removed ${categoriesToRemove.join(', ')}.` });
    } catch (err) {
      setStatusCategoryResult({ ok: false, message: err?.message || 'Failed to remove status categories.' });
    } finally {
      setIsSavingStatusCategories(false);
    }
  };

  const handleStatusListMouseDown = (event) => {
    const option = event.target;
    if (!(option instanceof HTMLOptionElement)) return;

    event.preventDefault();
    event.currentTarget.focus();

    const selectedValue = option.value;
    setSelectedStatusCategories((prev) => {
      if (prev.includes(selectedValue)) {
        return prev.filter((value) => value !== selectedValue);
      }
      return [...prev, selectedValue];
    });
  };

  const handleGlobalStatusChange = async (e) => {
    e.preventDefault();
    const fromStatus = statusChangeForm.fromStatus;
    const toStatus = statusChangeForm.toStatus;

    if (!fromStatus || !toStatus || fromStatus === toStatus) {
      setStatusChangeResult({ ok: false, message: 'Choose two different status categories.' });
      return;
    }

    setStatusChangePhase('checking');
    setStatusChangeResult(null);

    let docs = [];
    try {
      docs = await fetchProjectDocuments();
    } catch (err) {
      setStatusChangeResult({ ok: false, message: err?.message || 'Unable to load documents for the status update.' });
      setStatusChangePhase('idle');
      return;
    }

    const matchingDocuments = docs.filter((doc) => String(doc.status || '') === fromStatus);
    if (!matchingDocuments.length) {
      setStatusChangeResult({ ok: false, message: `No documents currently use '${fromStatus}'.` });
      setStatusChangePhase('idle');
      return;
    }

    if (!window.confirm(`Change ${matchingDocuments.length} document(s) from '${fromStatus}' to '${toStatus}'?`)) {
      setStatusChangePhase('idle');
      return;
    }

    setStatusChangePhase('updating');
    try {
      for (const doc of matchingDocuments) {
        await updateDocumentRecord(doc, toStatus, doc.assigned || '');
      }

      setStatusChangeResult({ ok: true, message: `Updated ${matchingDocuments.length} document(s) from '${fromStatus}' to '${toStatus}'.` });
    } catch (err) {
      setStatusChangeResult({ ok: false, message: err?.message || 'Failed to update document statuses.' });
    } finally {
      setStatusChangePhase('idle');
    }
  };

  const handleBulkStatusChange = async (e) => {
    e.preventDefault();
    const targetStatus = bulkStatusForm.status;
    const corpusQuery = bulkStatusForm.corpus.trim().toLowerCase();
    const documentQuery = bulkStatusForm.document.trim().toLowerCase();

    if (!targetStatus) return;
    if (!corpusQuery && !documentQuery) {
      setBulkStatusResult({ ok: false, message: 'Enter a corpus or document substring.' });
      return;
    }

    setBulkStatusPhase('checking');
    setBulkStatusResult(null);

    let docs = [];
    try {
      docs = await fetchProjectDocuments();
    } catch (err) {
      setBulkStatusResult({ ok: false, message: err?.message || 'Unable to load documents for the status update.' });
      setBulkStatusPhase('idle');
      return;
    }

    const matchingDocuments = docs.filter((doc) => {
      const corpusMatch = corpusQuery ? String(doc.corpus || '').toLowerCase().includes(corpusQuery) : true;
      const documentMatch = documentQuery ? String(doc.docname || '').toLowerCase().includes(documentQuery) : true;
      return corpusMatch && documentMatch;
    });

    if (!matchingDocuments.length) {
      setBulkStatusResult({ ok: false, message: 'No documents matched the provided filters.' });
      setBulkStatusPhase('idle');
      return;
    }

    if (!window.confirm(`Set status '${targetStatus}' for ${matchingDocuments.length} document(s)?`)) {
      setBulkStatusPhase('idle');
      return;
    }

    setBulkStatusPhase('updating');
    try {
      for (const doc of matchingDocuments) {
        await updateDocumentRecord(doc, targetStatus, doc.assigned);
      }
      setBulkStatusResult({ ok: true, message: `Updated status for ${matchingDocuments.length} document(s).` });
      setBulkStatusForm({ corpus: '', document: '', status: targetStatus });
    } catch (err) {
      setBulkStatusResult({ ok: false, message: err?.message || 'Failed to update document statuses.' });
    } finally {
      setBulkStatusPhase('idle');
    }
  };

  const handleCorpusExportZip = async (e) => {
    e.preventDefault();
    const corpusName = (selectedCorpus || '').trim();
    if (!corpusName) return;

    if (corpusExportMode === 'spreadsheet' && !corpusExportConfig) {
      setCorpusExportResult({ ok: false, message: 'Please select an export scheme (.ini) for spreadsheet export.' });
      return;
    }

    const params = new URLSearchParams();
    params.set('mode', corpusExportMode);

    const extension = corpusExportExtension.trim();
    if (extension) {
      params.set('extension', extension.replace(/^\./, ''));
    }
    if (corpusExportMode === 'spreadsheet' && corpusExportConfig) {
      params.set('config', corpusExportConfig);
    }

    setIsExportingCorpusZip(true);
    setCorpusExportResult(null);
    try {
      const response = await fetch(
        `${API_ROOT}/projects/${encodeURIComponent(projectName)}/corpora/${encodeURIComponent(corpusName)}/export-zip?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            ...(token ? { token } : {})
          }
        }
      );

      if (!response.ok) {
        const responseText = await response.text();
        let detail = responseText || 'Export failed.';
        try {
          const parsed = responseText ? JSON.parse(responseText) : null;
          detail = parsed?.detail || detail;
        } catch {
        }
        throw new Error(detail);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition');
      const inferredFilename = parseFilenameFromContentDisposition(contentDisposition)
        || `${corpusName}-${corpusExportMode}.zip`;

      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = inferredFilename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);

      setCorpusExportResult({
        ok: true,
        message: `Export started for corpus '${corpusName}'.`,
        filename: inferredFilename
      });
    } catch (err) {
      setCorpusExportResult({ ok: false, message: err?.message || 'Export failed.' });
    } finally {
      setIsExportingCorpusZip(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className={`text-2xl font-semibold ${
              (isNavDark ? 'border-white/10 text-white' : 'border-slate-200 text-slate-800')
            }`}>Admin Console</h2>
        </div>
      </div>

      <div
        className={`flex gap-2 border-b border-slate-200 rounded-t-lg px-2 pt-2 ${panelStyle ? '' : 'bg-white'}`}
        style={panelStyle}
      >
        {canManageUsers && (
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'users' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            User Management
          </button>
        )}
        {canManageAssignments && (
          <button
            type="button"
            onClick={() => setActiveTab('assignments')}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'assignments' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Assignments
          </button>
        )}
        {canManageValidations && (
          <button
            type="button"
            onClick={() => setActiveTab('validations')}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'validations' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Validations
          </button>
        )}
        <button
          type="button"
          onClick={() => setActiveTab('corpus-management')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'corpus-management' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          Corpus Management
        </button>
      </div>

      <div
        className={`rounded-b-xl border border-slate-200 border-t-0 p-6 space-y-6 ${panelStyle ? '' : 'bg-white'}`}
        style={panelStyle}
      >
      {canManageUsers && activeTab === 'users' && (
        <div className="flex gap-8">
          <div className="w-1/3 bg-white p-6 rounded-xl shadow-sm border border-slate-200 self-start">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Plus size={20}/> {isEditing ? 'Update user' : 'Add new user'}</h3>
            <form onSubmit={handleAddOrUpdateUser} className="space-y-3 text-sm">
              <div><label className="block text-slate-600 mb-1">Username</label><input required disabled={isEditing} className={`w-full border p-2 rounded ${isEditing ? 'bg-slate-100' : ''}`} value={newUser.username} onChange={e=>setNewUser({...newUser, username: e.target.value})} /></div>
              <div><label className="block text-slate-600 mb-1">Password {isEditing && '(leave blank to keep)'}</label><input type="password" required={!isEditing} className="w-full border p-2 rounded" value={newUser.password} onChange={e=>setNewUser({...newUser, password: e.target.value})} /></div>
              <div><label className="block text-slate-600 mb-1">Real name</label><input required className="w-full border p-2 rounded" value={newUser.realname} onChange={e=>setNewUser({...newUser, realname: e.target.value})} /></div>
              <div><label className="block text-slate-600 mb-1">Email</label><input required type="email" className="w-full border p-2 rounded" value={newUser.email} onChange={e=>setNewUser({...newUser, email: e.target.value})} /></div>
              
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 mb-1">Admin level</label>
                  <select className="w-full border p-2 rounded bg-white" value={newUser.adminlevel} onChange={e=>setNewUser({...newUser, adminlevel: parseInt(e.target.value)})}>
                    <option value={0}>0 - Annotator</option>
                    <option value={1}>1 - Committer</option>
                    <option value={2}>2 - Manager</option>
                    <option value={3}>3 - Admin</option>
                  </select>
                </div>
                <div><label className="block text-slate-600 mb-1">GitHub username</label><input className="w-full border p-2 rounded" placeholder="Optional" value={newUser.git_username || ''} onChange={e=>setNewUser({...newUser, git_username: e.target.value})} /></div>
              </div>
              
              <div>
                <label className="block text-slate-600 mb-1">GitHub token</label>
                <input type="password" className="w-full border p-2 rounded" placeholder="Optional" value={newUser.token || ''} onChange={e=>setNewUser({...newUser, token: e.target.value})} />
              </div>
              
              <div className="flex gap-2 mt-4">
                <button type="submit" title="(manager/admin only)" className="flex items-center justify-center gap-1.5 flex-1 bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700">
                  <span>{isEditing ? 'Update user' : 'Create user'}</span><Shield size={14} className="opacity-60" />
                </button>
                {isEditing && (
                  <button type="button" onClick={cancelEdit} className="flex-1 bg-slate-200 text-slate-700 py-2 rounded hover:bg-slate-300">
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="w-2/3 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left">
              <thead className={`border-b ${tableHeaderStyle ? '' : 'bg-slate-50'}`} style={tableHeaderStyle}>
                <tr>
                  <th className="p-4 font-medium">Username</th>
                  <th className="p-4 font-medium">Name</th>
                  <th className="p-4 font-medium">Level</th>
                  <th className="p-4 font-medium">Email</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                    // Safely parse the level to an integer, defaulting to 0 if it's missing or invalid
                    const level = parseInt(u.adminlevel) || 0;

                    return (
                      <tr key={u.username} onDoubleClick={() => handleEditClick(u)} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer" title="Double click to edit">
                        <td className="p-4 font-medium text-indigo-600 whitespace-nowrap">{u.username}</td>
                        <td className="p-4 text-sm">{u.realname}</td>
                        <td className="p-4">
                          <span 
                            className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 px-2 py-1 rounded text-xs"
                            title={
                              level >= 3 ? "Admin" : 
                              level === 2 ? "Manager" : 
                              level === 1 ? "Committer" : 
                              "Annotator"
                            }
                          >
                            {level}
                            {level >= 3 && <ShieldPlus size={12} className="opacity-75" />}
                            {level === 2 && <Shield size={12} className="opacity-75" />}
                            {level === 1 && <ArrowUpFromLine size={12} className="opacity-75" />}
                            {level === 0 && <User size={12} className="opacity-75" />}
                          </span>
                        </td>
                        <td className="p-4 text-sm text-slate-500">{u.email}</td>
                        <td className="p-4 text-right space-x-2">
                          {canDeleteUsers && (
                            <button 
                              title="Delete User (Admin only)" 
                              onClick={() => handleDeleteUser(u.username)} 
                              className="inline-flex items-center gap-1.5 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 px-2.5 py-1.5 rounded-md border border-red-100 transition-colors"
                            >
                              <Trash2 size={16} /> 
                              <ShieldPlus size={14} className="opacity-60" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canManageAssignments && activeTab === 'assignments' && (
        <div className="space-y-6">
          {assignmentResult && (
            <div className={`rounded-xl border p-4 text-sm ${assignmentResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {assignmentResult.message}
            </div>
          )}

          {statusCategoryResult && (
            <div className={`rounded-xl border p-4 text-sm ${statusCategoryResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {statusCategoryResult.message}
            </div>
          )}

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <h3 className="text-lg font-semibold">Assign matching documents</h3>
              <form onSubmit={handleAssignmentSubmit} className="space-y-4 text-sm">
                <div>
                  <label className="block text-slate-600 mb-1">User</label>
                  <select
                    className="w-full border p-2 rounded bg-white"
                    value={assignmentForm.user}
                    onChange={(e) => setAssignmentForm((prev) => ({ ...prev, user: e.target.value }))}
                    required
                  >
                    <option value="">Select a user</option>
                    {users.map((u) => (
                      <option key={u.username} value={u.username}>{u.username}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-600 mb-1">Corpus substring</label>
                    <input
                      className="w-full border p-2 rounded"
                      value={assignmentForm.corpus}
                      onChange={(e) => setAssignmentForm((prev) => ({ ...prev, corpus: e.target.value }))}
                      placeholder="Match corpus names substring"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Document substring</label>
                    <input
                      className="w-full border p-2 rounded"
                      value={assignmentForm.document}
                      onChange={(e) => setAssignmentForm((prev) => ({ ...prev, document: e.target.value }))}
                      placeholder="Match document names substring"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={assignmentPhase !== 'idle' || !assignmentForm.user.trim() || (!assignmentForm.corpus.trim() && !assignmentForm.document.trim())}
                  className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {assignmentPhase === 'checking'
                    ? 'Checking...'
                    : assignmentPhase === 'updating'
                    ? 'Assigning...'
                    : 'Assign documents'}
                </button>
              </form>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <h3 className="text-lg font-semibold">Manage status categories</h3>
              <form onSubmit={handleAddStatusCategory} className="space-y-4 text-sm">
                <div>
                  <label className="block text-slate-600 mb-1">Current categories</label>
                  <select
                    multiple
                    className="w-full border p-2 rounded bg-white h-40"
                    value={selectedStatusCategories}
                    onMouseDown={handleStatusListMouseDown}
                    onChange={(e) => setSelectedStatusCategories(Array.from(e.target.selectedOptions, (option) => option.value))}
                  >
                    {availableStatusCategories.map((category) => (
                      <option key={category} value={category}>{formatStatusCategoryLabel(category)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteStatusCategories}
                    disabled={isSavingStatusCategories || selectedStatusCategories.length === 0}
                    className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Remove selected
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 border p-2 rounded"
                    value={newStatusCategory}
                    onChange={(e) => setNewStatusCategory(e.target.value)}
                    placeholder="Add a new status category"
                  />
                  <button
                    type="submit"
                    disabled={isSavingStatusCategories || !newStatusCategory.trim()}
                    className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Add
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-6">
              <h3 className="text-lg font-semibold border-b border-slate-100 pb-2">Global changes</h3>
              
              <div className="space-y-4">
                <h4 className="font-medium text-slate-700">Manage status</h4>
                {statusChangeResult && (
                  <div className={`rounded-xl border p-3 text-sm ${statusChangeResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    {statusChangeResult.message}
                  </div>
                )}
                <form onSubmit={handleGlobalStatusChange} className="space-y-4 text-sm">
                  <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-slate-600 mb-1">From</label>
                    <select
                      className="w-full border p-2 rounded bg-white"
                      value={statusChangeForm.fromStatus}
                      onChange={(e) => setStatusChangeForm((prev) => ({ ...prev, fromStatus: e.target.value }))}
                    >
                      {availableStatusCategories.map((category) => (
                        <option key={category} value={category}>{formatStatusCategoryLabel(category)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">To</label>
                    <select
                      className="w-full border p-2 rounded bg-white"
                      value={statusChangeForm.toStatus}
                      onChange={(e) => setStatusChangeForm((prev) => ({ ...prev, toStatus: e.target.value }))}
                    >
                      {availableStatusCategories.map((category) => (
                        <option key={category} value={category}>{formatStatusCategoryLabel(category)}</option>
                      ))}
                    </select>
                  </div>
                  </div>
                  <button
                    type="submit"
                    disabled={statusChangePhase !== 'idle' || !statusChangeForm.fromStatus || !statusChangeForm.toStatus || statusChangeForm.fromStatus === statusChangeForm.toStatus}
                    className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed h-10 w-full md:w-auto shrink-0"
                  >
                    {statusChangePhase === 'checking'
                      ? 'Checking...'
                      : statusChangePhase === 'updating'
                      ? 'Updating...'
                      : 'Change all matching documents'} <Shield size={14} className="opacity-60 ml-1" />
                  </button>
                </form>
              </div>

              {adminLevel >= 2 && (
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <h4 className="font-medium text-slate-700">Bulk assign status by substring</h4>
                  {bulkStatusResult && (
                    <div className={`rounded-xl border p-3 text-sm ${bulkStatusResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                      {bulkStatusResult.message}
                    </div>
                  )}
                  <form onSubmit={handleBulkStatusChange} className="space-y-4 text-sm">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="block text-slate-600 mb-1">Corpus substring</label>
                        <input
                          className="w-full border p-2 rounded"
                          value={bulkStatusForm.corpus}
                          onChange={(e) => setBulkStatusForm((prev) => ({ ...prev, corpus: e.target.value }))}
                          placeholder="Leave blank for any"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-600 mb-1">Document substring</label>
                        <input
                          className="w-full border p-2 rounded"
                          value={bulkStatusForm.document}
                          onChange={(e) => setBulkStatusForm((prev) => ({ ...prev, document: e.target.value }))}
                          placeholder="Leave blank for any"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-600 mb-1">New Status</label>
                        <select
                          className="w-full border p-2 rounded bg-white"
                          value={bulkStatusForm.status}
                          onChange={(e) => setBulkStatusForm((prev) => ({ ...prev, status: e.target.value }))}
                          required
                        >
                          <option value="">Select a status</option>
                          {availableStatusCategories.map((category) => (
                            <option key={category} value={category}>{formatStatusCategoryLabel(category)}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={
                        bulkStatusPhase !== 'idle' || 
                        !bulkStatusForm.status || 
                        (!bulkStatusForm.corpus.trim() && !bulkStatusForm.document.trim())
                      }
                      className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed h-10 w-full md:w-auto shrink-0"
                    >
                      {bulkStatusPhase === 'checking'
                        ? 'Checking...'
                        : bulkStatusPhase === 'updating'
                        ? 'Updating...'
                        : 'Assign status'} <Shield size={14} className="opacity-60 ml-1" />
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {canManageValidations && activeTab === 'validations' && (
        <div className="space-y-6">
          <div className="flex items-center justify-end gap-2">
            <input type="file" accept=".tab,.tsv,text/tab-separated-values" className="hidden" ref={validationFileInputRef} onChange={handleImportValidations} />
            
            <button disabled={isImportingValidations} onClick={() => validationFileInputRef.current?.click()} className="bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-md flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50">
              <Upload size={18} /> {isImportingValidations ? 'Importing...' : 'Import'}
            </button>

            <button onClick={handleExportValidations} className="bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-md flex items-center gap-2 hover:bg-slate-50">
              <Download size={18} /> Export
            </button>
            
            {adminLevel >= 2 && (
              <button title="(manager/admin only)" disabled={validations.length === 0 || isDeletingAllValidations} onClick={handleDeleteAllValidations} className="bg-red-600 text-white px-3 py-2 rounded-md flex items-center gap-2 hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed">
                <Trash2 size={18} /> {isDeletingAllValidations ? 'Deleting...' : 'Delete All'}
                <Shield size={14} className="opacity-60 ml-1" />
              </button>
            )}

            <button onClick={handleAddValidation} className="bg-indigo-600 text-white px-3 py-2 rounded-md flex items-center gap-2 hover:bg-indigo-700">
              <Plus size={18} /> Add Validation
            </button>
          </div>

          {showValidationForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={resetValidationForm}>
              <div className="w-full max-w-5xl bg-white p-6 rounded-xl shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">{isEditingValidation ? 'Edit Validation' : 'Add Validation'}</h3>
                  <button type="button" onClick={resetValidationForm} className="text-slate-400 hover:text-slate-700 p-1">
                    <X size={18} />
                  </button>
                </div>
                <form onSubmit={handleValidationSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 text-sm">
                    <div>
                      <label className="block text-slate-600 mb-1">Document</label>
                      <input className="w-full border p-2 rounded" placeholder="Substring match" value={validationForm.document} onChange={e => setValidationForm({ ...validationForm, document: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Corpus</label>
                      <input className="w-full border p-2 rounded" placeholder="Substring match" value={validationForm.corpus} onChange={e => setValidationForm({ ...validationForm, corpus: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Domain</label>
                      <select className="w-full border p-2 rounded bg-white" value={validationForm.domain} onChange={e => handleValidationDomainChange(e.target.value)}>
                        <option value="XML">XML</option>
                        <option value="spreadsheet">spreadsheet</option>
                        <option value="metadata">metadata</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Key</label>
                      <input required className="w-full border p-2 rounded" placeholder="Targeted key" value={validationForm.key} onChange={e => setValidationForm({ ...validationForm, key: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Operator</label>
                      <select className="w-full border p-2 rounded bg-white" value={validationForm.operator} onChange={e => setValidationForm({ ...validationForm, operator: e.target.value })}>
                        <option value="exists">exists</option>
                        <option value="!exists">!exists</option>
                        <option value="=">=</option>
                        <option value="~">~</option>
                        <option value="==">==</option>
                        <option value="|">|</option>
                        <option value="&" disabled={validationForm.domain !== 'spreadsheet'}>&amp;</option>
                        <option value=">">&gt;</option>
                        <option value="nelink" disabled={validationForm.domain !== 'spreadsheet'}>nelink</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Value</label>
                      <input className="w-full border p-2 rounded" placeholder="Comparison value or second key" value={validationForm.value} onChange={e => setValidationForm({ ...validationForm, value: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={resetValidationForm} className="px-4 py-2 rounded bg-slate-100 text-slate-700 hover:bg-slate-200">Cancel</button>
                    <button type="submit" className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700">{isEditingValidation ? 'Save Validation' : 'Create Validation'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className={`border-b ${tableHeaderStyle ? '' : 'bg-slate-50'}`} style={tableHeaderStyle}>
                {(() => {
                  const VAL_SORT_COLS = ['corpus', 'document', 'domain', 'key', 'operator', 'value'];
                  const handleValSort = (col) => {
                    setValidationSort((prev) =>
                      prev.key === col
                        ? { key: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                        : { key: col, dir: 'asc' }
                    );
                  };
                  const valSortIndicator = (col) => {
                    if (validationSort.key !== col) return null;
                    return validationSort.dir === 'asc' ? ' ▲' : ' ▼';
                  };
                  const thCls = (col) =>
                    `p-4 font-medium select-none cursor-pointer hover:text-indigo-600${validationSort.key === col ? ' text-indigo-600' : ''}`;
                  return (
                    <>
                      <tr>
                        {VAL_SORT_COLS.map((col) => (
                          <th key={col} className={thCls(col)} onClick={() => handleValSort(col)}>
                            {col.charAt(0).toUpperCase() + col.slice(1)}{valSortIndicator(col)}
                          </th>
                        ))}
                        <th className="p-4 font-medium text-right">Actions</th>
                      </tr>
                      <tr className="border-t border-slate-200">
                        {VAL_SORT_COLS.map((col) => (
                          <th key={`filter-${col}`} className="p-2">
                            <input
                              className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-normal"
                              placeholder={`Filter ${col}`}
                              value={validationFilters[col]}
                              onChange={(e) => handleValidationFilterChange(col, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </th>
                        ))}
                        <th className="p-2"></th>
                      </tr>
                    </>
                  );
                })()}
              </thead>
              <tbody>
                {(() => {
                  const DEFAULT_ORDER = ['corpus', 'document', 'domain', 'key', 'operator', 'value'];
                  const normalizeFilterValue = (value) => String(value || '').toLowerCase();
                  const filteredValidations = validations.filter((validation) => {
                    return DEFAULT_ORDER.every((col) => {
                      const filterValue = normalizeFilterValue(validationFilters[col]);
                      if (!filterValue) return true;
                      return normalizeFilterValue(validation[col]).includes(filterValue);
                    });
                  });
                  const cmp = (a, b, col) => {
                    const av = (a[col] || '').toLowerCase();
                    const bv = (b[col] || '').toLowerCase();
                    return av < bv ? -1 : av > bv ? 1 : 0;
                  };
                  const sortCols = validationSort.key
                    ? [validationSort.key, ...DEFAULT_ORDER.filter((c) => c !== validationSort.key)]
                    : DEFAULT_ORDER;
                  const sortedValidations = [...filteredValidations].sort((a, b) => {
                    for (let i = 0; i < sortCols.length; i++) {
                      const col = sortCols[i];
                      const d = cmp(a, b, col);
                      if (d !== 0) return i === 0 && validationSort.key ? d * (validationSort.dir === 'asc' ? 1 : -1) : d;
                    }
                    return 0;
                  });
                  return (
                    <>
                      {sortedValidations.length === 0 && (
                        <tr>
                          <td colSpan="7" className="p-8 text-center text-slate-500">No validations configured for this project.</td>
                        </tr>
                      )}
                      {sortedValidations.map((validation) => (
                  <tr key={validation.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="p-4">{validation.corpus || <span className="text-slate-400">Any</span>}</td>
                    <td className="p-4">{validation.document || <span className="text-slate-400">Any</span>}</td>
                    <td className="p-4">{validation.domain}</td>
                    <td className="p-4 font-medium text-slate-700">{validation.key}</td>
                    <td className="p-4"><span className="inline-flex min-w-10 justify-center rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 whitespace-nowrap">{validation.operator}</span></td>
                    <td className="p-4 text-slate-600">{validation.value || <span className="text-slate-400">-</span>}</td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <button onClick={() => handleEditValidation(validation)} className="text-blue-600 hover:text-blue-800 p-2"><Edit size={18} /></button>
                      <button onClick={() => handleDeleteValidation(validation.id)} className="text-red-500 hover:text-red-700 p-2"><Trash2 size={18} /></button>
                    </td>
                  </tr>
                ))}
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>

          <details className="bg-slate-50 rounded-xl border border-slate-200 p-5 group">
            <summary className="font-semibold cursor-pointer text-slate-700 select-none list-none flex items-center justify-between">
              <span>Validation Help</span>
              <span className="text-slate-400 group-open:rotate-180 transition-transform duration-200">▼</span>
            </summary>
            <div className="mt-4 text-sm text-slate-600 border-t border-slate-200 pt-4">
              <ul className="list-disc pl-5 space-y-2">
                <li><code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">exists</code> and <code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">!exists</code> mean that an annotation name must or must not exist (e.g. metadata name, spreadsheet column)</li>
                <li><code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">col1 = val</code> and <code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">col1 ~ regex</code> mean that col1 must only have the value <code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">val</code>, or match the <code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">regex</code></li>
                <li><code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">col1==col2</code> means the values in the same spans across col1 and col2 must match</li>
                <li><code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">col1 &gt; col2</code> means spreadsheet spans in col1 must <em>nest</em> spans in col2</li>
                <li><code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">col1 | col2</code> means spreadsheet spans in col1 are same <em>length</em> as col2 spans</li>
                <li><code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">col1 &amp; col2</code> means spreadsheet span contents in col1 must <em>sum up</em> to contents of spans in col2</li>
                <li>for xml, the key <code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">wellformed</code> and operator <code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">exists</code> validates wellformed SGML</li>
                <li><code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">col1 nelink col2</code> means that col2 must contain text for all named entity spans in col1 (all identities annotated)</li>
              </ul>
            </div>
          </details>
        </div>
      )}

      {activeTab === 'corpus-management' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Batch export corpus ZIP</h3>
              {corpusExportMode === 'spreadsheet' && (
                <button
                  type="button"
                  onClick={fetchExportConfigs}
                  className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                  disabled={isExportConfigsLoading}
                >
                  {isExportConfigsLoading ? 'Loading schemas...' : 'Refresh schemas'}
                </button>
              )}
            </div>

            {corpora.length > 0 ? (
              <form onSubmit={handleCorpusExportZip} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="block text-slate-600 mb-1">Corpus</label>
                    <select
                      className="w-full border p-2 rounded bg-white"
                      value={selectedCorpus}
                      onChange={(e) => setSelectedCorpus(e.target.value)}
                    >
                      {corpora.map((corpusName) => (
                        <option key={corpusName} value={corpusName}>{corpusName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Export format</label>
                    <select
                      className="w-full border p-2 rounded bg-white"
                      value={corpusExportMode}
                      onChange={(e) => setCorpusExportMode(e.target.value)}
                    >
                      <option value="xml">XML</option>
                      <option value="spreadsheet">Spreadsheet (SGML)</option>
                    </select>
                  </div>

                  {corpusExportMode === 'spreadsheet' && (
                    <div>
                      <label className="block text-slate-600 mb-1">Export Scheme (.ini)</label>
                      <select
                        className="w-full border p-2 rounded bg-white"
                        value={corpusExportConfig}
                        onChange={(e) => setCorpusExportConfig(e.target.value)}
                        disabled={isExportConfigsLoading || exportConfigs.length === 0}
                        required
                      >
                        {exportConfigs.length === 0 ? (
                          <option value="">No schemas available</option>
                        ) : (
                          exportConfigs.map((configName) => (
                            <option key={configName} value={configName}>{configName}</option>
                          ))
                        )}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-slate-600 mb-1">File Extension (optional)</label>
                    <input
                      className="w-full border p-2 rounded"
                      value={corpusExportExtension}
                      onChange={(e) => setCorpusExportExtension(e.target.value)}
                      placeholder={corpusExportMode === 'spreadsheet' ? 'Default: sgml' : 'Default: xml'}
                    />
                    <p className="text-xs text-slate-500 mt-1">Use extension name without dot, for example: xml, sgml, txt.</p>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={
                    isExportingCorpusZip
                    || !selectedCorpus
                    || (corpusExportMode === 'spreadsheet' && !corpusExportConfig)
                  }
                  className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  <Download size={16} />
                  {isExportingCorpusZip ? 'Preparing ZIP...' : 'Export ZIP'}
                </button>
              </form>
            ) : (
              <p className="text-sm text-slate-500">No corpora found in this project yet.</p>
            )}
          </div>

          {corpusExportResult && (
            <div className={`rounded-xl border p-5 ${corpusExportResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              <p className="font-semibold">{corpusExportResult.message}</p>
              {corpusExportResult.ok && corpusExportResult.filename && (
                <p className="text-sm mt-1">Downloaded file: {corpusExportResult.filename}</p>
              )}
            </div>
          )}

          {canBatchImportCorpus && (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h3 className="text-lg font-semibold mb-4">Upload corpus ZIP</h3>
              <form onSubmit={handleCorpusUpload} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="block text-slate-600 mb-1">Upload type</label>
                    <select
                      className="w-full border p-2 rounded bg-white"
                      value={corpusUploadType}
                      onChange={(e) => setCorpusUploadType(e.target.value)}
                    >
                      <option value="xml">XML files</option>
                      <option value="sgml">Spreadsheet/SGML files</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">ZIP File</label>
                    <input
                      type="file"
                      accept=".zip,application/zip"
                      className="w-full border p-2 rounded bg-white"
                      onChange={(e) => setCorpusZipFile(e.target.files?.[0] || null)}
                      required
                    />
                  </div>
                </div>

                <button
                  title="(manager/admin only)"
                  type="submit"
                  disabled={!corpusZipFile || isUploadingCorpus}
                  className="flex inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  <Upload size={16} />
                  {isUploadingCorpus ? 'Uploading...' : 'Upload corpus'} <Shield size={14} className="opacity-60" />
                </button>
              </form>
            </div>
          )}

          {canBatchImportCorpus && corpusUploadResult?.ok && (() => {
            const payload = corpusUploadResult.payload || {};
            const issues = getCorpusIssues(payload);
            const hasIssues = Number(payload.error_count || 0) > 0 || issues.length > 0;

            return (
              <div className={`rounded-xl border p-5 ${hasIssues ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
                {!hasIssues && (
                  <p className="font-semibold">
                    Import successful. Created {payload.created_count ?? 0} document(s).
                  </p>
                )}
                {hasIssues && (
                  <div className="space-y-2">
                    <p className="font-semibold">Import completed with issues.</p>
                    <p className="text-sm">
                      Created: {payload.created_count ?? 0} | Skipped: {payload.skipped_count ?? 0} | Errors: {payload.error_count ?? 0}
                    </p>
                    {issues.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mt-2 mb-1">Issue details:</p>
                        <ul className="list-disc ml-5 text-sm space-y-1">
                          {issues.map((issue, idx) => (
                            <li key={`${issue?.name || issue?.docname || 'issue'}-${idx}`}>
                              {issue?.name || issue?.docname || issue?.entry || `Entry ${idx + 1}`}: {issue?.error || issue?.status || 'Issue detected'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {canBatchImportCorpus && corpusUploadResult && !corpusUploadResult.ok && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
              <p className="font-semibold">Import failed.</p>
              <p className="text-sm mt-1">{corpusUploadResult.message}</p>
            </div>
          )}

          {/* --- Global Metadata & Repository Addition (Requires Level >= 2) --- */}
          {adminLevel >= 2 && (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <h3 className="text-lg font-semibold">Bulk metadata & repository update</h3>
              
              {metadataActionResult && (
                <div className={`rounded-xl border p-4 text-sm ${metadataActionResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                  {metadataActionResult.message}
                </div>
              )}

              <div className="space-y-6 text-sm">
                {/* Document Substring Filters */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <label className="block text-slate-600 mb-1">Corpus substring (optional)</label>
                    <input
                      className="w-full border p-2 rounded"
                      value={metadataForm.corpus}
                      onChange={(e) => setMetadataForm((prev) => ({ ...prev, corpus: e.target.value }))}
                      placeholder="Leave blank to match all corpora"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Document substring (optional)</label>
                    <input
                      className="w-full border p-2 rounded"
                      value={metadataForm.document}
                      onChange={(e) => setMetadataForm((prev) => ({ ...prev, document: e.target.value }))}
                      placeholder="Leave blank to match all documents"
                    />
                  </div>
                </div>

                {/* Apply Metadata Row */}
                <div className="flex flex-col md:flex-row items-end gap-4 pb-4 border-b border-slate-100">
                  <div className="flex-1 w-full">
                    <label className="block text-slate-600 mb-1">Metadata key</label>
                    <input
                      className="w-full border p-2 rounded"
                      value={metadataForm.key}
                      onChange={(e) => setMetadataForm((prev) => ({ ...prev, key: e.target.value }))}
                      placeholder="e.g., source_language"
                    />
                  </div>
                  <div className="flex-1 w-full">
                    <label className="block text-slate-600 mb-1">Metadata value</label>
                    <input
                      className="w-full border p-2 rounded"
                      value={metadataForm.value}
                      onChange={(e) => setMetadataForm((prev) => ({ ...prev, value: e.target.value }))}
                      placeholder="e.g., eng"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleMetadataSubmit}
                    disabled={metadataPhase !== 'idle' || !metadataForm.key.trim()}
                    className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed h-10 w-full md:w-auto shrink-0"
                  >
                    {metadataPhase === 'checking'
                      ? 'Checking...'
                      : metadataPhase === 'updating'
                      ? 'Applying...'
                      : 'Apply metadata'} <Shield size={14} className="opacity-60" />
                  </button>
                </div>

                {/* Update Repository Row */}
                <div className="flex flex-col md:flex-row items-end gap-4">
                  <div className="flex-1 w-full">
                    <label className="block text-slate-600 mb-1">Repository</label>
                    <input
                      className="w-full border p-2 rounded"
                      value={metadataForm.repository || ''}
                      onChange={(e) => setMetadataForm((prev) => ({ ...prev, repository: e.target.value }))}
                      placeholder="e.g., org/repo or org/repo/subfolder"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleRepoBulkSubmit}
                    disabled={
                      metadataPhase !== 'idle' || 
                      !(metadataForm.repository && /^[^\s/]+(?:\/[^\s/]+)+$/.test(metadataForm.repository.trim()))
                    }
                    className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed h-10 w-full md:w-auto shrink-0"
                  >
                    {metadataPhase === 'checking'
                      ? 'Checking...'
                      : metadataPhase === 'updating'
                      ? 'Updating...'
                      : 'Update repository'} <Shield size={14} className="opacity-60" />
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* --- End Global Metadata & Repository Addition --- */}

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Corpus rename and delete</h3>
              <button
                type="button"
                onClick={fetchCorpora}
                className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                disabled={isCorpusListLoading}
              >
                {isCorpusListLoading ? 'Loading...' : 'Refresh corpora'}
              </button>
            </div>

            {corpora.length > 0 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="block text-slate-600 mb-1">Existing corpus</label>
                    <select
                      className="w-full border p-2 rounded bg-white"
                      value={selectedCorpus}
                      onChange={(e) => setSelectedCorpus(e.target.value)}
                    >
                      {corpora.map((corpusName) => (
                        <option key={corpusName} value={corpusName}>{corpusName}</option>
                      ))}
                    </select>
                  </div>
                  <form onSubmit={handleRenameCorpus}>
                    <label className="block text-slate-600 mb-1">Rename selected corpus to</label>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 border p-2 rounded"
                        value={renameCorpusName}
                        onChange={(e) => setRenameCorpusName(e.target.value)}
                        disabled={!canRenameCorpus || isRenamingCorpus}
                        placeholder="Enter a new corpus name"
                      />
                      <button
                        type="submit"
                        disabled={
                          !canRenameCorpus ||
                          isRenamingCorpus ||
                          !selectedCorpus ||
                          !renameCorpusName.trim() ||
                          renameCorpusName.trim() === selectedCorpus
                        }
                        className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                      >
                        {isRenamingCorpus ? 'Renaming...' : 'Rename'}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  {canDeleteCorpus && (
                    <button
                      title="(manager/admin only)"
                      type="button"
                      onClick={handleDeleteCorpus}
                      disabled={isDeletingCorpus || !selectedCorpus}
                      className="flex inline-flex items-center gap-2 px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={18} />
                      {isDeletingCorpus ? 'Deleting...' : 'Delete selected corpus'}  <Shield size={14} className="opacity-60" />
                    </button>
                  )}
                  <p className="text-xs text-slate-500">
                    Rename requires level 1 (committer) or above. <br/>
                    {canDeleteCorpus ? 'Delete requires level 2 (manager) or above.' : ''}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">No corpora found in this project yet.</p>
            )}
          </div>

          {corpusActionResult && (
            <div className={`rounded-xl border p-5 ${corpusActionResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              <p className="font-semibold">{corpusActionResult.message}</p>
              {corpusActionResult.ok && Number.isFinite(corpusActionResult.count) && (
                <p className="text-sm mt-1">
                  {corpusActionResult.kind === 'rename' ? 'Updated documents' : 'Deleted documents'}: {corpusActionResult.count}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
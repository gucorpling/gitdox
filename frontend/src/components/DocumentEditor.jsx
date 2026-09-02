import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Plus, Trash2, Edit, X, Copy, Code } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { xml } from '@codemirror/lang-xml';
import { insertNewline } from '@codemirror/commands';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import SpreadsheetEditor from './SpreadsheetEditor';
import Spannotator from './Spannotator';
import { Dendroid } from './Dendroid';
import ValidationBadge from './ValidationBadge';
import {
  DEFAULT_STATUS_CATEGORIES,
  formatStatusCategoryLabel,
  normalizeCssStyleValue,
  getMetadataValidationViolationKeys,
  getValidationSummary,
  normalizePreferredColumnOrder,
  normalizeBackgroundImageValue,
  normalizeFontFamily,
  isSpreadsheetBackedMode
} from '../appShared';

export default function DocumentEditor({ 
  apiCall, 
  docId, 
  onCorpusChange,
  user, 
  projectName, 
  mutationTools, 
  spannotatorConfig = {}, 
  dendroidConfig = {}, 
  spreadsheetConfig = {},
  editorOptions = [], 
  editorFonts = {}, 
  spreadsheetColumnOrderConfig = [], 
  xmlTagCompletion = null, 
  statusCategories = [], 
  isAppConfigLoaded = false 
}) {
  const [doc, setDoc] = useState(null);
  const [contentXml, setContentXml] = useState('');
  const [contentSpreadsheet, setContentSpreadsheet] = useState('');
  const [activeMutationTool, setActiveMutationTool] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isXmlDirty, setIsXmlDirty] = useState(false);
  const [isSpreadsheetDirty, setIsSpreadsheetDirty] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommittingToGithub, setIsCommittingToGithub] = useState(false);
  const [isRestoringFromGithub, setIsRestoringFromGithub] = useState(false);
  const [latestGithubCommitMessage, setLatestGithubCommitMessage] = useState('');
  const [latestGithubCommitUrl, setLatestGithubCommitUrl] = useState('');
  const [latestGithubCommitDate, setLatestGithubCommitDate] = useState('');
  const [latestGithubCommitAuthor, setLatestGithubCommitAuthor] = useState('');
  const [isLoadingGithubCommitMessage, setIsLoadingGithubCommitMessage] = useState(false);
  const spreadsheetEditorRef = useRef(null);
  const previousEditorModeRef = useRef(null);
  
  const [lastReadyValidation, setLastReadyValidation] = useState(null);
  const [prevValidation, setPrevValidation] = useState(null);

  const cmRef = useRef(null);
  const [xmlTagModalOpen, setXmlTagModalOpen] = useState(false);
  const [xmlTagForm, setXmlTagForm] = useState({ tag: '', attr: '', val: '' });

  // Metadata States
  const [metadata, setMetadata] = useState([]); // Document metadata
  const [corpusMetadata, setCorpusMetadata] = useState([]); // Corpus metadata
  const [activeMetaTab, setActiveMetaTab] = useState('document'); // 'document' or 'corpus'
  
  // Metadata Clone States
  const [allDocuments, setAllDocuments] = useState([]);
  const [selectedCloneDocId, setSelectedCloneDocId] = useState('');

  useEffect(() => {
      // Check if the document data has loaded and has a name/title
      if (doc && doc.docname) {
        document.title = doc.docname; 

      }     
    }, [doc]);

  const uniqueMetaKeys = useMemo(() => {
    const keys = new Set();
    allDocuments.forEach(d => {
      try {
        const metaObj = typeof d.metadata === 'string' ? JSON.parse(d.metadata) : (d.metadata || {});
        Object.keys(metaObj).forEach(k => keys.add(k));
      } catch (e) {
        // ignore JSON parse errors for invalid metadata
        console.warn("Failed to parse document metadata", e);
      }
    });
    return Array.from(keys).sort();
  }, [allDocuments]);

  const [usersList, setUsersList] = useState([]);
  const [isAutoSaving, setIsAutoSaving] = useState(false);

  // OCC / Conflict tracking
  const [lastModifiedAt, setLastModifiedAt] = useState(0);
  const [conflictData, setConflictData] = useState(null); 
  const [wakeSyncNotice, setWakeSyncNotice] = useState(null);
  const lastModifiedAtRef = useRef(0);
  const hasUnsavedChangesRef = useRef(false);
  const isSavingRef = useRef(false);

  // Keep ref in sync with state for event listeners
  useEffect(() => {
    lastModifiedAtRef.current = lastModifiedAt;
  }, [lastModifiedAt]);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);
  
  // Metadata Modal State
  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [metaForm, setMetaForm] = useState({ k: '', v: '', originalKey: null });
  const canEditAssignee = (user?.adminlevel ?? 0) > 0;
  
  const statusOptions = useMemo(() => {
    const options = Array.isArray(statusCategories) && statusCategories.length > 0
      ? statusCategories
      : DEFAULT_STATUS_CATEGORIES;
    const currentStatus = doc?.status;
    if (currentStatus && !options.includes(currentStatus)) {
      return [...options, currentStatus];
    }
    return options;
  }, [statusCategories, doc?.status]);

  const assigneeOptions = useMemo(() => {
    const usernames = usersList
      .map((u) => String(u?.username || '').trim())
      .filter((name) => name.length > 0);

    const currentAssignee = String(doc?.assigned || '').trim();
    if (currentAssignee && !usernames.includes(currentAssignee)) {
      usernames.unshift(currentAssignee);
    }

    return usernames;
  }, [usersList, doc?.assigned]);

  // Hoisted helper functions to resolve missing dependencies and variable access before declaration issues
  const normalizeMetadataObject = useCallback((metaObj = {}) => {
    const source = metaObj && typeof metaObj === 'object' ? metaObj : {};
    return Object.entries(source)
      .map(([k, v]) => ({ k, v }))
      .sort((a, b) => a.k.localeCompare(b.k));
  }, []);

  const buildMetadataObject = useCallback((metaArray) => {
    const sortedMetaArray = [...metaArray].sort((a, b) => a.k.localeCompare(b.k));
    return sortedMetaArray.reduce((acc, curr) => {
      if (curr.k.trim()) acc[curr.k.trim()] = curr.v;
      return acc;
    }, {});
  }, []);

  const formatServerEditTime = useCallback((serverTime) => {
    return new Date(serverTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  const applyServerSnapshot = useCallback((data) => {
    setContentXml(data.content_xml || '');
    setContentSpreadsheet(data.content_spreadsheet || '');

    const serverTime = data.last_modified_at || 0;
    setLastModifiedAt(serverTime);
    lastModifiedAtRef.current = serverTime;

    setHasUnsavedChanges(false);
    setIsXmlDirty(false);
    setIsSpreadsheetDirty(false);
    setConflictData(null);
  }, []);

  const checkForConflicts = useCallback(async ({ source = 'passive' } = {}) => {
    if (!docId) return;
    try {
      const data = await apiCall(`/documents/${docId}/contents`);
      const serverTime = data.last_modified_at || 0;
      
      // If the server has a newer timestamp than our local ref, trigger a conflict
      if (serverTime > lastModifiedAtRef.current) {
        const shouldAutoRefreshOnWake = source === 'wake' && !hasUnsavedChangesRef.current && !isSavingRef.current;

        if (shouldAutoRefreshOnWake) {
          applyServerSnapshot(data);
          setWakeSyncNotice({
            user: data.last_modified_by || 'another user',
            formattedTime: formatServerEditTime(serverTime)
          });
          return;
        }

        setConflictData({
          user: data.last_modified_by || 'another user',
          serverTime: serverTime,
          serverXml: data.content_xml || '',
          serverSpreadsheet: data.content_spreadsheet || '',
          formattedTime: formatServerEditTime(serverTime)
        });
      }
    } catch (err) {
      console.warn("Conflict check failed silently", err);
    }
  }, [docId, apiCall, applyServerSnapshot, formatServerEditTime]);

  const autoSaveSpreadsheetContent = useCallback(async (spreadsheetValue, timeOverride = null) => {
    if (!doc) return false;
    
    // Prevent overlapping network requests
    if (isSavingRef.current) {
      console.warn("Save already in progress, skipping redundant request.");
      return false; 
    }

    isSavingRef.current = true;
    setIsAutoSaving(true);
    try {
      const currentTimestamp = timeOverride !== null ? timeOverride : lastModifiedAtRef.current;
      const response = await apiCall(`/documents/${docId}/contents`, 'PUT', {
        content_xml: contentXml,
        content_spreadsheet: spreadsheetValue,
        last_modified_at: currentTimestamp
      });
      
      if (response?.validation) {
        setDoc(prev => ({ ...prev, validation: response.validation }));
      }
      if (response?.last_modified_at) {
        setLastModifiedAt(response.last_modified_at);
        lastModifiedAtRef.current = response.last_modified_at;
      }
      
      setHasUnsavedChanges(false);
      setIsSpreadsheetDirty(false);
      return true;
    } catch (err) {
      console.error(err);
      checkForConflicts();
      setHasUnsavedChanges(true);
      return false;
    } finally {
      isSavingRef.current = false;
      setIsAutoSaving(false);
    }
  }, [apiCall, contentXml, doc, docId, checkForConflicts]);

  const autoSaveXmlContent = useCallback(async (xmlValue, timeOverride = null) => {
    if (!doc) return;

    setIsAutoSaving(true);
    try {
      const currentTimestamp = timeOverride !== null ? timeOverride : lastModifiedAtRef.current;
      const response = await apiCall(`/documents/${docId}/contents`, 'PUT', {
        content_xml: xmlValue,
        content_spreadsheet: contentSpreadsheet,
        last_modified_at: currentTimestamp
      });
      
      if (response?.validation) {
        setDoc(prev => ({ ...prev, validation: response.validation }));
      }
      if (response?.last_modified_at) {
        setLastModifiedAt(response.last_modified_at);
        lastModifiedAtRef.current = response.last_modified_at;
      }

      setHasUnsavedChanges(false);
      setIsXmlDirty(false);
      return true;
    } catch (err) {
      console.error(err);
      checkForConflicts();
      setHasUnsavedChanges(true);
      return false;
    } finally {
      setIsAutoSaving(false);
    }
  }, [apiCall, contentSpreadsheet, doc, docId, checkForConflicts]);

  const saveDocMetadataToBackend = useCallback(async (newMetaArray) => {
    if (!doc) return;
    const sortedMetaArray = [...newMetaArray].sort((a, b) => a.k.localeCompare(b.k));
    const metaObj = buildMetadataObject(sortedMetaArray);

    try {
      const response = await apiCall(`/documents/${docId}`, 'PUT', {
        corpus: doc.corpus,
        docname: doc.docname,
        repo: doc.repo || '',
        mode: doc.mode,
        status: doc.status,
        assigned: doc.assigned,
        metadata: metaObj
      });
      setMetadata(sortedMetaArray);
      if (response?.validation) {
        setDoc(prev => ({ ...prev, validation: response.validation }));
      }
    } catch (err) {
      alert("Failed to save document metadata: " + err.message);
    }
  }, [apiCall, buildMetadataObject, doc, docId]);

  // Keep the nav's "Corpus" button in sync with the currently open document
  useEffect(() => {
    if (!onCorpusChange) return;
    onCorpusChange(doc?.corpus || '');
    return () => onCorpusChange('');
  }, [doc?.corpus, onCorpusChange]);

  useEffect(() => {
    const init = async () => {
      // Fetch users in a separate try/catch so a failure here doesn't break document loading
      try {
        const users = await apiCall(`/projects/${projectName}/users`);
        setUsersList(users);
      } catch (err) {
        console.warn("Failed to load users for assignee dropdown", err);
      }
      
      // Fetch the document
      try {
        // Find doc metadata 
        const allDocs = await apiCall(`/projects/${projectName}/documents`);
        setAllDocuments(allDocs);
        const targetDoc = allDocs.find(d => d.id === docId);
        
        if (targetDoc) {
          setDoc(targetDoc);
          // Parse Doc Metadata
          const metaObj = typeof targetDoc.metadata === 'string' ? JSON.parse(targetDoc.metadata) : (targetDoc.metadata || {});
          setMetadata(normalizeMetadataObject(metaObj));
          
          // Fetch Corpus Metadata
          if (targetDoc.corpus) {
            try {
              const corpusMetaObj = await apiCall(`/corpora/${targetDoc.corpus}/metadata`);
              const sortedCorpusMetaArray = Object.entries(corpusMetaObj)
                .map(([k, v]) => ({ k, v }))
                .sort((a, b) => a.k.localeCompare(b.k));
              setCorpusMetadata(sortedCorpusMetaArray);
            } catch (e) {
              console.warn("Failed to fetch corpus metadata", e);
              // Backend might not have this endpoint yet, gracefully fallback
              setCorpusMetadata([]);
            }
          }
        }

        // Fetch doc contents
        const contentData = await apiCall(`/documents/${docId}/contents`);
        const fallbackContents = contentData.contents || '';
        setContentXml(contentData.content_xml ?? (targetDoc?.mode === 'xml' ? fallbackContents : ''));
        setContentSpreadsheet(contentData.content_spreadsheet ?? (targetDoc?.mode !== 'xml' ? fallbackContents : ''));
        setHasUnsavedChanges(false);
        // Tracking variables for Optimistic Concurrency Control
        const serverTime = contentData.last_modified_at || 0;
        setLastModifiedAt(serverTime);
        lastModifiedAtRef.current = serverTime;
      } catch (err) {
        console.warn("Failed to fetch document contents", err);
      }
    };
    init();
  }, [docId, projectName, apiCall, normalizeMetadataObject]);

  useEffect(() => {
    if (!doc || doc.mode !== 'xml' || !isXmlDirty) return;

    const timer = setTimeout(() => {
      autoSaveXmlContent(contentXml);
    }, 1000);

    return () => clearTimeout(timer);
  }, [contentXml, doc, doc?.id, doc?.mode, isXmlDirty, autoSaveXmlContent]);

  useEffect(() => {
    if (!doc || !(isSpreadsheetBackedMode(doc.mode) || doc.mode === 'dendroid') || !isSpreadsheetDirty) return;

    const timer = setTimeout(() => {
      autoSaveSpreadsheetContent(contentSpreadsheet);
    }, 1000);

    return () => clearTimeout(timer);
  }, [contentSpreadsheet, doc, doc?.id, doc?.mode, isSpreadsheetDirty, autoSaveSpreadsheetContent]);

  useEffect(() => {
    if (!docId) return;

    // 1. Tab Visibility Check
    const handleWakeUpSync = () => {
      checkForConflicts({ source: 'wake' });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleWakeUpSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWakeUpSync);
    window.addEventListener('pageshow', handleWakeUpSync);

    // 2. Polling Check (15 minutes = 900,000 ms)
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkForConflicts({ source: 'poll' });
      }
    }, 900000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWakeUpSync);
      window.removeEventListener('pageshow', handleWakeUpSync);
      clearInterval(pollInterval);
    };
  }, [docId, checkForConflicts]);

  const handleSpreadsheetContentChange = useCallback((nextValue) => {
    setContentSpreadsheet((prevValue) => {
      if (prevValue === nextValue) return prevValue;
      setHasUnsavedChanges(true);
      setIsSpreadsheetDirty(true);
      return nextValue;
    });
  }, []);

  const resolveCarouselMetadataKeys = useCallback((cfg) => {
    const entitiesCarousel = cfg?.entities?.carousel;
    const rootCarousel = cfg?.carousel;

    const keyCandidates = [
      ...(Array.isArray(entitiesCarousel?.keys) ? entitiesCarousel.keys : []),
      ...(Array.isArray(rootCarousel?.keys) ? rootCarousel.keys : []),
      ...(Array.isArray(rootCarousel) ? rootCarousel : []),
      ...(Array.isArray(cfg?.CAROUSEL_KEYS) ? cfg.CAROUSEL_KEYS : []),
      ...(Array.isArray(cfg?.SUMMARY_KEYS) ? cfg.SUMMARY_KEYS : [])
    ];

    return [...new Set(
      keyCandidates
        .map((key) => String(key || '').trim())
        .filter((key) => key.length > 0)
    )];
  }, []);

  const updateDocField = (field, value, markUnsaved = true) => {
    setDoc(prev => ({ ...prev, [field]: value }));
    if (markUnsaved) {
      setHasUnsavedChanges(true);
    }
  };

  const autoSaveDocField = async (field, value) => {
    if (!doc) return;

    let updatedDoc = { ...doc, [field]: value };
    setDoc(updatedDoc);
    setIsAutoSaving(true);
    try {
      const response = await apiCall(`/documents/${docId}`, 'PUT', {
        corpus: updatedDoc.corpus,
        docname: updatedDoc.docname,
        repo: updatedDoc.repo || '',
        mode: updatedDoc.mode,
        status: updatedDoc.status,
        assigned: updatedDoc.assigned,
        metadata: buildMetadataObject(metadata)
      });

      if (response?.validation) {
        updatedDoc = { ...updatedDoc, validation: response.validation };
      }

      if (response?.last_modified_at) {
        setLastModifiedAt(response.last_modified_at);
        lastModifiedAtRef.current = response.last_modified_at;
      }

      setDoc(updatedDoc);
      setHasUnsavedChanges(false);
      return true;
    } catch (err) {
      console.error(err);
      alert("Failed to auto-save: " + err.message);
      setHasUnsavedChanges(true);
      return false;
    } finally {
      setIsAutoSaving(false);
    }
  };

  const handleConflictReload = () => {
    if (!conflictData) return;
    setContentXml(conflictData.serverXml);
    setContentSpreadsheet(conflictData.serverSpreadsheet);
    setLastModifiedAt(conflictData.serverTime);
    lastModifiedAtRef.current = conflictData.serverTime;
    setHasUnsavedChanges(false);
    setIsXmlDirty(false);
    setIsSpreadsheetDirty(false);
    setConflictData(null);
  };

  const handleConflictOverwrite = () => {
    if (!conflictData) return;
    const timeOverride = conflictData.serverTime; // Adopt the server's time to bypass 409
    setConflictData(null);
    
    // Force the save with the new adopted timestamp
    if (doc.mode === 'xml') {
      autoSaveXmlContent(contentXml, timeOverride);
    } else {
      autoSaveSpreadsheetContent(contentSpreadsheet, timeOverride);
    }
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(contentXml);
    alert("XML copied to clipboard!");
  };

  const handleSpreadsheetCanonicalized = useCallback(async (canonicalValue) => {
    if (!doc || !isSpreadsheetBackedMode(doc.mode)) return;
    if (typeof canonicalValue !== 'string' || !canonicalValue.trim()) return;

    setContentSpreadsheet((prevValue) => (prevValue === canonicalValue ? prevValue : canonicalValue));
    setHasUnsavedChanges(true);
    setIsSpreadsheetDirty(true);

    const spreadsheetSaved = await autoSaveSpreadsheetContent(canonicalValue);
    if (!spreadsheetSaved) return;

    try {
      const response = await apiCall(`/documents/${doc.id}/validate`, 'POST');
      if (response?.validation) {
        setDoc((prev) => (prev ? { ...prev, validation: response.validation } : prev));
      }
    } catch (err) {
      console.error(err);
    }
  }, [doc, apiCall, autoSaveSpreadsheetContent]);

  const runSpannotatorToolMutation = async (toolKey) => {
    if (!doc || !contentSpreadsheet.trim()) {
      alert('Spreadsheet content is empty.');
      return '';
    }

    const response = await apiCall('/documents/mutate', 'POST', {
      tool: toolKey, 
      content_spreadsheet: contentSpreadsheet
    });

    const transformedSgml = response?.content_xml ?? response?.content_spreadsheet ?? '';
    if (typeof transformedSgml !== 'string' || !transformedSgml.trim()) {
      alert('Spannotator tool failed: no SGML content was returned.');
      return '';
    }

    return transformedSgml;
  };

  const runIdentifyMutation = async (entityPairs) => {
    if (!doc) return [];
    if (!Array.isArray(entityPairs) || entityPairs.length === 0) {
      return [];
    }

    try {
      const response = await apiCall('/documents/mutate', 'POST', {
        tool: 'identify',
        entities: entityPairs
      });

      const identities = response?.identities;
      if (!Array.isArray(identities)) {
        throw new Error('No identity predictions were returned.');
      }

      return identities.map((value) => (typeof value === 'string' ? value : String(value ?? '')));
    } catch (err) {
      alert('Guess identities failed: ' + err.message);
      return [];
    }
  };

  const suggestionCache = useRef({});

  const fetchIdentitySuggestions = async (entityType) => {
    // Return cached results if we already fetched them for this entity type
    if (suggestionCache.current[entityType]) {
      return suggestionCache.current[entityType];
    }

    try {
      const response = await apiCall('/documents/mutate', 'POST', {
        tool: 'identity_list',
        entities: [['_', entityType]] // Send empty string with the entity type
      });

      const identities = response?.identities || [];
      // Store in memory for future keystrokes/renders
      suggestionCache.current[entityType] = identities; 
      
      return identities;
    } catch (err) {
      console.error(`Fetch suggestions failed for ${entityType}: ` + err.message);
      return [];
    }
  };
  
  const importSpreadsheetSgml = async (sgmlContent) => {
    if (!docId) {
      throw new Error('Document ID is unknown.');
    }

    try {
      const refreshed = await apiCall(`/documents/${docId}/contents`, 'PUT', {
        content_spreadsheet: sgmlContent,
        format: 'sgml',
        last_modified_at: lastModifiedAtRef.current, // OCC tracking
      });

      // Update our local OCC tracking with the newly generated timestamps
      if (refreshed?.last_modified_at) {
        setLastModifiedAt(refreshed.last_modified_at);
        lastModifiedAtRef.current = refreshed.last_modified_at;
      }

      handleSpreadsheetImportResult(refreshed);
      return refreshed?.content_spreadsheet ?? refreshed?.contents ?? '';
    } catch (err) {
      // Catch the 409 conflict if someone else edited while they were importing
      checkForConflicts();
      throw err;
    }
  };

  const runXmlMutationTool = async (toolKey, toolConfig) => {
    if (!doc || !contentXml.trim()) {
      alert('XML content is empty.');
      return;
    }

    setActiveMutationTool(toolKey);
    try {
      const response = await apiCall('/documents/mutate', 'POST', {
        tool: toolKey, 
        content_xml: contentXml
      });

      const returnMode = toolConfig.return;

      // Handle returning XML
      if (returnMode === 'xml') {
        const transformedXml = response?.content_xml;
        if (typeof transformedXml !== 'string' || transformedXml.length === 0) {
          throw new Error(`${toolConfig.caption} returned no XML content.`);
        }

        setContentXml(transformedXml);
        setHasUnsavedChanges(true);
        setIsXmlDirty(true);
        await autoSaveXmlContent(transformedXml);
      } 
      // Handle returning Spreadsheet or Entities
      else if (returnMode === 'spreadsheet' || returnMode === 'entities' || returnMode === 'dendroid') {
        const transformedSpreadsheet = response?.content_spreadsheet;
        if (typeof transformedSpreadsheet !== 'string' || transformedSpreadsheet.length === 0) {
          throw new Error(`${toolConfig.caption} returned no spreadsheet content.`);
        }

        setContentSpreadsheet(transformedSpreadsheet);
        setHasUnsavedChanges(true);
        setIsSpreadsheetDirty(true);

        const spreadsheetSaved = await autoSaveSpreadsheetContent(transformedSpreadsheet);
        if (!spreadsheetSaved) return;

        // Switch the editor to the new mode ("spreadsheet" or "entities")
        await autoSaveDocField('mode', returnMode);
      }
    } catch (err) {
      alert(`Failed to execute ${toolConfig.caption || toolKey}: ${err.message}`);
    } finally {
      setActiveMutationTool('');
    }
  };

  const runSpreadsheetMutationTool = async (toolKey, toolConfig) => {
    if (!doc || !contentSpreadsheet.trim()) {
      alert('Spreadsheet content is empty.');
      return;
    }

    setActiveMutationTool(toolKey);
    try {
      const response = await apiCall('/documents/mutate', 'POST', {
        tool: toolKey,
        content_spreadsheet: contentSpreadsheet
      });

      const returnMode = toolConfig.return;

      // Handle returning XML
      if (returnMode === 'xml') {
        const transformedXml = response?.content_xml;
        if (typeof transformedXml !== 'string' || transformedXml.length === 0) {
          throw new Error(`${toolConfig.caption} returned no XML content.`);
        }

        setContentXml(transformedXml);
        setHasUnsavedChanges(true);
        setIsXmlDirty(true);
        await autoSaveXmlContent(transformedXml);
        await autoSaveDocField('mode', 'xml');
      }
      // Handle returning Spreadsheet or Entities
      else if (returnMode === 'spreadsheet' || returnMode === 'entities' || returnMode === 'dendroid') {
        const transformedSpreadsheet = response?.content_spreadsheet;
        if (typeof transformedSpreadsheet !== 'string' || transformedSpreadsheet.length === 0) {
          throw new Error(`${toolConfig.caption} returned no spreadsheet content.`);
        }

        setContentSpreadsheet(transformedSpreadsheet);
        setHasUnsavedChanges(true);
        setIsSpreadsheetDirty(true);

        const spreadsheetSaved = await autoSaveSpreadsheetContent(transformedSpreadsheet);
        if (!spreadsheetSaved) return;

        if (returnMode === 'entities') {
          await autoSaveDocField('mode', 'entities');
        } else if (returnMode === 'dendroid') {
          await autoSaveDocField('mode', 'dendroid');
        }
      }
    } catch (err) {
      alert(`Failed to execute ${toolConfig.caption || toolKey}: ${err.message}`);
    } finally {
      setActiveMutationTool('');
    }
  };

  const formatGithubCommitTimestamp = (isoDate) => {
    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  };

  const buildGithubFilePath = (mode, docnameValue) => {
    const normalizedDocname = String(docnameValue || '').trim();
    if (!normalizedDocname) return '';
    return mode === 'xml' ? `${normalizedDocname}.xml` : `${normalizedDocname}_ether.sgml`;
  };
  
  const fetchLatestGithubCommitMessage = useCallback(async ({ modeOverride = null } = {}) => {
    const isCommitter = (user?.adminlevel ?? 0) >= 1;
    if (!doc || !isCommitter) {
      setLatestGithubCommitMessage('');
      setLatestGithubCommitUrl('');
      setLatestGithubCommitDate('');
      setLatestGithubCommitAuthor('');
      return;
    }

    const repoIsConfigured = typeof doc.repo === 'string' && doc.repo.trim().length > 0;
    if (!repoIsConfigured) {
      setLatestGithubCommitMessage('');
      setLatestGithubCommitUrl('');
      setLatestGithubCommitDate('');
      setLatestGithubCommitAuthor('');
      return;
    }

    const modeToUse = modeOverride ?? doc.mode;
    const filePath = buildGithubFilePath(modeToUse, doc.docname);
    if (!filePath) {
      setLatestGithubCommitMessage('');
      setLatestGithubCommitUrl('');
      setLatestGithubCommitDate('');
      setLatestGithubCommitAuthor('');
      return;
    }

    setIsLoadingGithubCommitMessage(true);
    try {
      const response = await apiCall(`/documents/${docId}/github/commit-message?file_path=${encodeURIComponent(filePath)}`);
      const fetchedMessage = typeof response?.commit_message === 'string' ? response.commit_message.trim() : '';
      const fetchedUrl = typeof response?.commit_url === 'string' ? response.commit_url.trim() : '';
      const fetchedDate = typeof response?.commit_date === 'string' ? response.commit_date.trim() : '';
      const fetchedAuthor = typeof response?.commit_author === 'string' ? response.commit_author.trim() : '';
      setLatestGithubCommitMessage(fetchedMessage);
      setLatestGithubCommitUrl(fetchedUrl);
      setLatestGithubCommitDate(fetchedDate);
      setLatestGithubCommitAuthor(fetchedAuthor);
    } catch (err) {
      console.error(err);
      setLatestGithubCommitMessage('');
      setLatestGithubCommitUrl('');
      setLatestGithubCommitDate('');
      setLatestGithubCommitAuthor('');
    } finally {
      setIsLoadingGithubCommitMessage(false);
    }
  }, [apiCall, doc, docId, user?.adminlevel]);

  const commitCurrentDocumentToGithub = async () => {
    if (!doc) return;

    const repoIsConfigured = typeof doc.repo === 'string' && doc.repo.trim().length > 0;
    if (!repoIsConfigured) {
      alert('Please fill the repo field before committing to GitHub.');
      return;
    }

    const docname = String(doc.docname || '').trim();
    if (!docname) {
      alert('Document name is required before committing to GitHub.');
      return;
    }

    const trimmedCommitMessage = commitMessage.trim();
    if (!trimmedCommitMessage) {
      alert('Please enter a commit message.');
      return;
    }

    const isXmlMode = doc.mode === 'xml';
    const format = isXmlMode ? 'xml' : 'spreadsheet';
    const filePath = buildGithubFilePath(doc.mode, docname);

    let content = isXmlMode ? contentXml : contentSpreadsheet;
    if (!isXmlMode && doc.mode === 'spreadsheet') {
      const latestSpreadsheet = await spreadsheetEditorRef.current?.getSerializedValue?.();
      if (typeof latestSpreadsheet === 'string') {
        content = latestSpreadsheet;
      }
    }

    if (!String(content || '').trim()) {
      alert('Cannot commit empty content.');
      return;
    }

    setIsCommittingToGithub(true);
    try {
      const metadataPayload = buildMetadataObject(metadata);
      await apiCall(`/documents/${docId}/github/contents`, 'PUT', {
        file_path: filePath,
        commit_message: trimmedCommitMessage,
        content,
        format,
        metadata: metadataPayload
      });
      setCommitMessage('');
      await fetchLatestGithubCommitMessage({ modeOverride: doc.mode });
      alert('Successfully pushed new version to GitHub.');
    } catch (err) {
      alert('Failed to commit to GitHub: ' + err.message);
    } finally {
      setIsCommittingToGithub(false);
    }
  };

  const restoreCurrentDocumentFromGithub = async () => {
    if (!doc) return;

    const isCommitter = (user?.adminlevel ?? 0) >= 1;
    if (!isCommitter) return;

    const repoIsConfigured = typeof doc.repo === 'string' && doc.repo.trim().length > 0;
    if (!repoIsConfigured) {
      alert('Please fill the repo field before restoring from GitHub.');
      return;
    }

    if (!latestGithubCommitMessage) {
      alert('Restore is available only after the file has at least one commit on GitHub.');
      return;
    }

    const docname = String(doc.docname || '').trim();
    if (!docname) {
      alert('Document name is required before restoring from GitHub.');
      return;
    }

    const confirmed = confirm('Restore from GitHub will replace the current editor content. This cannot be undone. Continue?');
    if (!confirmed) return;

    const filePath = buildGithubFilePath(doc.mode, docname);
    if (!filePath) {
      alert('Could not determine GitHub file path for this mode.');
      return;
    }

    setIsRestoringFromGithub(true);
    try {
      const response = await apiCall(`/documents/${docId}/github/contents?file_path=${encodeURIComponent(filePath)}`);
      const githubContent = typeof response?.content === 'string' ? response.content : '';
      if (!githubContent.trim()) {
        throw new Error('GitHub returned empty file contents.');
      }

      if (doc.mode === 'xml') {
        setContentXml(githubContent);
        setHasUnsavedChanges(true);
        setIsXmlDirty(true);
        await autoSaveXmlContent(githubContent);
      } else {
        const importedSpreadsheet = await importSpreadsheetSgml(githubContent);
        if (typeof importedSpreadsheet === 'string') {
          setContentSpreadsheet(importedSpreadsheet);
        }
        setHasUnsavedChanges(false);
        setIsSpreadsheetDirty(false);
      }

      alert('Editor content restored from GitHub.');
    } catch (err) {
      alert('Failed to restore from GitHub: ' + err.message);
    } finally {
      setIsRestoringFromGithub(false);
    }
  };

  const handleCloneMetadata = async () => {
    if (!selectedCloneDocId) return;

    const cloneDoc = allDocuments.find(d => d.id === selectedCloneDocId);
    if (!cloneDoc) return;

    let cloneMetaObj;
    try {
      cloneMetaObj = typeof cloneDoc.metadata === 'string' ? JSON.parse(cloneDoc.metadata) : (cloneDoc.metadata || {});
    } catch (e) {
      console.error("Failed to parse cloned doc metadata", e);
      cloneMetaObj = {};
    }

    const cloneMetaArray = normalizeMetadataObject(cloneMetaObj);
    if (cloneMetaArray.length === 0) {
      alert(`The selected document (${cloneDoc.corpus}/${cloneDoc.docname}) has no metadata to clone.`);
      return;
    }

    // Clash Logic: Keep existing keys, append new missing keys
    const currentKeys = new Set(metadata.map(m => m.k));
    const newEntriesToAppend = cloneMetaArray.filter(m => !currentKeys.has(m.k));

    if (newEntriesToAppend.length === 0) {
      alert("No new metadata keys to add. All keys from the selected document already exist in this document.");
      return;
    }

    const combinedMetadata = [...metadata, ...newEntriesToAppend];
    await saveDocMetadataToBackend(combinedMetadata);
    alert(`Successfully cloned ${newEntriesToAppend.length} new metadata entries.`);
    setSelectedCloneDocId(''); // reset dropdown
  };

  const handleSpannotatorMetadataChange = useCallback(async (incomingMeta) => {
    if (!incomingMeta || typeof incomingMeta !== 'object') return;
    if (!doc) return;

    const carouselKeys = resolveCarouselMetadataKeys(spannotatorConfig);
    if (carouselKeys.length === 0) return;

    const incomingOwnedMeta = {};
    carouselKeys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(incomingMeta, key)) return;
      incomingOwnedMeta[key] = incomingMeta[key];
    });

    if (Object.keys(incomingOwnedMeta).length === 0) return;

    const currentMetaObj = buildMetadataObject(metadata);
    const nextMetaObj = {
      ...currentMetaObj,
      ...incomingOwnedMeta
    };

    const changed = Object.keys(incomingOwnedMeta).some((key) => {
      return String(currentMetaObj[key] ?? '') !== String(nextMetaObj[key] ?? '');
    });
    if (!changed) return;

    await saveDocMetadataToBackend(normalizeMetadataObject(nextMetaObj));
  }, [buildMetadataObject, doc, metadata, normalizeMetadataObject, resolveCarouselMetadataKeys, saveDocMetadataToBackend, spannotatorConfig]);

  const handleSpreadsheetImportResult = (importResult) => {
    if (!importResult || typeof importResult !== 'object') return;

    if (importResult.metadata && typeof importResult.metadata === 'object') {
      setMetadata(normalizeMetadataObject(importResult.metadata));
    }

    if (importResult.validation) {
      setDoc(prev => ({ ...prev, validation: importResult.validation }));
    }
  };

  const saveCorpusMetadataToBackend = async (newMetaArray) => {
    if (!doc || !doc.corpus) return;
    const sortedMetaArray = [...newMetaArray].sort((a, b) => a.k.localeCompare(b.k));
    const metaObj = sortedMetaArray.reduce((acc, curr) => {
      if (curr.k.trim()) acc[curr.k.trim()] = curr.v;
      return acc;
    }, {});

    try {
      await apiCall(`/corpora/${doc.corpus}/metadata`, 'PUT', metaObj);
      setCorpusMetadata(sortedMetaArray);
    } catch (err) {
      alert("Failed to save corpus metadata: " + err.message);
    }
  };

  const openAddMetaModal = () => {
    setMetaForm({ k: '', v: '', originalKey: null });
    setMetaModalOpen(true);
  };

  const openEditMetaModal = (k, v) => {
    setMetaForm({ k, v, originalKey: k });
    setMetaModalOpen(true);
  };

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    if (!metaForm.k.trim()) return;

    const currentArray = activeMetaTab === 'document' ? metadata : corpusMetadata;
    const saveFunction = activeMetaTab === 'document' ? saveDocMetadataToBackend : saveCorpusMetadataToBackend;
    
    let newMetaArray;
    if (metaForm.originalKey !== null) {
      // Prevent editing key to one that already exists
      if (metaForm.originalKey !== metaForm.k && currentArray.some(item => item.k === metaForm.k)) {
        alert("A metadata entry with that key already exists!");
        return;
      }
      // Editing existing
      newMetaArray = currentArray.map(item => 
        item.k === metaForm.originalKey ? { k: metaForm.k, v: metaForm.v } : item
      );
    } else {
      // Adding new
      if (currentArray.some(item => item.k === metaForm.k)) {
        alert("A metadata entry with that key already exists!");
        return;
      }
      newMetaArray = [...currentArray, { k: metaForm.k, v: metaForm.v }];
    }

    await saveFunction(newMetaArray);
    setMetaModalOpen(false);
  };

  const handleRemoveMeta = async (keyToRemove) => {
    if (!confirm(`Delete metadata key "${keyToRemove}"?`)) return;
    
    if (activeMetaTab === 'document') {
      const newMetaArray = metadata.filter(item => item.k !== keyToRemove);
      await saveDocMetadataToBackend(newMetaArray);
    } else {
      const newMetaArray = corpusMetadata.filter(item => item.k !== keyToRemove);
      await saveCorpusMetadataToBackend(newMetaArray);
    }
  };

  // Safe Retrieval Helper for configuration fields where empty strings "" are meaningful triggers to disable logic
  const getTokenAnn = (key, defaultVal) => {
    const val = dendroidConfig?.token_annotations?.[key];
    return val !== undefined ? val : defaultVal;
  };

  const currentMetadataArray = activeMetaTab === 'document' ? metadata : corpusMetadata;
  const uiFontFamily = normalizeFontFamily(editorFonts?.ui?.font);
  const uiPanelBackgroundColor = normalizeCssStyleValue(editorFonts?.ui?.panel_background_color);
  const uiTableHeaderBackgroundColor = normalizeCssStyleValue(editorFonts?.ui?.table_header_background_color);
  const uiBackgroundColor = normalizeCssStyleValue(editorFonts?.ui?.background_color);
  const uiBackgroundImage = normalizeBackgroundImageValue(editorFonts?.ui?.background_image);
  const xmlFontFamily = normalizeFontFamily(editorFonts?.xml?.font) || uiFontFamily;
  const entitiesFontFamily = normalizeFontFamily(editorFonts?.entities?.font) || normalizeFontFamily(spannotatorConfig?.font) || uiFontFamily;
  const spreadsheetFontFamily = normalizeFontFamily(editorFonts?.spreadsheet?.font) || uiFontFamily;
  const preferredColumnOrder = isAppConfigLoaded
    ? normalizePreferredColumnOrder(
        Array.isArray(spreadsheetColumnOrderConfig) && spreadsheetColumnOrderConfig.length > 0
          ? spreadsheetColumnOrderConfig
          : (editorFonts?.spreadsheet?.column_order ?? editorFonts?.spreadsheet?.preferred_column_order)
      )
    : null;
  const editorSurfaceStyle = {
    ...(uiBackgroundColor ? { backgroundColor: uiBackgroundColor } : {}),
    ...(uiBackgroundImage
      ? {
          backgroundImage: uiBackgroundImage,
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center'
        }
      : {})
  };
  const editorSurfaceHasCustomBackground = Object.keys(editorSurfaceStyle).length > 0;
  const panelStyle = uiPanelBackgroundColor ? { backgroundColor: uiPanelBackgroundColor } : undefined;
  const tableHeaderStyle = uiTableHeaderBackgroundColor ? { backgroundColor: uiTableHeaderBackgroundColor } : undefined;
  const effectiveEditorSurfaceStyle = editorSurfaceHasCustomBackground
    ? editorSurfaceStyle
    : (panelStyle || undefined);
  const canShowGithubCommitControls = (user?.adminlevel ?? 0) >= 1;
  const canUseDataTransferTools = (user?.adminlevel ?? 0) >= 2;
  const copyPasteLevel = Number(spreadsheetConfig?.copy_paste_level);
  const allowExternalSpreadsheetClipboard = (user?.adminlevel ?? 0) >= (Number.isFinite(copyPasteLevel) ? copyPasteLevel : 0);
  const canCommitToGithub = typeof doc?.repo === 'string' && doc.repo.trim().length > 0;
  const hasGithubCommittedVersion = typeof latestGithubCommitMessage === 'string' && latestGithubCommitMessage.trim().length > 0;
  const canRestoreFromGithub = canShowGithubCommitControls
    && canCommitToGithub
    && hasGithubCommittedVersion
    && !isLoadingGithubCommitMessage
    && !isRestoringFromGithub;
    
  const modeSelectOptions = useMemo(() => {
    const currentMode = doc?.mode;
    if (!currentMode) return editorOptions;
    if (editorOptions.some((option) => option.mode === currentMode)) {
      return editorOptions;
    }
    return [...editorOptions, { key: `legacy-${currentMode}`, mode: currentMode, label: currentMode }];
  }, [doc?.mode, editorOptions]);
  
  const githubModeKind = doc?.mode === 'xml' ? 'xml' : 'spreadsheet';
  const spannotatorMetaDict = useMemo(() => buildMetadataObject(metadata), [metadata, buildMetadataObject]);
  const validationSummary = getValidationSummary(doc?.validation, {
    mode: doc?.mode,
    xmlContent: contentXml,
    spreadsheetContent: contentSpreadsheet
  });
  const isValidationPending = validationSummary.status === 'validating';
  const configuredMaxCoordsPerRule = Number(editorFonts?.ui?.max_validator_warn_per_rule);
  const maxValidatorWarnPerRule = Number.isInteger(configuredMaxCoordsPerRule) && configuredMaxCoordsPerRule > 0
    ? configuredMaxCoordsPerRule
    : 8;
  const metadataViolationKeySet = useMemo(
    () => new Set(getMetadataValidationViolationKeys(doc?.validation, currentMetadataArray)),
    [doc?.validation, currentMetadataArray]
  );
  const xmlAutoIndent = editorFonts?.xml?.auto_indent !== false;
  const xmlSchemaWarning = typeof editorFonts?.xml?.tags_schema_error === 'string' ? editorFonts.xml.tags_schema_error : '';
  const xmlEditorExtensions = useMemo(() => {
    const extensions = [];

    extensions.push(
      keymap.of([
        {
          key: 'Ctrl-e', 
          mac: 'Cmd-e', 
          run: () => {
            setXmlTagModalOpen(true);
            return true;
          }
        }
      ])
    );

    if (!xmlAutoIndent) {
      extensions.push(
        Prec.highest(
          keymap.of([
            { key: 'Enter', run: insertNewline, shift: insertNewline }
          ])
        )
      );
    }

    if (xmlTagCompletion?.elements?.length) {
      extensions.push(xml(xmlTagCompletion));
    } else {
      extensions.push(xml());
    }

    // Add word wrap if desired using extensions={[EditorView.lineWrapping]}
    if (editorFonts?.xml?.line_wrapping) {
      extensions.push(EditorView.lineWrapping);
    }

    return extensions;
  }, [xmlAutoIndent, xmlTagCompletion, editorFonts?.xml?.line_wrapping]);

  const isDocLoaded = doc !== null;
  useEffect(() => {
    if (!doc) return;
    const timer = setTimeout(() => {
      fetchLatestGithubCommitMessage();
    }, 0);
    return () => clearTimeout(timer);
  }, [doc, docId, githubModeKind, user?.adminlevel, isDocLoaded, fetchLatestGithubCommitMessage]);

  useEffect(() => {
    if (!isValidationPending || !docId || !projectName) return undefined;

    const intervalId = window.setInterval(async () => {
      try {
        const allDocs = await apiCall(`/projects/${projectName}/documents`);
        const refreshedDoc = Array.isArray(allDocs) ? allDocs.find((entry) => entry.id === docId) : null;
        if (!refreshedDoc?.validation) return;

        setDoc((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            validation: refreshedDoc.validation
          };
        });
      } catch (err) {
        console.error(err);
      }
    }, 2500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isValidationPending, docId, projectName, apiCall]);

  useEffect(() => {
    if (!doc?.id) return undefined;

    const previousMode = previousEditorModeRef.current;
    const currentMode = doc.mode;
    previousEditorModeRef.current = currentMode;

    const enteringSpreadsheetMode = currentMode === 'spreadsheet' && previousMode !== 'spreadsheet';
    if (!enteringSpreadsheetMode) return undefined;

    let cancelled = false;
    const queueSpreadsheetValidation = async () => {
      try {
        const response = await apiCall(`/documents/${doc.id}/validate`, 'POST');
        if (cancelled) return;
        if (response?.validation) {
          setDoc((prev) => (prev ? { ...prev, validation: response.validation } : prev));
        }
      } catch (err) {
        console.error(err);
      }
    };

    queueSpreadsheetValidation();

    return () => {
      cancelled = true;
    };
  }, [doc?.id, doc?.mode, apiCall]);

  // Derived State Pattern: Updating last ready validation directly during render avoids the useEffect flash completely.
  if (doc?.validation !== prevValidation) {
    setPrevValidation(doc?.validation);
    if (doc?.validation && doc.validation.status !== 'validating' && Array.isArray(doc.validation.results)) {
      setLastReadyValidation(doc.validation);
    }
  }

  const effectiveSpreadsheetValidation = doc?.validation?.status === 'validating' && lastReadyValidation
    ? { ...doc.validation, results: lastReadyValidation.results }
    : doc?.validation;

  const handleValidationCellReferenceClick = useCallback((cellRef) => {
    spreadsheetEditorRef.current?.focusCell?.(cellRef);
  }, []);

  const [validationBadgeCollapseSignal, setValidationBadgeCollapseSignal] = useState(0);
  const handleFindOpen = useCallback(() => {
    setValidationBadgeCollapseSignal((signal) => signal + 1);
  }, []);

  const handleInsertXmlTag = (e) => {
    e.preventDefault();
    const { tag, attr, val } = xmlTagForm;
    const cleanTag = tag.trim();
    
    // Disable OK if no tag
    if (!cleanTag) return;

    if (cmRef.current && cmRef.current.view) {
      const view = cmRef.current.view;
      const state = view.state;
      const selection = state.selection.main;
      const selectedText = state.sliceDoc(selection.from, selection.to);

      // Build the tags
      let openTag = `<${cleanTag}`;
      if (attr.trim()) {
        openTag += ` ${attr.trim()}="${val.trim()}"`;
      }
      openTag += '>';
      const closeTag = `</${cleanTag}>`;

      // Dispatch the change directly to CodeMirror
      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: openTag + selectedText + closeTag
        },
        // Leave the wrapped text selected afterward
        selection: { 
          anchor: selection.from + openTag.length, 
          head: selection.from + openTag.length + selectedText.length 
        }
      });
      
      // Refocus the editor
      view.focus();
    }
    setXmlTagModalOpen(false);
  };


  if (!doc) return <div className="p-8 text-center">Loading document...</div>;

  return (
    <div className="max-w-6xl mx-auto flex flex-col space-y-4" style={{ maxWidth: '100%' }}>
      <div className="flex items-center gap-3 shrink-0">
        {/* No min-w-0 here: once the fields can't shrink further, the row overflows (scrolls) instead of clipping */}
        <div className={`flex-1 flex items-center gap-4 p-2 rounded-xl shadow-sm border border-slate-200 ${panelStyle ? '' : 'bg-white'}`} style={panelStyle}>
          <div className="flex-1 min-w-[6rem]">
            <label className="block text-xs font-semibold text-slate-500 uppercase">Corpus</label>
            <input
              className="w-full border-b pb-1 focus:outline-none focus:border-indigo-500"
              value={doc.corpus}
              onChange={e => updateDocField('corpus', e.target.value, false)}
              onBlur={e => autoSaveDocField('corpus', e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className="block text-xs font-semibold text-slate-500 uppercase">Document Name</label>
            <input
              className="w-full border-b pb-1 focus:outline-none focus:border-indigo-500 font-medium"
              value={doc.docname}
              onChange={e => updateDocField('docname', e.target.value, false)}
              onBlur={e => {
                autoSaveDocField('docname', e.target.value);
                fetchLatestGithubCommitMessage();
              }}
            />
          </div>
          <div className="flex-1 min-w-[6rem]">
            <label className="block text-xs font-semibold text-slate-500 uppercase">Repo</label>
            <input
              className="w-full border-b pb-1 focus:outline-none focus:border-indigo-500"
              value={doc.repo || ''}
              onChange={e => updateDocField('repo', e.target.value, false)}
              onBlur={e => {
                autoSaveDocField('repo', e.target.value);
                fetchLatestGithubCommitMessage();
              }}
              placeholder="Optional"
            />
          </div>
          <div className="shrink-0">
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Status</label>
            <select className="border rounded p-1 text-sm bg-slate-50" value={doc.status} onChange={e => autoSaveDocField('status', e.target.value)}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{formatStatusCategoryLabel(status)}</option>
              ))}
            </select>
          </div>
          <div className="shrink-0">
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Assignee</label>
            <select
              className="border rounded p-1 text-sm bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
              value={doc.assigned || ''}
              onChange={e => autoSaveDocField('assigned', e.target.value)}
              disabled={!canEditAssignee}
              title={!canEditAssignee ? 'Only admins can reassign documents.' : undefined}
            >
               {assigneeOptions.map((username) => <option key={username} value={username}>{username}</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 shrink-0">
          <div className={`sync-container inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold border ${
            isAutoSaving
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : hasUnsavedChanges
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            <span className={`h-2 w-2 rounded-full ${
              isAutoSaving
                ? 'bg-amber-500'
                : hasUnsavedChanges
                  ? 'bg-blue-500'
                  : 'bg-emerald-500'
            }`}></span>
            {isAutoSaving ? 'Saving...' : (hasUnsavedChanges ? 'Unsynced' : 'Saved')}
          </div>

          <ValidationBadge
            key={validationBadgeCollapseSignal}
            validationSummary={validationSummary}
            maxCoordsPerRule={maxValidatorWarnPerRule}
            onCellReferenceClick={doc?.mode === 'spreadsheet' ? handleValidationCellReferenceClick : null}
          />
        </div>
      </div>

      <div className="flex flex-col">
        <div
          className={`rounded-xl shadow-sm border border-slate-200 flex flex-col relative h-[800px] overflow-hidden ${effectiveEditorSurfaceStyle ? '' : 'bg-white'}`}
          style={effectiveEditorSurfaceStyle}
        >
          <div className="absolute top-2 right-4 z-10 bg-white rounded p-1 shadow-sm" style={{top: "-1px"}}>
             <select className="text-xs bg-slate-100 border-none rounded p-1" value={doc.mode} onChange={e => autoSaveDocField('mode', e.target.value)}>
              {modeSelectOptions.map((option) => (
                <option key={option.key} value={option.mode}>{option.label}</option>
              ))}
            </select>
          </div>
          
          {doc.mode === 'xml' ? (
            <div className="flex-1 bg-white pt-10 flex flex-col min-h-0">
              {xmlSchemaWarning && (
                <div className="mx-4 mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  XML tag schema warning: {xmlSchemaWarning}
                </div>
              )}
              <div className="flex-1 overflow-auto xml-editor-host" style={xmlFontFamily ? { '--xml-editor-font-family': xmlFontFamily } : undefined}>
                <CodeMirror
                  ref={cmRef}
                  value={contentXml}
                  height="100%"
                  extensions={xmlEditorExtensions}
                  basicSetup={xmlAutoIndent ? true : { indentOnInput: false }}
                  onChange={(value) => {
                    setContentXml(value);
                    setHasUnsavedChanges(true);
                    setIsXmlDirty(true);
                  }}
                  className="h-full text-sm border-t border-slate-100"
                />
              </div>
              {/* 2. XML toolbar button */}
              <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-2 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setXmlTagModalOpen(true)}
                  title="Insert XML Element (Ctrl+E)"
                  className="p-1.5 mr-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-100 rounded transition-colors bg-white border border-slate-200 shadow-sm"
                >
                  <Code size={18} />
                </button>
                {/* ----------------------- */}               
                {Object.entries(mutationTools || {}).map(([toolKey, config]) => {
                  // 1. Check if the tool belongs to the XML editor
                  if (config.editor !== 'xml') return null;

                  // 2. Check if the user has the required admin level
                  const requiredLevel = config.level || 0;
                  const userLevel = user?.adminlevel || 0;
                  if (userLevel < requiredLevel) return null;

                  // 3. Render the dynamic button
                  return (
                    <button
                      key={toolKey}
                      type="button"
                      style={config.color ? { backgroundColor: config.color } : undefined}
                      onClick={() => runXmlMutationTool(toolKey, config)}
                      disabled={!!activeMutationTool}
                      className="px-3 py-1.5 text-sm font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {activeMutationTool === toolKey ? `${config.caption}...` : config.caption}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : doc.mode === 'entities' ? (
            <div className="flex-1 w-full h-full pt-10 overflow-hidden border-t border-slate-100 bg-white">
              <Spannotator
                config={spannotatorConfig}
                fontFamily={entitiesFontFamily}
                value={contentSpreadsheet}
                canDataTransfer={canUseDataTransferTools}
                externalControlsHostId="spannotator-entities-controls-host"
                meta_dict={spannotatorMetaDict}
                onMetadataChange={handleSpannotatorMetadataChange}
                onImportSgml={importSpreadsheetSgml}
                mutationTools={mutationTools}
                onRunTool={runSpannotatorToolMutation}
                onGuessIdentities={runIdentifyMutation}
                onFetchIdentitySuggestions={fetchIdentitySuggestions}
                onChange={handleSpreadsheetContentChange}
                className="h-full overflow-auto"
              />
            </div>
          ) : doc.mode === 'dendroid' ? (
            <div className="flex-1 w-full h-full pt-10 overflow-hidden border-t border-slate-100 bg-white">
              <Dendroid
                initialData={contentSpreadsheet}
                initialFormat="socialcalc"
                currentUser={user?.username || 'Anonymous'}
                defaultAnnotator={dendroidConfig?.default_annotator || 'parser'}
                perUserMode={dendroidConfig?.multiuser ?? true}
                textCol={dendroidConfig?.sentence_text ?? ''}
                sentBoundCol={dendroidConfig?.sentence_span ?? 'sent_id'}
                sentenceAnnotations={dendroidConfig?.sentence_annotations ?? []}
                colMappings={{
                  id: getTokenAnn('word_id', 'word_id'),
                  form: getTokenAnn('word', 'tok'),
                  lemma: getTokenAnn('lemma', 'lemma'),
                  upos: getTokenAnn('upos', 'upos'),
                  xpos: getTokenAnn('xpos', 'xpos'),
                  feats: getTokenAnn('feats', 'feats'),
                  head: getTokenAnn('head', 'head'),
                  deprel: getTokenAnn('deprel', 'deprel'),
                  deps: getTokenAnn('edeps', 'deps'),
                  misc: getTokenAnn('misc', 'misc'),
                  annotator: 'dendroid:annotator',
                  mwt: dendroidConfig?.mwt || ''
                }}
                features={{
                  mwt: Boolean(dendroidConfig?.mwt),
                  ellipsis: Boolean(dendroidConfig?.ellipsis),
                  edeps: Boolean(getTokenAnn('edeps', '')),
                  feats: Boolean(getTokenAnn('feats', '')),
                  misc: Boolean(getTokenAnn('misc', ''))
                }}
                tagsets={{
                  upos: dendroidConfig?.tagsets?.upos || [],
                  xpos: dendroidConfig?.tagsets?.xpos || [],
                  deprel: dendroidConfig?.tagsets?.deprels || [],
                  edeprel: dendroidConfig?.tagsets?.edeprels || []
                }}
                onChange={handleSpreadsheetContentChange}
              />
            </div>
          ) : (
            <div className="flex-1 w-full h-full pt-10 overflow-hidden border-t border-slate-100 bg-white flex flex-col">
              
              <div className="flex-1 min-h-0">
                <SpreadsheetEditor
                  ref={spreadsheetEditorRef}
                  fontFamily={spreadsheetFontFamily}
                  preferredColumnOrder={preferredColumnOrder}
                  value={contentSpreadsheet}
                  canDataTransfer={canUseDataTransferTools}
                  allowExternalClipboard={allowExternalSpreadsheetClipboard}
                  validation={effectiveSpreadsheetValidation}
                  onChange={handleSpreadsheetContentChange}
                  onCanonicalized={handleSpreadsheetCanonicalized}
                  onImportResult={handleSpreadsheetImportResult}
                  onImportSgml={importSpreadsheetSgml}
                  onFindOpen={handleFindOpen}
                  docId={docId}
                  apiCall={apiCall}
                  className="h-full"
                />
              </div>
              {Object.entries(mutationTools || {}).some(([, config]) => config.editor === 'spreadsheet') && (
                <div className="border-b border-slate-100 px-4 py-3 flex items-center gap-2 bg-slate-50">
                  {Object.entries(mutationTools || {}).map(([toolKey, config]) => {
                    // 1. Check if the tool belongs to the spreadsheet editor
                    if (config.editor !== 'spreadsheet') return null;

                    // 2. Check if the user has the required admin level
                    const requiredLevel = config.level || 0;
                    const userLevel = user?.adminlevel || 0;
                    if (userLevel < requiredLevel) return null;

                    // 3. Render the dynamic button
                    return (
                      <button
                        key={toolKey}
                        type="button"
                        style={config.color ? { backgroundColor: config.color } : undefined}
                        onClick={() => runSpreadsheetMutationTool(toolKey, config)}
                        disabled={!!activeMutationTool}
                        className="px-3 py-1.5 text-sm font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {activeMutationTool === toolKey ? `${config.caption}...` : config.caption}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {doc.mode === 'entities' ? (
          <div id="spannotator-entities-controls-host" className="-mt-px px-0 py-0" />
        ) : null}

        {canShowGithubCommitControls ? (
          <div className={`mt-3 rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-2 ${panelStyle ? '' : 'bg-white'}`} style={panelStyle}>
            <label className="block text-xs font-semibold text-slate-500 uppercase">GitHub Commit Message</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Describe this update"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={commitCurrentDocumentToGithub}
                disabled={!canCommitToGithub || isCommittingToGithub || isRestoringFromGithub}
                className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCommittingToGithub ? 'Committing...' : 'Commit to GitHub'}
              </button>
              <button
                type="button"
                onClick={restoreCurrentDocumentFromGithub}
                disabled={!canRestoreFromGithub || isCommittingToGithub}
                className="inline-flex items-center justify-center rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRestoringFromGithub ? 'Restoring...' : 'Restore from GitHub'}
              </button>
            </div>
            {!canCommitToGithub ? (
              <p className="text-xs text-amber-700">Set the repo field to enable GitHub commits.</p>
            ) : null}
            {canCommitToGithub && isLoadingGithubCommitMessage ? (
              <p className="text-xs text-slate-500">Loading latest GitHub commit message...</p>
            ) : null}
            {canCommitToGithub && !isLoadingGithubCommitMessage && latestGithubCommitMessage ? (
              <p className="text-xs text-slate-600">
                Latest GitHub commit:{' '}
                {latestGithubCommitUrl ? (
                  <a
                    href={latestGithubCommitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-slate-800 underline decoration-slate-400 underline-offset-2 hover:text-indigo-700"
                  >
                    {latestGithubCommitMessage}
                  </a>
                ) : (
                  <span className="font-medium text-slate-800">{latestGithubCommitMessage}</span>
                )}
                {latestGithubCommitDate ? (
                  <span className="text-slate-500"> ({formatGithubCommitTimestamp(latestGithubCommitDate)})</span>
                ) : null}
                {latestGithubCommitAuthor ? (
                  <span className="text-slate-500"> by <span className="font-medium text-slate-800">{latestGithubCommitAuthor}</span></span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Metadata Section */}
      <div className={`p-4 rounded-xl shadow-sm border border-slate-200 shrink-0 ${panelStyle ? '' : 'bg-white'}`} style={panelStyle}>
        <div className="flex justify-between items-center mb-3">
          <div className="flex space-x-6 border-b border-slate-200 flex-1 mr-4">
            <button
              onClick={() => setActiveMetaTab('document')}
              className={`pb-2 text-sm font-semibold transition-colors relative ${activeMetaTab === 'document' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Document Metadata
              {activeMetaTab === 'document' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600"></div>}
            </button>
            <button
              onClick={() => setActiveMetaTab('corpus')}
              className={`pb-2 text-sm font-semibold transition-colors relative ${activeMetaTab === 'corpus' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Corpus Metadata
              {activeMetaTab === 'corpus' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600"></div>}
            </button>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Clone Metadata Controls */}
            {activeMetaTab === 'document' && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 font-medium">Clone from:</span>
                <select
                  className="border border-slate-300 rounded-md p-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm max-w-[200px]"
                  value={selectedCloneDocId}
                  onChange={(e) => setSelectedCloneDocId(e.target.value)}
                >
                  <option value="">-- Select Document --</option>
                  {allDocuments
                    .filter(d => d.id !== docId) // Don't list the currently open document
                    .sort((a, b) => `${a.corpus}/${a.docname}`.localeCompare(`${b.corpus}/${b.docname}`))
                    .map(d => (
                      <option key={d.id} value={d.id}>{d.corpus}/{d.docname}</option>
                    ))
                  }
                </select>
                <button
                  onClick={handleCloneMetadata}
                  disabled={!selectedCloneDocId}
                  className="flex items-center gap-1 px-2 py-1 bg-white border border-slate-300 rounded-md shadow-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 font-medium transition-colors"
                  title="Clone missing metadata keys from the selected document"
                >
                  <Copy size={14} /> Clone
                </button>
              </div>
            )}
            
            <button onClick={openAddMetaModal} className="text-indigo-600 hover:text-indigo-800 text-xs flex items-center gap-1 font-medium bg-indigo-50 px-2 py-1 rounded transition-colors">
              <Plus size={14} /> Add Entry
            </button>
          </div>
        </div>
        
        {currentMetadataArray.length === 0 ? (
          <div className="text-xs text-slate-500 italic p-4 text-center bg-slate-50 rounded border border-dashed border-slate-200">
            No {activeMetaTab} metadata keys attached.
          </div>
        ) : (
          <div className="border border-slate-200 rounded-md overflow-hidden bg-white">
            <table className="w-full text-left text-sm bg-white">
              <thead className={`border-b border-slate-200 ${tableHeaderStyle ? '' : 'bg-slate-100'}`} style={tableHeaderStyle}>
                <tr>
                  <th className="p-2 font-medium text-slate-700 w-1/3">Key</th>
                  <th className="p-2 font-medium text-slate-700">Value</th>
                  <th className="p-2 font-medium text-slate-700 text-right w-16">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentMetadataArray.map((item) => (
                  <tr
                    key={item.k}
                    className={`${metadataViolationKeySet.has(item.k)
                      ? 'bg-amber-100 hover:bg-amber-100'
                      : 'hover:bg-indigo-50/50'} transition-colors`}
                  >
                    <td className="p-2 font-semibold text-slate-700 truncate max-w-[150px]" title={item.k}>{item.k}</td>
                    <td className="p-2 text-slate-600 truncate max-w-[250px]" title={item.v}>{item.v}</td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openEditMetaModal(item.k, item.v)} className="text-blue-500 hover:text-blue-700 p-1" title="Edit">
                          <Edit size={14} />
                        </button>
                        <button onClick={() => handleRemoveMeta(item.k)} className="text-red-500 hover:text-red-700 p-1" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Metadata Add/Edit Modal */}
      {metaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-xl w-96 max-w-full m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-800">
                {metaForm.originalKey ? `Edit ${activeMetaTab === 'document' ? 'Doc' : 'Corpus'} Meta` : `Add ${activeMetaTab === 'document' ? 'Doc' : 'Corpus'} Meta`}
              </h3>
              <button onClick={() => setMetaModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleModalSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Key</label>
                <input 
                  required 
                  className="w-full border border-slate-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  placeholder="e.g. author"
                  value={metaForm.k} 
                  onChange={e => setMetaForm({...metaForm, k: e.target.value})} 
                  list="meta-key-suggestions"
                />
                <datalist id="meta-key-suggestions">
                  {uniqueMetaKeys.map(key => (
                    <option key={key} value={key} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Value</label>
                <input 
                  required 
                  className="w-full border border-slate-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  placeholder="Enter value..."
                  value={metaForm.v} 
                  onChange={e => setMetaForm({...metaForm, v: e.target.value})} 
                />
              </div>
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={() => setMetaModalOpen(false)} 
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-md"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-md shadow-sm"
                >
                  OK
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* XML Tag Insertion Modal */}
      {xmlTagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-xl w-96 max-w-full m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-800">Wrap with XML Tag</h3>
              <button onClick={() => setXmlTagModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleInsertXmlTag} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tag Name</label>
                <input 
                  required 
                  autoFocus
                  className="w-full border border-slate-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  placeholder="e.g. hi"
                  value={xmlTagForm.tag} 
                  onChange={e => setXmlTagForm({...xmlTagForm, tag: e.target.value})} 
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Attribute <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input 
                    className="w-full border border-slate-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    placeholder="e.g. rend"
                    value={xmlTagForm.attr} 
                    onChange={e => setXmlTagForm({...xmlTagForm, attr: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Value <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input 
                    className="w-full border border-slate-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    placeholder="e.g. italic"
                    value={xmlTagForm.val} 
                    onChange={e => setXmlTagForm({...xmlTagForm, val: e.target.value})} 
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={() => setXmlTagModalOpen(false)} 
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-md"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={!xmlTagForm.tag.trim()}
                  className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-md shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  OK
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Concurrent Edit Conflict Modal */}
      {wakeSyncNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-xl w-[500px] max-w-full m-4 border border-sky-300">
            <div className="flex items-center gap-3 mb-4 text-sky-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
              <h3 className="text-lg font-bold text-slate-800">Document Refreshed</h3>
            </div>

            <p className="text-sm text-slate-600 mb-6">
              Refreshing view with latest changes (last edited by <strong>{wakeSyncNotice.user}</strong> at <strong>{wakeSyncNotice.formattedTime}</strong>).
            </p>

            <div className="flex justify-end">
              <button
                onClick={() => setWakeSyncNotice(null)}
                className="px-4 py-2 text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 rounded-md shadow-sm transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {conflictData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-xl w-[500px] max-w-full m-4 border-2 border-amber-400">
            <div className="flex items-center gap-3 mb-4 text-amber-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              <h3 className="text-lg font-bold text-slate-800">Document Modified</h3>
            </div>
            
            <p className="text-sm text-slate-600 mb-4">
              <strong>{conflictData.user}</strong> saved changes to this document at <strong>{conflictData.formattedTime}</strong>, before your last edit. 
            </p>
            <p className="text-sm text-slate-600 mb-6">
              To prevent data loss, your background saves have been paused. What would you like to do?
            </p>

            <div className="flex flex-col gap-3">
              <button 
                onClick={handleConflictReload} 
                className="w-full px-4 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 rounded-md shadow-sm transition-colors"
              >
                Reload Document (Discard my changes since {conflictData.formattedTime})
              </button>
              
              <button 
                onClick={handleConflictOverwrite} 
                className="w-full px-4 py-2 text-sm font-medium bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 rounded-md shadow-sm transition-colors"
              >
                Overwrite their changes with my current version
              </button>

              {doc?.mode === 'xml' && (
                <button 
                  onClick={handleCopyToClipboard} 
                  className="w-full px-4 py-2 text-sm font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md shadow-sm transition-colors mt-2"
                >
                  <Copy size={16} className="inline mr-2 -mt-0.5" />
                  Copy my XML to clipboard (Decide later)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
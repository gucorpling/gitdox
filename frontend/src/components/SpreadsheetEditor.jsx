import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import createSpreadsheetCore from './spreadsheet/core';
import './spreadsheet/spreadsheet.css';

const CELL_REF_PATTERN = /^[A-Z]+\d+$/;

function getSpreadsheetValidationCellRefs(validation) {
  const results = Array.isArray(validation?.results) ? validation.results : [];
  const cellRefs = [];

  results.forEach((result) => {
    if (!Array.isArray(result?.violations) || result.violations.length === 0) return;

    const normalizedViolations = result.violations
      .map((value) => (typeof value === 'string' ? value.trim().toUpperCase() : ''))
      .filter((value) => CELL_REF_PATTERN.test(value));

    if (normalizedViolations.length === 0) return;
    cellRefs.push(...normalizedViolations);
  });

  return [...new Set(cellRefs)].sort();
}

function getSpreadsheetValidationSignature(validation) {
  return getSpreadsheetValidationCellRefs(validation).join('|');
}

const SpreadsheetEditor = forwardRef(function SpreadsheetEditor({ 
  value = '', 
  validation = null, 
  canDataTransfer = true,
  allowExternalClipboard = true,
  onChange, 
  onCanonicalized,
  onImportResult, 
  onImportSgml,
  docId = null, 
  apiCall = null, 
  className = '', 
  fontFamily = null,
  preferredColumnOrder = [], 
}, ref) {
  const coreRef = useRef(null);
  const lastKnownValueRef = useRef(value || '');
  const suppressExternalChangeRef = useRef(false);
  const highlightedValidationCellsRef = useRef([]);
  const highlightedValidationSignatureRef = useRef('');
  const [coreReady, setCoreReady] = useState(false);
  const isPreferredColumnOrderResolved = preferredColumnOrder !== null;
  
  const activeFormulaStateRef = useRef(null);

  const captureFormulaFocus = () => {
    const activeEl = document.activeElement;
    if (activeEl && activeEl.id === 'spreadsheet-formula-input') {
      activeFormulaStateRef.current = { start: activeEl.selectionStart, end: activeEl.selectionEnd };
    } else {
      activeFormulaStateRef.current = null;
    }
  };

  const restoreFormulaFocus = () => {
    if (!activeFormulaStateRef.current) return;
    // Double rAF ensures we execute AFTER React commits and AFTER the spreadsheet's internal microtasks finish
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const formulaInput = document.getElementById('spreadsheet-formula-input');
        if (formulaInput && document.activeElement !== formulaInput) {
          formulaInput.focus();
          try { 
            formulaInput.setSelectionRange(
              activeFormulaStateRef.current.start, 
              activeFormulaStateRef.current.end
            ); 
          } catch(e) {
            console.warn('Error restoring formula input selection range:', e);
          }
        }
      });
    });
  };

  const rootStyle = fontFamily ? { '--spreadsheet-editor-font-family': fontFamily } : undefined;

  useImperativeHandle(ref, () => ({
    getSerializedValue: () => coreRef.current?.getSerializedValue?.() ?? '',
    focusCell: (cellRef) => coreRef.current?.focusCell?.(cellRef) ?? false,
  }), []);

  useEffect(() => {
    if (!isPreferredColumnOrderResolved) return;

    const onFetchSgml = (docId && apiCall)
      ? (configName = null) => {
        const query = configName ? `?config=${encodeURIComponent(configName)}` : '';
        return apiCall(`/documents/${docId}/sgml${query}`);
      }
      : null;
    const onFetchConfigs = apiCall
      ? () => apiCall('/configs')
      : null;

    coreRef.current = createSpreadsheetCore({
      initialValue: value || '',
      fontFamily,
      preferredColumnOrder,
      allowDataTransfer: Boolean(canDataTransfer),
      allowExternalClipboard: Boolean(allowExternalClipboard),
      onChange: (nextValue) => {
        if (suppressExternalChangeRef.current) {
          return;
        }
        captureFormulaFocus();        
        lastKnownValueRef.current = nextValue;
        if (onChange) onChange(nextValue);
        
        restoreFormulaFocus();
      },
      onCanonicalized,
      onFetchSgml,
      onFetchConfigs,
      onImportSgml,
      onImportResult,
    });
    setCoreReady(true);

    return () => {
      setCoreReady(false);
      if (coreRef.current) {
        coreRef.current.destroy();
        coreRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreferredColumnOrderResolved, canDataTransfer, allowExternalClipboard]);

  useEffect(() => {
    if (!coreRef.current || !coreReady || !Array.isArray(preferredColumnOrder)) return;
    if (typeof coreRef.current.setPreferredColumnOrder === 'function') {
      coreRef.current.setPreferredColumnOrder(preferredColumnOrder);
    }
  }, [preferredColumnOrder, coreReady]);

  useEffect(() => {
    if (!coreRef.current || !coreReady) return;
    coreRef.current.setFontFamily?.(fontFamily || null);
  }, [fontFamily]);

  useEffect(() => {
    const nextValue = value || '';
    if (!coreRef.current) return;
    // Normalize strings to prevent trivial line-ending changes from the parent 
    // from causing a complete grid destruction loop.
    const normalize = (str) => typeof str === 'string' ? str.replace(/\r\n/g, '\n').trim() : '';
    if (normalize(nextValue) === normalize(lastKnownValueRef.current)) {
      lastKnownValueRef.current = nextValue; // Sync the ref to prevent future mismatch
      return;
    }
    // When an external value change forces a reload, trap focus for formula bar
    captureFormulaFocus();

    coreRef.current.setValue(nextValue);
    lastKnownValueRef.current = nextValue;

    restoreFormulaFocus();
  }, [value]);

useEffect(() => {
    if (!coreRef.current) return;

    // Protect against parent component wiping state during fetch
    if (!validation) return; 

    const nextHighlightedCells = getSpreadsheetValidationCellRefs(validation);
    const nextHighlightedSignature = getSpreadsheetValidationSignature(validation);
    if (nextHighlightedSignature === highlightedValidationSignatureRef.current) return;

    suppressExternalChangeRef.current = true;

    // A validation update triggered by typing mutates the grid, trap focus
    captureFormulaFocus();

    try {
      if (coreRef.current.syncValidationHighlights) {
        // Handles clearing, highlighting, and rogue pastes
        coreRef.current.syncValidationHighlights(nextHighlightedCells, '#fef3c7');
      }

      highlightedValidationCellsRef.current = nextHighlightedCells;
      highlightedValidationSignatureRef.current = nextHighlightedSignature;
    } finally {
      suppressExternalChangeRef.current = false;
      restoreFormulaFocus();
    }
  }, [validation, coreReady]);

  return (
    <div id="spreadsheet-editor-root" style={rootStyle} className={`w-full h-full relative bg-white flex flex-col min-h-0 ${className}`.trim()}>
      <div id="custom-toolbar-host" className="px-3 py-2 border-b border-gray-200 bg-white" />

      <div id="spreadsheet-formula-host" className="spreadsheet-formula-host">
        <span className="spreadsheet-formula-label" aria-hidden="true">fx</span>
        <textarea
          id="spreadsheet-formula-input"
          className="spreadsheet-formula-input"
          rows={1}
          spellCheck="false"
          placeholder="Cell contents"
          aria-label="Selected cell contents"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div id="spreadsheet-container" className="absolute inset-0" style={{ overscrollBehavior: 'none' }}/>
      </div>

      <div id="find-replace-dialog" className="hidden fixed top-24 right-6 z-50 bg-white border border-gray-300 rounded-lg shadow-xl" style={{ width: 320 }}>
        <div className="flex items-center justify-between px-4 py-2 bg-gray-100 rounded-t-lg border-b border-gray-200 cursor-move select-none">
          <span className="font-semibold text-gray-700 text-sm">Find & Replace</span>
          <button id="find-close-btn" className="text-gray-400 hover:text-gray-700 text-lg leading-none" type="button">&times;</button>
        </div>
        <div className="p-3 flex flex-col gap-2">
          <div className="flex gap-1 items-center">
            <input id="find-input" type="text" placeholder="Find..." autoComplete="off" className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <button id="find-prev-btn" type="button" title="Previous (Shift+Enter)" className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300">▲</button>
            <button id="find-next-btn" type="button" title="Next (Enter)" className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300">▼</button>
          </div>
          <div className="flex gap-1 items-center">
            <input id="replace-input" type="text" placeholder="Replace with..." autoComplete="off" className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <button id="find-replace-one-btn" type="button" className="px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 rounded border border-blue-300 text-blue-700">Replace</button>
            <button id="find-replace-all-btn" type="button" className="px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 rounded border border-blue-300 text-blue-700">All</button>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <label className="flex items-center gap-1 cursor-pointer">
              <input id="find-case-sensitive" type="checkbox" />
              Case-sensitive
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input id="find-use-regex" type="checkbox" />
              Regex
            </label>
            <span id="find-match-info" className="ml-auto font-mono" />
          </div>
        </div>
      </div>

      <div id="data-modal" className="fixed inset-0 bg-black/50 z-50 hidden flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl flex flex-col h-[85vh]">
          <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
            <h2 id="modal-title" className="font-bold text-lg text-gray-800">Transfer Data</h2>
            <button id="data-modal-close-btn" className="text-gray-500 hover:text-gray-700 transition-colors" type="button">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <div className="p-4 flex-1 flex flex-col min-h-0">
            <p id="modal-desc" className="text-sm text-gray-600 mb-3" />
            <div id="modal-format-row" className="hidden items-center gap-2 mb-3">
              <label htmlFor="export-format-select" className="text-sm text-gray-600 shrink-0">Format:</label>
              <select id="export-format-select" className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="sgml">SGML</option>
                <option value="socialcalc">SocialCalc</option>
              </select>
            </div>
            <div id="modal-config-row" className="hidden items-center gap-2 mb-3">
              <label htmlFor="export-config-select" className="text-sm text-gray-600 shrink-0">Schema:</label>
              <select id="export-config-select" className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <textarea id="modal-textarea" className="w-full flex-1 p-4 bg-gray-50 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs whitespace-pre resize-none shadow-inner" spellCheck="false" />
          </div>
          <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 rounded-b-lg">
            <button id="data-modal-cancel-btn" type="button" className="px-5 py-2 text-gray-600 font-medium hover:bg-gray-200 rounded transition-colors">Cancel</button>
            <button id="data-modal-action-btn" type="button" className="px-5 py-2 bg-blue-600 font-medium text-white rounded hover:bg-blue-700 transition shadow-sm">Execute</button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default SpreadsheetEditor;
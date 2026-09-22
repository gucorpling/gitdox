// UI layer: import/export modal, custom toolbar (buttons + SVG icons), find & replace
// dialog, and the formula bar. Talks back to core.js exclusively through the host object
// configured via configureUiHost()
import { parseMergeEntry, xyToCoord } from './utils.js';
import { scheduleRestoreFocus, jumpSelectionTo } from './viewport.js';
import { performUndo, performRedo, saveHistoryState } from './history.js';

// --- HOST BINDING (bridges to core.js's live spreadsheet instance & selection/mutation helpers) ---
let host = null;

export function configureUiHost(nextHost) {
    host = nextHost;
}

const SOCIALCALC_SIGNATURE = '--SocialCalcSpreadsheetControlSave';
const BG_COLOR_OPTIONS = ['#ffffff', '#efc990', '#fee2e2', '#dcfce7', '#dbeafe', '#ede9fe', '#fce7f3', '#e5e7eb'];

// --- MODAL LOGIC ---
let modalMode = ''; // 'import' or 'export'
let exportConfigNames = [];
let exportConfigsLoaded = false;

export function resetExportConfigsCache() {
    exportConfigNames = [];
    exportConfigsLoaded = false;
}

export function openModal(mode) {
    if (!host.isDataTransferAllowed() && (mode === 'import' || mode === 'export')) {
        return;
    }

    modalMode = mode;
    const modal = document.getElementById('data-modal');
    const title = document.getElementById('modal-title');
    const desc = document.getElementById('modal-desc');
    const textarea = document.getElementById('modal-textarea');
    const actionBtn = document.getElementById('data-modal-action-btn');
    const formatRow = document.getElementById('modal-format-row');
    const formatSelect = document.getElementById('export-format-select');
    const configRow = document.getElementById('modal-config-row');
    
    modal.classList.remove('hidden');
    
    if (mode === 'import') {
        title.textContent = 'Import Data';
        desc.textContent = 'Paste SocialCalc or SGML data. SocialCalc is loaded directly; SGML is imported by the backend and then refreshed as SocialCalc.';
        actionBtn.textContent = 'Load Data';
        actionBtn.className = 'px-5 py-2 bg-blue-600 font-medium text-white rounded hover:bg-blue-700 transition shadow-sm';
        textarea.value = '';
        textarea.readOnly = false;
        if (formatRow) {
            formatRow.classList.add('hidden');
            formatRow.style.display = 'none';
        }
        if (configRow) {
            configRow.classList.add('hidden');
            configRow.style.display = 'none';
        }
        setTimeout(() => textarea.focus(), 50);
    } else {
        title.textContent = 'Export Data';
        desc.textContent = 'Select your format below to export your annotations.';
        actionBtn.textContent = 'Copy to Clipboard';
        actionBtn.className = 'px-5 py-2 bg-green-600 font-medium text-white rounded hover:bg-green-700 transition shadow-sm';
        if (formatRow) {
            formatRow.classList.remove('hidden');
            formatRow.style.display = 'flex';
        }
        if (configRow) {
            configRow.classList.add('hidden');
            configRow.style.display = 'none';
        }
        if (formatSelect) {
            formatSelect.value = 'sgml';
            handleExportFormatChange();
        } else {
            textarea.value = host.exportSocialCalc();
        }
        textarea.readOnly = true;
        setTimeout(() => textarea.select(), 50);
    }
}

export async function handleExportFormatChange() {
    const formatSelect = document.getElementById('export-format-select');
    const configRow = document.getElementById('modal-config-row');
    const configSelect = document.getElementById('export-config-select');
    const textarea = document.getElementById('modal-textarea');
    const actionBtn = document.getElementById('data-modal-action-btn');
    if (!formatSelect || !textarea) return;

    const format = formatSelect.value;
    
    if (actionBtn) {
        actionBtn.textContent = format === 'xlsx' ? 'Download Excel' : 'Copy to Clipboard';
    }

    if (format === 'sgml') {
        if (configRow) {
            configRow.classList.remove('hidden');
            configRow.style.display = 'flex';
        }

        await ensureExportConfigsLoaded();
        if (!configSelect || !configSelect.value) {
            textarea.value = '(No SGML schemas are available.)';
            return;
        }

        const onFetchSgml = host.getOnFetchSgml();
        if (!onFetchSgml) {
            textarea.value = '(SGML export is not available - document ID is unknown.)';
            return;
        }
        textarea.value = 'Loading...';
        try {
            const result = await onFetchSgml(configSelect.value);
            if (typeof result === 'string') {
                textarea.value = result;
            } else if (result && typeof result === 'object') {
                textarea.value = result.sgml ?? result.content ?? result.data ?? result.text ?? JSON.stringify(result, null, 2);
            } else {
                textarea.value = String(result ?? '');
            }
        } catch (err) {
            textarea.value = `Error fetching SGML: ${err.message}`;
        }
    } else if (format === 'xlsx') {
        if (configRow) {
            configRow.classList.add('hidden');
            configRow.style.display = 'none';
        }
        textarea.value = 'Click the button below to download the Excel (.xlsx) file.';
    } else {
        if (configRow) {
            configRow.classList.add('hidden');
            configRow.style.display = 'none';
        }
        textarea.value = host.exportSocialCalc();
    }
}

async function ensureExportConfigsLoaded() {
    const configSelect = document.getElementById('export-config-select');
    if (!configSelect) return;

    if (exportConfigsLoaded) {
        return;
    }

    const onFetchConfigs = host.getOnFetchConfigs();
    if (!onFetchConfigs) {
        exportConfigsLoaded = true;
        exportConfigNames = [];
        renderExportConfigOptions(configSelect, exportConfigNames);
        return;
    }

    try {
        const result = await onFetchConfigs();
        const nextConfigs = Array.isArray(result?.configs) ? result.configs : [];
        exportConfigNames = nextConfigs
            .filter((name) => typeof name === 'string' && name.trim())
            .map((name) => name.trim());
    } catch (err) {
        console.warn("Error fetching export configs:", err);
        exportConfigNames = [];
    }

    exportConfigsLoaded = true;
    renderExportConfigOptions(configSelect, exportConfigNames);
}

function renderExportConfigOptions(selectEl, configNames) {
    if (!selectEl) return;
    const previousValue = selectEl.value;

    selectEl.innerHTML = '';
    if (!Array.isArray(configNames) || configNames.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No schemas available';
        selectEl.appendChild(opt);
        return;
    }

    configNames.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        selectEl.appendChild(opt);
    });

    if (previousValue && configNames.includes(previousValue)) {
        selectEl.value = previousValue;
    }
}

export function closeModal() {
    document.getElementById('data-modal').classList.add('hidden');
    scheduleRestoreFocus();
}

export async function executeModalAction() {
    if (!host.isDataTransferAllowed() && (modalMode === 'import' || modalMode === 'export')) {
        return;
    }

    if (modalMode === 'import') {
        const textarea = document.getElementById('modal-textarea');
        const rawData = textarea ? textarea.value : '';
        if (!rawData.trim()) {
            return;
        }

        const isSocialCalcImport = rawData.includes(SOCIALCALC_SIGNATURE);
        if (isSocialCalcImport) {
            host.importSocialCalc(rawData);
            closeModal();
            return;
        }

        const onImportSgml = host.getOnImportSgml();
        if (!onImportSgml) {
            if (textarea) {
                textarea.value = '(SGML import is not available - document ID is unknown.)';
            }
            return;
        }

        const actionBtn = document.getElementById('data-modal-action-btn');
        const originalLabel = actionBtn ? actionBtn.textContent : 'Load Data';
        if (actionBtn) {
            actionBtn.disabled = true;
            actionBtn.textContent = 'Importing...';
        }

        try {
            const importResponse = await onImportSgml(rawData);
            const onImportResult = host.getOnImportResult();
            if (importResponse && typeof importResponse === 'object' && typeof onImportResult === 'function') {
                onImportResult(importResponse);
            }

            const refreshedSocialCalc = typeof importResponse === 'string'
                ? importResponse
                : importResponse?.content_spreadsheet ?? importResponse?.contents ?? '';

            if (typeof refreshedSocialCalc === 'string' && refreshedSocialCalc.trim()) {
                host.importSocialCalc(refreshedSocialCalc);
                closeModal();
            } else if (textarea) {
                textarea.value = 'SGML import succeeded but no SocialCalc content was returned from the backend.';
            }
        } catch (err) {
            if (textarea) {
                textarea.value = `Error importing SGML: ${err.message}`;
            }
        } finally {
            if (actionBtn) {
                actionBtn.disabled = false;
                actionBtn.textContent = originalLabel;
            }
        }
    } else {
        const formatSelect = document.getElementById('export-format-select');
        const format = formatSelect ? formatSelect.value : '';

        if (format === 'xlsx') {
            const onFetchXlsx = host.getOnFetchXlsx && host.getOnFetchXlsx();
            if (!onFetchXlsx) {
                alert('Excel export function is not bound to the host.');
                return;
            }

            const actionBtn = document.getElementById('data-modal-action-btn');
            const originalLabel = actionBtn ? actionBtn.textContent : 'Download Excel';
            
            if (actionBtn) {
                actionBtn.disabled = true;
                actionBtn.textContent = 'Downloading...';
            }

            try {
                await onFetchXlsx();
                closeModal();
            } catch (err) {
                console.error("Error exporting XLSX:", err);
                alert(`Export failed: ${err.message}`);
            } finally {
                if (actionBtn) {
                    actionBtn.disabled = false;
                    actionBtn.textContent = originalLabel;
                }
            }
        } else {
            const textarea = document.getElementById('modal-textarea');
            textarea.select();
            document.execCommand('copy');
            const btn = document.getElementById('data-modal-action-btn');
            const origText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = origText; }, 2000);
        }
    }
}

// --- FORMULA BAR ---
export function syncFormulaBarFromSelection(options = {}) {
    const force = !!options.force;
    const formulaInput = document.getElementById('spreadsheet-formula-input');
    if (!formulaInput) return;
    const mySpreadsheet = host.getSpreadsheet();
    if (!mySpreadsheet) {
        formulaInput.value = '';
        return;
    }
    if (!force && document.activeElement === formulaInput) return;

    const { ri, ci } = host.getTopLeftSelectionPosition();
    const data = mySpreadsheet.getData()[0] || {};
    const nextValue = host.getCellTextFromData(data, ri, ci);
    if (formulaInput.value !== nextValue) {
        formulaInput.value = nextValue;
    }
}

export function updateTopLeftSelectedCellFromFormulaBar(nextValue) {
    const mySpreadsheet = host.getSpreadsheet();
    if (!mySpreadsheet || !mySpreadsheet.sheet) return;
    const textValue = typeof nextValue === 'string' ? nextValue : '';
    const { ri, ci } = host.getTopLeftSelectionPosition();

    // Bypass applyDataMutation's loadData() and mutate the active object reference in-place
    const data = mySpreadsheet.getData()[0];
    
    if (!data.rows) data.rows = { len: 100 };
    if (!data.rows[ri]) data.rows[ri] = { cells: {} };
    if (!data.rows[ri].cells) data.rows[ri].cells = {};

    const existingCell = data.rows[ri].cells[ci] ? { ...data.rows[ri].cells[ci] } : {};
    if (textValue === '') {
        delete existingCell.text;
        if (Object.keys(existingCell).length === 0) {
            delete data.rows[ri].cells[ci];
        }
    } else {
        existingCell.text = textValue;
        data.rows[ri].cells[ci] = existingCell;
    }

    data.rows.len = Math.max(Number.isInteger(data.rows.len) ? data.rows.len : 100, ri + 1);

    // Redraw the canvas. This prevents x-data-spreadsheet from resetting its UI layer and firing the delayed timeouts that steal focus
    const sheet = mySpreadsheet.sheet;
    if (typeof sheet.render === 'function') {
        sheet.render();
    } else if (sheet.table && typeof sheet.table.render === 'function') {
        sheet.table.render();
    }

    // Manually push to history and notify React
    saveHistoryState();
    host.notifySerializedChange();
}

export function handleFormulaBarInput(event) {
    updateTopLeftSelectedCellFromFormulaBar(event.target.value);
} 

export function handleFormulaBarFocus() {
    syncFormulaBarFromSelection({ force: true });
}

export function handleFormulaBarMouseDown(event) {
    event.stopPropagation();
}

export function handleFormulaBarClick(event) {
    event.stopPropagation();
}

export function handleFormulaBarClipboard(event) {
    event.stopPropagation();
}

export function handleFormulaBarKeydown(event) {
    // Add stopPropagation to prevent the spreadsheet engine from catching Ctrl+C / Ctrl+X
    event.stopPropagation(); 
    
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        scheduleRestoreFocus();
    }
}

// --- TOOLBAR ISOLATION LOGIC ---
export function customizeToolbar() {
    const toolbarHost = document.getElementById('custom-toolbar-host');
    if (!toolbarHost) return;
    
    if (!toolbarHost._focusPatched) {
        toolbarHost.addEventListener('mousedown', (e) => {
            if (e.target.tagName !== 'INPUT') e.preventDefault();
        }, true);
        toolbarHost._focusPatched = true;
    }

    if (toolbarHost.querySelector('.custom-toolbar-group')) return;

    const customGroup = document.createElement('div');
    customGroup.className = 'custom-toolbar-group';
    customGroup.style.display = 'flex';
    customGroup.style.alignItems = 'center';
    customGroup.style.flexWrap = 'wrap';
    customGroup.style.gap = '2px';

    const createSvgBtn = (svgHTML, tooltip, onClick, options = {}) => {
        const btn = document.createElement('div');
        btn.className = 'custom-btn';
        btn.title = tooltip; 
        btn.innerHTML = svgHTML;
        btn.addEventListener('mousedown', (e) => {
            btn._selectionSnapshot = host.getActiveSelectionRange();
            host.setToolbarSelectionSnapshot(btn._selectionSnapshot);
            e.preventDefault();
        });
        btn.onclick = () => {
            const selectionSnapshot = btn._selectionSnapshot || host.getActiveSelectionRange();
            host.setToolbarSelectionSnapshot(selectionSnapshot);
            onClick();
            if (!options.skipPostSelectionRestore) {
                host.restoreSelectorRange(selectionSnapshot);
                scheduleRestoreFocus(selectionSnapshot);
            }
            setTimeout(() => {
                if (host.getToolbarSelectionSnapshot() === selectionSnapshot) {
                    host.setToolbarSelectionSnapshot(null);
                }
            }, 100);
        };
        customGroup.appendChild(btn);
        return btn;
    };

    const createBgColorDropdown = () => {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-color-dropdown';

        const trigger = document.createElement('div');
        trigger.className = 'custom-btn';
        trigger.title = 'Background Color';
        const defaultColor = BG_COLOR_OPTIONS[0];
        trigger.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M6 16l6-12 6 12"/></svg><span class="custom-color-indicator" style="background:${defaultColor}"></span>`;
        trigger.addEventListener('mousedown', (e) => {
            wrapper._selectionSnapshot = host.getActiveSelectionRange();
            host.setToolbarSelectionSnapshot(wrapper._selectionSnapshot);
            e.preventDefault();
        });

        const menu = document.createElement('div');
        menu.className = 'custom-color-menu';

        BG_COLOR_OPTIONS.forEach((hexColor) => {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'custom-color-swatch';
            swatch.title = hexColor;
            swatch.style.background = hexColor;
            swatch.addEventListener('mousedown', (e) => {
                host.setToolbarSelectionSnapshot(wrapper._selectionSnapshot || host.getActiveSelectionRange());
                e.preventDefault();
            });
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                const selectionSnapshot = wrapper._selectionSnapshot || host.getActiveSelectionRange();
                host.setToolbarSelectionSnapshot(selectionSnapshot);
                host.applyBackgroundColorToSelection(hexColor);
                const indicator = trigger.querySelector('.custom-color-indicator');
                if (indicator) indicator.style.background = hexColor;
                menu.classList.remove('open');
                host.restoreSelectorRange(selectionSnapshot);
                scheduleRestoreFocus(selectionSnapshot);
                setTimeout(() => {
                    host.setToolbarSelectionSnapshot(null);
                }, 100);
            });
            menu.appendChild(swatch);
        });

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('open');
            const selectionSnapshot = wrapper._selectionSnapshot || host.getActiveSelectionRange();
            host.setToolbarSelectionSnapshot(selectionSnapshot);
            host.restoreSelectorRange(selectionSnapshot);
            scheduleRestoreFocus(selectionSnapshot);
            setTimeout(() => {
                if (host.getToolbarSelectionSnapshot() === selectionSnapshot) {
                    host.setToolbarSelectionSnapshot(null);
                }
            }, 100);
        });

        if (!document._bgColorMenuBound) {
            document.addEventListener('click', () => {
                document.querySelectorAll('.custom-color-menu.open').forEach((openMenu) => {
                    openMenu.classList.remove('open');
                });
            });
            document._bgColorMenuBound = true;
        }

        wrapper.appendChild(trigger);
        wrapper.appendChild(menu);
        customGroup.appendChild(wrapper);
    };

    // --- Custom SVG Icons ---
    // Import: Document with arrow pointing IN
    const iconImport = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><polyline points="9 15 12 18 15 15"></polyline></svg>`;
    // Export: Document with arrow pointing OUT
    const iconExport = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><polyline points="9 15 12 12 15 15"></polyline></svg>`;

    const iconUndo = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`;
    const iconRedo = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>`;
    const iconBold = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><text x="7" y="18" fill="#4b5563" font-size="17" font-family="Arial, sans-serif" font-weight="900">B</text></svg>`;
    const iconMerge = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="7" height="6"/><rect x="14" y="5" width="7" height="6"/><rect x="3" y="13" width="18" height="6" fill="#facc15"/><path d="M10 8h4"/><path d="M12 8v5"/></svg>`;
    const iconJoin = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="7" height="6" fill="#facc15"/><rect x="14" y="5" width="7" height="6" fill="#facc15"/><rect x="3" y="13" width="18" height="6" fill="#facc15"/><path d="M10 8h4"/><path d="M12 8v5"/></svg>`;
    const iconMergeDown = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="6"/><rect x="9" y="15" width="6" height="6" fill="#facc15"/><path d="M12 9v5"/><path d="M9.5 12.5 12 15l2.5-2.5"/></svg>`;
    const iconFreeze = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><rect x="3" y="3" width="18" height="6" fill="#cbd5e1" stroke="none"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/></svg>`;
    
    // Red Delete Icons
    const iconDelRow = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><rect x="3" y="9" width="18" height="6" fill="#ef4444" stroke="none"/></svg>`;
    const iconDelCol = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><rect x="9" y="3" width="6" height="18" fill="#ef4444" stroke="none"/></svg>`;
    
    // Green Insert Icons with Plus Overlay
    const iconAddRow = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2"><rect x="4" y="4" width="18" height="18" rx="2" ry="2"/><line x1="4" y1="10" x2="22" y2="10"/><line x1="4" y1="16" x2="22" y2="16"/><rect x="4" y="10" width="18" height="6" fill="#22c55e" stroke="none"/><circle cx="4" cy="4" r="5" fill="#22c55e" stroke="none"/><line x1="4" y1="2" x2="4" y2="6" stroke="white" stroke-width="2"/><line x1="2" y1="4" x2="6" y2="4" stroke="white" stroke-width="2"/></svg>`;
    const iconAddCol = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2"><rect x="4" y="4" width="18" height="18" rx="2" ry="2"/><line x1="10" y1="4" x2="10" y2="22"/><line x1="16" y1="4" x2="16" y2="22"/><rect x="10" y="4" width="6" height="18" fill="#22c55e" stroke="none"/><circle cx="4" cy="4" r="5" fill="#22c55e" stroke="none"/><line x1="4" y1="2" x2="4" y2="6" stroke="white" stroke-width="2"/><line x1="2" y1="4" x2="6" y2="4" stroke="white" stroke-width="2"/></svg>`;

    // Modal triggers
    if (host.isDataTransferAllowed()) {
        createSvgBtn(iconImport, 'Import Data', () => openModal('import'));
        createSvgBtn(iconExport, 'Export Data', () => openModal('export'));
    }

    const divider0 = document.createElement('div');
    divider0.className = 'x-spreadsheet-toolbar-divider';
    divider0.style.display = 'inline-block';
    customGroup.appendChild(divider0);

    createSvgBtn(iconUndo, 'Undo (Ctrl+Z)', performUndo);
    createSvgBtn(iconRedo, 'Redo (Ctrl+Y)', performRedo);
    createSvgBtn(iconBold, 'Bold (Ctrl+B)', () => host.toggleBoldForSelection());
    createSvgBtn(iconMerge, 'Merge (Ctrl+M)', () => host.mergeSelectionSafely(), { skipPostSelectionRestore: true });
    createSvgBtn(iconJoin, 'Join Contents (Ctrl+J)', () => host.joinSelectionContentsSafely(), { skipPostSelectionRestore: true });
    createSvgBtn(iconMergeDown, 'Merge Down (Ctrl+D)', () => host.mergeDownSelection());

    const divider1 = document.createElement('div');
    divider1.className = 'x-spreadsheet-toolbar-divider';
    divider1.style.display = 'inline-block';
    customGroup.appendChild(divider1);

    const iconSearch = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    createSvgBtn(iconSearch, 'Find & Replace (Ctrl+F)', () => openFindReplace());

    const syncFreezeButtonState = (btn) => {
        const mySpreadsheet = host.getSpreadsheet();
        if (!btn || !mySpreadsheet || typeof mySpreadsheet.getData !== 'function') return;
        const data = mySpreadsheet.getData()[0] || {};
        btn.classList.toggle('custom-btn-active', data.freeze === 'A2');
    };

    const freezeBtn = createSvgBtn(iconFreeze, 'Toggle Freeze Header', () => { 
        host.executeStateChange((d) => {
            if (d.freeze === 'A2') delete d.freeze;
            else d.freeze = 'A2'; 
        });
        syncFreezeButtonState(freezeBtn);
    });
    syncFreezeButtonState(freezeBtn);

    createBgColorDropdown();

    const divider2 = document.createElement('div');
    divider2.className = 'x-spreadsheet-toolbar-divider';
    divider2.style.display = 'inline-block';
    customGroup.appendChild(divider2);

    createSvgBtn(iconAddRow, 'Insert Row (Ctrl+L)', () => host.insertRowAtSelection());

    createSvgBtn(iconDelRow, 'Delete Row (Ctrl+K)', () => host.deleteRowAtSelection());

    createSvgBtn(iconAddCol, 'Insert Column', () => { 
        host.executeStateChange((d) => {
            let targetCol = host.getSpreadsheet().sheet.data.selector.ci;
            Object.keys(d.rows).forEach(rStr => {
                if (rStr === 'len') return;
                let row = d.rows[rStr];
                if (row && row.cells) {
                    let newCells = {};
                    Object.keys(row.cells).forEach(cStr => {
                        let c = parseInt(cStr);
                        if (c < targetCol) { newCells[c] = row.cells[c]; } 
                        else if (c >= targetCol) { newCells[c + 1] = row.cells[c]; }
                    });
                    row.cells = newCells;
                }
            });

            let newMerges = [];
            (d.merges || []).forEach(mergeStr => {
                const parsedMerge = parseMergeEntry(mergeStr);
                if (!parsedMerge) {
                    newMerges.push(mergeStr);
                    return;
                }
                let start = { x: parsedMerge.sci, y: parsedMerge.sri };
                let end = { x: parsedMerge.eci, y: parsedMerge.eri };
                if (start.x < targetCol && end.x >= targetCol) {
                    end.x += 1;
                    newMerges.push(`${xyToCoord(start.x, start.y)}:${xyToCoord(end.x, end.y)}`);
                    let row = d.rows[start.y];
                    if (row && row.cells && row.cells[start.x] && row.cells[start.x].merge) {
                        row.cells[start.x].merge[1] += 1;
                    }
                } else if (start.x >= targetCol) {
                    start.x += 1; end.x += 1;
                    newMerges.push(`${xyToCoord(start.x, start.y)}:${xyToCoord(end.x, end.y)}`);
                } else { newMerges.push(mergeStr); }
            });
            d.merges = newMerges;
        });
    });

    createSvgBtn(iconDelCol, 'Delete Column', () => { 
        host.executeStateChange((d) => {
            let targetCol = host.getSpreadsheet().sheet.data.selector.ci;
            Object.keys(d.rows).forEach(rStr => {
                if (rStr === 'len') return;
                let row = d.rows[rStr];
                if (row && row.cells) {
                    let newCells = {};
                    Object.keys(row.cells).forEach(cStr => {
                        let c = parseInt(cStr);
                        if (c < targetCol) { newCells[c] = row.cells[c]; } 
                        else if (c > targetCol) { newCells[c - 1] = row.cells[c]; }
                    });
                    row.cells = newCells;
                }
            });

            let newMerges = [];
            (d.merges || []).forEach(mergeStr => {
                const parsedMerge = parseMergeEntry(mergeStr);
                if (!parsedMerge) {
                    newMerges.push(mergeStr);
                    return;
                }
                let start = { x: parsedMerge.sci, y: parsedMerge.sri };
                let end = { x: parsedMerge.eci, y: parsedMerge.eri };
                if (start.x === targetCol) {
                    // Drops merge
                } else if (start.x < targetCol && end.x >= targetCol) {
                    end.x -= 1;
                    if (end.x > start.x || end.y > start.y) {
                        newMerges.push(`${xyToCoord(start.x, start.y)}:${xyToCoord(end.x, end.y)}`);
                        let row = d.rows[start.y];
                        if (row && row.cells && row.cells[start.x] && row.cells[start.x].merge) {
                            row.cells[start.x].merge[1] -= 1;
                        }
                    } else {
                        let row = d.rows[start.y];
                        if (row && row.cells && row.cells[start.x]) {
                            delete row.cells[start.x].merge;
                        }
                    }
                } else if (start.x > targetCol) {
                    start.x -= 1; end.x -= 1;
                    newMerges.push(`${xyToCoord(start.x, start.y)}:${xyToCoord(end.x, end.y)}`);
                } else { newMerges.push(mergeStr); }
            });
            d.merges = newMerges;
        });
    });

    toolbarHost.appendChild(customGroup);
}

// --- FIND & REPLACE ---
let findMatches = [];
let findMatchIndex = -1;

export function openFindReplace() {
    const dialog = document.getElementById('find-replace-dialog');
    dialog.classList.remove('hidden');

    // Make sure x-data-spreadsheet's global listeners release focus 
    // so they don't intercept input meant for the Find dialog
    const mySpreadsheet = host.getSpreadsheet();
    if (mySpreadsheet && mySpreadsheet.sheet) {
        mySpreadsheet.sheet.focusing = false;
        mySpreadsheet.sheet.isFocus = false;
    }

    const onFindOpen = host.getOnFindOpen();
    onFindOpen?.();
    const input = document.getElementById('find-input');
    input.focus();
    input.select();
    runFindSearch();
}

export function closeFindReplace() {
    document.getElementById('find-replace-dialog').classList.add('hidden');
    findMatches = [];
    findMatchIndex = -1;
    scheduleRestoreFocus();
}

function getAllCellsForSearch() {
    const mySpreadsheet = host.getSpreadsheet();
    if (!mySpreadsheet) return [];
    const data = mySpreadsheet.getData()[0];
    const rows = data.rows || {};
    const cells = [];
    Object.keys(rows).forEach(rStr => {
        if (rStr === 'len') return;
        const y = parseInt(rStr);
        const row = rows[y];
        if (row && row.cells) {
            Object.keys(row.cells).forEach(cStr => {
                const x = parseInt(cStr);
                const cell = row.cells[x];
                if (cell && cell.text !== undefined && cell.text !== null && cell.text !== '') {
                    cells.push({ ri: y, ci: x, text: String(cell.text) });
                }
            });
        }
    });
    cells.sort((a, b) => a.ri !== b.ri ? a.ri - b.ri : a.ci - b.ci);
    return cells;
}

export function buildSearchRegex(query, caseSensitive, useRegex, global = false) {
    const flags = (caseSensitive ? '' : 'i') + (global ? 'g' : '');
    const pattern = useRegex ? query : escapeRegex(query);
    return new RegExp(pattern, flags);
}

export function runFindSearch() {
    const query = document.getElementById('find-input').value;
    const caseSensitive = document.getElementById('find-case-sensitive').checked;
    const useRegex = document.getElementById('find-use-regex').checked;
    const findInput = document.getElementById('find-input');
    
    findMatches = [];
    findMatchIndex = -1;
    const info = document.getElementById('find-match-info');
    if (!query) { 
        info.textContent = ''; 
        findInput.style.borderColor = ''; 
        return; 
    }

    let regex;
    try {
        regex = buildSearchRegex(query, caseSensitive, useRegex);
        findInput.style.borderColor = '';
        findInput.title = '';
    } catch (e) {
        info.textContent = 'Invalid regex';
        info.style.color = '#ef4444';
        findInput.style.borderColor = '#ef4444';
        findInput.title = e.message;
        return;
    }

    getAllCellsForSearch().forEach(({ ri, ci, text }) => {
        if (regex.test(text)) findMatches.push({ ri, ci });
    });
    
    if (findMatches.length === 0) {
        info.textContent = 'No matches';
        info.style.color = '#ef4444';
    } else {
        navigateToMatch(0);
    }
}

export function navigateToMatch(idx) {
    if (findMatches.length === 0) return;
    idx = ((idx % findMatches.length) + findMatches.length) % findMatches.length;
    findMatchIndex = idx;
    const match = findMatches[idx];
    const info = document.getElementById('find-match-info');
    info.textContent = `${idx + 1} / ${findMatches.length}`;
    info.style.color = '#6b7280';

    // Verify the match still falls within the spreadsheet's current dimensions
    const data = host.getSpreadsheet().getData()[0];
    const rowsLen = data.rows && typeof data.rows.len === 'number' ? data.rows.len : 100;
    const colsLen = data.cols && typeof data.cols.len === 'number' ? data.cols.len : 676;

    if (match.ri >= rowsLen || match.ci >= colsLen) {
        // Match is out of bounds. Gracefully ignore jumping but keep the state.
        return; 
    }

    // Capture focus before jumping to the match so user can stay in Find box while navigating
    const activeEl = document.activeElement;
    const findDialog = document.getElementById('find-replace-dialog');
    const findInput = document.getElementById('find-input');
    const wasInDialog = findDialog && findDialog.contains(activeEl);

    jumpSelectionTo(match.ri, match.ci, true);

    // Restore focus with multiple strategies to ensure it survives all async operations
    if (findDialog && !findDialog.classList.contains('hidden') && wasInDialog) {
        const restoreFocusToElement = (el) => {
            if (el && typeof el.focus === 'function') {
                el.focus({ preventScroll: true });
                return true;
            }
            return false;
        };

        const targetEl = activeEl || findInput;
        
        // Immediate attempt (might not work if operations are still ongoing)
        restoreFocusToElement(targetEl);
        
        // Delayed attempt after the find operation completes
        setTimeout(() => restoreFocusToElement(targetEl), 50);
        
        // Secondary safety net after requestAnimationFrame
        requestAnimationFrame(() => {
            setTimeout(() => restoreFocusToElement(targetEl), 0);
        });
    }
}

export function findNext() {
    if (findMatches.length === 0) { runFindSearch(); return; }
    navigateToMatch(findMatchIndex + 1);
}

export function findPrev() {
    if (findMatches.length === 0) { runFindSearch(); return; }
    navigateToMatch(findMatchIndex - 1);
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceOne() {
    if (findMatches.length === 0 || findMatchIndex < 0) return;
    const match = findMatches[findMatchIndex];
    const query = document.getElementById('find-input').value;
    const replaceVal = document.getElementById('replace-input').value;
    const caseSensitive = document.getElementById('find-case-sensitive').checked;
    const useRegex = document.getElementById('find-use-regex').checked;
    let regex;
    try { regex = buildSearchRegex(query, caseSensitive, useRegex, true); } catch (e) { console.error('Error building search regex:', e); return; }

    const data = host.getSpreadsheet().getData()[0];
    const rowsLen = data.rows && typeof data.rows.len === 'number' ? data.rows.len : 100;
    const colsLen = data.cols && typeof data.cols.len === 'number' ? data.cols.len : 676;
    if (match.ri >= rowsLen || match.ci >= colsLen) {
        return; 
    }

    // Capture focus before mutation
    const activeEl = document.activeElement;
    const findDialog = document.getElementById('find-replace-dialog');
    const wasInDialog = findDialog && findDialog.contains(activeEl);

    host.applyDataMutation((d) => {
        const row = d.rows[match.ri];
        if (row && row.cells && row.cells[match.ci]) {
            const cell = row.cells[match.ci];
            cell.text = String(cell.text || '').replace(regex, replaceVal);
        }
    });

    // Restore focus after mutation
    if (findDialog && !findDialog.classList.contains('hidden') && wasInDialog) {
        setTimeout(() => {
            if (activeEl && typeof activeEl.focus === 'function') {
                activeEl.focus();
            } else {
                document.getElementById('find-input').focus();
            }
        }, 0);
    }
}

export function replaceAll() {
    const query = document.getElementById('find-input').value;
    if (!query) return;
    const replaceVal = document.getElementById('replace-input').value;
    const caseSensitive = document.getElementById('find-case-sensitive').checked;
    const useRegex = document.getElementById('find-use-regex').checked;
    let regex;
    try { regex = buildSearchRegex(query, caseSensitive, useRegex, true); } catch (e) { console.error('Error building search regex:', e); return; }
    
    // Capture focus before mutation
    const activeEl = document.activeElement;
    const findDialog = document.getElementById('find-replace-dialog');
    const wasInDialog = findDialog && findDialog.contains(activeEl);

    host.applyDataMutation((d) => {
        const rows = d.rows;
        Object.keys(rows).forEach(rStr => {
            if (rStr === 'len') return;
            const row = rows[rStr];
            if (row && row.cells) {
                Object.keys(row.cells).forEach(cStr => {
                    const cell = row.cells[cStr];
                    if (cell && cell.text !== undefined && cell.text !== null && cell.text !== '') {
                        cell.text = String(cell.text).replace(regex, replaceVal);
                    }
                });
            }
        });
    });

    // Restore focus after mutation
    if (findDialog && !findDialog.classList.contains('hidden') && wasInDialog) {
        setTimeout(() => {
            if (activeEl && typeof activeEl.focus === 'function') {
                activeEl.focus();
            } else {
                document.getElementById('find-input').focus();
            }
        }, 0);
    }
}
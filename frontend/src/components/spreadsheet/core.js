import Spreadsheet from 'x-data-spreadsheet';
import './xspreadsheet.patched.css';

// --- CORE LIFECYCLE STATE ---
let onSerializedChange = null;
let onFetchSgml = null;
let onFetchConfigs = null;
let onImportSgml = null;
let onImportResult = null;
let onCanonicalized = null;
let isDomBound = false;
let isKeyboardBound = false;
const MAX_COLUMN_COUNT = 26 * 26;
let exportConfigNames = [];
let exportConfigsLoaded = false;
let allowDataTransfer = true;

const SOCIALCALC_SIGNATURE = '--SocialCalcSpreadsheetControlSave';

function ensureColumnCapacity(sheetData, minColumns = MAX_COLUMN_COUNT) {
    if (!sheetData.cols || typeof sheetData.cols !== 'object') {
        sheetData.cols = {};
    }

    const currentLen = Number.isInteger(sheetData.cols.len) ? sheetData.cols.len : 0;
    sheetData.cols.len = Math.max(currentLen, minColumns);
}

// --- MODAL LOGIC ---
let modalMode = ''; // 'import' or 'export'

function openModal(mode) {
    if (!allowDataTransfer && (mode === 'import' || mode === 'export')) {
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
        desc.textContent = 'Copy the serialized output below to export your annotations.';
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
            textarea.value = exportSocialCalc();
        }
        textarea.readOnly = true;
        setTimeout(() => textarea.select(), 50);
    }
}

async function handleExportFormatChange() {
    const formatSelect = document.getElementById('export-format-select');
    const configRow = document.getElementById('modal-config-row');
    const configSelect = document.getElementById('export-config-select');
    const textarea = document.getElementById('modal-textarea');
    if (!formatSelect || !textarea) return;

    const format = formatSelect.value;
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

        if (!onFetchSgml) {
            textarea.value = '(SGML export is not available - document ID is unknown.)';
            return;
        }
        textarea.value = 'Loading...';
        try {
            const result = await onFetchSgml(configSelect.value);
            // result is supposed to return an object with a key 'sgml' but we can be flexible in parsing it
            if (typeof result === 'string') {
                textarea.value = result;
            } else if (result && typeof result === 'object') {
                // Try common field names for text content
                textarea.value = result.sgml ?? result.content ?? result.data ?? result.text ?? JSON.stringify(result, null, 2);
            } else {
                textarea.value = String(result ?? '');
            }
        } catch (err) {
            textarea.value = `Error fetching SGML: ${err.message}`;
        }
    } else {
        if (configRow) {
            configRow.classList.add('hidden');
            configRow.style.display = 'none';
        }
        textarea.value = exportSocialCalc();
    }
}

async function ensureExportConfigsLoaded() {
    const configSelect = document.getElementById('export-config-select');
    if (!configSelect) return;

    if (exportConfigsLoaded) {
        return;
    }

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

function closeModal() {
    document.getElementById('data-modal').classList.add('hidden');
    scheduleRestoreFocus();
}

async function executeModalAction() {
    if (!allowDataTransfer && (modalMode === 'import' || modalMode === 'export')) {
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
            importSocialCalc(rawData);
            closeModal();
            return;
        }

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
            if (importResponse && typeof importResponse === 'object' && typeof onImportResult === 'function') {
                onImportResult(importResponse);
            }

            const refreshedSocialCalc = typeof importResponse === 'string'
                ? importResponse
                : importResponse?.content_spreadsheet ?? importResponse?.contents ?? '';

            if (typeof refreshedSocialCalc === 'string' && refreshedSocialCalc.trim()) {
                importSocialCalc(refreshedSocialCalc);
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
        const textarea = document.getElementById('modal-textarea');
        textarea.select();
        document.execCommand('copy');
        const btn = document.getElementById('data-modal-action-btn');
        const origText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = origText; }, 2000);
    }
}

// --- UTILITIES ---
function colToInt(colStr) {
    let num = 0;
    for (let i = 0; i < colStr.length; i++) {
        num = num * 26 + (colStr.charCodeAt(i) - 64);
    }
    return num - 1;
}

function intToCol(num) {
    let str = '';
    while (num >= 0) {
        str = String.fromCharCode((num % 26) + 65) + str;
        num = Math.floor(num / 26) - 1;
    }
    return str;
}

function coordToXY(coord) {
    if (typeof coord !== 'string') return null;
    const normalizedCoord = coord.trim().toUpperCase();
    const match = normalizedCoord.match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;
    return { x: colToInt(match[1]), y: parseInt(match[2], 10) - 1 };
}

function xyToCoord(x, y) {
    return intToCol(x) + (y + 1);
}

function getMaxBounds(data) {
    let rows = data.rows || {};
    let maxC = 0;
    let maxR = 0;
    Object.keys(rows).forEach(yStr => {
        if (yStr === 'len') return;
        let y = parseInt(yStr);
        if (rows[y] && rows[y].cells) {
            Object.keys(rows[y].cells).forEach(xStr => {
                let x = parseInt(xStr);
                let cell = rows[y].cells[x];
                if (cell && (cell.text || cell.merge || cell.style !== undefined)) {
                    maxR = Math.max(maxR, y);
                    maxC = Math.max(maxC, x);
                }
            });
        }
    });
    return { maxR, maxC };
}

const restoreFocus = (selectionOverride = null, options = {}) => {
    const skipSyntheticClick = !!options.skipSyntheticClick;
    const findDialog = document.getElementById('find-replace-dialog');
    if (findDialog && !findDialog.classList.contains('hidden') && findDialog.contains(document.activeElement)) {
        return;
    }

    if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
    }

    const toolbarFocused = document.querySelector('.x-spreadsheet-toolbar :focus');
    if (toolbarFocused && typeof toolbarFocused.blur === 'function') {
        toolbarFocused.blur();
    }

    const spreadsheetHost = document.querySelector('#spreadsheet-container .x-spreadsheet');
    if (spreadsheetHost) {
        if (!spreadsheetHost.hasAttribute('tabindex')) {
            spreadsheetHost.setAttribute('tabindex', '-1');
        }
        spreadsheetHost.focus({ preventScroll: true });
    }

    const keyInput = document.querySelector('#spreadsheet-container .x-spreadsheet-selector .hide-input input');
    if (keyInput) {
        keyInput.focus({ preventScroll: true });
    }
    
    const selectionRange = selectionOverride || getActiveSelectionRange();
    
    if (mySpreadsheet && mySpreadsheet.sheet) {
        mySpreadsheet.sheet.focusing = true;
        mySpreadsheet.sheet.isFocus = true; 
        restoreSelectorRange(selectionRange);

        // Synthetic mouseclick strictly on the actively selected cell - 
        // Wakes up the canvas engine without snapping selection to A1
        const canvas = document.querySelector('.x-spreadsheet-sheet canvas');
        const hiddenInputContainer = document.querySelector('#spreadsheet-container .x-spreadsheet-selector .hide-input');
        
        if (!skipSyntheticClick && canvas && hiddenInputContainer && mySpreadsheet.sheet.data) {
            try {
                const inputRect = hiddenInputContainer.getBoundingClientRect();
                
                // Add 5px padding to ensure the click hits inside the cell bounds
                const clickX = inputRect.left + 5;
                const clickY = inputRect.top + 5;
                
                // Only dispatch if coordinates are actually visually on-screen
                if (clickX > 0 && clickY > 0) {
                    // Mute the library's autoscroll for this click only
                    window._isSyntheticFocusClick = true; 
                    
                    canvas.dispatchEvent(new MouseEvent('mousedown', { view: window, bubbles: true, cancelable: true, clientX: clickX, clientY: clickY }));
                    canvas.dispatchEvent(new MouseEvent('mouseup', { view: window, bubbles: true, cancelable: true, clientX: clickX, clientY: clickY }));
                    
                    window._isSyntheticFocusClick = false;
                }
            } catch(e) {
                window._isSyntheticFocusClick = false;
            }
        }
    }
};

// --- MONKEY-PATCH THE SELECTION ENGINE (Fixes Navigation & Auto-Scrolling) ---
function patchSelector() {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.selector) return;

    const sanitizeOffsetPayload = (payload) => {
        if (!payload || typeof payload !== 'object') return payload;
        const nextPayload = { ...payload };
        ['left', 'top', 'width', 'height'].forEach((key) => {
            if (!(key in nextPayload)) return;
            const numericValue = Number(nextPayload[key]);
            if (!Number.isFinite(numericValue)) {
                nextPayload[key] = 0;
                return;
            }
            if ((key === 'width' || key === 'height') && numericValue < 0) {
                nextPayload[key] = 0;
                return;
            }
            nextPayload[key] = numericValue;
        });
        return nextPayload;
    };

    const patchOffsetWriter = (target) => {
        if (!target || typeof target.offset !== 'function' || target._offsetGuardPatched) return;
        const originalOffset = target.offset.bind(target);
        target.offset = (value) => {
            if (value === undefined) return originalOffset();
            return originalOffset(sanitizeOffsetPayload(value));
        };
        target._offsetGuardPatched = true;
    };

    const patchGeometryOffsetGuards = () => {
        const sheet = mySpreadsheet && mySpreadsheet.sheet;
        if (!sheet) return;

        const selector = sheet.selector;
        if (selector && !selector._offsetGuardsPatched) {
            ['br', 't', 'l', 'tl'].forEach((regionKey) => {
                const region = selector[regionKey];
                if (!region) return;
                patchOffsetWriter(region.el);
                patchOffsetWriter(region.areaEl);
                patchOffsetWriter(region.clipboardEl);
                patchOffsetWriter(region.autofillEl);
                patchOffsetWriter(region.hideInputDiv);
            });
            selector._offsetGuardsPatched = true;
        }

        const editor = sheet.editor;
        if (editor && !editor._offsetGuardsPatched) {
            patchOffsetWriter(editor.el);
            patchOffsetWriter(editor.areaEl);
            patchOffsetWriter(editor.textEl);
            patchOffsetWriter(editor.textlineEl);
            editor._offsetGuardsPatched = true;
        }
    };

    patchGeometryOffsetGuards();
    if (mySpreadsheet.sheet.selector._isPatched) return;

    const snapTallSelectionToTop = () => {
        const sheet = mySpreadsheet && mySpreadsheet.sheet;
        const data = sheet && sheet.data;
        if (!sheet || !data || typeof data.getSelectedRect !== 'function' || typeof sheet.getTableOffset !== 'function') {
            return;
        }

        const selectedRect = data.getSelectedRect();
        const tableOffset = sheet.getTableOffset();
        const selectionHeight = Number(selectedRect && selectedRect.height) || 0;
        const viewportHeight = Number(tableOffset && tableOffset.height) || 0;
        if (selectionHeight <= 0 || viewportHeight <= 0 || selectionHeight <= viewportHeight) {
            return;
        }

        // Cell is taller than the viewport: scroll so its top row is visible.
        // We pass (t - 1 - freezeH) to verticalScrollbar.move() so the library's
        // internal scrolly() snaps scroll.y to exactly sumHeight(freeze_start, sri),
        // placing the cell's top row at the very top of the viewport.
        // Passing t directly would snap one row further (to the bottom of row sri).
        const freezeH = typeof data.freezeTotalHeight === 'function' ? data.freezeTotalHeight() : 0;
        const targetTop = Math.max(0, (Number(selectedRect.t) || 0) - 1 - freezeH);
        if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
            try { sheet.verticalScrollbar.move(targetTop); } catch (e) {}
        }
    };
    
    let sel = mySpreadsheet.sheet.selector;
    const origSet = sel.set.bind(sel);
    
    sel.set = function(ri, ci, setArg = true) {
        let data = mySpreadsheet.sheet.data;
        const toolbarSnapshot = activeToolbarSelectionSnapshot;
        const setOptions = (setArg && typeof setArg === 'object') ? setArg : null;
        const indexesUpdated = setOptions
            ? (setOptions.indexesUpdated !== undefined ? !!setOptions.indexesUpdated : true)
            : !!setArg;
        const autoScroll = setOptions
            ? (setOptions.autoScroll !== undefined ? !!setOptions.autoScroll : true)
            : (window._isSyntheticFocusClick ? false : true);
        const preservedScroll = data && data.scroll
            ? {
                x: Number.isFinite(data.scroll.x) ? data.scroll.x : 0,
                y: Number.isFinite(data.scroll.y) ? data.scroll.y : 0,
            }
            : null;
        
        let mergesArray = [];
        if (data.merges) {
            if (Array.isArray(data.merges)) mergesArray = data.merges;
            else if (Array.isArray(data.merges.merges)) mergesArray = data.merges.merges;
            else if (Array.isArray(data.merges._)) mergesArray = data.merges._;
        }
        
        let targetBox = null;
        for (let i = 0; i < mergesArray.length; i++) {
            let m = mergesArray[i];
            if (typeof m === 'string') {
                let parts = m.split(':');
                let start = coordToXY(parts[0]);
                let end = coordToXY(parts[1]);
                if (start && end && ri >= start.y && ri <= end.y && ci >= start.x && ci <= end.x) {
                    targetBox = { sri: start.y, sci: start.x, eri: end.y, eci: end.x };
                    break;
                }
            } else if (m && m.sri !== undefined) {
                if (ri >= m.sri && ri <= m.eri && ci >= m.sci && ci <= m.eci) {
                    targetBox = { sri: m.sri, sci: m.sci, eri: m.eri, eci: m.eci };
                    break;
                }
            }
        }
        
        if (targetBox) {
            let lRi = typeof lastRi !== 'undefined' ? lastRi : 0;
            let lCi = typeof lastCi !== 'undefined' ? lastCi : 0;
            let isLastInside = (lRi >= targetBox.sri && lRi <= targetBox.eri && lCi >= targetBox.sci && lCi <= targetBox.eci);
            
            if (!isLastInside) {
                ri = targetBox.sri;
                ci = targetBox.sci;
            } else {
                let dRi = ri - lRi;
                let dCi = ci - lCi;
                if (dRi > 0) ri = targetBox.eri + 1;
                else if (dRi < 0) ri = targetBox.sri - 1;
                if (dCi > 0) ci = targetBox.eci + 1;
                else if (dCi < 0) ci = targetBox.sci - 1;
            }
            if (ri < 0) ri = 0;
            if (ci < 0) ci = 0;
        }
        
        lastRi = ri;
        lastCi = ci;

        // FIX: Deep gag order. The library's Selector.set calls sheet UI methods, 
        // not just data methods. We must freeze the physical scrollbars too.
        let sheet = mySpreadsheet.sheet;
        let origDataX = data.scrollx;
        let origDataY = data.scrolly;
        let origSheetX = sheet ? sheet.scrollx : null;
        let origSheetY = sheet ? sheet.scrolly : null;
        let origVScroll = sheet && sheet.verticalScrollbar ? sheet.verticalScrollbar.move : null;
        let origHScroll = sheet && sheet.horizontalScrollbar ? sheet.horizontalScrollbar.move : null;

        if (autoScroll === false) {
            data.scrollx = () => {};
            data.scrolly = () => {};
            if (sheet) {
                sheet.scrollx = () => {};
                sheet.scrolly = () => {};
                if (sheet.verticalScrollbar) sheet.verticalScrollbar.move = () => {};
                if (sheet.horizontalScrollbar) sheet.horizontalScrollbar.move = () => {};
            }
        }

        let ret = origSet(ri, ci, indexesUpdated);

        if (autoScroll !== false) {
            // The library's scrollbarMove() is called by selectorMove() AFTER sel.set()
            // returns, so a synchronous snap here would be immediately overwritten.
            // A microtask fires after the full synchronous call stack (including
            // scrollbarMove) completes but before the browser paints, so it wins.
            const snapRi = mySpreadsheet?.sheet?.data?.selector?.ri ?? ri;
            const snapCi = mySpreadsheet?.sheet?.data?.selector?.ci ?? ci;
            queueMicrotask(() => {
                const curSel = mySpreadsheet?.sheet?.data?.selector;
                if (curSel && curSel.ri === snapRi && curSel.ci === snapCi) {
                    snapTallSelectionToTop();
                }
            });
        }

        // Restore mutators
        if (autoScroll === false) {
            data.scrollx = origDataX;
            data.scrolly = origDataY;
            if (sheet) {
                if (origSheetX) sheet.scrollx = origSheetX;
                if (origSheetY) sheet.scrolly = origSheetY;
                if (origVScroll) sheet.verticalScrollbar.move = origVScroll;
                if (origHScroll) sheet.horizontalScrollbar.move = origHScroll;
            }

            // Hard-restore scroll coordinates as origSet may still mutate raw scroll state.
            if (preservedScroll) {
                if (!data.scroll || typeof data.scroll !== 'object') data.scroll = {};
                data.scroll.x = preservedScroll.x;
                data.scroll.y = preservedScroll.y;
            }
        }

        if (
            toolbarSnapshot &&
            ri === toolbarSnapshot.sri &&
            ci === toolbarSnapshot.sci &&
            (toolbarSnapshot.eri !== toolbarSnapshot.sri || toolbarSnapshot.eci !== toolbarSnapshot.sci)
        ) {
            sel.setEnd(toolbarSnapshot.eri, toolbarSnapshot.eci);
        }
        
        if (isProgrammaticJump && !sel._isRendering) {
            sel._isRendering = true;
            if (mySpreadsheet && mySpreadsheet.sheet) {
                let sheet = mySpreadsheet.sheet;
                if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
                    try { sheet.verticalScrollbar.move(data.scroll ? data.scroll.y : 0); } catch(e) {}
                }
                if (sheet.horizontalScrollbar && typeof sheet.horizontalScrollbar.move === 'function') {
                    try { sheet.horizontalScrollbar.move(data.scroll ? data.scroll.x : 0); } catch(e) {}
                }
                if (typeof sheet.render === 'function') {
                    sheet.render();
                } else if (sheet.table && typeof sheet.table.render === 'function') {
                    sheet.table.render();
                }
            }
            sel._isRendering = false;
        }

        syncFormulaBarFromSelection();
        
        return ret;
    };
    sel._isPatched = true;
}

// --- MONKEY-PATCH THE CONTEXT MENU ---
// This removes context menu items we don't want users to see, such as "Data Validation" and "Enable/Disable Export".
function patchContextMenu() {
    const container = document.getElementById('spreadsheet-container');
    if (!container) return;

    // x-data-spreadsheet statically renders the context menu inside the main wrapper on init
    const menuItems = container.querySelectorAll('.x-spreadsheet-contextmenu .x-spreadsheet-item');

    menuItems.forEach(item => {
        const text = (item.textContent || '').trim().toLowerCase();
        
        if (
            text.includes('data validation') || 
            text.includes('enable export') || 
            text.includes('disable export')
        ) {
            // Hide the item
            item.style.display = 'none';

            // Clean up the adjacent divider to prevent awkward double borders in the UI
            const nextSibling = item.nextElementSibling;
            if (nextSibling && nextSibling.classList.contains('divider')) {
                nextSibling.style.display = 'none';
            }
        }
    });
}

// --- DEBOUNCED SCHEDULERS TO PREVENT PILE-UP AND RACE CONDITIONS ---
let _restoreFocusTimeout = null;
let _restoreFocusRaf = null;

function scheduleRestoreFocus(selectionOverride = null, options = {}) {
    if (_restoreFocusTimeout) clearTimeout(_restoreFocusTimeout);
    if (_restoreFocusRaf) cancelAnimationFrame(_restoreFocusRaf);
    _restoreFocusTimeout = setTimeout(() => {
        restoreFocus(selectionOverride, options);
        _restoreFocusRaf = requestAnimationFrame(() => restoreFocus(selectionOverride, options));
    }, 0);
}

let _viewportSyncTimeout = null;
let _viewportSyncRaf = null;
let _viewportSyncRequestId = 0;

function scheduleViewportSync(options = {}) {
    const requestId = Number.isInteger(options.requestId) ? options.requestId : ++_viewportSyncRequestId;
    if (_viewportSyncTimeout) clearTimeout(_viewportSyncTimeout);
    if (_viewportSyncRaf) cancelAnimationFrame(_viewportSyncRaf);
    _viewportSyncTimeout = setTimeout(() => {
        const syncOptions = { ...options, requestId };
        syncViewportFromSheetData(syncOptions);
        _viewportSyncRaf = requestAnimationFrame(() => syncViewportFromSheetData(syncOptions));
    }, 0);
}

function syncViewportFromSheetData(options = {}) {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data) return;
    const requestId = Number.isInteger(options.requestId) ? options.requestId : ++_viewportSyncRequestId;
    const sheet = mySpreadsheet.sheet;
    const data = sheet.data;
    const preserveHorizontal = !!options.preserveHorizontal;
    const lockedScrollX = Number.isFinite(options.lockedScrollX) ? options.lockedScrollX : null;

    const applyViewport = () => {
        if (requestId !== _viewportSyncRequestId) return;
        if (lockedScrollX !== null) {
            if (!data.scroll || typeof data.scroll !== 'object') data.scroll = {};
            data.scroll.x = lockedScrollX;
        }
        
        // 1. Move Scrollbars first before calculating pixel offsets
        if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
            try { sheet.verticalScrollbar.move(data.scroll ? data.scroll.y : 0 ); } catch (e) {}
        }
        if (sheet.horizontalScrollbar && typeof sheet.horizontalScrollbar.move === 'function') {
            const left = lockedScrollX !== null ? lockedScrollX : (data.scroll ? data.scroll.x : 0);
            try { sheet.horizontalScrollbar.move( left ); } catch (e) {}
        }

        // 2. Now recalculate blue selection box offsets against the new scroll position
        if (sheet.selector && typeof sheet.selector.resetAreaOffset === 'function') {
            sheet.selector.resetAreaOffset();
        }
        if (sheet.selector && typeof sheet.selector.resetBRTAreaOffset === 'function') {
            sheet.selector.resetBRTAreaOffset();
        }
        if (sheet.selector && typeof sheet.selector.resetBRLAreaOffset === 'function') {
            sheet.selector.resetBRLAreaOffset();
        }
        
        // 3. Render Canvas
        if (typeof sheet.render === 'function') {
            sheet.render();
        } else if (sheet.table && typeof sheet.table.render === 'function') {
            sheet.table.render();
        }
    };

    const selectedRect = typeof data.getSelectedRect === 'function' ? data.getSelectedRect() : null;
    const tableOffset = typeof sheet.getTableOffset === 'function' ? sheet.getTableOffset() : null;
    if (selectedRect && tableOffset) {
        const contentLeft = selectedRect.l || 0;
        const contentTop = selectedRect.t || 0;
        const viewLeft = selectedRect.left || 0;
        const viewTop = selectedRect.top || 0;
        const width = selectedRect.width || 0;
        const height = selectedRect.height || 0;

        if (!preserveHorizontal && sheet.horizontalScrollbar && typeof sheet.horizontalScrollbar.move === 'function') {
            let targetLeft = null;
            if (Math.abs(viewLeft) + width > tableOffset.width) {
                targetLeft = contentLeft + width - tableOffset.width;
            } else {
                const freezeW = typeof data.freezeTotalWidth === 'function' ? data.freezeTotalWidth() : 0;
                if (viewLeft < freezeW) {
                    targetLeft = contentLeft - 1 - freezeW;
                }
            }
            if (targetLeft !== null && typeof data.scrollx === 'function') {
                try { data.scrollx(targetLeft, applyViewport); } catch (e) {}
            }
        }

        if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
            let targetTop = null;
            const freezeH = typeof data.freezeTotalHeight === 'function' ? data.freezeTotalHeight() : 0;
            if (height > tableOffset.height) {
                targetTop = Math.max(0, contentTop - 1 - freezeH);
            } else if (Math.abs(viewTop) + height > tableOffset.height) {
                targetTop = contentTop + height - tableOffset.height - 1;
            } else if (viewTop < freezeH) {
                targetTop = contentTop - 1 - freezeH;
            }
            if (targetTop !== null && typeof data.scrolly === 'function') {
                try { data.scrolly(targetTop, applyViewport); } catch (e) {}
            }
        }
        applyViewport();
    } else {
        applyViewport();
    }
}

// --- Helper to find the true bounds of a cell (expanding if it's a merge) ---
function getExpandedCellBounds(data, ri, ci) {
    if (!data || !data.merges) return { sri: ri, sci: ci, eri: ri, eci: ci };
    
    let mergesArray = [];
    if (Array.isArray(data.merges)) mergesArray = data.merges;
    else if (Array.isArray(data.merges.merges)) mergesArray = data.merges.merges;
    else if (Array.isArray(data.merges._)) mergesArray = data.merges._;

    for (let i = 0; i < mergesArray.length; i++) {
        let m = mergesArray[i];
        let bounds = null;
        
        if (typeof m === 'string') {
            let parts = m.split(':');
            let start = coordToXY(parts[0]);
            let end = coordToXY(parts[1]);
            if (start && end) bounds = { sri: start.y, sci: start.x, eri: end.y, eci: end.x };
        } else if (m && m.sri !== undefined) {
            bounds = { sri: m.sri, sci: m.sci, eri: m.eri, eci: m.eci };
        }

        if (bounds && ri >= bounds.sri && ri <= bounds.eri && ci >= bounds.sci && ci <= bounds.eci) {
            return bounds;
        }
    }
    return { sri: ri, sci: ci, eri: ri, eci: ci };
}

function jumpSelectionTo(ri, ci, skipFocusRestore = false, options = {}) {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.selector) return;
    
    const preserveHorizontal = !!options.preserveHorizontal;
    const lockedScrollX = preserveHorizontal
        ? (Number.isFinite(mySpreadsheet.sheet?.data?.scroll?.x) ? mySpreadsheet.sheet.data.scroll.x : 0)
        : null;
    const requestId = ++_viewportSyncRequestId;
    
    isProgrammaticJump = true;
    try {
        // 1. Identify true span of target cell (handling merges)
        const targetBounds = getExpandedCellBounds(mySpreadsheet.sheet.data, ri, ci);
        
        // 2. Pre-stage coordinates and the selection range so syncViewportFromSheetData 
        //    reads the correct getSelectedRect() bounding box before calculating the scroll distance.
        if (mySpreadsheet.sheet.data.selector) {
            mySpreadsheet.sheet.data.selector.ri = targetBounds.sri;
            mySpreadsheet.sheet.data.selector.ci = targetBounds.sci;
            
            // Force the range to update before calculating viewport offsets
            if (mySpreadsheet.sheet.data.selector.range && typeof mySpreadsheet.sheet.data.selector.range.set === 'function') {
                mySpreadsheet.sheet.data.selector.range.set(
                    targetBounds.sri, 
                    targetBounds.sci, 
                    targetBounds.eri, 
                    targetBounds.eci
                );
            }
        }

        // Move the viewport to destination
        syncViewportFromSheetData({ preserveHorizontal, requestId, lockedScrollX });
        
        // Force generation of the blue selection box against the new scroll state
        restoreSelectorRange(targetBounds);
    } finally {
        isProgrammaticJump = false;
    }
    
    if (!skipFocusRestore) {
        scheduleRestoreFocus();
    }
}

// --- GLOBAL STATE & CUSTOM HISTORY ENGINE ---
let mySpreadsheet = null;
let preSheetLines = [];
let postSheetLines = [];
let parsedFonts = [];
let parsedValueFormats = [];
let currentPreferredColumnOrder = [];

let appHistory = [];
let appHistoryIndex = -1;
let lastRi = 0;
let lastCi = 0;
let isProgrammaticJump = false;
let activeToolbarSelectionSnapshot = null;
const BG_COLOR_OPTIONS = ['#ffffff', '#efc990', '#fee2e2', '#dcfce7', '#dbeafe', '#ede9fe', '#fce7f3', '#e5e7eb'];
let configuredSpreadsheetFontFamily = null;

function normalizeSpreadsheetFontFamily(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function getEffectiveSpreadsheetFontFamily() {
    return configuredSpreadsheetFontFamily || 'Arial';
}

function applyConfiguredFontToStyles(stylesList) {
    if (!Array.isArray(stylesList) || stylesList.length === 0) return stylesList;
    const family = getEffectiveSpreadsheetFontFamily();

    return stylesList.map((styleObj) => {
        const nextStyle = styleObj && typeof styleObj === 'object'
            ? JSON.parse(JSON.stringify(styleObj))
            : {};
        const nextFont = nextStyle.font && typeof nextStyle.font === 'object'
            ? { ...nextStyle.font }
            : {};

        nextFont.name = family;
        if (!Number.isFinite(nextFont.size)) nextFont.size = 10;
        if (typeof nextFont.bold !== 'boolean') nextFont.bold = false;
        if (typeof nextFont.italic !== 'boolean') nextFont.italic = false;

        nextStyle.font = nextFont;
        return nextStyle;
    });
}

function getTopLeftSelectionPosition() {
    const selectionRange = getActiveSelectionRange();
    return { ri: selectionRange.sri, ci: selectionRange.sci };
}

function getCellTextFromData(data, ri, ci) {
    const cell = data?.rows?.[ri]?.cells?.[ci];
    if (!cell || cell.text === undefined || cell.text === null) return '';
    return String(cell.text);
}

function syncFormulaBarFromSelection(options = {}) {
    const force = !!options.force;
    const formulaInput = document.getElementById('spreadsheet-formula-input');
    if (!formulaInput) return;
    if (!mySpreadsheet) {
        formulaInput.value = '';
        return;
    }
    if (!force && document.activeElement === formulaInput) return;

    const { ri, ci } = getTopLeftSelectionPosition();
    const data = mySpreadsheet.getData()[0] || {};
    const nextValue = getCellTextFromData(data, ri, ci);
    if (formulaInput.value !== nextValue) {
        formulaInput.value = nextValue;
    }
}

function updateTopLeftSelectedCellFromFormulaBar(nextValue) {
    if (!mySpreadsheet || !mySpreadsheet.sheet) return;
    const textValue = typeof nextValue === 'string' ? nextValue : '';
    const { ri, ci } = getTopLeftSelectionPosition();

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
    notifySerializedChange();
}

function handleFormulaBarInput(event) {
    updateTopLeftSelectedCellFromFormulaBar(event.target.value);
} 

function handleFormulaBarFocus() {
    syncFormulaBarFromSelection({ force: true });
}

function handleFormulaBarMouseDown(event) {
    event.stopPropagation();
}

function handleFormulaBarClick(event) {
    event.stopPropagation();
}

function handleFormulaBarClipboard(event) {
    event.stopPropagation();
}

function handleFormulaBarKeydown(event) {
    // Add stopPropagation to prevent the spreadsheet engine from catching Ctrl+C / Ctrl+X
    event.stopPropagation(); 
    
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        scheduleRestoreFocus();
    }
}

function enforceHeaderRowStyles() {
    // Silently ensure every filled cell in row 0 (header row) has bold font + #f3f4f6 bgcolor.

    if (!mySpreadsheet) return;
    
    // Grab the live reference instead of a cloned copy
    const data = mySpreadsheet.getData()[0];
    if (!data) return;
    
    const rows = data.rows || {};
    const row0 = rows[0];
    if (!row0 || !row0.cells) return;

    const stylesList = Array.isArray(data.styles) ? data.styles : [];
    let changed = false;
    const family = getEffectiveSpreadsheetFontFamily();

    let headerStyleIndex = stylesList.findIndex(
        (s) => s && s.font && s.font.bold === true && normalizeHexColor(s.bgcolor) === '#f3f4f6'
    );

    Object.entries(row0.cells).forEach(([xStr, cell]) => {
        if (!cell || cell.text === undefined || cell.text === null || cell.text === '') return;
        const existingStyle = cell.style !== undefined ? stylesList[cell.style] : null;
        const alreadyCorrect =
            existingStyle &&
            existingStyle.font &&
            existingStyle.font.bold === true &&
            normalizeHexColor(existingStyle.bgcolor) === '#f3f4f6';
        if (alreadyCorrect) return;

        if (headerStyleIndex === -1) {
            stylesList.push({
                font: { bold: true, italic: false, name: family, size: 10 },
                bgcolor: '#f3f4f6',
                align: '',
                valign: '',
                textwrap: false,
                strike: false,
                underline: false,
                color: '#000000',
                border: {},
                format: 'normal',
            });
            data.styles = stylesList;
            headerStyleIndex = stylesList.length - 1;
        }

        row0.cells[xStr] = { ...cell, style: headerStyleIndex };
        changed = true;
    });

    if (changed) {
        // Redraw canvas in-place instead of using loadData()
        const sheet = mySpreadsheet.sheet;
        if (typeof sheet.render === 'function') {
            sheet.render();
        } else if (sheet.table && typeof sheet.table.render === 'function') {
            sheet.table.render();
        }
    }
}

function notifySerializedChange() {
    if (!onSerializedChange || !mySpreadsheet) return;
    enforceHeaderRowStyles();
    onSerializedChange(exportSocialCalc());
}

function getDefaultSocialCalcData() {
    return `socialcalc:version:1.0
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave
--SocialCalcSpreadsheetControlSave
Content-type: text/plain; charset=UTF-8

# SocialCalc Spreadsheet Control Save
version:1.0
part:sheet
--SocialCalcSpreadsheetControlSave
Content-type: text/plain; charset=UTF-8

version:1.5
cell:A1:t:tok:f:2
cell:B1:t:text_id:f:2
cell:C1:t:head:f:2
cell:D1:t:s_type:f:2
cell:Q1:t:entity:f:2
cell:V1:t:group\\ccoref:f:2
cell:A2:t:You:f:1:tvf:1
cell:B2:t:GUM_essay_merit:f:1:tvf:1:rowspan:9
cell:C2:t:head:f:1:tvf:1:rowspan:9
cell:D2:t:decl:f:1:tvf:1:rowspan:9
cell:Q2:t:person:f:1:tvf:1
cell:V2:t:1:f:1:tvf:1
cell:A3:t:’re:f:1:tvf:1
cell:A4:t:Not:f:1:tvf:1
cell:A5:t:Going:f:1:tvf:1
cell:A6:t:to:f:1:tvf:1
cell:A7:t:Get:f:1:tvf:1
cell:A8:t:Accepted:f:1:tvf:1
cell:A9:t:into:f:1:tvf:1
cell:A10:t:a:f:1:tvf:1
cell:Q10:t:organization:f:1:tvf:1:rowspan:3
sheet:c:22:r:10:tvf:2
font:1:* * Antinoou
font:2:normal bold * *
valueformat:1:text-plain
--SocialCalcSpreadsheetControlSave
Content-type: text/plain; charset=UTF-8
--SocialCalcSpreadsheetControlSave--`;
}

function normalizeHexColor(color) {
    if (!color) return null;
    const val = String(color).trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(val)) return val;
    return null;
}

function isDefaultBackgroundColor(color) {
    return normalizeHexColor(color) === '#ffffff';
}

function compactStyleObject(styleObj) {
    if (!styleObj || typeof styleObj !== 'object') return {};

    const normalizedStyle = JSON.parse(JSON.stringify(styleObj));
    if (normalizedStyle.font && Object.keys(normalizedStyle.font).length === 0) {
        delete normalizedStyle.font;
    }
    if (isDefaultBackgroundColor(normalizedStyle.bgcolor)) {
        delete normalizedStyle.bgcolor;
    }

    return normalizedStyle;
}

function isStyleEquivalent(a, b) {
    return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function getOrCreateStyleIndex(styles, styleObj) {
    for (let i = 0; i < styles.length; i++) {
        if (isStyleEquivalent(styles[i], styleObj)) return i;
    }
    styles.push(styleObj);
    return styles.length - 1;
}

function getActiveSelectionRange() {
    const sel = mySpreadsheet && mySpreadsheet.sheet && mySpreadsheet.sheet.data ? mySpreadsheet.sheet.data.selector : null;
    if (!sel) return { sri: 0, sci: 0, eri: 0, eci: 0 };

    const range = sel.range || {};

    const sriCandidate = Number.isInteger(range.sri)
        ? range.sri
        : (Number.isInteger(sel.ri) ? sel.ri : 0);
    const sciCandidate = Number.isInteger(range.sci)
        ? range.sci
        : (Number.isInteger(sel.ci) ? sel.ci : 0);
    const eriCandidate = Number.isInteger(range.eri)
        ? range.eri
        : (Number.isInteger(sel.eri) ? sel.eri : sriCandidate);
    const eciCandidate = Number.isInteger(range.eci)
        ? range.eci
        : (Number.isInteger(sel.eci) ? sel.eci : sciCandidate);

    return {
        sri: Math.min(sriCandidate, eriCandidate),
        sci: Math.min(sciCandidate, eciCandidate),
        eri: Math.max(sriCandidate, eriCandidate),
        eci: Math.max(sciCandidate, eciCandidate)
    };
}

function restoreSelectorRange(selectionRange) {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.selector || !selectionRange) return;
    
    const sheet = mySpreadsheet.sheet;
    const sel = sheet.selector;
    const dataSel = sheet.data && sheet.data.selector;
    
    // 1. HARD-SYNC THE DATA LAYER FIRST
    // Prevents proxy detachment bugs from silently corrupting history
    if (dataSel) {
        dataSel.ri = selectionRange.sri;
        dataSel.ci = selectionRange.sci;
        if (dataSel.range && typeof dataSel.range.set === 'function') {
            dataSel.range.set(selectionRange.sri, selectionRange.sci, selectionRange.eri, selectionRange.eci);
        }
    }

    // Keep the patched selector's merge-navigation state aligned with the true anchor.
    lastRi = selectionRange.sri;
    lastCi = selectionRange.sci;

    // 2. UPDATE THE UI LAYER without triggering viewport movement.
    sel.set(selectionRange.sri, selectionRange.sci, { autoScroll: false, indexesUpdated: true });
    
    if (selectionRange.eri !== selectionRange.sri || selectionRange.eci !== selectionRange.sci) {
        // Force endpoint update; moving=true may short-circuit on cached lastri/lastci.
        sel.setEnd(selectionRange.eri, selectionRange.eci, false);
    }

    // 3. RECALCULATE PIXEL BOUNDARIES FOR THE BLUE BOX
    if (typeof sel.resetAreaOffset === 'function') sel.resetAreaOffset();
    if (typeof sel.resetBRTAreaOffset === 'function') sel.resetBRTAreaOffset();
    if (typeof sel.resetBRLAreaOffset === 'function') sel.resetBRLAreaOffset();

    // 4. REPAINT THE CANVAS
    if (typeof sheet.render === 'function') {
        sheet.render();
    } else if (sheet.table && typeof sheet.table.render === 'function') {
        sheet.table.render();
    }
}

function applyBackgroundColorToSelection(color) {
    const selectedColor = normalizeHexColor(color);
    if (!selectedColor || !mySpreadsheet) return;

    const targetRange = activeToolbarSelectionSnapshot || getActiveSelectionRange();
    executeStateChange((d) => {
        if (!d.rows) d.rows = { len: 100 };
        if (!Array.isArray(d.styles)) d.styles = [];

        for (let y = targetRange.sri; y <= targetRange.eri; y++) {
            if (!d.rows[y]) d.rows[y] = { cells: {} };
            if (!d.rows[y].cells) d.rows[y].cells = {};
            for (let x = targetRange.sci; x <= targetRange.eci; x++) {
                const existingCell = d.rows[y].cells[x] || {};
                const baseStyle = (existingCell.style !== undefined && d.styles[existingCell.style])
                    ? JSON.parse(JSON.stringify(d.styles[existingCell.style]))
                    : {};

                if (isDefaultBackgroundColor(selectedColor)) {
                    delete baseStyle.bgcolor;
                } else {
                    baseStyle.bgcolor = selectedColor;
                }

                const nextStyle = compactStyleObject(baseStyle);
                if (Object.keys(nextStyle).length > 0) {
                    existingCell.style = getOrCreateStyleIndex(d.styles, nextStyle);
                } else {
                    delete existingCell.style;
                }
                d.rows[y].cells[x] = existingCell;
            }
        }
    });
}

function highlightCellsBackgroundColor(cellRefs, color = '#fef3c7') {
    if (!mySpreadsheet || !Array.isArray(cellRefs) || cellRefs.length === 0) return 0;

    const selectedColor = normalizeHexColor(color) || '#fef3c7';
    const uniqueCoords = [...new Set(cellRefs)];
    let updatedCount = 0;

    executeStateChange((d) => {
        if (!d.rows) d.rows = { len: 100 };
        if (!Array.isArray(d.styles)) d.styles = [];

        uniqueCoords.forEach((coord) => {
            if (typeof coord !== 'string') return;
            const pos = coordToXY(coord.trim().toUpperCase());
            if (!pos) return;

            if (!d.rows[pos.y]) d.rows[pos.y] = { cells: {} };
            if (!d.rows[pos.y].cells) d.rows[pos.y].cells = {};

            const existingCell = d.rows[pos.y].cells[pos.x] || {};
            const baseStyle = (existingCell.style !== undefined && d.styles[existingCell.style])
                ? JSON.parse(JSON.stringify(d.styles[existingCell.style]))
                : {};

            if (isDefaultBackgroundColor(selectedColor)) {
                delete baseStyle.bgcolor;
            } else {
                baseStyle.bgcolor = selectedColor;
            }

            const nextStyle = compactStyleObject(baseStyle);
            if (Object.keys(nextStyle).length > 0) {
                existingCell.style = getOrCreateStyleIndex(d.styles, nextStyle);
            } else {
                delete existingCell.style;
            }

            d.rows[pos.y].cells[pos.x] = existingCell;
            d.rows.len = Math.max(Number.isInteger(d.rows.len) ? d.rows.len : 100, pos.y + 1);
            updatedCount++;
        });
    });

    return updatedCount;
}

function clearHighlightedCellsBackgroundColor(cellRefs, color = '#fef3c7') {
    if (!mySpreadsheet || !Array.isArray(cellRefs) || cellRefs.length === 0) return 0;

    const selectedColor = normalizeHexColor(color) || '#fef3c7';
    const uniqueCoords = [...new Set(cellRefs)];
    let updatedCount = 0;

    executeStateChange((d) => {
        if (!d.rows) d.rows = { len: 100 };
        if (!Array.isArray(d.styles)) d.styles = [];

        uniqueCoords.forEach((coord) => {
            if (typeof coord !== 'string') return;
            const pos = coordToXY(coord.trim().toUpperCase());
            if (!pos) return;

            const row = d.rows[pos.y];
            const cell = row && row.cells ? row.cells[pos.x] : null;
            if (!cell || cell.style === undefined) return;

            const existingStyle = d.styles[cell.style];
            if (!existingStyle || normalizeHexColor(existingStyle.bgcolor) !== selectedColor) return;

            const nextStyle = JSON.parse(JSON.stringify(existingStyle));
            delete nextStyle.bgcolor;

            const compacted = compactStyleObject(nextStyle);
            if (Object.keys(compacted).length > 0) {
                cell.style = getOrCreateStyleIndex(d.styles, compacted);
            } else {
                delete cell.style;
            }

            updatedCount++;
        });
    });

    return updatedCount;
}

function cleanupRogueHighlights(allowedCellRefs, color = '#fef3c7') {
    if (!mySpreadsheet || !Array.isArray(allowedCellRefs)) return 0;

    const targetColor = normalizeHexColor(color) || '#fef3c7';
    
    // Create a Set of allowed 'y,x' coordinate strings for fast lookup
    const allowedSet = new Set();
    allowedCellRefs.forEach((coord) => {
        if (typeof coord !== 'string') return;
        const pos = coordToXY(coord.trim().toUpperCase());
        if (pos) allowedSet.add(`${pos.y},${pos.x}`);
    });

    // 1. Dry Run: Check if we even need to mutate state (to prevent empty history logs)
    const data = mySpreadsheet.getData()[0];
    const rows = data.rows || {};
    const styles = data.styles || [];
    let rogueFound = false;

    for (const yStr of Object.keys(rows)) {
        if (yStr === 'len') continue;
        const row = rows[yStr];
        if (!row || !row.cells) continue;
        
        for (const xStr of Object.keys(row.cells)) {
            const cell = row.cells[xStr];
            if (cell && cell.style !== undefined) {
                const style = styles[cell.style];
                if (style && normalizeHexColor(style.bgcolor) === targetColor) {
                    if (!allowedSet.has(`${yStr},${xStr}`)) {
                        rogueFound = true;
                        break;
                    }
                }
            }
        }
        if (rogueFound) break;
    }

    if (!rogueFound) return 0; // Skip state mutation entirely

    // 2. Perform actual cleanup within history wrapper
    let updatedCount = 0;
    executeStateChange((d) => {
        if (!d.rows || !Array.isArray(d.styles)) return;

        Object.keys(d.rows).forEach((yStr) => {
            if (yStr === 'len') return;
            const y = parseInt(yStr, 10);
            const row = d.rows[yStr];
            if (!row || !row.cells) return;

            Object.keys(row.cells).forEach((xStr) => {
                const x = parseInt(xStr, 10);
                const cell = row.cells[xStr];
                if (!cell || cell.style === undefined) return;

                const existingStyle = d.styles[cell.style];
                if (!existingStyle || normalizeHexColor(existingStyle.bgcolor) !== targetColor) return;

                if (!allowedSet.has(`${y},${x}`)) {
                    const nextStyle = JSON.parse(JSON.stringify(existingStyle));
                    delete nextStyle.bgcolor;

                    const compacted = compactStyleObject(nextStyle);
                    if (Object.keys(compacted).length > 0) {
                        cell.style = getOrCreateStyleIndex(d.styles, compacted);
                    } else {
                        delete cell.style;
                    }
                    updatedCount++;
                }
            });
        });
    });

    return updatedCount;
}

function toggleBoldForSelection() {
    if (!mySpreadsheet) return;

    const targetRange = activeToolbarSelectionSnapshot || getActiveSelectionRange();
    const data = mySpreadsheet.getData()[0];
    const styles = data.styles || [];
    let allBold = true;

    for (let y = targetRange.sri; y <= targetRange.eri; y++) {
        for (let x = targetRange.sci; x <= targetRange.eci; x++) {
            const cell = data.rows?.[y]?.cells?.[x];
            const style = cell && cell.style !== undefined ? styles[cell.style] : null;
            if (!(style && style.font && style.font.bold)) {
                allBold = false;
                y = targetRange.eri + 1;
                break;
            }
        }
    }

    const shouldBold = !allBold;
    executeStateChange((d) => {
        if (!d.rows) d.rows = { len: 100 };
        if (!Array.isArray(d.styles)) d.styles = [];

        for (let y = targetRange.sri; y <= targetRange.eri; y++) {
            if (!d.rows[y]) d.rows[y] = { cells: {} };
            if (!d.rows[y].cells) d.rows[y].cells = {};

            for (let x = targetRange.sci; x <= targetRange.eci; x++) {
                const existingCell = d.rows[y].cells[x] || {};
                const baseStyle = (existingCell.style !== undefined && d.styles[existingCell.style])
                    ? JSON.parse(JSON.stringify(d.styles[existingCell.style]))
                    : {};

                if (shouldBold) {
                    baseStyle.font = { ...(baseStyle.font || {}), bold: true };
                } else if (baseStyle.font) {
                    delete baseStyle.font.bold;
                    if (Object.keys(baseStyle.font).length === 0) {
                        delete baseStyle.font;
                    }
                }

                existingCell.style = getOrCreateStyleIndex(d.styles, baseStyle);
                d.rows[y].cells[x] = existingCell;
            }
        }
    });
}

function saveHistoryState() {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data) return;
    
    let dataSnapshot = mySpreadsheet.getData()[0];
    const selectionRange = getActiveSelectionRange();
    
    let currentState = JSON.stringify({
        data: dataSnapshot,
        sel: selectionRange
    });
    
    if (appHistoryIndex >= 0) {
        let prev = JSON.parse(appHistory[appHistoryIndex]);
        if (JSON.stringify(prev.data) === JSON.stringify(dataSnapshot)) {
            return; // Prevent duplicate identical data states
        }
    }
    
    appHistory.length = appHistoryIndex + 1; 
    appHistory.push(currentState);
    appHistoryIndex++;
}

function clickNativeToolbarButton(tooltipPattern) {
    const buttons = Array.from(document.querySelectorAll('.x-spreadsheet-toolbar-btn'));
    const target = buttons.find((btn) => tooltipPattern.test(btn.getAttribute('data-tooltip') || ''));
    if (target) {
        target.click();
        return true;
    }
    return false;
}

function mergeSelectionSafely() {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data || !mySpreadsheet.sheet.selector) return;

    const requestedRange = activeToolbarSelectionSnapshot || getActiveSelectionRange();
    const target = normalizeSelectionRange(requestedRange);
    const singleCell = target.sri === target.eri && target.sci === target.eci;

    const sheet = mySpreadsheet.sheet;
    const data = sheet.data;

    if (!singleCell) {
        restoreSelectorRange(target);
    }

    if (typeof data.canUnmerge === 'function' && data.canUnmerge()) {
        data.unmerge();
        if (typeof sheet.reload === 'function') {
            sheet.reload();
        } else if (typeof sheet.render === 'function') {
            sheet.render();
        }
        patchSelector();

        const postUnmergeRange = singleCell
            ? { sri: target.sri, sci: target.sci, eri: target.sri, eci: target.sci }
            : target;
        scheduleRestoreFocus(postUnmergeRange, { skipSyntheticClick: true });
        return;
    }

    if (singleCell) return;

    if (typeof data.merge === 'function') {
        data.merge();
    }
    if (typeof sheet.reload === 'function') {
        sheet.reload();
    } else if (typeof sheet.render === 'function') {
        sheet.render();
    }
    patchSelector();

    const currentRange = getActiveSelectionRange();
    scheduleRestoreFocus(currentRange, { skipSyntheticClick: true });
}

function joinSelectionContentsSafely() {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data || !mySpreadsheet.sheet.selector) return;

    const requestedRange = activeToolbarSelectionSnapshot || getActiveSelectionRange();
    const target = normalizeSelectionRange(requestedRange);
    const singleCell = target.sri === target.eri && target.sci === target.eci;

    const sheet = mySpreadsheet.sheet;
    const data = sheet.data;

    if (typeof data.canUnmerge === 'function' && data.canUnmerge()) {
        data.unmerge();
        if (typeof sheet.reload === 'function') {
            sheet.reload();
        } else if (typeof sheet.render === 'function') {
            sheet.render();
        }
        patchSelector();

        const postUnmergeRange = singleCell
            ? { sri: target.sri, sci: target.sci, eri: target.sri, eci: target.sci }
            : target;
        scheduleRestoreFocus(postUnmergeRange, { skipSyntheticClick: true });
        return;
    }

    if (singleCell) return;

    applyDataMutation((d) => {
        if (!d.rows) d.rows = { len: 100 };
        if (!Array.isArray(d.merges)) d.merges = [];

        const joinedText = collectJoinedSelectionText(d, target);
        const nextMerges = [];

        (d.merges || []).forEach((rawMerge) => {
            const parsedMerge = parseMergeEntry(rawMerge);
            if (!parsedMerge) {
                nextMerges.push(rawMerge);
                return;
            }

            if (rangesOverlap(parsedMerge, target)) {
                const anchorRow = d.rows[parsedMerge.sri];
                const anchorCell = anchorRow && anchorRow.cells ? anchorRow.cells[parsedMerge.sci] : null;
                if (anchorCell && anchorCell.merge) {
                    delete anchorCell.merge;
                }
                return;
            }

            nextMerges.push(rawMerge);
        });

        d.merges = nextMerges;

        for (let y = target.sri; y <= target.eri; y++) {
            if (!d.rows[y]) d.rows[y] = { cells: {} };
            if (!d.rows[y].cells) d.rows[y].cells = {};

            for (let x = target.sci; x <= target.eci; x++) {
                if (y === target.sri && x === target.sci) continue;
                delete d.rows[y].cells[x];
            }
        }

        if (!d.rows[target.sri]) d.rows[target.sri] = { cells: {} };
        if (!d.rows[target.sri].cells) d.rows[target.sri].cells = {};

        const anchorCell = d.rows[target.sri].cells[target.sci] ? { ...d.rows[target.sri].cells[target.sci] } : {};
        if (joinedText === '') {
            delete anchorCell.text;
        } else {
            anchorCell.text = joinedText;
        }

        anchorCell.merge = [target.eri - target.sri, target.eci - target.sci];
        d.rows[target.sri].cells[target.sci] = anchorCell;
        d.merges.push(`${xyToCoord(target.sci, target.sri)}:${xyToCoord(target.eci, target.eri)}`);
        d.rows.len = Math.max(Number.isInteger(d.rows.len) ? d.rows.len : 100, target.eri + 1);
    });

    scheduleRestoreFocus(target, { skipSyntheticClick: true });
}

function parseMergeEntry(mergeEntry) {
    if (typeof mergeEntry === 'string') {
        const parts = mergeEntry.split(':');
        if (parts.length !== 2) return null;
        const start = coordToXY(parts[0]);
        const end = coordToXY(parts[1]);
        if (!start || !end) return null;
        return {
            sri: Math.min(start.y, end.y),
            sci: Math.min(start.x, end.x),
            eri: Math.max(start.y, end.y),
            eci: Math.max(start.x, end.x)
        };
    }

    if (mergeEntry && Number.isInteger(mergeEntry.sri) && Number.isInteger(mergeEntry.sci) && Number.isInteger(mergeEntry.eri) && Number.isInteger(mergeEntry.eci)) {
        return {
            sri: Math.min(mergeEntry.sri, mergeEntry.eri),
            sci: Math.min(mergeEntry.sci, mergeEntry.eci),
            eri: Math.max(mergeEntry.sri, mergeEntry.eri),
            eci: Math.max(mergeEntry.sci, mergeEntry.eci)
        };
    }

    return null;
}

function findMergeCoveringCell(mergeEntries, rowIndex, colIndex) {
    for (let i = 0; i < mergeEntries.length; i++) {
        const merge = mergeEntries[i];
        if (!merge) continue;
        if (rowIndex >= merge.sri && rowIndex <= merge.eri && colIndex >= merge.sci && colIndex <= merge.eci) {
            return { index: i, merge };
        }
    }
    return null;
}

function getParsedMerges(data) {
    if (!data || !data.merges) return [];

    const mergesArray = Array.isArray(data.merges)
        ? data.merges
        : (Array.isArray(data.merges.merges)
            ? data.merges.merges
            : (Array.isArray(data.merges._) ? data.merges._ : []));

    return mergesArray.map(parseMergeEntry).filter(Boolean);
}

function isWritablePasteTarget(data, rowIndex, colIndex) {
    const coveringMerge = findMergeCoveringCell(getParsedMerges(data), rowIndex, colIndex);
    return !coveringMerge || (coveringMerge.merge.sri === rowIndex && coveringMerge.merge.sci === colIndex);
}

function cellHasTextValue(cell) {
    return !!(cell && cell.text !== undefined && cell.text !== null && String(cell.text) !== '');
}

function normalizeSelectionRange(range) {
    if (!range) return { sri: 0, sci: 0, eri: 0, eci: 0 };

    const sri = Number.isInteger(range.sri) ? range.sri : 0;
    const sci = Number.isInteger(range.sci) ? range.sci : 0;
    const eri = Number.isInteger(range.eri) ? range.eri : sri;
    const eci = Number.isInteger(range.eci) ? range.eci : sci;

    return {
        sri: Math.min(sri, eri),
        sci: Math.min(sci, eci),
        eri: Math.max(sri, eri),
        eci: Math.max(sci, eci),
    };
}

function rangesOverlap(a, b) {
    return !!(a && b && a.sri <= b.eri && a.eri >= b.sri && a.sci <= b.eci && a.eci >= b.sci);
}

function collectJoinedSelectionText(data, range) {
    const parts = [];

    for (let x = range.sci; x <= range.eci; x++) {
        for (let y = range.sri; y <= range.eri; y++) {
            const text = getCellTextFromData(data, y, x);
            if (text !== '') {
                parts.push(text);
            }
        }
    }

    return parts.join('');
}

function mergeDownSelection() {
    if (!mySpreadsheet) return;

    const targetRange = activeToolbarSelectionSnapshot || getActiveSelectionRange();
    executeStateChange((d) => {
        if (!d.rows) d.rows = { len: 100 };
        if (!Array.isArray(d.merges)) d.merges = [];

        const mergeRefs = d.merges.map((rawMerge, rawIndex) => ({ rawIndex, merge: parseMergeEntry(rawMerge) }));
        const usedAreaMaxRow = getMaxBounds(d).maxR;
        const rowLimit = Math.max(targetRange.sri + 1, usedAreaMaxRow + 1);

        const removeMergeRef = (mergeRef) => {
            if (!mergeRef || !mergeRef.merge || !Number.isInteger(mergeRef.rawIndex)) return;

            const removed = d.merges.splice(mergeRef.rawIndex, 1);
            if (removed.length === 0) return;

            for (let i = 0; i < mergeRefs.length; i++) {
                if (mergeRefs[i].rawIndex > mergeRef.rawIndex) {
                    mergeRefs[i].rawIndex -= 1;
                }
            }

            const anchorRow = d.rows[mergeRef.merge.sri];
            const anchorCell = anchorRow && anchorRow.cells ? anchorRow.cells[mergeRef.merge.sci] : null;
            if (anchorCell && anchorCell.merge) {
                delete anchorCell.merge;
            }
        };

        for (let col = targetRange.sci; col <= targetRange.eci; col++) {
            const startRow = targetRange.sri;
            let effectiveBottom = startRow;

            const containingMergeRef = mergeRefs.find((ref) => {
                const merge = ref && ref.merge;
                return !!(merge
                    && startRow >= merge.sri
                    && startRow <= merge.eri
                    && col >= merge.sci
                    && col <= merge.eci);
            });

            // Merge-down should always originate at the selected cell.
            // If the selection is inside an existing merge, unmerge first.
            if (containingMergeRef) {
                removeMergeRef(containingMergeRef);
            }

            let nextFilledRow = null;
            for (let row = effectiveBottom + 1; row < rowLimit; row++) {
                const cell = d.rows[row] && d.rows[row].cells ? d.rows[row].cells[col] : null;
                if (cellHasTextValue(cell)) {
                    nextFilledRow = row;
                    break;
                }
            }

            const newEndRow = nextFilledRow === null ? rowLimit - 1 : nextFilledRow - 1;
            if (newEndRow <= startRow) {
                continue;
            }

            if (!d.rows[startRow]) d.rows[startRow] = { cells: {} };
            if (!d.rows[startRow].cells) d.rows[startRow].cells = {};
            const anchorCell = d.rows[startRow].cells[col] || {};
            anchorCell.merge = [newEndRow - startRow, 0];
            d.rows[startRow].cells[col] = anchorCell;

            const mergeString = `${xyToCoord(col, startRow)}:${xyToCoord(col, newEndRow)}`;
            d.merges.push(mergeString);
            mergeRefs.push({
                rawIndex: d.merges.length - 1,
                merge: { sri: startRow, sci: col, eri: newEndRow, eci: col }
            });
        }
    });
}

function insertRowAtSelection() {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data || !mySpreadsheet.sheet.data.selector) return;

    executeStateChange((d) => {
        let targetRow = mySpreadsheet.sheet.data.selector.ri;
        let newRows = {};
        let maxRow = 0;
        Object.keys(d.rows).forEach(rStr => {
            if (rStr === 'len') return;
            let r = parseInt(rStr);
            if (r < targetRow) { newRows[r] = d.rows[r]; maxRow = Math.max(maxRow, r); }
            else if (r >= targetRow) { newRows[r + 1] = d.rows[r]; maxRow = Math.max(maxRow, r + 1); }
        });
        newRows[targetRow] = { cells: {} };
        newRows.len = Math.max(d.rows.len || 100, maxRow + 20);
        d.rows = newRows;

        let newMerges = [];
        (d.merges || []).forEach(mergeStr => {
            const parsedMerge = parseMergeEntry(mergeStr);
            if (!parsedMerge) {
                newMerges.push(mergeStr);
                return;
            }
            let start = { x: parsedMerge.sci, y: parsedMerge.sri };
            let end = { x: parsedMerge.eci, y: parsedMerge.eri };
            if (start.y < targetRow && end.y >= targetRow) {
                end.y += 1;
                newMerges.push(`${xyToCoord(start.x, start.y)}:${xyToCoord(end.x, end.y)}`);
                if (newRows[start.y] && newRows[start.y].cells && newRows[start.y].cells[start.x] && newRows[start.y].cells[start.x].merge) {
                    newRows[start.y].cells[start.x].merge[0] += 1;
                }
            } else if (start.y >= targetRow) {
                start.y += 1; end.y += 1;
                newMerges.push(`${xyToCoord(start.x, start.y)}:${xyToCoord(end.x, end.y)}`);
            } else { newMerges.push(mergeStr); }
        });
        d.merges = newMerges;
    });
}

function deleteRowAtSelection() {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data || !mySpreadsheet.sheet.data.selector) return;

    executeStateChange((d) => {
        let targetRow = mySpreadsheet.sheet.data.selector.ri;
        let newRows = {};
        let maxRow = 0;
        Object.keys(d.rows).forEach(rStr => {
            if (rStr === 'len') return;
            let r = parseInt(rStr);
            if (r < targetRow) { newRows[r] = d.rows[r]; maxRow = Math.max(maxRow, r); }
            else if (r > targetRow) { newRows[r - 1] = d.rows[r]; maxRow = Math.max(maxRow, r - 1); }
        });
        newRows.len = Math.max(d.rows.len || 100, maxRow + 20);
        d.rows = newRows;

        let newMerges = [];
        (d.merges || []).forEach(mergeStr => {
            const parsedMerge = parseMergeEntry(mergeStr);
            if (!parsedMerge) {
                newMerges.push(mergeStr);
                return;
            }
            let start = { x: parsedMerge.sci, y: parsedMerge.sri };
            let end = { x: parsedMerge.eci, y: parsedMerge.eri };
            if (start.y === targetRow) {
                // Drops merge
            } else if (start.y < targetRow && end.y >= targetRow) {
                end.y -= 1;
                if (end.y > start.y || end.x > start.x) {
                    newMerges.push(`${xyToCoord(start.x, start.y)}:${xyToCoord(end.x, end.y)}`);
                    if (newRows[start.y] && newRows[start.y].cells && newRows[start.y].cells[start.x] && newRows[start.y].cells[start.x].merge) {
                        newRows[start.y].cells[start.x].merge[0] -= 1;
                    }
                } else {
                    if (newRows[start.y] && newRows[start.y].cells && newRows[start.y].cells[start.x]) {
                        delete newRows[start.y].cells[start.x].merge;
                    }
                }
            } else if (start.y > targetRow) {
                start.y -= 1; end.y -= 1;
                newMerges.push(`${xyToCoord(start.x, start.y)}:${xyToCoord(end.x, end.y)}`);
            } else { newMerges.push(mergeStr); }
        });
        d.merges = newMerges;
    });
}

function performUndo() {
    if (appHistoryIndex > 0) {
        const viewportScroll = getViewportScrollPosition();
        appHistoryIndex--;
        let state = JSON.parse(appHistory[appHistoryIndex]);
        _viewportSyncRequestId++;
        mySpreadsheet.loadData([state.data]);
        patchSelector();

        // Restore viewport first
        restoreViewportScrollPosition(viewportScroll);

        if (state.sel && mySpreadsheet.sheet && mySpreadsheet.sheet.selector) {
            if (
                Number.isInteger(state.sel.sri) &&
                Number.isInteger(state.sel.sci) &&
                Number.isInteger(state.sel.eri) &&
                Number.isInteger(state.sel.eci)
            ) {
                restoreSelectorRange(state.sel);
            } else if (Number.isInteger(state.sel.ri) && Number.isInteger(state.sel.ci)) {
                // Preserve indexes while preventing viewport movement during restore.
                mySpreadsheet.sheet.selector.set(state.sel.ri, state.sel.ci, { autoScroll: false, indexesUpdated: true });
            }
        }

        // Enforce original viewport after selector restoration.
        restoreViewportScrollPosition(viewportScroll);
        
        requestAnimationFrame(() => restoreViewportScrollPosition(viewportScroll));
        notifySerializedChange();
    }
}

function performRedo() {
    if (appHistoryIndex < appHistory.length - 1) {
        const viewportScroll = getViewportScrollPosition();
        appHistoryIndex++;
        let state = JSON.parse(appHistory[appHistoryIndex]);
        _viewportSyncRequestId++;
        mySpreadsheet.loadData([state.data]);
        patchSelector();

        // Restore viewport first
        restoreViewportScrollPosition(viewportScroll);

        if (state.sel && mySpreadsheet.sheet && mySpreadsheet.sheet.selector) {
            if (
                Number.isInteger(state.sel.sri) &&
                Number.isInteger(state.sel.sci) &&
                Number.isInteger(state.sel.eri) &&
                Number.isInteger(state.sel.eci)
            ) {
                restoreSelectorRange(state.sel);
            } else if (Number.isInteger(state.sel.ri) && Number.isInteger(state.sel.ci)) {
                // Preserve indexes while preventing viewport movement during restore.
                mySpreadsheet.sheet.selector.set(state.sel.ri, state.sel.ci, { autoScroll: false, indexesUpdated: true });
            }
        }

        // Enforce original viewport after selector restoration.
        restoreViewportScrollPosition(viewportScroll);

        requestAnimationFrame(() => restoreViewportScrollPosition(viewportScroll));
        notifySerializedChange();
    }
}

// Intercept hardware keyboard shortcuts (Overpowering library defaults)
function isSelectorHiddenInputTarget(target) {
    return !!(target
        && target.tagName === 'INPUT'
        && typeof target.closest === 'function'
        && target.closest('#spreadsheet-container .x-spreadsheet-selector .hide-input'));
}

function startSelectionEditWithInitialText(initialText) {
    const sheet = mySpreadsheet && mySpreadsheet.sheet;
    if (!sheet || !sheet.data || !sheet.editor) return false;
    if (sheet.data.settings && sheet.data.settings.mode === 'read') return false;

    // unwrap x-data-spreadsheet's custom DOM objects
    const editorDomEl = sheet.editor.el ? (sheet.editor.el.el || sheet.editor.el) : null;
    const isEditorActive = editorDomEl && editorDomEl.style && editorDomEl.style.display !== 'none';

    // If the editor is already visible but the 
    // browser hasn't shifted focus yet, just append the new keystroke manually 
    if (isEditorActive && sheet.editor.textEl) {
        // Unwrap the textarea as well
        const textArea = sheet.editor.textEl.el || sheet.editor.textEl;
        if (textArea) {
            textArea.value += initialText;
            // Trigger a native input event so the library resizes the editor box properly
            textArea.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }
    }

    // Initialize a fresh edit state for the first keystroke
    if (typeof sheet.data.setSelectedCellText === 'function') {
        sheet.data.setSelectedCellText(initialText, 'input');
    } else {
        return false;
    }

    if (typeof sheet.getTableOffset === 'function' && typeof sheet.data.getSelectedRect === 'function' && typeof sheet.editor.setOffset === 'function') {
        const selectedRect = sheet.data.getSelectedRect();
        const tableOffset = sheet.getTableOffset();
        const editorPosition = selectedRect && tableOffset && selectedRect.top > tableOffset.height / 2 ? 'bottom' : 'top';
        sheet.editor.setOffset(selectedRect, editorPosition);
    }

    if (typeof sheet.editor.setCell === 'function' && typeof sheet.data.getSelectedCell === 'function') {
        const validator = typeof sheet.data.getSelectedValidator === 'function'
            ? sheet.data.getSelectedValidator()
            : null;
        sheet.editor.setCell(sheet.data.getSelectedCell(), validator);
    }

    return true;
}

function handleSpreadsheetKeydown(e) {
    // If find dialog is open, don't let keyboard events reach the spreadsheet
    const findDialog = document.getElementById('find-replace-dialog');
    if (findDialog && !findDialog.classList.contains('hidden')) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            closeFindReplace();
            return;
        }
        if (findDialog.contains(e.target)) {
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;  // Let find dialog handle it
        }
    }

    const formulaInput = document.getElementById('spreadsheet-formula-input');
    if (formulaInput && e.target === formulaInput) {
        return;
    }

    const target = e.target;
    const isTextEntryTarget = !!(target && (target.tagName === 'TEXTAREA' || target.isContentEditable || target.tagName === 'INPUT'));
    const isHiddenSelectorInput = isSelectorHiddenInputTarget(target);

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (isHiddenSelectorInput) {
            // Let the paste event handler decide between native and fallback paste flows.
            return;
        }
    }

    const isSelectionFocused = !!(mySpreadsheet && mySpreadsheet.sheet && mySpreadsheet.sheet.focusing);
    const isPrintableSingleChar = typeof e.key === 'string' && e.key.length === 1 && !/\s/.test(e.key);

    // Iintercept all single printable characters if they hit the hidden selector input.
    // Note that native x-data-spreadsheet only starts edit mode for [A-Z0-9=] from selector mode.
    // This allows users to type ",.;:" directly, but we do it for all characters to prevent race
    // conditions with the library's own key handling which can lead to duplicate keystrokes appearing in the editor.
    if (
        isSelectionFocused
        && !e.ctrlKey
        && !e.metaKey
        && !e.altKey
        && !e.isComposing
        && isPrintableSingleChar
        && (!isTextEntryTarget || isHiddenSelectorInput)
    ) {
        if (startSelectionEditWithInitialText(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }
    }
    
    if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (e.shiftKey) performRedo(); else performUndo();
            scheduleRestoreFocus();
        } else if (e.key.toLowerCase() === 'y') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            performRedo();
            scheduleRestoreFocus();
        } else if (e.key.toLowerCase() === 'm') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            mergeSelectionSafely();
        } else if (e.key.toLowerCase() === 'j') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            joinSelectionContentsSafely();
        } else if (e.key.toLowerCase() === 'b') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            toggleBoldForSelection();
        } else if (e.key.toLowerCase() === 'd') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            mergeDownSelection();
            scheduleRestoreFocus();
        } else if (e.key.toLowerCase() === 'l') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            insertRowAtSelection();
            scheduleRestoreFocus();
        } else if (e.key.toLowerCase() === 'k') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            deleteRowAtSelection();
            scheduleRestoreFocus();
        } else if (e.key === 'Home') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (mySpreadsheet && mySpreadsheet.sheet && mySpreadsheet.sheet.selector) {
                jumpSelectionTo(0, 0);
            }
        } else if (e.key === 'End') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (mySpreadsheet && mySpreadsheet.sheet && mySpreadsheet.sheet.selector) {
                let maxBounds = getMaxBounds(mySpreadsheet.getData()[0]);
                jumpSelectionTo(maxBounds.maxR, maxBounds.maxC);
            }
        } else if (e.key.toLowerCase() === 'f') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            openFindReplace();
        }
    } else {
        // Non-Modifier Custom Shortcuts (PageUp / PageDown)
        if (e.key === 'PageUp') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (mySpreadsheet && mySpreadsheet.sheet && mySpreadsheet.sheet.data && mySpreadsheet.sheet.data.selector) {
                let ri = Math.max(0, mySpreadsheet.sheet.data.selector.ri - 15);
                let ci = mySpreadsheet.sheet.data.selector.ci;
                jumpSelectionTo(ri, ci, false, { preserveHorizontal: true });
            }
        } else if (e.key === 'PageDown') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (mySpreadsheet && mySpreadsheet.sheet && mySpreadsheet.sheet.data && mySpreadsheet.sheet.data.selector) {
                let d = mySpreadsheet.getData()[0];
                let maxBounds = getMaxBounds(d);
                let len = d.rows.len || Math.max(100, maxBounds.maxR + 20);
                let ri = Math.min(len - 1, mySpreadsheet.sheet.data.selector.ri + 15);
                let ci = mySpreadsheet.sheet.data.selector.ci;
                jumpSelectionTo(ri, ci, false, { preserveHorizontal: true });
            }
        }
    }
}

let _resizeTimeout;
function handleWindowResize() {
    if (!mySpreadsheet) return;
    
    // Debounce the resize to prevent lag during continuous zooming/resizing
    clearTimeout(_resizeTimeout);
    _resizeTimeout = setTimeout(() => {
        // x-data-spreadsheet's resize() method will recalculate the devicePixelRatio 
        // and redraw the canvas at the new resolution
        if (typeof mySpreadsheet.resize === 'function') {
            mySpreadsheet.resize();
        } else if (mySpreadsheet.sheet && typeof mySpreadsheet.sheet.reload === 'function') {
            mySpreadsheet.sheet.reload();
        }
    }, 100);
}

// --- TOOLBAR ISOLATION LOGIC ---
function customizeToolbar() {
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
            btn._selectionSnapshot = getActiveSelectionRange();
            activeToolbarSelectionSnapshot = btn._selectionSnapshot;
            e.preventDefault();
        });
        btn.onclick = (e) => {
            const selectionSnapshot = btn._selectionSnapshot || getActiveSelectionRange();
            activeToolbarSelectionSnapshot = selectionSnapshot;
            onClick();
            if (!options.skipPostSelectionRestore) {
                restoreSelectorRange(selectionSnapshot);
                scheduleRestoreFocus(selectionSnapshot);
            }
            setTimeout(() => {
                if (activeToolbarSelectionSnapshot === selectionSnapshot) {
                    activeToolbarSelectionSnapshot = null;
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
            wrapper._selectionSnapshot = getActiveSelectionRange();
            activeToolbarSelectionSnapshot = wrapper._selectionSnapshot;
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
                activeToolbarSelectionSnapshot = wrapper._selectionSnapshot || getActiveSelectionRange();
                e.preventDefault();
            });
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                activeToolbarSelectionSnapshot = wrapper._selectionSnapshot || getActiveSelectionRange();
                applyBackgroundColorToSelection(hexColor);
                const indicator = trigger.querySelector('.custom-color-indicator');
                if (indicator) indicator.style.background = hexColor;
                menu.classList.remove('open');
                restoreSelectorRange(activeToolbarSelectionSnapshot);
                scheduleRestoreFocus(activeToolbarSelectionSnapshot);
                setTimeout(() => {
                    activeToolbarSelectionSnapshot = null;
                }, 100);
            });
            menu.appendChild(swatch);
        });

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('open');
            const selectionSnapshot = wrapper._selectionSnapshot || getActiveSelectionRange();
            activeToolbarSelectionSnapshot = selectionSnapshot;
            restoreSelectorRange(selectionSnapshot);
            scheduleRestoreFocus(selectionSnapshot);
            setTimeout(() => {
                if (activeToolbarSelectionSnapshot === selectionSnapshot) {
                    activeToolbarSelectionSnapshot = null;
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
    if (allowDataTransfer) {
        createSvgBtn(iconImport, 'Import Data', () => openModal('import'));
        createSvgBtn(iconExport, 'Export Data', () => openModal('export'));
    }

    const divider0 = document.createElement('div');
    divider0.className = 'x-spreadsheet-toolbar-divider';
    divider0.style.display = 'inline-block';
    customGroup.appendChild(divider0);

    createSvgBtn(iconUndo, 'Undo (Ctrl+Z)', performUndo);
    createSvgBtn(iconRedo, 'Redo (Ctrl+Y)', performRedo);
    createSvgBtn(iconBold, 'Bold (Ctrl+B)', () => toggleBoldForSelection());
    createSvgBtn(iconMerge, 'Merge (Ctrl+M)', () => mergeSelectionSafely(), { skipPostSelectionRestore: true });
    createSvgBtn(iconJoin, 'Join Contents (Ctrl+J)', () => joinSelectionContentsSafely(), { skipPostSelectionRestore: true });
    createSvgBtn(iconMergeDown, 'Merge Down (Ctrl+D)', () => mergeDownSelection());

    const divider1 = document.createElement('div');
    divider1.className = 'x-spreadsheet-toolbar-divider';
    divider1.style.display = 'inline-block';
    customGroup.appendChild(divider1);

    const iconSearch = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    createSvgBtn(iconSearch, 'Find & Replace (Ctrl+F)', () => openFindReplace());

    const syncFreezeButtonState = (btn) => {
        if (!btn || !mySpreadsheet || typeof mySpreadsheet.getData !== 'function') return;
        const data = mySpreadsheet.getData()[0] || {};
        btn.classList.toggle('custom-btn-active', data.freeze === 'A2');
    };

    const freezeBtn = createSvgBtn(iconFreeze, 'Toggle Freeze Header', () => { 
        executeStateChange((d) => {
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

    createSvgBtn(iconAddRow, 'Insert Row (Ctrl+L)', () => insertRowAtSelection());

    createSvgBtn(iconDelRow, 'Delete Row (Ctrl+K)', () => deleteRowAtSelection());

    createSvgBtn(iconAddCol, 'Insert Column', () => { 
        executeStateChange((d) => {
            let targetCol = mySpreadsheet.sheet.data.selector.ci;
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
        executeStateChange((d) => {
            let targetCol = mySpreadsheet.sheet.data.selector.ci;
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

function executeStateChange(mutationCallback) {
    applyDataMutation(mutationCallback);
}

function normalizeLineEndings(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\r\n?/g, '\n');
}

// --- COLUMN REORDERING LOGIC ---
function reorderSocialCalcColumns(socialCalcData, preferredOrder) {
    if (!socialCalcData) return socialCalcData;
    const prefOrder = Array.isArray(preferredOrder) ? preferredOrder : [];

    const lines = socialCalcData.split('\n');

    // 1. Separate metadata from cells and extract the grid
    const metadataPre = [];
    const metadataPost = [];
    const cells = [];
    let state = 'PRE';
    let maxRow = 0;

    const colHeaders = {}; // colIndex -> header string
    const headerStyles = {}; // header string -> cell payload (to recreate headers)

    lines.forEach(line => {
        const cleanLine = line.replace(/\r$/, '');
        if (state === 'PRE') {
            if (cleanLine.startsWith('cell:')) {
                state = 'CELLS';
            } else if (cleanLine.startsWith('sheet:')) {
                state = 'POST';
                metadataPost.push(cleanLine);
                return;
            } else {
                metadataPre.push(cleanLine);
                return;
            }
        }

        if (state === 'CELLS') {
            if (cleanLine.startsWith('cell:')) {
                const parts = cleanLine.split(':');
                const coord = parts[1];
                const match = coord.match(/^([A-Z]+)(\d+)$/);
                
                if (match) {
                    const c = colToInt(match[1]);
                    const r = parseInt(match[2], 10) - 1;
                    maxRow = Math.max(maxRow, r);

                    const rIdx = parts.indexOf('rowspan');
                    const rowspan = rIdx !== -1 && rIdx + 1 < parts.length ? parseInt(parts[rIdx + 1], 10) : 1;
                    const payload = parts.slice(2).join(':');

                    if (r === 0) {
                        const tIdx = parts.indexOf('t');
                        let headerText = '';
                        if (tIdx !== -1 && tIdx + 1 < parts.length) {
                            headerText = parts[tIdx + 1].replace(/\\c/g, ':').replace(/\\n/g, '\n');
                        }
                        colHeaders[c] = headerText;
                        if (!headerStyles[headerText]) {
                            headerStyles[headerText] = payload;
                        }
                    } else {
                        cells.push({ r, c, rowspan, payload });
                    }
                }
            } else if (cleanLine.startsWith('sheet:') || cleanLine.startsWith('--SocialCalc') || cleanLine.startsWith('font:') || cleanLine.startsWith('valueformat:')) {
                state = 'POST';
                metadataPost.push(cleanLine);
            }
        } else if (state === 'POST') {
            metadataPost.push(cleanLine);
        }
    });

    // Fallback for any cells in a column that somehow missed a row 0 header
    cells.forEach(cell => {
        if (colHeaders[cell.c] === undefined) {
            colHeaders[cell.c] = `UNKNOWN_${cell.c}`;
        }
        cell.header = colHeaders[cell.c];
    });

    // 2. Group cells by header and record original header appearance order
    const headerGroups = {};
    const originalHeaderOrder = [];

    Object.keys(colHeaders).sort((a, b) => a - b).forEach(c => {
        const h = colHeaders[c];
        if (!originalHeaderOrder.includes(h)) {
            originalHeaderOrder.push(h);
        }
        if (!headerGroups[h]) headerGroups[h] = [];
    });

    cells.forEach(cell => {
        if (!headerGroups[cell.header]) headerGroups[cell.header] = [];
        headerGroups[cell.header].push(cell);
    });

    // 3. Compact cells within each header group (Interval Scheduling / Bin Packing)
    const compactedGroups = {};

    for (const header in headerGroups) {
        const groupCells = headerGroups[header];
        
        // Sort cells by longest rowspan first, then highest starting row
        groupCells.sort((a, b) => {
            if (a.rowspan !== b.rowspan) return b.rowspan - a.rowspan;
            if (a.r !== b.r) return a.r - b.r;
            return a.c - b.c; 
        });

        // virtualCols represents our newly compacted columns for this specific header
        const virtualCols = []; 

        groupCells.forEach(cell => {
            let placed = false;
            
            // Try to fold the cell into an existing virtual column
            for (let i = 0; i < virtualCols.length; i++) {
                const vCol = virtualCols[i];
                let canPlace = true;
                
                // Check if any required row is already occupied in this virtual column
                for (let y = cell.r; y < cell.r + cell.rowspan; y++) {
                    if (vCol.occupied.has(y)) {
                        canPlace = false;
                        break;
                    }
                }
                
                if (canPlace) {
                    for (let y = cell.r; y < cell.r + cell.rowspan; y++) {
                        vCol.occupied.add(y);
                    }
                    vCol.cells.push(cell);
                    placed = true;
                    break;
                }
            }

            // If it couldn't fit in any existing column, create a new one to the right
            if (!placed) {
                const newVCol = { occupied: new Set(), cells: [cell] };
                for (let y = cell.r; y < cell.r + cell.rowspan; y++) {
                    newVCol.occupied.add(y);
                }
                virtualCols.push(newVCol);
            }
        });

        // Ensure we at least render a header column even if it has no data cells
        if (virtualCols.length === 0) {
            virtualCols.push({ occupied: new Set(), cells: [] });
        }

        compactedGroups[header] = virtualCols;
    }

    // 4. Sort the unique headers based on preferredOrder, falling back to original order
    const sortedHeaders = [...originalHeaderOrder].sort((a, b) => {
        const idxA = prefOrder.indexOf(a);
        const idxB = prefOrder.indexOf(b);
        const hasA = idxA !== -1;
        const hasB = idxB !== -1;

        if (hasA && hasB) return idxA - idxB;
        if (hasA && !hasB) return -1;
        if (!hasA && hasB) return 1;
        return originalHeaderOrder.indexOf(a) - originalHeaderOrder.indexOf(b);
    });

    // 5. Rebuild the SocialCalc string with the new coordinates
    const finalCells = [];
    let currentFinalCol = 0;

    sortedHeaders.forEach(header => {
        const vCols = compactedGroups[header];
        if (!vCols) return;

        vCols.forEach(vCol => {
            // Write the Header cell (Row 0)
            const headerPayload = headerStyles[header] || `t:${header.replace(/:/g, '\\c').replace(/\n/g, '\\n')}:f:1`;
            finalCells.push(`cell:${xyToCoord(currentFinalCol, 0)}:${headerPayload}`);

            // Write the Data cells
            vCol.cells.forEach(cell => {
                finalCells.push(`cell:${xyToCoord(currentFinalCol, cell.r)}:${cell.payload}`);
            });

            currentFinalCol++;
        });
    });

    const maxColFinal = currentFinalCol - 1;

    // Combine metadata and new cells
    const newLines = [...metadataPre, ...finalCells];

    // Correct the `sheet:` bounds to reflect dropped/compacted columns
    metadataPost.forEach(line => {
        if (line.startsWith('sheet:')) {
            const parts = line.split(':');
            const cIdx = parts.indexOf('c');
            const rIdx = parts.indexOf('r');
            if (cIdx !== -1) parts[cIdx + 1] = (maxColFinal + 1).toString();
            if (rIdx !== -1) parts[rIdx + 1] = (maxRow + 1).toString();
            newLines.push(parts.join(':'));
        } else if (!line.startsWith('col:')) { 
            // Drop any old custom column widths (col:) as they no longer map 1:1
            newLines.push(line);
        }
    });

    return newLines.join('\n');
}


// --- 1. IMPORT LOGIC (SocialCalc -> X-Spreadsheet) ---
function importSocialCalc(rawData, emitChange = true) {
    // Intercept with column sorting first
    const sourceRaw = typeof rawData === 'string' ? rawData : '';
    const raw = reorderSocialCalcColumns(sourceRaw, currentPreferredColumnOrder);
    const didReorderColumns = normalizeLineEndings(raw) !== normalizeLineEndings(sourceRaw);
    const lines = raw.split('\n');

    let cellData = {};
    let sheetMerges = []; 
    let maxCol = 0;
    let maxRow = 0;
    
    let stylesList = [
        {
            font: {
                name: getEffectiveSpreadsheetFontFamily(),
                size: 10,
                bold: true,
                italic: false,
            },
            bgcolor: '#f3f4f6',
            valign: 'top'
        }
    ];

    preSheetLines = [];
    postSheetLines = [];
    parsedFonts = [];
    parsedValueFormats = [];
    let state = 'PRE';

    lines.forEach(line => {
        let cleanLine = line.replace(/\r$/, '');

        if (state === 'PRE') {
            preSheetLines.push(cleanLine);
            if (cleanLine.startsWith('version:1.5')) state = 'SHEET';
        } 
        else if (state === 'SHEET') {
            if (cleanLine.startsWith('--SocialCalcSpreadsheetControlSave')) {
                state = 'POST';
                postSheetLines.push(cleanLine);
            } else {
                if (cleanLine.startsWith('font:')) parsedFonts.push(cleanLine);
                if (cleanLine.startsWith('valueformat:')) parsedValueFormats.push(cleanLine);

                if (cleanLine.startsWith('cell:')) {
                    const parts = cleanLine.split(':');
                    const coord = parts[1];
                    const pos = coordToXY(coord);
                    if (!pos) return;

                    maxCol = Math.max(maxCol, pos.x);
                    maxRow = Math.max(maxRow, pos.y);

                    if (!cellData[pos.y]) cellData[pos.y] = { cells: {} };
                    let cellObj = {};

                    const tIdx = parts.indexOf('t');
                    if (tIdx !== -1) {
                        let val = parts[tIdx + 1];
                        cellObj.text = val.replace(/\\c/g, ':').replace(/\\n/g, '\n');
                    }

                    const rIdx = parts.indexOf('rowspan');
                    const cIdx = parts.indexOf('colspan');
                    let rSpan = rIdx !== -1 ? parseInt(parts[rIdx + 1], 10) : 1;
                    let cSpan = cIdx !== -1 ? parseInt(parts[cIdx + 1], 10) : 1;
                    
                    if (rSpan > 1 || cSpan > 1) {
                        cellObj.merge = [rSpan - 1, cSpan - 1]; 
                        let startCell = coord;
                        let endCell = xyToCoord(pos.x + cSpan - 1, pos.y + rSpan - 1);
                        sheetMerges.push(`${startCell}:${endCell}`);
                    }

                    const styleObj = {};
                    const fIdx = parts.indexOf('f');
                    if (fIdx !== -1 && parts[fIdx + 1] === '2') {
                        styleObj.font = { bold: true };
                        styleObj.bgcolor = '#f3f4f6';
                        styleObj.valign = 'top';
                    }

                    const bgIdx = parts.indexOf('bgcolor');
                    if (bgIdx !== -1) {
                        const importedColor = normalizeHexColor(parts[bgIdx + 1]);
                        if (importedColor && !isDefaultBackgroundColor(importedColor)) {
                            styleObj.bgcolor = importedColor;
                        }
                    }

                    if (Object.keys(styleObj).length > 0) {
                        cellObj.style = getOrCreateStyleIndex(stylesList, styleObj);
                    }

                    cellData[pos.y].cells[pos.x] = cellObj;
                }
            }
        } 
        else if (state === 'POST') {
            postSheetLines.push(cleanLine);
        }
    });

    cellData.len = Math.max(100, maxRow + 20);
    stylesList = applyConfiguredFontToStyles(stylesList);

    const container = document.getElementById('spreadsheet-container');
    container.innerHTML = ''; 
    
    mySpreadsheet = new Spreadsheet('#spreadsheet-container', {
        showBottomBar: false, 
        style: {
            valign: 'top', 
            align: 'left',
            textwrap: true,
            font: {
                name: getEffectiveSpreadsheetFontFamily(),
                size: 10,
                bold: false,
                italic: false,
            }
        },
        view: {
            height: () => container.clientHeight,
            width: () => container.clientWidth,
        }
    });

    _viewportSyncRequestId++;
    mySpreadsheet.loadData([{
        name: 'Sheet1',
        styles: stylesList,
        cols: { len: Math.max(MAX_COLUMN_COUNT, maxCol + 1) },
        rows: cellData,
        merges: sheetMerges,
        freeze: 'A2'
    }]);

    customizeToolbar();
    patchSelector();
    patchContextMenu();
    syncFormulaBarFromSelection({ force: true });
    
    appHistory = [];
    appHistoryIndex = -1;
    saveHistoryState();
    
    mySpreadsheet.change(() => {
        saveHistoryState();
        notifySerializedChange();
        syncFormulaBarFromSelection();
    });

    if (emitChange) {
        notifySerializedChange();
    } else if (didReorderColumns && typeof onCanonicalized === 'function') {
        // Persist reordered SGML once so backend coordinates match visible columns.
        onCanonicalized(exportSocialCalc());
    }
}

// --- 2. EXPORT LOGIC (X-Spreadsheet -> SocialCalc) ---
function exportSocialCalc() {
    if (!mySpreadsheet) return "";

    const data = mySpreadsheet.getData()[0];
    const rows = data.rows || {};
    const stylesList = data.styles || [];

    let output = preSheetLines.join('\n') + '\n';

    let maxC = 0;
    let maxR = 0;

    let bounds = getMaxBounds(data);
    maxC = bounds.maxC;
    maxR = bounds.maxR;

    for (let y = 0; y <= maxR; y++) {
        if (!rows[y] || !rows[y].cells) continue;
        for (let x = 0; x <= maxC; x++) {
            let cell = rows[y].cells[x];
            if (!cell) continue;

            let coord = xyToCoord(x, y);
            let cellParts = [];

            if (cell.text !== undefined && cell.text !== null && cell.text !== '') {
                let escapedVal = String(cell.text).replace(/:/g, '\\c').replace(/\n/g, '\\n');
                cellParts.push(`t:${escapedVal}`);
            }

            const isHeaderRow = (y === 0);
            let isBold = isHeaderRow;
            if (!isHeaderRow && cell.style !== undefined && stylesList[cell.style]) {
                let s = stylesList[cell.style];
                if (s.font && s.font.bold) isBold = true;
            }

            if (isBold) {
                cellParts.push('f:2');
            } else if (cell.text !== undefined && cell.text !== null && cell.text !== '') {
                cellParts.push('f:1:tvf:1');
            }

            let bgColor = null;
            if (isHeaderRow && (cell.text !== undefined && cell.text !== null && cell.text !== '')) {
                bgColor = '#f3f4f6';
            } else if (cell.style !== undefined && stylesList[cell.style]) {
                bgColor = normalizeHexColor(stylesList[cell.style].bgcolor);
            }
            if (bgColor && !isDefaultBackgroundColor(bgColor)) {
                cellParts.push(`bgcolor:${bgColor}`);
            }

            if (cell.merge) {
                let rSpan = cell.merge[0] + 1;
                let cSpan = cell.merge[1] + 1;
                if (cSpan > 1) cellParts.push(`colspan:${cSpan}`);
                if (rSpan > 1) cellParts.push(`rowspan:${rSpan}`);
            }

            if (cellParts.length > 0) {
                output += `cell:${coord}:${cellParts.join(':')}\n`;
            }
        }
    }

    output += `sheet:c:${maxC + 1}:r:${maxR + 1}:tvf:2\n`;
    if (parsedFonts.length) output += parsedFonts.join('\n') + '\n';
    if (parsedValueFormats.length) output += parsedValueFormats.join('\n') + '\n';

    if (postSheetLines.length > 0) {
        output += postSheetLines.join('\n');
    } else {
        output += `--SocialCalcSpreadsheetControlSave\nContent-type: text/plain; charset=UTF-8\n--SocialCalcSpreadsheetControlSave--`;
    }

    return output;
}

// --- FIND & REPLACE ---
let findMatches = [];
let findMatchIndex = -1;

function openFindReplace() {
    const dialog = document.getElementById('find-replace-dialog');
    dialog.classList.remove('hidden');
    const input = document.getElementById('find-input');
    input.focus();
    input.select();
    runFindSearch();
}

function handleFindInputBlur(e) {
    const findDialog = document.getElementById('find-replace-dialog');
    if (!findDialog) return;
    // If the dialog is still open and focus went outside it, claw it back
    if (!findDialog.classList.contains('hidden') && !findDialog.contains(e.relatedTarget)) {
        // Double-rAF ensures we run after *any* library-scheduled focus work
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!findDialog.classList.contains('hidden') && !findDialog.contains(document.activeElement)) {
                document.getElementById('find-input').focus();
            }
        }));
    }
}

function closeFindReplace() {
    document.getElementById('find-replace-dialog').classList.add('hidden');
    findMatches = [];
    findMatchIndex = -1;
    scheduleRestoreFocus();
}

function getAllCellsForSearch() {
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

function buildSearchRegex(query, caseSensitive, useRegex, global = false) {
    const flags = (caseSensitive ? '' : 'i') + (global ? 'g' : '');
    const pattern = useRegex ? query : escapeRegex(query);
    return new RegExp(pattern, flags);
}

function runFindSearch() {
    const query = document.getElementById('find-input').value;
    const caseSensitive = document.getElementById('find-case-sensitive').checked;
    const useRegex = document.getElementById('find-use-regex').checked;
    const findInput = document.getElementById('find-input');
    findMatches = [];
    findMatchIndex = -1;
    const info = document.getElementById('find-match-info');
    if (!query) { info.textContent = ''; findInput.style.borderColor = ''; return; }

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

function navigateToMatch(idx) {
    if (findMatches.length === 0) return;
    idx = ((idx % findMatches.length) + findMatches.length) % findMatches.length;
    findMatchIndex = idx;
    const match = findMatches[idx];
    jumpSelectionTo(match.ri, match.ci, true);
    const info = document.getElementById('find-match-info');
    info.textContent = `${idx + 1} / ${findMatches.length}`;
    info.style.color = '#6b7280';

    // Re-focus find input if the dialog is open (library's selector.set steals focus)
    const findDialog = document.getElementById('find-replace-dialog');
    if (findDialog && !findDialog.classList.contains('hidden')) {
        setTimeout(() => document.getElementById('find-input').focus(), 0);
    }
}

function findNext() {
    if (findMatches.length === 0) { runFindSearch(); return; }
    navigateToMatch(findMatchIndex + 1);
}

function findPrev() {
    if (findMatches.length === 0) { runFindSearch(); return; }
    navigateToMatch(findMatchIndex - 1);
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getViewportScrollPosition() {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data) {
        return { x: 0, y: 0, ri: 0, ci: 0 };
    }

    const scroll = mySpreadsheet.sheet.data.scroll || {};
    return {
        x: Number.isFinite(scroll.x) ? scroll.x : 0,
        y: Number.isFinite(scroll.y) ? scroll.y : 0,
        ri: Number.isInteger(scroll.ri) ? scroll.ri : 0,
        ci: Number.isInteger(scroll.ci) ? scroll.ci : 0,
    };
}

function resolveVerticalScrollAnchor(data, targetY, fallbackRi = 0) {
    const rows = data && data.rows;
    const freezeRow = Array.isArray(data && data.freeze) && Number.isInteger(data.freeze[0]) ? data.freeze[0] : 0;
    const maxRows = rows && Number.isInteger(rows.len) ? rows.len : 0;
    const y = Number.isFinite(targetY) ? Math.max(0, targetY) : 0;

    if (!rows || maxRows <= 0 || y <= 0) {
        return { y: 0, ri: 0 };
    }

    let cumulative = 0;
    let ri = freezeRow;
    for (let i = freezeRow; i < maxRows; i++) {
        const h = Number(rows.getHeight(i)) || 0;
        if (h <= 0) continue;
        cumulative += h;
        ri = i;
        if (y <= cumulative) {
            return { y: cumulative, ri };
        }
    }

    const safeRi = Number.isInteger(fallbackRi) ? Math.max(0, Math.min(fallbackRi, maxRows - 1)) : ri;
    return { y: cumulative, ri: safeRi };
}

function resolveHorizontalScrollAnchor(data, targetX, fallbackCi = 0) {
    const cols = data && data.cols;
    const freezeCol = Array.isArray(data && data.freeze) && Number.isInteger(data.freeze[1]) ? data.freeze[1] : 0;
    const maxCols = cols && Number.isInteger(cols.len) ? cols.len : 0;
    const x = Number.isFinite(targetX) ? Math.max(0, targetX) : 0;

    if (!cols || maxCols <= 0 || x <= 0) {
        return { x: 0, ci: 0 };
    }

    let cumulative = 0;
    let ci = freezeCol;
    for (let i = freezeCol; i < maxCols; i++) {
        const w = Number(cols.getWidth(i)) || 0;
        if (w <= 0) continue;
        cumulative += w;
        ci = i;
        if (x <= cumulative) {
            return { x: cumulative, ci };
        }
    }

    const safeCi = Number.isInteger(fallbackCi) ? Math.max(0, Math.min(fallbackCi, maxCols - 1)) : ci;
    return { x: cumulative, ci: safeCi };
}

function restoreViewportScrollPosition(position) {
    if (!position || !mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data) return;

    const sheet = mySpreadsheet.sheet;
    const data = sheet.data;
    const targetX = Number.isFinite(position.x) ? position.x : 0;
    const targetY = Number.isFinite(position.y) ? position.y : 0;
    const fallbackRi = Number.isInteger(position.ri) ? position.ri : 0;
    const fallbackCi = Number.isInteger(position.ci) ? position.ci : 0;

    if (!data.scroll || typeof data.scroll !== 'object') data.scroll = {};
    data.scroll.y = targetY;
    data.scroll.ri = fallbackRi;
    data.scroll.x = targetX;
    data.scroll.ci = fallbackCi;

    const applyViewport = () => {
        // 1. MOVE SCROLLBARS FIRST
        if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
            try { sheet.verticalScrollbar.move(data.scroll ? data.scroll.y : targetY); } catch (e) {}
        }
        if (sheet.horizontalScrollbar && typeof sheet.horizontalScrollbar.move === 'function') {
            try { sheet.horizontalScrollbar.move(data.scroll ? data.scroll.x : targetX); } catch (e) {}
        }

        // 2. RECALCULATE SELECTION BOX OFFSETS
        if (sheet.selector && typeof sheet.selector.resetBRTAreaOffset === 'function') {
            sheet.selector.resetBRTAreaOffset();
        }
        if (sheet.selector && typeof sheet.selector.resetBRLAreaOffset === 'function') {
            sheet.selector.resetBRLAreaOffset();
        }
        if (sheet.selector && typeof sheet.selector.resetAreaOffset === 'function') {
            sheet.selector.resetAreaOffset();
        }
        
        // 3. RENDER CANVAS
        if (typeof sheet.render === 'function') {
            sheet.render();
        } else if (sheet.table && typeof sheet.table.render === 'function') {
            sheet.table.render();
        }
    };

    applyViewport();
}

 function applyDataMutation(mutationCallback) {

    let d = JSON.parse(JSON.stringify(mySpreadsheet.getData()[0]));
    ensureColumnCapacity(d);
    const selectionRange = getActiveSelectionRange();
    const viewportScroll = getViewportScrollPosition();

    mutationCallback(d);

    ensureColumnCapacity(d);
    _viewportSyncRequestId++;
    mySpreadsheet.loadData([d]);
    patchSelector();

    // Restore viewport first
    restoreViewportScrollPosition(viewportScroll);
    restoreSelectorRange(selectionRange);

    requestAnimationFrame(() => {
        restoreViewportScrollPosition(viewportScroll);
        requestAnimationFrame(() => restoreViewportScrollPosition(viewportScroll));
    });

    saveHistoryState();
    notifySerializedChange();
} 

function replaceOne() {
    if (findMatches.length === 0 || findMatchIndex < 0) return;
    const match = findMatches[findMatchIndex];
    const query = document.getElementById('find-input').value;
    const replaceVal = document.getElementById('replace-input').value;
    const caseSensitive = document.getElementById('find-case-sensitive').checked;
    const useRegex = document.getElementById('find-use-regex').checked;
    let regex;
    try { regex = buildSearchRegex(query, caseSensitive, useRegex, true); } catch (e) { return; }
    applyDataMutation((d) => {
        const row = d.rows[match.ri];
        if (row && row.cells && row.cells[match.ci]) {
            const cell = row.cells[match.ci];
            cell.text = String(cell.text || '').replace(regex, replaceVal);
        }
    });
    runFindSearch();
}

function replaceAll() {
    const query = document.getElementById('find-input').value;
    if (!query) return;
    const replaceVal = document.getElementById('replace-input').value;
    const caseSensitive = document.getElementById('find-case-sensitive').checked;
    const useRegex = document.getElementById('find-use-regex').checked;
    let regex;
    try { regex = buildSearchRegex(query, caseSensitive, useRegex, true); } catch (e) { return; }
    applyDataMutation((d) => {
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
    runFindSearch();
}

// --- WHEEL SCROLLING FIXES ---

function blockLegacyScroll(e) {
    const container = document.getElementById('spreadsheet-container');
    if (!container || !container.contains(e.target)) return;

    if (e.target.closest('.x-spreadsheet-scrollbar') || e.target.closest('.x-spreadsheet-contextmenu')) {
        return;
    }

    // Kill legacy scrolling event used by Firefox so it doesn't use it to scroll the window on top of normal scroll
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}

function handleSpreadsheetWheel(e) {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data) return;

    // Do not interfere with native browser zooming (Ctrl + Wheel)
    if (e.ctrlKey || e.metaKey) return;

    // Check if the cursor is actually hovering over the spreadsheet component
    const container = document.getElementById('spreadsheet-container');
    if (!container || !container.contains(e.target)) return;

    // Allow native scrolling to occur if the cursor is specifically over the 
    // scrollbar elements or a context menu.
    if (e.target.closest('.x-spreadsheet-scrollbar') || e.target.closest('.x-spreadsheet-contextmenu')) {
        return;
    }

    // Stop the whole window from scrolling
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const sheet = mySpreadsheet.sheet;
    const data = sheet.data;

    let deltaY = e.deltaY;
    let deltaX = e.deltaX;

    // Standardize wheel deltas across different mouse configurations
    if (e.deltaMode === 1) { // LINE mode
        deltaY *= 40;
        deltaX *= 40;
    } else if (e.deltaMode === 2) { // PAGE mode
        deltaY *= 800;
        deltaX *= 800;
    }

    const currentX = data.scroll && Number.isFinite(data.scroll.x) ? data.scroll.x : 0;
    const currentY = data.scroll && Number.isFinite(data.scroll.y) ? data.scroll.y : 0;

    const targetX = Math.max(0, currentX + deltaX);
    const targetY = Math.max(0, currentY + deltaY);

    let needsRender = false;

    // Apply exact pixel offsets to the internal x-data-spreadsheet engine
    if (deltaY !== 0 && typeof data.scrolly === 'function') {
        data.scrolly(targetY, () => { needsRender = true; });
    }
    if (deltaX !== 0 && typeof data.scrollx === 'function') {
        data.scrollx(targetX, () => { needsRender = true; });
    }

    // Resync UI to match the new scroll coordinates
    if (needsRender) {
        if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
            try { sheet.verticalScrollbar.move(data.scroll.y); } catch (err) {}
        }
        if (sheet.horizontalScrollbar && typeof sheet.horizontalScrollbar.move === 'function') {
            try { sheet.horizontalScrollbar.move(data.scroll.x); } catch (err) {}
        }

        if (sheet.selector) {
            if (typeof sheet.selector.resetBRTAreaOffset === 'function') sheet.selector.resetBRTAreaOffset();
            if (typeof sheet.selector.resetBRLAreaOffset === 'function') sheet.selector.resetBRLAreaOffset();
            if (typeof sheet.selector.resetAreaOffset === 'function') sheet.selector.resetAreaOffset();
        }

        if (typeof sheet.render === 'function') {
            sheet.render();
        } else if (sheet.table && typeof sheet.table.render === 'function') {
            sheet.table.render();
        }
    }
}

function rangeContainsMerges(data, range) {
    if (!data || !data.merges) return false;
    const mergesArray = Array.isArray(data.merges) ? data.merges : (Array.isArray(data.merges._) ? data.merges._ : []);
    
    for (let i = 0; i < mergesArray.length; i++) {
        const parsedMerge = parseMergeEntry(mergesArray[i]);
        if (parsedMerge && rangesOverlap(parsedMerge, range)) {
            return true;
        }
    }
    return false;
}

function isSpreadsheetClipboardTarget(target) {
    if (!mySpreadsheet || !mySpreadsheet.sheet) return false;
    const container = document.getElementById('spreadsheet-container');
    const editor = mySpreadsheet.sheet.editor;
    const editorEl = editor && editor.textEl ? (editor.textEl.el || editor.textEl) : null;
    const isHiddenSelectorInput = isSelectorHiddenInputTarget(target);
    const isTextEntryTarget = !!(target && (target.tagName === 'TEXTAREA' || target.isContentEditable || target.tagName === 'INPUT'));

    if (!container || !container.contains(target)) {
        return false;
    }
    if (target === editorEl) {
        return false;
    }
    if (isTextEntryTarget && !isHiddenSelectorInput) {
        return false;
    }
    return true;
}

function parseClipboardTsv(text) {
    if (typeof text !== 'string' || text === '') return [];
    const rows = text.split(/\r?\n/).map((row) => row.split('\t'));
    while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
        rows.pop();
    }
    return rows;
}

function buildRangeTsv(data, range) {
    const normalized = normalizeSelectionRange(range);
    const lines = [];

    for (let y = normalized.sri; y <= normalized.eri; y++) {
        const row = [];
        for (let x = normalized.sci; x <= normalized.eci; x++) {
            row.push(getCellTextFromData(data, y, x));
        }
        lines.push(row.join('\t'));
    }

    return lines.join('\n');
}

function applyPlainTextRowsAtSelection(rows, options = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const clearSourceRange = options.clearSourceRange || null;

    const liveData = mySpreadsheet.sheet.data;
    const selection = getActiveSelectionRange();
    const startBounds = getExpandedCellBounds(liveData, selection.sri, selection.sci);
    const startRow = startBounds.sri;
    const startCol = startBounds.sci;

    applyDataMutation((d) => {
        if (!d.rows) d.rows = { len: 100 };

        if (clearSourceRange) {
            for (let r = clearSourceRange.sri; r <= clearSourceRange.eri; r++) {
                if (!d.rows[r] || !d.rows[r].cells) continue;
                for (let c = clearSourceRange.sci; c <= clearSourceRange.eci; c++) {
                    if (d.rows[r].cells[c]) delete d.rows[r].cells[c].text;
                }
            }
        }

        for (let r = 0; r < rows.length; r++) {
            const rowData = rows[r] || [];
            const y = startRow + r;
            if (!d.rows[y]) d.rows[y] = { cells: {} };
            if (!d.rows[y].cells) d.rows[y].cells = {};

            for (let c = 0; c < rowData.length; c++) {
                const x = startCol + c;
                if (!isWritablePasteTarget(d, y, x)) {
                    continue;
                }
                const existingCell = d.rows[y].cells[x] || {};
                existingCell.text = rowData[c];
                d.rows[y].cells[x] = existingCell;
            }
        }

        d.rows.len = Math.max(Number.isInteger(d.rows.len) ? d.rows.len : 100, startRow + rows.length + 1);
    });
}

function handleSpreadsheetCopyCut(e) {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data) return;
    if (!e || !e.clipboardData) return;
    if (!isSpreadsheetClipboardTarget(e.target)) return;

    const data = mySpreadsheet.getData()[0] || {};
    const selection = getActiveSelectionRange();
    const tsv = buildRangeTsv(data, selection);
    e.clipboardData.setData('text/plain', tsv);
    e.preventDefault();
    e.stopImmediatePropagation();
}

// --- TSV PASTE ROUTER (Internal + External) ---
function handleSpreadsheetPaste(e) {
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data) return;
    if (!isSpreadsheetClipboardTarget(e.target)) return;

    const data = mySpreadsheet.sheet.data;
    const clipboard = data.clipboard;
    const hasInternalClipboard = !!(clipboard && clipboard.state !== 'clear' && clipboard.range);
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';

    const selection = getActiveSelectionRange();
    const startBounds = getExpandedCellBounds(data, selection.sri, selection.sci);

    let targetHasMerges = false;
    if (hasInternalClipboard) {
        const srcRange = clipboard.range;
        const targetRange = {
            sri: startBounds.sri,
            sci: startBounds.sci,
            eri: startBounds.sri + (srcRange.eri - srcRange.sri),
            eci: startBounds.sci + (srcRange.eci - srcRange.sci)
        };
        targetHasMerges = rangeContainsMerges(data, targetRange);
        if (!targetHasMerges) {
            // Case 1: internal paste with no merged target => let engine preserve formatting.
            return;
        }
    }

    // Case 2: all external pastes and all internal merged-target pastes.
    e.preventDefault();
    e.stopImmediatePropagation();

    let rows = parseClipboardTsv(text);
    if (rows.length === 0 && hasInternalClipboard) {
        const srcRange = clipboard.range;
        rows = [];
        for (let y = srcRange.sri; y <= srcRange.eri; y++) {
            const row = [];
            for (let x = srcRange.sci; x <= srcRange.eci; x++) {
                row.push(getCellTextFromData(mySpreadsheet.getData()[0] || {}, y, x));
            }
            rows.push(row);
        }
    }
    if (rows.length === 0) return;

    const clearSourceRange = hasInternalClipboard && clipboard.state === 'cut' ? clipboard.range : null;
    applyPlainTextRowsAtSelection(rows, { clearSourceRange });

    if (clearSourceRange && typeof clipboard.clear === 'function') {
        clipboard.clear();
    }

}

function bindDomEvents() {
    if (isDomBound) return;

    const findInput = document.getElementById('find-input');
    if (findInput) {
        findInput.addEventListener('blur', handleFindInputBlur);
        findInput.addEventListener('input', runFindSearch);
        findInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                if (event.shiftKey) findPrev();
                else findNext();
                event.preventDefault();
            } else if (event.key === 'Escape') {
                closeFindReplace();
            }
        });
    }

    const replaceInput = document.getElementById('replace-input');
    if (replaceInput) {
        replaceInput.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeFindReplace();
        });
    }

    document.getElementById('find-prev-btn')?.addEventListener('click', findPrev);
    document.getElementById('find-next-btn')?.addEventListener('click', findNext);
    document.getElementById('find-replace-one-btn')?.addEventListener('click', replaceOne);
    document.getElementById('find-replace-all-btn')?.addEventListener('click', replaceAll);
    document.getElementById('find-close-btn')?.addEventListener('click', closeFindReplace);
    document.getElementById('find-case-sensitive')?.addEventListener('change', runFindSearch);
    document.getElementById('find-use-regex')?.addEventListener('change', runFindSearch);

    document.getElementById('data-modal-close-btn')?.addEventListener('click', closeModal);
    document.getElementById('data-modal-cancel-btn')?.addEventListener('click', closeModal);
    document.getElementById('data-modal-action-btn')?.addEventListener('click', executeModalAction);
    document.getElementById('export-format-select')?.addEventListener('change', handleExportFormatChange);
    document.getElementById('export-config-select')?.addEventListener('change', handleExportFormatChange);

    const formulaInput = document.getElementById('spreadsheet-formula-input');
    if (formulaInput) {
        formulaInput.addEventListener('input', handleFormulaBarInput);
        formulaInput.addEventListener('focus', handleFormulaBarFocus);
        formulaInput.addEventListener('mousedown', handleFormulaBarMouseDown);
        formulaInput.addEventListener('click', handleFormulaBarClick);
        formulaInput.addEventListener('keydown', handleFormulaBarKeydown);
        formulaInput.addEventListener('copy', handleFormulaBarClipboard);
        formulaInput.addEventListener('cut', handleFormulaBarClipboard);
        formulaInput.addEventListener('paste', handleFormulaBarClipboard);
    }

    // Intercept wheel events to prevent the whole window from scrolling when the cursor is over the spreadsheet
    window.addEventListener('wheel', handleSpreadsheetWheel, { passive: false, capture: true });
    window.addEventListener('DOMMouseScroll', blockLegacyScroll, { passive: false, capture: true });
    window.addEventListener('MozMousePixelScroll', blockLegacyScroll, { passive: false, capture: true });
    window.addEventListener('mousewheel', blockLegacyScroll, { passive: false, capture: true });
    
    // Intercept paste events globally
    window.addEventListener('paste', handleSpreadsheetPaste, true);
    window.addEventListener('copy', handleSpreadsheetCopyCut, true);
    window.addEventListener('cut', handleSpreadsheetCopyCut, true);

    window.addEventListener('keydown', handleSpreadsheetKeydown, true);
    // Handle menu bar / keyboard shortcut zoom to keep fonts sharp on canvas
    window.addEventListener('resize', handleWindowResize, true);
    isKeyboardBound = true;

    // Preserve compatibility for any residual inline handlers.
    window.closeModal = closeModal;
    window.executeModalAction = executeModalAction;
    window.closeFindReplace = closeFindReplace;
    window.findPrev = findPrev;
    window.findNext = findNext;
    window.replaceOne = replaceOne;
    window.replaceAll = replaceAll;
    window.runFindSearch = runFindSearch;

    isDomBound = true;
}

function unbindDomEvents() {
    const findInput = document.getElementById('find-input');
    if (findInput) {
        findInput.removeEventListener('blur', handleFindInputBlur);
        findInput.removeEventListener('input', runFindSearch);
    }

    if (isKeyboardBound) {
        window.removeEventListener('keydown', handleSpreadsheetKeydown, true);
        window.removeEventListener('wheel', handleSpreadsheetWheel, { capture: true });
        window.removeEventListener('DOMMouseScroll', blockLegacyScroll, { capture: true });
        window.removeEventListener('MozMousePixelScroll', blockLegacyScroll, { capture: true });
        window.removeEventListener('mousewheel', blockLegacyScroll, { capture: true });
        window.removeEventListener('paste', handleSpreadsheetPaste, true);
        window.removeEventListener('copy', handleSpreadsheetCopyCut, true);
        window.removeEventListener('cut', handleSpreadsheetCopyCut, true);
        isKeyboardBound = false;
    }

    const formulaInput = document.getElementById('spreadsheet-formula-input');
    if (formulaInput) {
        formulaInput.removeEventListener('input', handleFormulaBarInput);
        formulaInput.removeEventListener('focus', handleFormulaBarFocus);
        formulaInput.removeEventListener('mousedown', handleFormulaBarMouseDown);
        formulaInput.removeEventListener('click', handleFormulaBarClick);
        formulaInput.removeEventListener('keydown', handleFormulaBarKeydown);
        formulaInput.removeEventListener('copy', handleFormulaBarClipboard);
        formulaInput.removeEventListener('cut', handleFormulaBarClipboard);
        formulaInput.removeEventListener('paste', handleFormulaBarClipboard);
    }
    
    window.removeEventListener('resize', handleWindowResize, true);
    isDomBound = false;
}

export function createSpreadsheetCore({ initialValue = '', fontFamily = null, preferredColumnOrder = [], allowDataTransfer: allowTransfer = true, onChange = null, onCanonicalized: canonicalized = null, onFetchSgml: fetchSgml = null, onFetchConfigs: fetchConfigs = null, onImportSgml: importSgml = null, onImportResult: importResult = null } = {}) {
    configuredSpreadsheetFontFamily = normalizeSpreadsheetFontFamily(fontFamily);
    currentPreferredColumnOrder = Array.isArray(preferredColumnOrder) ? preferredColumnOrder : []; 
    allowDataTransfer = Boolean(allowTransfer);
    
    onSerializedChange = onChange;
    onCanonicalized = canonicalized;
    onFetchSgml = fetchSgml;
    onFetchConfigs = fetchConfigs;
    onImportSgml = importSgml;
    onImportResult = importResult;
    exportConfigNames = [];
    exportConfigsLoaded = false;
    bindDomEvents();

    const firstValue = typeof initialValue === 'string' && initialValue.trim()
        ? initialValue
        : ''; 
    importSocialCalc(firstValue, false);

    return {
        setPreferredColumnOrder(nextOrder) {
            // Prevent unnecessary reloads if the order hasn't changed
            const currentStr = JSON.stringify(currentPreferredColumnOrder);
            const nextStr = JSON.stringify(Array.isArray(nextOrder) ? nextOrder : []);
            if (currentStr === nextStr) return;

            currentPreferredColumnOrder = Array.isArray(nextOrder) ? nextOrder : [];
            
            // Re-apply the sort immediately once the async config fetch completes
            if (mySpreadsheet) {
                const currentSerialized = exportSocialCalc();
                if (currentSerialized && currentSerialized.trim()) {
                    importSocialCalc(currentSerialized, false);
                }
            }
        },
        setFontFamily(nextFontFamily) {
            const normalized = normalizeSpreadsheetFontFamily(nextFontFamily);
            if (normalized === configuredSpreadsheetFontFamily) return;

            configuredSpreadsheetFontFamily = normalized;
            const currentSerialized = exportSocialCalc();
            const effective = typeof currentSerialized === 'string' && currentSerialized.trim()
                ? currentSerialized
                : getDefaultSocialCalcData();
            importSocialCalc(effective, false);
        },
        setValue(nextValue) {
            const raw = typeof nextValue === 'string' ? nextValue : '';
            const effective = raw.trim() ? raw : getDefaultSocialCalcData();
            importSocialCalc(effective, false);
        },
        highlightCellsBackgroundColor(cellRefs, color = '#fef3c7') {
            return highlightCellsBackgroundColor(cellRefs, color);
        },
        clearHighlightedCellsBackgroundColor(cellRefs, color = '#fef3c7') {
            return clearHighlightedCellsBackgroundColor(cellRefs, color);
        },
        cleanupRogueHighlights(allowedCellRefs, color = '#fef3c7') {
            return cleanupRogueHighlights(allowedCellRefs, color);
        },
        syncValidationHighlights(activeInvalidRefs, color = '#fef3c7') {
            if (!mySpreadsheet || !Array.isArray(activeInvalidRefs)) return;

            const targetColor = normalizeHexColor(color) || '#fef3c7';
            
            // Create a fast-lookup Set of the currently invalid coordinates
            const activeInvalidSet = new Set();
            activeInvalidRefs.forEach((coord) => {
                if (typeof coord !== 'string') return;
                const pos = coordToXY(coord.trim().toUpperCase());
                if (pos) activeInvalidSet.add(`${pos.y},${pos.x}`);
            });

            // Pre-flight check: Do we actually need to trigger a render/undo state?
            const d = mySpreadsheet.getData()[0];
            const rows = d.rows || {};
            const styles = d.styles || [];
            let needsMutation = false;

            // 1. Check if any cells need to be CLEARED
            for (const yStr of Object.keys(rows)) {
                if (yStr === 'len' || needsMutation) continue;
                const row = rows[yStr];
                if (!row || !row.cells) continue;
                
                for (const xStr of Object.keys(row.cells)) {
                    const cell = row.cells[xStr];
                    if (cell && cell.style !== undefined) {
                        const style = styles[cell.style];
                        if (style && normalizeHexColor(style.bgcolor) === targetColor) {
                            if (!activeInvalidSet.has(`${yStr},${xStr}`)) {
                                needsMutation = true;
                                break;
                            }
                        }
                    }
                }
            }

            // 2. Check if any new cells need to be HIGHLIGHTED
            if (!needsMutation) {
                for (const coord of activeInvalidRefs) {
                    const pos = coordToXY(coord.trim().toUpperCase());
                    if (!pos) continue;
                    const cell = rows[pos.y]?.cells?.[pos.x];
                    const style = cell && cell.style !== undefined ? styles[cell.style] : null;
                    if (!style || normalizeHexColor(style.bgcolor) !== targetColor) {
                        needsMutation = true;
                        break;
                    }
                }
            }

            // If the grid perfectly matches the validation state, do nothing
            if (!needsMutation) return;

            // Perform exactly one history mutation and canvas render
            executeStateChange((dMut) => {
                if (!dMut.rows) dMut.rows = { len: 100 };
                if (!Array.isArray(dMut.styles)) dMut.styles = [];

                // Step A: Clear rogue or resolved colors
                Object.keys(dMut.rows).forEach(yStr => {
                    if (yStr === 'len') return;
                    const y = parseInt(yStr, 10);
                    const row = dMut.rows[yStr];
                    if (!row || !row.cells) return;

                    Object.keys(row.cells).forEach(xStr => {
                        const x = parseInt(xStr, 10);
                        const cell = row.cells[xStr];
                        if (!cell || cell.style === undefined) return;

                        const existingStyle = dMut.styles[cell.style];
                        if (existingStyle && normalizeHexColor(existingStyle.bgcolor) === targetColor) {
                            if (!activeInvalidSet.has(`${y},${x}`)) {
                                const nextStyle = JSON.parse(JSON.stringify(existingStyle));
                                delete nextStyle.bgcolor;
                                const compacted = compactStyleObject(nextStyle);
                                if (Object.keys(compacted).length > 0) {
                                    cell.style = getOrCreateStyleIndex(dMut.styles, compacted);
                                } else {
                                    delete cell.style;
                                }
                            }
                        }
                    });
                });

                // Step B: Apply required colors
                activeInvalidRefs.forEach((coord) => {
                    const pos = coordToXY(coord.trim().toUpperCase());
                    if (!pos) return;

                    if (!dMut.rows[pos.y]) dMut.rows[pos.y] = { cells: {} };
                    if (!dMut.rows[pos.y].cells) dMut.rows[pos.y].cells = {};

                    const existingCell = dMut.rows[pos.y].cells[pos.x] || {};
                    const baseStyle = (existingCell.style !== undefined && dMut.styles[existingCell.style])
                        ? JSON.parse(JSON.stringify(dMut.styles[existingCell.style]))
                        : {};

                    if (normalizeHexColor(baseStyle.bgcolor) !== targetColor) {
                        baseStyle.bgcolor = targetColor;
                        const nextStyle = compactStyleObject(baseStyle);
                        existingCell.style = getOrCreateStyleIndex(dMut.styles, nextStyle);
                        dMut.rows[pos.y].cells[pos.x] = existingCell;
                        dMut.rows.len = Math.max(Number.isInteger(dMut.rows.len) ? dMut.rows.len : 100, pos.y + 1);
                    }
                });
            });
        },
        getSerializedValue() {
            return exportSocialCalc();
        },
        focusCell(cellRef) {
            if (typeof cellRef !== 'string') return false;

            const pos = coordToXY(cellRef.trim().toUpperCase());
            if (!pos) return false;

            jumpSelectionTo(pos.y, pos.x);
            return true;
        },
        focus() {
            scheduleRestoreFocus();
        },
        destroy() {
            onSerializedChange = null;
            onFetchSgml = null;
            onFetchConfigs = null;
            onImportSgml = null;
            onImportResult = null;
            exportConfigNames = [];
            exportConfigsLoaded = false;
            unbindDomEvents();
            mySpreadsheet = null;
        }
    };
}

export default createSpreadsheetCore;
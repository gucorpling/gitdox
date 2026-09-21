// Spreadsheet editor core: wires up the x-data-spreadsheet instance, DOM bindings,
// modal/import-export UI, viewport/history/formula-bar logic and SocialCalc<->sheet
// data conversion. Pure helpers live in utils.js/styles.js; format conversions in io.js.
import Spreadsheet from 'x-data-spreadsheet';
import './xspreadsheet.patched.css';
import { coordToXY, xyToCoord, getMaxBounds, getExpandedCellBounds, parseMergeEntry, rangesOverlap } from './utils.js';
import { normalizeHexColor, isDefaultBackgroundColor, compactStyleObject, getOrCreateStyleIndex, normalizeSpreadsheetFontFamily } from './styles.js';
import { getDefaultSocialCalcData, parseSocialCalcToSheetData, exportSocialCalc as exportSocialCalcFormat } from './io.js';
import {
    configureViewportHost,
    getViewportScrollPosition,
    restoreViewportScrollPosition,
    jumpSelectionTo,
    scheduleRestoreFocus,
    patchSelector,
    patchContextMenu,
    bindScrollbarFeedbackGuard,
    unbindScrollbarFeedbackGuard,
    withScrollbarFeedbackSuppressed,
    invalidateViewportSync,
} from './viewport.js';
import {
    configureHistoryHost,
    resetHistory,
    saveHistoryState,
    performUndo,
    performRedo,
} from './history.js';
import {
    configureUiHost,
    resetExportConfigsCache,
    closeModal,
    executeModalAction,
    handleExportFormatChange,
    syncFormulaBarFromSelection,
    handleFormulaBarInput,
    handleFormulaBarFocus,
    handleFormulaBarMouseDown,
    handleFormulaBarClick,
    handleFormulaBarClipboard,
    handleFormulaBarKeydown,
    customizeToolbar,
    openFindReplace,
    closeFindReplace,
    runFindSearch,
    findNext,
    findPrev,
    replaceOne,
    replaceAll,
} from './ui.js';

// --- CORE LIFECYCLE STATE ---
let onSerializedChange = null;
let onFetchSgml = null;
let onFetchConfigs = null;
let onImportSgml = null;
let onImportResult = null;
let onCanonicalized = null;
let onFindOpen = null;
let isDomBound = false;
let isKeyboardBound = false;
const MAX_COLUMN_COUNT = 26 * 26;
let allowDataTransfer = true;
let allowExternalClipboard = true;
let exactScrollX = null;  // Accumulate fractional scrolls on trackpads (for Mac)
let exactScrollY = null;
let expectedEngineX = null;  // Track the last known engine scroll position to detect drift and correct it
let expectedEngineY = null;

function ensureColumnCapacity(sheetData, minColumns = MAX_COLUMN_COUNT) {
    if (!sheetData.cols || typeof sheetData.cols !== 'object') {
        sheetData.cols = {};
    }

    const currentLen = Number.isInteger(sheetData.cols.len) ? sheetData.cols.len : 0;
    sheetData.cols.len = Math.max(currentLen, minColumns);
}

// --- GLOBAL STATE & CUSTOM HISTORY ENGINE ---
let mySpreadsheet = null;
let currentPreferredColumnOrder = [];

let lastRi = 0;
let lastCi = 0;
let activeToolbarSelectionSnapshot = null;
let configuredSpreadsheetFontFamily = null;

// Bridges viewport.js to this module's live spreadsheet instance & selection state
// (viewport.js never imports core.js, avoiding a circular dependency).
configureViewportHost({
    getSpreadsheet: () => mySpreadsheet,
    getLastSelection: () => ({ ri: lastRi, ci: lastCi }),
    setLastSelection: (ri, ci) => { lastRi = ri; lastCi = ci; },
    getToolbarSelectionSnapshot: () => activeToolbarSelectionSnapshot,
    isExternalClipboardAllowed: () => allowExternalClipboard,
    getActiveSelectionRange: () => getActiveSelectionRange(),
    restoreSelectorRange: (range) => restoreSelectorRange(range),
    notifySelectionSet: () => syncFormulaBarFromSelection(),
});

// Bridges history.js to this module's live spreadsheet instance & selection helpers.
configureHistoryHost({
    getSpreadsheet: () => mySpreadsheet,
    getActiveSelectionRange: () => getActiveSelectionRange(),
    restoreSelectorRange: (range) => restoreSelectorRange(range),
    notifySerializedChange: () => notifySerializedChange(),
});

// Bridges ui.js (modal/toolbar/find-replace/formula-bar) to this module's live state.
configureUiHost({
    getSpreadsheet: () => mySpreadsheet,
    isDataTransferAllowed: () => allowDataTransfer,
    exportSocialCalc: () => exportSocialCalc(),
    importSocialCalc: (rawData, emitChange) => importSocialCalc(rawData, emitChange),
    getOnFetchSgml: () => onFetchSgml,
    getOnFetchConfigs: () => onFetchConfigs,
    getOnImportSgml: () => onImportSgml,
    getOnImportResult: () => onImportResult,
    getOnFindOpen: () => onFindOpen,
    getTopLeftSelectionPosition: () => getTopLeftSelectionPosition(),
    getCellTextFromData: (data, ri, ci) => getCellTextFromData(data, ri, ci),
    notifySerializedChange: () => notifySerializedChange(),
    getActiveSelectionRange: () => getActiveSelectionRange(),
    restoreSelectorRange: (range) => restoreSelectorRange(range),
    getToolbarSelectionSnapshot: () => activeToolbarSelectionSnapshot,
    setToolbarSelectionSnapshot: (value) => { activeToolbarSelectionSnapshot = value; },
    executeStateChange: (fn) => executeStateChange(fn),
    applyDataMutation: (fn) => applyDataMutation(fn),
    applyBackgroundColorToSelection: (color) => applyBackgroundColorToSelection(color),
    toggleBoldForSelection: () => toggleBoldForSelection(),
    mergeSelectionSafely: () => mergeSelectionSafely(),
    joinSelectionContentsSafely: () => joinSelectionContentsSafely(),
    mergeDownSelection: () => mergeDownSelection(),
    insertRowAtSelection: () => insertRowAtSelection(),
    deleteRowAtSelection: () => deleteRowAtSelection(),
});

function getEffectiveSpreadsheetFontFamily() {
    return configuredSpreadsheetFontFamily || 'Arial';
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
    
    // Keep the patched selector's merge-navigation state aligned with the true anchor.
    lastRi = selectionRange.sri;
    lastCi = selectionRange.sci;

    // UPDATE THE UI LAYER natively without triggering viewport movement.
    // By using the native sel.set, we ensure all internal proxy states (like merges) are updated safely.
    sel.set(selectionRange.sri, selectionRange.sci, { autoScroll: false, indexesUpdated: true });
    
    if (selectionRange.eri !== selectionRange.sri || selectionRange.eci !== selectionRange.sci) {
        // Force endpoint update; moving=true may short-circuit on cached lastri/lastci.
        sel.setEnd(selectionRange.eri, selectionRange.eci, false);
    }

    // RECALCULATE PIXEL BOUNDARIES FOR THE BLUE BOX
    if (typeof sel.resetAreaOffset === 'function') sel.resetAreaOffset();
    if (typeof sel.resetBRTAreaOffset === 'function') sel.resetBRTAreaOffset();
    if (typeof sel.resetBRLAreaOffset === 'function') sel.resetBRLAreaOffset();

    // REPAINT THE CANVAS
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
        
        // Use eri (end row index) here to ensure rowLimit accommodates a large multi-row selection
        const rowLimit = Math.max(targetRange.eri + 1, usedAreaMaxRow + 1);

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
            // 1. Identify all "anchor rows" for this column within the selected range
            const anchorRows = [];
            for (let r = targetRange.sri; r <= targetRange.eri; r++) {
                const cell = d.rows[r] && d.rows[r].cells ? d.rows[r].cells[col] : null;
                // An anchor is either the start of the selection, or any filled cell inside the selection
                if (r === targetRange.sri || cellHasTextValue(cell)) {
                    anchorRows.push(r);
                }
            }

            // 2. Execute the merge-down logic for each identified anchor
            for (let i = 0; i < anchorRows.length; i++) {
                const startRow = anchorRows[i];

                const containingMergeRef = mergeRefs.find((ref) => {
                    const merge = ref && ref.merge;
                    return !!(merge
                        && startRow >= merge.sri
                        && startRow <= merge.eri
                        && col >= merge.sci
                        && col <= merge.eci);
                });

                // Unmerge if the current anchor is inside an existing merge
                if (containingMergeRef) {
                    removeMergeRef(containingMergeRef);
                }

                // Scan down from the anchor to find the next boundary limit
                let nextFilledRow = null;
                for (let row = startRow + 1; row < rowLimit; row++) {
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
                
                // Set merge parameters
                anchorCell.merge = [newEndRow - startRow, 0];
                d.rows[startRow].cells[col] = anchorCell;

                const mergeString = `${xyToCoord(col, startRow)}:${xyToCoord(col, newEndRow)}`;
                d.merges.push(mergeString);
                mergeRefs.push({
                    rawIndex: d.merges.length - 1,
                    merge: { sri: startRow, sci: col, eri: newEndRow, eci: col }
                });
            }
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
    // If the import/export modal is open, Esc acts like Cancel
    const dataModal = document.getElementById('data-modal');
    if (dataModal && !dataModal.classList.contains('hidden')) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            closeModal();
        }
        return;
    }

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
            // Check for Enter key here in the capture phase before stopping propagation
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    findPrev();
                } else {
                    findNext();
                }
            }
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
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

    // Intercept all single printable characters if they hit the hidden selector input.
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
                // Revert to getData()[0] so getMaxBounds can iterate the rows correctly
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
                let sel = mySpreadsheet.sheet.data.selector;
                // Because sel.ri is always the top of a merge, -15 guarantees we exit it moving up.
                let ri = Math.max(0, sel.ri - 15);
                let ci = sel.ci;
                jumpSelectionTo(ri, ci, false, { preserveHorizontal: true });
            }
        } else if (e.key === 'PageDown') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (mySpreadsheet && mySpreadsheet.sheet && mySpreadsheet.sheet.data && mySpreadsheet.sheet.data.selector) {
                let sheetData = mySpreadsheet.sheet.data;
                let sel = sheetData.selector;
                
                let ri = sel.ri;
                let ci = sel.ci;
                let targetRi = ri + 15;
                
                // The live DataProxy stores rows inside the `_` property, while 
                // the serialized JSON stores them at the root of `rows`. We check both.
                let rowsMap = sheetData.rows._ || sheetData.rows;
                let row = rowsMap && rowsMap[ri];
                let cell = row && row.cells && row.cells[ci];
                
                // cell.merge in the live model is an array: [rowspan - 1, colspan - 1]
                if (cell && Array.isArray(cell.merge) && cell.merge[0] > 0) {
                    let rowspan = cell.merge[0] + 1;
                    let bottomRi = ri + rowspan - 1;
                    
                    // If a standard 15-row jump keeps us trapped inside this merged cell,
                    // jump exactly to the first row beneath it.
                    if (targetRi <= bottomRi) {
                        targetRi = bottomRi + 1;
                    }
                }
                
                // Prevent scrolling off the absolute bottom of the grid
                let maxLen = 100;
                if (sheetData.rows && typeof sheetData.rows.len === 'number') {
                    maxLen = sheetData.rows.len;
                }
                
                targetRi = Math.min(maxLen - 1, targetRi);
                jumpSelectionTo(targetRi, ci, false, { preserveHorizontal: true });
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
function executeStateChange(mutationCallback) {
    applyDataMutation(mutationCallback);
}


// --- IMPORT: parse + (re)construct or reuse the Spreadsheet instance ---
function importSocialCalc(rawData, emitChange = true) {
    //console.log('[IMPORT SOCIALCALC CALLED]', new Error().stack); // emit stack trace for debugging

    const { sheetData, didReorderColumns } = parseSocialCalcToSheetData(rawData, {
        preferredColumnOrder: currentPreferredColumnOrder,
        fontFamily: getEffectiveSpreadsheetFontFamily(),
        maxColumnCount: MAX_COLUMN_COUNT,
    });


    if (!mySpreadsheet) {
        // First construction only.
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

        invalidateViewportSync();
        mySpreadsheet.loadData([sheetData]);

        customizeToolbar();
        patchSelector();
        patchContextMenu();
        syncFormulaBarFromSelection({ force: true });

        resetHistory();
        saveHistoryState();

        mySpreadsheet.change(() => {
            saveHistoryState();
            notifySerializedChange();
            syncFormulaBarFromSelection();
        });
    } else {
        // Reuse the existing instance — avoids leaking another set of the
        // library's window-level listeners (see ghost-paste-listener bug).
        invalidateViewportSync();
        mySpreadsheet.loadData([sheetData]);
        patchSelector();

        resetHistory();
        saveHistoryState();
    }

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
    return exportSocialCalcFormat(mySpreadsheet.getData()[0]);
}

 function applyDataMutation(mutationCallback) {

    let d = JSON.parse(JSON.stringify(mySpreadsheet.getData()[0]));
    ensureColumnCapacity(d);
    const selectionRange = getActiveSelectionRange();
    const viewportScroll = getViewportScrollPosition();

    mutationCallback(d);

    ensureColumnCapacity(d);
    invalidateViewportSync();
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
    //console.log('[WHEEL IN]', e.deltaX, e.deltaY, e.deltaMode, e.shiftKey);

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

    // --- TRACKPAD AXIS LOCK (Scroll Intent) ---
    // Prevent diagonal trackpad drift. If the user is clearly scrolling on one axis, 
    // zero out the minor drift on the other axis.
    if (Math.abs(deltaY) > Math.abs(deltaX) * 2.5) {
        deltaX = 0; // Purely vertical intent, kill horizontal drift if vertical scroll is 2.5 times stronger than horizontal
    } else if (Math.abs(deltaX) > Math.abs(deltaY) * 2.5) {
        deltaY = 0; // Purely horizontal intent, kill vertical drift if horizontal scroll is 2.5 times stronger than vertical
    }

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

    // Only resync if the engine's position changed outside of this wheel handler
    if (exactScrollX === null || (expectedEngineX !== null && currentX !== expectedEngineX)) {
        exactScrollX = currentX;
    }
    if (exactScrollY === null || (expectedEngineY !== null && currentY !== expectedEngineY)) {
        exactScrollY = currentY;
    }

    // Accumulate the exact floating point fractions
    exactScrollX += deltaX;
    exactScrollY += deltaY;

    // Prevent scrolling past the top/left edge
    exactScrollX = Math.max(0, exactScrollX);
    exactScrollY = Math.max(0, exactScrollY);

    // Round only when communicating with the x-data-spreadsheet engine
    const targetX = Math.round(exactScrollX);
    const targetY = Math.round(exactScrollY);

    let needsRender = false;

    if (deltaY !== 0 && typeof data.scrolly === 'function') {
        data.scrolly(targetY, () => { needsRender = true; });
    }
    if (deltaX !== 0 && typeof data.scrollx === 'function') {
        data.scrollx(targetX, () => { needsRender = true; });
    }
    
    // Record where the scrolling engine ended up, so we don't accidentally resync on the next wheel tick
    expectedEngineX = data.scroll && Number.isFinite(data.scroll.x) ? data.scroll.x : 0;
    expectedEngineY = data.scroll && Number.isFinite(data.scroll.y) ? data.scroll.y : 0;
    
    /*console.log('[Trackpad Debug]', {
        deltas: { dx: e.deltaMode ? e.deltaX * 40 : e.deltaX, dy: e.deltaMode ? e.deltaY * 40 : e.deltaY },
        exactBefore: { x: exactScrollX, y: exactScrollY },
        targetsSent: { targetX, targetY },
        engineStateAfter: { engineX: data.scroll?.x, engineY: data.scroll?.y }
    });*/

    // Resync UI to match the new scroll coordinates
    if (needsRender) {
        withScrollbarFeedbackSuppressed(() => {
            if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
                //console.log('[BEFORE VSCROLLBAR MOVE]', data.scroll.y);
                try { sheet.verticalScrollbar.move( data.scroll.y); } catch (err) {console.error('Error moving vertical scrollbar:', err); }
                //console.log('[AFTER VSCROLLBAR MOVE]', data.scroll.y);
            }
            if (sheet.horizontalScrollbar && typeof sheet.horizontalScrollbar.move === 'function') {
                //console.log('[BEFORE HSCROLLBAR MOVE]', data.scroll.x);
                try { sheet.horizontalScrollbar.move( data.scroll.x); } catch (err) {console.error('Error moving horizontal scrollbar:', err); }
                //console.log('[AFTER HSCROLLBAR MOVE]', data.scroll.x);
            }
        });

        if (sheet.selector) {
            if (typeof sheet.selector.resetBRTAreaOffset === 'function') sheet.selector.resetBRTAreaOffset();
            if (typeof sheet.selector.resetBRLAreaOffset === 'function') sheet.selector.resetBRLAreaOffset();
            if (typeof sheet.selector.resetAreaOffset === 'function') sheet.selector.resetAreaOffset();
        }

        //console.log('[BEFORE RENDER]', data.scroll.y);
        if (typeof sheet.render === 'function') {
            sheet.render();
        } else if (sheet.table && typeof sheet.table.render === 'function') {
            sheet.table.render();
        }
        //console.log('[AFTER RENDER]', data.scroll.y);
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

    if (!allowExternalClipboard) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }

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

    if (!allowExternalClipboard && !hasInternalClipboard) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }

    const selection = getActiveSelectionRange();
    const startBounds = getExpandedCellBounds(data, selection.sri, selection.sci);

    if (hasInternalClipboard) {
        const srcRange = clipboard.range;
        const targetRange = {
            sri: startBounds.sri,
            sci: startBounds.sci,
            eri: startBounds.sri + (srcRange.eri - srcRange.sri),
            eci: startBounds.sci + (srcRange.eci - srcRange.sci)
        };
        const targetHasMerges = rangeContainsMerges(data, targetRange);
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

    bindScrollbarFeedbackGuard();
    isDomBound = true;
}

function unbindDomEvents() {
    const findInput = document.getElementById('find-input');
    if (findInput) {
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
    unbindScrollbarFeedbackGuard();
    isDomBound = false;
}

export function createSpreadsheetCore({ initialValue = '', fontFamily = null, preferredColumnOrder = [], allowDataTransfer: allowTransfer = true, allowExternalClipboard: allowClipboard = true, onChange = null, onCanonicalized: canonicalized = null, onFetchSgml: fetchSgml = null, onFetchConfigs: fetchConfigs = null, onImportSgml: importSgml = null, onImportResult: importResult = null, onFindOpen: findOpen = null } = {}) {
    configuredSpreadsheetFontFamily = normalizeSpreadsheetFontFamily(fontFamily);
    currentPreferredColumnOrder = Array.isArray(preferredColumnOrder) ? preferredColumnOrder : []; 
    allowDataTransfer = Boolean(allowTransfer);
    allowExternalClipboard = Boolean(allowClipboard);
    
    onSerializedChange = onChange;
    onCanonicalized = canonicalized;
    onFetchSgml = fetchSgml;
    onFetchConfigs = fetchConfigs;
    onImportSgml = importSgml;
    onImportResult = importResult;
    onFindOpen = findOpen;
    resetExportConfigsCache();
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
            onFindOpen = null;
            resetExportConfigsCache();
            unbindDomEvents();
            mySpreadsheet = null;
        }
    };
}

export default createSpreadsheetCore;
// Undo/redo history: snapshots {sheetData, selection} after each mutation and replays
// them, driving the same viewport-restore sequence performUndo/performRedo always used.
// Talks back to core.js exclusively through the host object configured via
// configureHistoryHost()
import { getViewportScrollPosition, restoreViewportScrollPosition, invalidateViewportSync, patchSelector } from './viewport.js';

// --- HOST BINDING (bridges to core.js's live spreadsheet instance & selection helpers) ---
let host = null;

export function configureHistoryHost(nextHost) {
    host = nextHost;
}

let appHistory = [];
let appHistoryIndex = -1;

export function resetHistory() {
    appHistory = [];
    appHistoryIndex = -1;
}

export function saveHistoryState() {
    const mySpreadsheet = host.getSpreadsheet();
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data) return;
    
    let dataSnapshot = mySpreadsheet.getData()[0];
    const selectionRange = host.getActiveSelectionRange();
    
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

export function performUndo() {
    const mySpreadsheet = host.getSpreadsheet();
    if (appHistoryIndex > 0) {
        const viewportScroll = getViewportScrollPosition();
        appHistoryIndex--;
        let state = JSON.parse(appHistory[appHistoryIndex]);
        invalidateViewportSync();
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
                host.restoreSelectorRange(state.sel);
            } else if (Number.isInteger(state.sel.ri) && Number.isInteger(state.sel.ci)) {
                // Preserve indexes while preventing viewport movement during restore.
                mySpreadsheet.sheet.selector.set(state.sel.ri, state.sel.ci, { autoScroll: false, indexesUpdated: true });
            }
        }

        // Enforce original viewport after selector restoration.
        restoreViewportScrollPosition(viewportScroll);
        
        requestAnimationFrame(() => restoreViewportScrollPosition(viewportScroll));
        host.notifySerializedChange();
    }
}

export function performRedo() {
    const mySpreadsheet = host.getSpreadsheet();
    if (appHistoryIndex < appHistory.length - 1) {
        const viewportScroll = getViewportScrollPosition();
        appHistoryIndex++;
        let state = JSON.parse(appHistory[appHistoryIndex]);
        invalidateViewportSync();
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
                host.restoreSelectorRange(state.sel);
            } else if (Number.isInteger(state.sel.ri) && Number.isInteger(state.sel.ci)) {
                // Preserve indexes while preventing viewport movement during restore.
                mySpreadsheet.sheet.selector.set(state.sel.ri, state.sel.ci, { autoScroll: false, indexesUpdated: true });
            }
        }

        // Enforce original viewport after selector restoration.
        restoreViewportScrollPosition(viewportScroll);

        requestAnimationFrame(() => restoreViewportScrollPosition(viewportScroll));
        host.notifySerializedChange();
    }
}

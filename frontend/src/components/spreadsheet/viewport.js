// Viewport engine: keeps the x-data-spreadsheet canvas, scrollbars and selection UI in
// sync, and patches the library's selector/context-menu to fix navigation, auto-scroll
// and focus-stealing bugs. Talks back to core.js exclusively through the host object
// configured via configureViewportHost()
import { coordToXY, getExpandedCellBounds } from './utils.js';

// --- HOST BINDING (bridges to core.js's live spreadsheet instance & selection state) ---
let host = null;

export function configureViewportHost(nextHost) {
    host = nextHost;
}

// --- SCROLLBAR FEEDBACK GUARD ---
// Guard against scrollbar feedback loops when data.scroll is set, triggering
// the library's moveFn -> Sheet.verticalScrollbarMove -> data.scrolly
let _suppressScrollbarFeedback = 0;
let _scrollbarFeedbackGuardBound = false;
let _scrollbarFeedbackGuardHandler = null;

export function bindScrollbarFeedbackGuard() {
    if (_scrollbarFeedbackGuardBound) return;
    // Capture phase on document: runs before the library's own listener on the
    // scrollbar element, so stopImmediatePropagation() will block moveFn 
    _scrollbarFeedbackGuardHandler = (e) => {
            if (_suppressScrollbarFeedback > 0 && e.target && e.target.classList
                && e.target.classList.contains('x-spreadsheet-scrollbar')) {
                e.stopImmediatePropagation();
            }
    };
    document.addEventListener('scroll', _scrollbarFeedbackGuardHandler, true);
    _scrollbarFeedbackGuardBound = true;
}

export function unbindScrollbarFeedbackGuard() {
    if (_scrollbarFeedbackGuardBound && _scrollbarFeedbackGuardHandler) {
        document.removeEventListener('scroll', _scrollbarFeedbackGuardHandler, true);
    }
    _scrollbarFeedbackGuardHandler = null;
    _scrollbarFeedbackGuardBound = false;
    _suppressScrollbarFeedback = 0;
}

export function withScrollbarFeedbackSuppressed(fn) {
    _suppressScrollbarFeedback++;
    try {
        fn();
    } finally {
        // The native scroll event this can trigger fires asynchronously, not
        // synchronously inside fn(), so hold the guard for a couple of frames.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                _suppressScrollbarFeedback = Math.max(0, _suppressScrollbarFeedback - 1);
            });
        });
    }
}

function lockOverlayerContentScroll() {
    const mySpreadsheet = host.getSpreadsheet();
    if (!mySpreadsheet || !mySpreadsheet.sheet) return;
    const el = document.querySelector('.x-spreadsheet-overlayer-content');
    if (!el || el._scrollLocked) return;

    // This container should never scroll natively — all scrolling is handled
    // via data.scroll.y/x and the custom scrollbar divs
    el.addEventListener('scroll', () => {
        if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
            el.scrollTop = 0;
            el.scrollLeft = 0;
        }
    });
    el._scrollLocked = true;
}

// --- MONKEY-PATCH THE SELECTION ENGINE (Fixes Navigation & Auto-Scrolling) ---
export function patchSelector() {
    const mySpreadsheet = host.getSpreadsheet();
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.selector) return;

    const sheet = mySpreadsheet.sheet;

    if (sheet.data && typeof sheet.data.copyToSystemClipboard === 'function' && !sheet.data._systemClipboardPatched) {
        const originalCopyToSystemClipboard = sheet.data.copyToSystemClipboard.bind(sheet.data);
        sheet.data.copyToSystemClipboard = () => {
            if (host.isExternalClipboardAllowed()) {
                return originalCopyToSystemClipboard();
            }
            return undefined;
        };
        sheet.data._systemClipboardPatched = true;
    }
    
    // Prevent native browser scroll-jump when library internally focuses the hidden input or editor.
    // By dynamically targeting the specific elements from the instance, we guarantee they exist.
    if (sheet.selector && sheet.selector.hideInputDiv && sheet.selector.hideInputDiv.el) {
        const hiddenInput = sheet.selector.hideInputDiv.el.querySelector('input');
        if (hiddenInput && !hiddenInput._focusPatched) {
            const origFocus = hiddenInput.focus;
            hiddenInput.focus = function(opts) {
                origFocus.call(this, { preventScroll: true, ...(opts || {}) });
            };
            hiddenInput._focusPatched = true;
        }
    }
    if (sheet.editor && sheet.editor.textEl && sheet.editor.textEl.el) {
        const textarea = sheet.editor.textEl.el;
        if (textarea && !textarea._focusPatched) {
            const origFocus = textarea.focus;
            textarea.focus = function(opts) {
                origFocus.call(this, { preventScroll: true, ...(opts || {}) });
            };
            textarea._focusPatched = true;
        }
    }

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
    lockOverlayerContentScroll();
    if (sheet.selector._isPatched) return;

    let sel = sheet.selector;
    const origSet = sel.set.bind(sel);
    
    sel.set = function(ri, ci, setArg = true) {
        let data = host.getSpreadsheet().sheet.data;
        const toolbarSnapshot = host.getToolbarSelectionSnapshot();
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
        
        const { ri: lastRi, ci: lastCi } = host.getLastSelection();
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
        
        host.setLastSelection(ri, ci);

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
            const expectedRi = ri;
            const expectedCi = ci;
            
            const doSnap = () => {
                const data = host.getSpreadsheet()?.sheet?.data;
                const curSel = data?.selector;
                if (!data || !curSel || curSel.ri !== expectedRi || curSel.ci !== expectedCi) return;
                
                if (typeof data.getSelectedRect !== 'function' || typeof sheet.getTableOffset !== 'function') return;

                const selectedRect = data.getSelectedRect();
                const tableOffset = sheet.getTableOffset();
                const selectionHeight = Number(selectedRect && selectedRect.height) || 0;
                const viewportHeight = Number(tableOffset && tableOffset.height) || 0;
                
                if (selectionHeight <= 0 || viewportHeight <= 0 || selectionHeight <= viewportHeight) return;

                const freezeH = typeof data.freezeTotalHeight === 'function' ? data.freezeTotalHeight() : 0;
                const targetTop = Math.max(0, (Number(selectedRect.t) || 0) - 1 - freezeH);
                const currentY = data.scroll && Number.isFinite(data.scroll.y) ? data.scroll.y : 0;

                // Only force UI rendering and scrolling if we are not already at the desired absolute coordinate
                if (Math.abs(currentY - targetTop) > 1 && typeof data.scrolly === 'function') {
                    data.scrolly(targetTop, () => {
                        withScrollbarFeedbackSuppressed(() => {
                            if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
                                try { sheet.verticalScrollbar.move(data.scroll.y); } catch (e) {console.warn('Error moving vertical scrollbar during snap:', e);}
                            }
                        });
                        if (sheet.selector && typeof sheet.selector.resetAreaOffset === 'function') {
                            sheet.selector.resetAreaOffset();
                            if (typeof sheet.selector.resetBRTAreaOffset === 'function') sheet.selector.resetBRTAreaOffset();
                            if (typeof sheet.selector.resetBRLAreaOffset === 'function') sheet.selector.resetBRLAreaOffset();
                        }
                        if (typeof sheet.render === 'function') {
                            sheet.render();
                        } else if (sheet.table && typeof sheet.table.render === 'function') {
                            sheet.table.render();
                        }
                    });
                }
            };

            // Wait for the library's internal keydown loop (which fires synchronously after sel.set returns)
            // to finish messing with the viewport, then enforce our boundary
            setTimeout(() => {
                doSnap();
                // Secondary safety net catch in case the library defers via requestAnimationFrame natively
                requestAnimationFrame(doSnap);
            }, 0);
        }

        if (autoScroll === false) {
            data.scrollx = origDataX;
            data.scrolly = origDataY;
            if (sheet) {
                if (origSheetX) sheet.scrollx = origSheetX;
                if (origSheetY) sheet.scrolly = origSheetY;
                if (origVScroll) sheet.verticalScrollbar.move = origVScroll;
                if (origHScroll) sheet.horizontalScrollbar.move = origHScroll;
            }

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

        host.notifySelectionSet();
        
        return ret;
    };
    sel._isPatched = true;
}

// --- MONKEY-PATCH THE CONTEXT MENU ---
// This removes context menu items we don't want users to see, such as "Data Validation" and "Enable/Disable Export".
export function patchContextMenu() {
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

export const restoreFocus = (selectionOverride = null, options = {}) => {
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
    
    const mySpreadsheet = host.getSpreadsheet();
    const selectionRange = selectionOverride || host.getActiveSelectionRange();
    
    if (mySpreadsheet && mySpreadsheet.sheet) {
        mySpreadsheet.sheet.focusing = true;
        mySpreadsheet.sheet.isFocus = true; 
        host.restoreSelectorRange(selectionRange);

        // jumpSelectionTo etc. know exactly where to jump to;
        // Lock the viewport scroll position if specified to prevent library scrolling drift
        if (options.lockedViewportScroll) {
            restoreViewportScrollPosition(options.lockedViewportScroll);
        }

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
                console.warn('Error during synthetic focus click:', e);
            }
        }
    }
};

// --- DEBOUNCED SCHEDULERS TO PREVENT PILE-UP AND RACE CONDITIONS ---
let _restoreFocusTimeout = null;
let _restoreFocusRaf = null;

export function scheduleRestoreFocus(selectionOverride = null, options = {}) {
    if (_restoreFocusTimeout) clearTimeout(_restoreFocusTimeout);
    if (_restoreFocusRaf) cancelAnimationFrame(_restoreFocusRaf);
    _restoreFocusTimeout = setTimeout(() => {
        restoreFocus(selectionOverride, options);
        _restoreFocusRaf = requestAnimationFrame(() => restoreFocus(selectionOverride, options));
    }, 0);
}

let _viewportSyncRequestId = 0;

// Bumps the in-flight viewport-sync request counter so any pending async callback
// from a superseded sync/scroll operation (see requestId checks below) bails out.
export function invalidateViewportSync() {
    return ++_viewportSyncRequestId;
}

export function syncViewportFromSheetData(options = {}) {
    const mySpreadsheet = host.getSpreadsheet();
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.data) return;
    const requestId = Number.isInteger(options.requestId) ? options.requestId : ++_viewportSyncRequestId;
    const sheet = mySpreadsheet.sheet;
    const data = sheet.data;
    const preserveHorizontal = !!options.preserveHorizontal;
    const lockedScrollX = Number.isFinite(options.lockedScrollX) ? options.lockedScrollX : null;

    const applyViewport = (horizontalTarget = null) => {
        if (requestId !== _viewportSyncRequestId) return;
        if (lockedScrollX !== null) {
            if (!data.scroll || typeof data.scroll !== 'object') data.scroll = {};
            data.scroll.x = lockedScrollX;
        }
        
        // 1. Recalculate blue selection box offsets against the new scroll position
        if (sheet.selector && typeof sheet.selector.resetAreaOffset === 'function') {
            sheet.selector.resetAreaOffset();
        }
        if (sheet.selector && typeof sheet.selector.resetBRTAreaOffset === 'function') {
            sheet.selector.resetBRTAreaOffset();
        }
        if (sheet.selector && typeof sheet.selector.resetBRLAreaOffset === 'function') {
            sheet.selector.resetBRLAreaOffset();
        }
        
        // 2. Render Canvas FIRST. 
        if (typeof sheet.render === 'function') {
            sheet.render();
        } else if (sheet.table && typeof sheet.table.render === 'function') {
            sheet.table.render();
        }

        // 3. WAIT FOR PAINT, THEN MOVE SCROLLBARS
        requestAnimationFrame(() => {
            withScrollbarFeedbackSuppressed(() => {
                if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
                   try { sheet.verticalScrollbar.move(data.scroll ? {top: data.scroll.y} : {top: 0}); } catch (e) {
                        console.warn('Error moving vertical scrollbar:', e);
                    }
                }
                if (horizontalTarget !== null && sheet.horizontalScrollbar && typeof sheet.horizontalScrollbar.move === 'function') {
                    try { sheet.horizontalScrollbar.move({left: horizontalTarget}); } catch (e) {
                        console.warn('Error moving horizontal scrollbar:', e);
                    }
                }
            });
        });
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

        let horizontalPending = false;
        let verticalPending = false;

        if (!preserveHorizontal && sheet.horizontalScrollbar && typeof sheet.horizontalScrollbar.move === 'function') {
            let targetLeft = null;
            if (viewLeft + width > tableOffset.width) {
                targetLeft = contentLeft + width - tableOffset.width;
            } else {
                const freezeW = typeof data.freezeTotalWidth === 'function' ? data.freezeTotalWidth() : 0;
                if (viewLeft < freezeW) {
                    targetLeft = contentLeft - 1 - freezeW;
                }
            }
            if (targetLeft !== null && typeof data.scrollx === 'function') {
                horizontalPending = true;
                try { data.scrollx(targetLeft, () => applyViewport(targetLeft)); } catch (e) {console.warn('Error scrolling horizontally:', e);}
            }
        }

        if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
            let targetTop = null;
            const freezeH = typeof data.freezeTotalHeight === 'function' ? data.freezeTotalHeight() : 0;
            if (height > tableOffset.height) {
                targetTop = Math.max(0, contentTop - 1 - freezeH);
            } else if (viewTop + height > tableOffset.height) {
                targetTop = contentTop + height - tableOffset.height - 1;
            } else if (viewTop < 0) {
                targetTop = contentTop - 1 - freezeH;
            }
            if (targetTop !== null && typeof data.scrolly === 'function') {
                verticalPending = true;
                try { data.scrolly(targetTop, applyViewport); } catch (e) {console.warn('Error scrolling vertically:', e);}
            }
        }
        if (!horizontalPending && !verticalPending) {
            applyViewport();
        }
    } else {
        applyViewport();
    }
}

export function getViewportScrollPosition() {
    const mySpreadsheet = host.getSpreadsheet();
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

export function restoreViewportScrollPosition(position) {
    const mySpreadsheet = host.getSpreadsheet();
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

    // Claim this as the authoritative in-flight request. Any earlier calls
    // to restoreViewportScrollPosition/syncViewportFromSheetData that are
    // still pending in a rAF callback will see a mismatched requestId and bail,
    // so only the most recently requested scroll position ever gets applied.
    const requestId = ++_viewportSyncRequestId;

    const applyViewport = () => {
        // 1. RECALCULATE SELECTION BOX OFFSETS
        if (sheet.selector && typeof sheet.selector.resetBRTAreaOffset === 'function') {
            sheet.selector.resetBRTAreaOffset();
        }
        if (sheet.selector && typeof sheet.selector.resetBRLAreaOffset === 'function') {
            sheet.selector.resetBRLAreaOffset();
        }
        if (sheet.selector && typeof sheet.selector.resetAreaOffset === 'function') {
            sheet.selector.resetAreaOffset();
        }

        // 2. RENDER CANVAS FIRST
        // This forces the internal engine to update DOM bounds (scrollbar max-heights)
        if (typeof sheet.render === 'function') {
            sheet.render();
        } else if (sheet.table && typeof sheet.table.render === 'function') {
            sheet.table.render();
        }
        
        // 3. WAIT FOR PAINT, THEN MOVE SCROLLBARS
        requestAnimationFrame(() => {
            if (requestId !== _viewportSyncRequestId) return; // a newer scroll request superseded this one

            const vScrollEl = document.querySelector('.x-spreadsheet-scrollbar.vertical');
            if (vScrollEl) vScrollEl.scrollHeight; // force layout calculation
            
            withScrollbarFeedbackSuppressed(() => {
                if (sheet.verticalScrollbar && typeof sheet.verticalScrollbar.move === 'function') {
                    try { sheet.verticalScrollbar.move({ top: data.scroll ? data.scroll.y : targetY }); } catch (e) {
                        console.warn('Error moving vertical scrollbar:', e);
                    }
                }
                if (sheet.horizontalScrollbar && typeof sheet.horizontalScrollbar.move === 'function') {
                    try { sheet.horizontalScrollbar.move({ left: data.scroll ? data.scroll.x : targetX }); } catch (e) {
                        console.warn('Error moving horizontal scrollbar:', e);
                    }
                }
            });
        });
    };

    applyViewport();
}

export function jumpSelectionTo(ri, ci, skipFocusRestore = false, options = {}) {
    const mySpreadsheet = host.getSpreadsheet();
    if (!mySpreadsheet || !mySpreadsheet.sheet || !mySpreadsheet.sheet.selector) return;
    
    const preserveHorizontal = !!options.preserveHorizontal;
    const lockedScrollX = preserveHorizontal
        ? (Number.isFinite(mySpreadsheet.sheet?.data?.scroll?.x) ? mySpreadsheet.sheet.data.scroll.x : 0)
        : null;
    const requestId = ++_viewportSyncRequestId;
    
    const targetBounds = getExpandedCellBounds(mySpreadsheet.sheet.data, ri, ci);
    
    host.restoreSelectorRange(targetBounds);

    syncViewportFromSheetData({ preserveHorizontal, requestId, lockedScrollX });


    if (!skipFocusRestore) {
        // lockedViewportScroll makes every restoreFocus pass scheduleRestoreFocus
        // queues (both the immediate and the rAF-deferred one) re-assert the
        // scroll position we just computed - see restoreFocus for why this is
        // needed instead of just calling scheduleRestoreFocus plain.
        scheduleRestoreFocus(null, {
            skipSyntheticClick: true,
            lockedViewportScroll: getViewportScrollPosition(),
        });
    }
}

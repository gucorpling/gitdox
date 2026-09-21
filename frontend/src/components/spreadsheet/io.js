// SocialCalc <-> sheet-data format conversions. Each supported wire format exposes a
// parse(rawString, ctx) -> { sheetData, didReorderColumns } and
// serialize(sheetData) -> rawString pair
import { colToInt, coordToXY, xyToCoord, getMaxBounds } from './utils.js';
import { normalizeHexColor, isDefaultBackgroundColor, getOrCreateStyleIndex, applyConfiguredFontToStyles } from './styles.js';

// Round-trip metadata captured during parse and replayed during serialize, so
// SocialCalc-specific lines that we don't model in sheetData survive an edit cycle
let preSheetLines = [];
let postSheetLines = [];
let parsedFonts = [];
let parsedValueFormats = [];

export function normalizeLineEndings(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\r\n?/g, '\n');
}

export function getDefaultSocialCalcData() {
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

// --- COLUMN REORDERING LOGIC ---
export function reorderSocialCalcColumns(socialCalcData, preferredOrder) {
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

    // 4. Sort the unique headers respecting prefix-based ordering and suffix-batching
    const headerDetails = originalHeaderOrder.map(header => {
        const colonIdx = header.indexOf(':');
        const rawPrefix = colonIdx !== -1 ? header.substring(0, colonIdx) : header;

        // 1. Check for an exact full header match first
        const isExactMatch = prefOrder.indexOf(header) !== -1;

        let idx;
        let prefix = rawPrefix;
        let suffix;

        if (isExactMatch) {
            // EXACT MATCH: Treat as a standalone column.
            idx = prefOrder.indexOf(header);
            prefix = header;
            suffix = '';
        } else {
            // DYNAMIC MATCH: Split into prefix and suffix
            idx = prefOrder.indexOf(rawPrefix);
            suffix = colonIdx !== -1 ? header.substring(colonIdx + 1) : '';
        }

        const isKnown = idx !== -1;

        // Give unknown columns a mathematically high secondary rank (though they are separated later)
        if (!isKnown) {
            idx = prefOrder.length + originalHeaderOrder.indexOf(header);
        }

        return { header, prefix, suffix, secondaryRank: idx, isKnown };
    });

    // Determine the min and max rank bounds for every suffix group (excluding the empty base suffix)
    const suffixBounds = {};
    headerDetails.forEach(details => {
        if (details.isKnown && details.suffix !== '') {
            if (!suffixBounds[details.suffix]) {
                suffixBounds[details.suffix] = { min: details.secondaryRank, max: details.secondaryRank };
            } else {
                suffixBounds[details.suffix].min = Math.min(suffixBounds[details.suffix].min, details.secondaryRank);
                suffixBounds[details.suffix].max = Math.max(suffixBounds[details.suffix].max, details.secondaryRank);
            }
        }
    });

    // Merge overlapping intervals to create contiguous "cluster blocks"
    const rawIntervals = Object.values(suffixBounds).sort((a, b) => a.min - b.min);
    const mergedIntervals = [];
    if (rawIntervals.length > 0) {
        let current = rawIntervals[0];
        for (let i = 1; i < rawIntervals.length; i++) {
            if (rawIntervals[i].min <= current.max) {
                current.max = Math.max(current.max, rawIntervals[i].max); // Extend interval
            } else {
                mergedIntervals.push(current);
                current = rawIntervals[i]; // Start new interval
            }
        }
        mergedIntervals.push(current);
    }

    // Assign final primary rank:
    // If a column's rank falls inside a cluster block, it anchors to the start of that block
    headerDetails.forEach(details => {
        let pRank = details.secondaryRank;
        if (details.isKnown) {
            for (const interval of mergedIntervals) {
                if (details.secondaryRank >= interval.min && details.secondaryRank <= interval.max) {
                    pRank = interval.min;
                    break;
                }
            }
        }
        details.primaryRank = pRank;
    });

    // Sort the headers using the composite parameters
    const sortedHeaders = headerDetails.sort((a, b) => {
        // 0. Known columns ALWAYS come before unknown columns
        if (a.isKnown !== b.isKnown) {
            return a.isKnown ? -1 : 1;
        }

        // 1. If both are completely unknown, simply sort them alphabetically
        if (!a.isKnown && !b.isKnown) {
            return a.header.localeCompare(b.header);
        }

        // 2. Primary rank keeps suffix batches in the correct relative global location
        if (a.primaryRank !== b.primaryRank) {
            return a.primaryRank - b.primaryRank;
        }

        // 3. Suffix (alphabetical) handles instances where two batches share the same anchor rank.
        // The empty suffix '' naturally sorts before '2', keeping base columns first within a cluster.
        if (a.suffix !== b.suffix) {
            return a.suffix < b.suffix ? -1 : 1;
        }

        // 4. Secondary rank orders prefixes INTERNALLY within the identical suffix batch
        if (a.secondaryRank !== b.secondaryRank) {
            return a.secondaryRank - b.secondaryRank;
        }

        // 5. Fallback to original arrival order to guarantee stable sorts
        return originalHeaderOrder.indexOf(a.header) - originalHeaderOrder.indexOf(b.header);
    }).map(d => d.header);

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
// ctx: { preferredColumnOrder, fontFamily, maxColumnCount }
export function parseSocialCalcToSheetData(rawData, ctx = {}) {
    // --- PARSE ONLY: SocialCalc string -> sheet data object (no side effects on existing mySpreadsheet) ---
    const preferredColumnOrder = ctx.preferredColumnOrder;
    const fontFamily = ctx.fontFamily;
    const maxColumnCount = ctx.maxColumnCount;

    const sourceRaw = typeof rawData === 'string' ? rawData : '';
    const raw = reorderSocialCalcColumns(sourceRaw, preferredColumnOrder);
    const didReorderColumns = normalizeLineEndings(raw) !== normalizeLineEndings(sourceRaw);
    const lines = raw.split('\n');

    let cellData = {};
    let sheetMerges = [];
    let maxCol = 0;
    let maxRow = 0;

    let stylesList = [
        {
            font: {
                name: fontFamily,
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
    stylesList = applyConfiguredFontToStyles(stylesList, fontFamily);

    return {
        sheetData: {
            name: 'Sheet1',
            styles: stylesList,
            cols: { len: Math.max(maxColumnCount, maxCol + 1) },
            rows: cellData,
            merges: sheetMerges,
            freeze: 'A2'
        },
        didReorderColumns,
    };
}

// --- 2. EXPORT LOGIC (X-Spreadsheet -> SocialCalc) ---
export function exportSocialCalc(data) {
    if (!data) return "";

    const rows = data.rows || {};
    const stylesList = data.styles || [];

    let output = preSheetLines.join('\n') + '\n';

    let bounds = getMaxBounds(data);
    const maxC = bounds.maxC;
    const maxR = bounds.maxR;

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

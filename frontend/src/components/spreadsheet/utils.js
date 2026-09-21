// --- STATIC UTILITIES (pure, no shared state) ---
// e.g. Coordinate/bounds math shared across the spreadsheet: column<->index conversion,
// coord<->xy parsing, merge-range parsing, and overlap/bounds calculations

export function colToInt(colStr) {
    let num = 0;
    for (let i = 0; i < colStr.length; i++) {
        num = num * 26 + (colStr.charCodeAt(i) - 64);
    }
    return num - 1;
}

export function intToCol(num) {
    let str = '';
    while (num >= 0) {
        str = String.fromCharCode((num % 26) + 65) + str;
        num = Math.floor(num / 26) - 1;
    }
    return str;
}

export function coordToXY(coord) {
    if (typeof coord !== 'string') return null;
    const normalizedCoord = coord.trim().toUpperCase();
    const match = normalizedCoord.match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;
    return { x: colToInt(match[1]), y: parseInt(match[2], 10) - 1 };
}

export function xyToCoord(x, y) {
    return intToCol(x) + (y + 1);
}

export function getMaxBounds(data) {
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

// --- Helper to find the true bounds of a cell (expanding if it's a merge) ---
export function getExpandedCellBounds(data, ri, ci) {
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

export function parseMergeEntry(mergeEntry) {
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

export function rangesOverlap(a, b) {
    return !!(a && b && a.sri <= b.eri && a.eri >= b.sri && a.sci <= b.eci && a.eci >= b.sci);
}

// Pure helpers for normalizing, comparing and deduplicating cell style objects and font names

export function normalizeHexColor(color) {
    if (!color) return null;
    const val = String(color).trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(val)) return val;
    return null;
}

export function isDefaultBackgroundColor(color) {
    return normalizeHexColor(color) === '#ffffff';
}

export function compactStyleObject(styleObj) {
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

export function isStyleEquivalent(a, b) {
    return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

export function getOrCreateStyleIndex(styles, styleObj) {
    for (let i = 0; i < styles.length; i++) {
        if (isStyleEquivalent(styles[i], styleObj)) return i;
    }
    styles.push(styleObj);
    return styles.length - 1;
}

export function normalizeSpreadsheetFontFamily(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function applyConfiguredFontToStyles(stylesList, family) {
    if (!Array.isArray(stylesList) || stylesList.length === 0) return stylesList;

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

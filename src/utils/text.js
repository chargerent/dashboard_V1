export const toText = (value) => (value == null ? '' : String(value));

export const normalizeText = (value) => toText(value).trim().toLowerCase();

export const textEquals = (left, right) => {
    const normalizedLeft = normalizeText(left);
    const normalizedRight = normalizeText(right);
    return normalizedLeft !== '' && normalizedLeft === normalizedRight;
};

export const textIncludes = (value, query) => normalizeText(value).includes(normalizeText(query));

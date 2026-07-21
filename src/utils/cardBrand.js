const firstText = (...values) => {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text) return text;
    }
    return '';
};

const decodeHexAscii = (value) => {
    const hex = String(value || '').replace(/[^0-9a-fA-F]/g, '');
    if (!hex || hex.length % 2 !== 0 || hex.length < 4) return '';

    let output = '';
    for (let index = 0; index < hex.length; index += 2) {
        const code = parseInt(hex.slice(index, index + 2), 16);
        if (!Number.isFinite(code) || code === 0) break;
        output += String.fromCharCode(code);
    }

    const text = output.trim();
    return /^[\x20-\x7E]+$/.test(text) ? text : '';
};

const normalizeRawBrand = (value) => {
    const decoded = decodeHexAscii(value);
    return (decoded || String(value || '')).trim();
};

const readTag = (tags, tag) => {
    if (!tags || typeof tags !== 'object') return '';
    return firstText(tags[tag], tags[tag.toUpperCase()], tags[tag.toLowerCase()]);
};

const readTagFromText = (text, tag) => {
    const source = String(text || '');
    if (!source) return '';

    const expression = new RegExp(`\\b${tag}\\b\\s*:\\s*([^\\s\\r\\n]+)`, 'i');
    const match = source.match(expression);
    return match ? match[1] : '';
};

const getAidBrand = (value) => {
    const aid = String(value || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (!aid) return '';

    if (aid.startsWith('A000000003')) return 'VISA';
    if (aid.startsWith('A000000004')) return 'MASTERCARD';
    if (aid.startsWith('A000000025')) return 'AMERICAN EXPRESS';
    if (aid.startsWith('A000000152')) return 'DISCOVER';
    if (aid.startsWith('A000000065')) return 'JCB';
    if (aid.startsWith('A000000333')) return 'UNIONPAY';
    if (aid.startsWith('A000000277')) return 'INTERAC';

    return '';
};

const extractRawBrand = (record = {}) => {
    const tags = record.emvTags || record.EMV_Tags || record.emv_tags;
    const terminalText = firstText(record.terminalPayloadSanitized, record.paymentPayloadSanitized);
    const aid = firstText(
        record.applicationId,
        record.applicationIdentifier,
        record.aid,
        readTag(tags, '84'),
        readTag(tags, '9F06'),
        readTag(tags, 'DFCA07'),
        readTagFromText(terminalText, '84'),
        readTagFromText(terminalText, '9F06'),
        readTagFromText(terminalText, 'DFCA07'),
    );

    return firstText(
        record.EMV_Card_Type,
        record.emvCardType,
        record.cardType,
        record.card_type,
        record.cardBrand,
        record.card_brand,
        record.cardLabel,
        record.card_label,
        record.applicationLabel,
        record.application_label,
        record.EMV_Application_Label,
        record.emvApplicationLabel,
        readTag(tags, 'DFCA0A'),
        readTag(tags, 'DFF004'),
        readTag(tags, '9F12'),
        readTag(tags, '50'),
        readTagFromText(terminalText, 'DFCA0A'),
        readTagFromText(terminalText, 'DFF004'),
        readTagFromText(terminalText, '9F12'),
        readTagFromText(terminalText, '50'),
        getAidBrand(aid),
    );
};

export const getCardBrandDisplay = (rental = {}) => {
    const eventRecords = Array.isArray(rental.rentalEvents) ? rental.rentalEvents.slice().reverse() : [];
    const records = [
        rental,
        rental.payment,
        rental.paymentMetadata,
        rental.payter,
        ...eventRecords,
        ...eventRecords.map(event => event?.payment),
        ...eventRecords.map(event => event?.paymentMetadata),
    ].filter(record => record && typeof record === 'object');

    const rawBrand = normalizeRawBrand(firstText(...records.map(extractRawBrand)));

    if (!rawBrand) return { key: 'generic', title: 'Card' };

    const normalized = rawBrand.toUpperCase().replace(/[_-]+/g, ' ');
    const compact = normalized.replace(/[^A-Z0-9]/g, '');

    if (normalized.includes('AMERICAN EXPRESS') || compact.includes('AMEX')) {
        return { key: 'amex', title: rawBrand };
    }
    if (normalized.includes('MAESTRO')) {
        return { key: 'maestro', title: rawBrand };
    }
    if (normalized.includes('MASTER')) {
        return { key: 'mastercard', title: rawBrand };
    }
    if (normalized.includes('VISA')) {
        return { key: 'visa', title: rawBrand };
    }
    if (normalized.includes('DISCOVER')) {
        return { key: 'discover', title: rawBrand };
    }
    if (normalized.includes('DINERS')) {
        return { key: 'diners', title: rawBrand };
    }
    if (normalized.includes('JCB')) {
        return { key: 'jcb', title: rawBrand };
    }
    if (normalized.includes('UNIONPAY') || normalized.includes('UNION PAY')) {
        return { key: 'unionpay', title: rawBrand };
    }
    if (normalized.includes('INTERAC')) {
        return { key: 'interac', title: rawBrand };
    }

    return { key: 'generic', title: rawBrand };
};

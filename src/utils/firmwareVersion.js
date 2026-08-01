const normalizeVersionByte = (value) => {
    const numericValue = Number(value);
    if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > 255) {
        return null;
    }

    return numericValue;
};

export const formatModuleFirmwareVersion = (softwareVersion, hardwareVersion) => {
    const highByte = normalizeVersionByte(softwareVersion);
    const lowByte = normalizeVersionByte(hardwareVersion);

    if (highByte === null || lowByte === null) {
        return '---';
    }

    const version = (highByte << 8) | lowByte;
    return version > 0 ? `V${version}` : '---';
};

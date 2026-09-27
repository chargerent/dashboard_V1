const STORED_GATEWAY_BY_OPTION = Object.freeze({
    P68: 'PAYTERP68',
    APO: 'APOLLO',
    SCAN: 'SCANNER',
});

const OPTION_BY_STORED_GATEWAY = Object.freeze(
    Object.fromEntries(Object.entries(STORED_GATEWAY_BY_OPTION).map(([option, gateway]) => [gateway, option]))
);

export function toStoredKioskGateway(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return STORED_GATEWAY_BY_OPTION[normalized] || normalized;
}

export function toGatewayOption(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return OPTION_BY_STORED_GATEWAY[normalized] || normalized;
}

export function canEditTerminalSerial(gateway) {
    const storedGateway = toStoredKioskGateway(gateway);
    return storedGateway === 'PAYTERP68' || storedGateway === 'APOLLO';
}

export function canUseApolloScannerOnly(gateway) {
    return toStoredKioskGateway(gateway) === 'APOLLO';
}

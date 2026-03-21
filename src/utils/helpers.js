// src/utils/helpers.js

const NEW_KIOSK_TYPES = new Set(['CT3', 'CT4', 'CT8', 'CT12', 'CK48']);
const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const LEGACY_TIMESTAMP_PATTERN = /(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/;
const HAS_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;

const parseDashboardTimestamp = (value) => {
    if (!value) return null;

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value !== 'string') return null;

    const normalizedValue = HAS_TIMEZONE_PATTERN.test(value) ? value : `${value}Z`;
    let parsed = new Date(normalizedValue);

    if (Number.isNaN(parsed.getTime())) {
        const parts = value.match(LEGACY_TIMESTAMP_PATTERN);
        if (parts) {
            parsed = new Date(parts[3], parts[2] - 1, parts[1], parts[4], parts[5], parts[6]);
        }
    }

    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getMostRecentTimestamp = (timestamps) => {
    const parsedDates = timestamps
        .map(parseDashboardTimestamp)
        .filter(Boolean);

    if (parsedDates.length === 0) return null;

    return new Date(Math.max(...parsedDates.map(date => date.getTime())));
};

const hasRecentTimestamp = (timestamp, referenceTime, windowMs) => {
    const parsedTimestamp = parseDashboardTimestamp(timestamp);
    const parsedReference = parseDashboardTimestamp(referenceTime);

    if (!parsedTimestamp || !parsedReference) return false;

    return parsedTimestamp.getTime() >= (parsedReference.getTime() - windowMs);
};

export const isNewSchemaKiosk = (kiosk) => {
    if (!kiosk) return false;
    if (kiosk.isNewSchema === true) return true;
    return NEW_KIOSK_TYPES.has(String(kiosk.hardware?.type || '').toUpperCase());
};

export const isModuleOnline = (module, referenceTime) => (
    hasRecentTimestamp(module?.lastUpdated, referenceTime, ONLINE_WINDOW_MS)
);

/**
 * Normalizes the raw kiosk data from the API into a more consistent and usable format.
 * @param {Array} kiosks - The array of kiosk objects from the API.
 * @returns {Array} - The normalized array of kiosk objects.
 */
export const normalizeKioskData = (kiosks) => {
    if (!Array.isArray(kiosks)) return [];

    return kiosks.map(kiosk => {
        const modulesSource = Object.values(kiosk.modules || {})
            .filter(module => module.id && !module.id.startsWith('disabled'));

        // Detect schema: new kiosks (CT3/CK48) have a `slots` array directly on the module.
        // Old kiosks use a `heartbeat` object with raw slot data.
        const isNewSchema = modulesSource.length > 0 && Array.isArray(modulesSource[0].slots);

        const normalizedModules = modulesSource.map(module => {
            let slots = [];

            if (isNewSchema) {
                // New schema: slots array with status/sn/lock/holeDetection fields
                slots = (module.slots || []).map(slotData => {
                    const status = Number(slotData.status ?? 0);
                    const sn = Number(slotData.sn ?? 0);
                    const chargingCurrent = Number(slotData.chargingCurrent ?? slotData.chargeCurrent ?? 0);
                    const chargingVoltage = Number(slotData.chargingVoltage ?? slotData.chargeVoltage ?? 0);
                    const chargeVoltage = Number(slotData.chargeVoltage ?? slotData.chargingVoltage ?? 0);
                    const areaCode = Number(slotData.areaCode ?? 0);
                    const holeDetection = Number(slotData.holeDetection ?? 0);
                    const softwareVersion = Number(slotData.softwareVersion ?? 0);
                    const hasCharger = status === 1 && sn !== 0;
                    const isSstatError = holeDetection === 192;
                    return {
                        position: slotData.position,
                        sn: hasCharger ? sn : 0,
                        batteryLevel: hasCharger ? slotData.batteryLevel : null,
                        chargingCurrent,
                        isLocked: !!slotData.lock,
                        lockReason: slotData.lockReason || '',
                        cmos: null,
                        sstat: hasCharger ? '0F' : '0C', // map to old convention for UI compatibility
                        // Legacy kiosks used cmos === 'BF' to mark broken chargers.
                        // New-schema kiosks do not expose an equivalent cmos flag in the slot payload,
                        // so do not infer a failure from "full and not charging" alone.
                        isFullNotCharging: false,
                        isSstatError,
                        // Extra new-schema fields preserved for display
                        status,
                        areaCode,
                        holeDetection,
                        chargingVoltage,
                        chargeVoltage,
                        chargeCurrent: chargingCurrent,
                        softwareVersion,
                        temperature: slotData.temperature,
                        cellVoltage: slotData.cellVoltage,
                        cycle: slotData.cycle,
                    };
                });
            } else {
                // Old schema: heartbeat object with cid/sstat/cmos/cstate fields
                const slotSource = module.heartbeat && typeof module.heartbeat === 'object'
                    ? Object.entries(module.heartbeat)
                    : [];

                slots = slotSource.map(([key, slotData]) => {
                    const position = parseInt(key.replace('slot', ''), 10);
                    const hasCharger = slotData && slotData.cid && slotData.cid !== '0000000000' && slotData.cid !== '0';
                    const isSstatError = slotData.sstat === '0F' && (!slotData.cid || slotData.cid === '0000000000');
                    const cmos = hasCharger ? slotData.cmos : null;
                    const chargingCurrent = hasCharger ? parseInt(slotData.cstate, 10) : 0;
                    return {
                        position: position,
                        sn: hasCharger ? slotData.cid : 0,
                        batteryLevel: hasCharger ? slotData.batlvl : null,
                        chargingCurrent: chargingCurrent,
                        isLocked: !!(module.lock && module.lock[`slot${position}`]),
                        lockReason: (module.lock && module.lock[`info${position}`]) || '',
                        cmos: cmos,
                        sstat: slotData.sstat,
                        isFullNotCharging: cmos === 'BF' && chargingCurrent === 0,
                        isSstatError: isSstatError,
                    };
                });
            }

            const lastUpdated = module.lastUpdated || kiosk.timestamp;
            return {
                id: module.id,
                lastUpdated,
                slots,
                output: module.output,
                heartbeat: module.heartbeat,
                isNewSchema,
            };
        });

        const lastUpdated = getMostRecentTimestamp([
            kiosk.timestamp,
            ...normalizedModules.map(module => module.lastUpdated),
        ])?.toISOString() || kiosk.timestamp || modulesSource[0]?.lastUpdated || null;

        // Infer hardware.type for new-schema kiosks that don't have it set (e.g. migrated V2 kiosks)
        let hardware = kiosk.hardware || {};
        if (isNewSchema && !hardware.type) {
            const totalSlots = normalizedModules.reduce((sum, m) => sum + m.slots.length, 0);
            hardware = { ...hardware, type: totalSlots >= 20 ? 'CK48' : 'CT3' };
        }

        const configuredPower = Number(hardware?.power);
        const fullThreshold = Number.isFinite(configuredPower) ? configuredPower : 80;
        const derivedCount = normalizedModules.reduce((sum, module) => (
            sum + module.slots.filter(slot => (
                slot.sn &&
                slot.sn !== 0 &&
                !slot.isLocked &&
                typeof slot.batteryLevel === 'number' &&
                slot.batteryLevel >= fullThreshold
            )).length
        ), 0);
        const kioskCount = Number(kiosk.count);

        return {
            stationid: kiosk.stationid,
            provisionid: kiosk.provisionid,
            hardware,
            info: {
                location: kiosk.info?.location || '',
                place: kiosk.info?.place || '',
                stationaddress: kiosk.info?.stationaddress || kiosk.info?.address || '',
                city: kiosk.info?.city || '',
                state: kiosk.info?.state || '',
                zip: kiosk.info?.zip || '',
                country: kiosk.info?.country || '',
                client: kiosk.info?.client || kiosk.info?.clientId || '',
                group: kiosk.info?.group || '',
                locationtype: kiosk.info?.locationtype || '',
                lat: kiosk.info?.lat || null,
                lon: kiosk.info?.lon || null,
                account: kiosk.info?.account || '',
                accountpercent: kiosk.info?.accountpercent || 0,
                rep: kiosk.info?.rep || '',
                reppercent: kiosk.info?.reppercent || 0
            },
            pricing: kiosk.pricing || {},
            ui: kiosk.ui || {},
            modules: normalizedModules.sort((a, b) => a.id.localeCompare(b.id)),
            uistate: kiosk.uistate,
            lastUpdated,
            active: kiosk.active !== false,
            count: Number.isFinite(kioskCount) ? kioskCount : derivedCount,
            ngrok: !!kiosk.ngrok,
            ssh: !!kiosk.ssh,
            fversion: kiosk.fversion,
            uiVersion: kiosk.ui?.version,
            disabled: kiosk.disabled,
            status: kiosk.status,
            isNewSchema,
        };
    });
};

export const filterStationsForClient = (stations, clientInfo) => {
    const stationList = Array.isArray(stations) ? stations : [];

    if (!clientInfo) {
        return [];
    }

    if (clientInfo.isAdmin) {
        return stationList;
    }

    if (clientInfo.partner) {
        const partnerId = clientInfo.clientId?.toLowerCase();
        return stationList.filter((station) => station.info.rep?.toLowerCase() === partnerId);
    }

    return stationList.filter((station) => station.info.client === clientInfo.clientId);
};

/**
 * Checks if a kiosk is considered online based on its last update time.
 * @param {Object} kiosk - The kiosk object.
 * @param {string} referenceTime - The reference time (ISO string) to compare against.
 * @returns {boolean} - True if the kiosk is online, false otherwise.
 */
export const isKioskOnline = (kiosk, referenceTime) => {
    if (!referenceTime) return false;

    if (isNewSchemaKiosk(kiosk)) {
        const modules = Array.isArray(kiosk?.modules) ? kiosk.modules : [];
        if (modules.length === 0) return false;
        return modules.some(module => isModuleOnline(module, referenceTime));
    }

    return hasRecentTimestamp(kiosk?.lastUpdated, referenceTime, ONLINE_WINDOW_MS);
};

/**
 * Checks if a kiosk is considered active based on its last update time (10-day threshold).
 * @param {Object} kiosk - The kiosk object.
 * @param {string} referenceTime - The reference time (ISO string) to compare against.
 * @returns {boolean} - True if the kiosk is active, false otherwise.
 */
export const isKioskActive = (kiosk, referenceTime) => {
    return hasRecentTimestamp(kiosk?.lastUpdated, referenceTime, 10 * 24 * 60 * 60 * 1000);
};
/**
 * Fetches coordinates for a given address using Google Geocoding API.
 * @param {Object} addressComponents - The components of the address.
 * @returns {Promise<Object|null>} - A promise that resolves to an object with lat and lon, or null.
 */
export const geocodeAddress = async (addressComponents) => {
    const { stationaddress, city, state, zip } = addressComponents;
    if (!stationaddress || !city) {
        return null;
    }

    const addressString = `${stationaddress}, ${city}, ${state} ${zip}`.trim();
    // TODO: This key should not be exposed on the client side.
    // It should be moved to a backend environment variable and accessed
    // via a dedicated API endpoint on your server.
    const apiKey = 'AIzaSyB267y0CtDdNwn8aZr-1SWN1TDNgVlzxK8';
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressString)}&key=${apiKey}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Geocoding request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (data.status === 'OK' && data.results[0]) {
            return data.results[0].geometry.location; // { lat, lng: lon }
        }
        console.error('Geocoding API did not return OK:', data.status, data.error_message);
        return null;
    } catch (error) {
        console.error('Geocoding API error:', error);
        return null;
    }
};

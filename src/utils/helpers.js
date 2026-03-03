// src/utils/helpers.js
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase-config";

/**
 * Normalizes the raw kiosk data from the API into a more consistent and usable format.
 * @param {Array} kiosks - The array of kiosk objects from the API.
 * @returns {Array} - The normalized array of kiosk objects.
 */
export const normalizeKioskData = (kiosks) => {
    if (!Array.isArray(kiosks)) return [];
    
    return kiosks.map(kiosk => {
        const normalizedModules = Object.values(kiosk.modules || {})
            .filter(module => module.id && !module.id.startsWith('disabled'))
            .map(module => {
                let slotSource = []; // The `heartbeat` object is the reliable source for raw slot data.
                if (module.heartbeat && typeof module.heartbeat === 'object') {
                    slotSource = Object.entries(module.heartbeat);
                }

                const slots = slotSource.map(([key, slotData]) => {
                    const position = parseInt(key.replace('slot', ''), 10);
                    // A charger is present if it has a readable CID, or if voltage (cap) is non-zero.
                    // Voltage catches real chargers whose SN chip is unreadable (cid stays 0000000000)
                    // but are electrically confirmed present (e.g. cap=4180mV, batlvl=100).
                    const hasCid = slotData && slotData.cid && slotData.cid !== '0000000000' && slotData.cid !== '0';
                    const capValue = parseInt(slotData?.cap, 10);
                    const hasVoltage = !isNaN(capValue) && capValue > 0;
                    const hasCharger = hasCid || hasVoltage;

                    const isSstatError = slotData.sstat === '0F' && !hasCharger;
                    const cmos = hasCharger ? slotData.cmos : null;
                    const chargingCurrent = hasCharger ? parseInt(slotData.cstate, 10) : 0;

                    return {
                        position: position,
                        sn: hasCharger ? slotData.cid : 0,
                        batteryLevel: hasCharger ? slotData.batlvl : null, // Correctly set to null for empty slots
                        chargingCurrent: chargingCurrent,
                        isLocked: !!(module.lock && module.lock[`slot${position}`]),
                        lockReason: (module.lock && module.lock[`info${position}`]) || '',
                        cmos: cmos,
                        sstat: slotData.sstat,
                        isFullNotCharging: cmos === 'BF' && chargingCurrent === 0,
                        isSstatError: isSstatError,
                    };
                });
                return {
                    id: module.id,
                    lastUpdated: kiosk.timestamp,
                    slots: slots, 
                    output: module.output,
                    heartbeat: module.heartbeat, // Keep the original heartbeat data
                };
            });

        return {
            stationid: kiosk.stationid,
            provisionid: kiosk.provisionid,
            hardware: kiosk.hardware ? { ...kiosk.hardware, power: kiosk.hardware.power != null ? Number(kiosk.hardware.power) : undefined } : {},
            info: {
                location: kiosk.info?.location || '',
                place: kiosk.info?.place || '',
                stationaddress: kiosk.info?.stationaddress || '',
                city: kiosk.info?.city || '',
                state: kiosk.info?.state || '',
                zip: kiosk.info?.zip || '',
                country: kiosk.info?.country || '',
                client: kiosk.info?.client || '',
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
            modules: normalizedModules.sort((a,b) => a.id.localeCompare(b.id)),
            uistate: kiosk.uistate,
            lastUpdated: kiosk.timestamp,
            active: kiosk.active !== false,
            count: kiosk.count,
            ngrok: !!kiosk.ngrok,
            ssh: !!kiosk.ssh,
            fversion: kiosk.fversion,
            uiVersion: kiosk.ui?.version,
            disabled: kiosk.disabled,
            status: kiosk.status,
        };
    });
};

/**
 * Parses a kiosk timestamp string into a Date object.
 * Supports two formats produced by the backend:
 *   - ISO 8601: "2024-11-15T10:30:00" (with or without Z / offset)
 *   - Legacy:   "15/11/2024 10:30:00" (DD/MM/YYYY HH:mm:ss, assumed UTC)
 * Returns null and logs a warning for any unrecognised format.
 */
const parseKioskTimestamp = (raw) => {
    if (!raw || typeof raw !== 'string') return null;

    // ISO 8601 — append Z if no timezone info so Date treats it as UTC
    const isoCandidate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)
        ? new Date(raw.endsWith('Z') || raw.includes('+') ? raw : raw + 'Z')
        : null;
    if (isoCandidate && !isNaN(isoCandidate.getTime())) return isoCandidate;

    // Legacy DD/MM/YYYY HH:mm:ss — build an explicit UTC date to avoid local-timezone shifts
    const legacyParts = raw.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
    if (legacyParts) {
        const [, dd, mm, yyyy, hh, min, ss] = legacyParts;
        const legacyCandidate = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +min, +ss));
        if (!isNaN(legacyCandidate.getTime())) return legacyCandidate;
    }

    console.warn(`[parseKioskTimestamp] Unrecognised timestamp format: "${raw}"`);
    return null;
};

/**
 * Checks if a kiosk is considered online based on its last update time.
 * @param {Object} kiosk - The kiosk object.
 * @param {string} referenceTime - The reference time (ISO string) to compare against.
 * @returns {boolean} - True if the kiosk is online, false otherwise.
 */
export const isKioskOnline = (kiosk, referenceTime) => {
    if (!kiosk.lastUpdated || !referenceTime) return false;

    const referenceDate = new Date(referenceTime.endsWith('Z') ? referenceTime : referenceTime + 'Z');
    const kioskDate = parseKioskTimestamp(kiosk.lastUpdated);
    if (!kioskDate) return false;

    const fiveMinutesAgo = new Date(referenceDate.getTime() - 5 * 60 * 1000);
    return kioskDate > fiveMinutesAgo;
};

/**
 * Checks if a kiosk is considered active based on its last update time (10-day threshold).
 * @param {Object} kiosk - The kiosk object.
 * @param {string} referenceTime - The reference time (ISO string) to compare against.
 * @returns {boolean} - True if the kiosk is active, false otherwise.
 */
export const isKioskActive = (kiosk, referenceTime) => {
    if (!kiosk.lastUpdated || !referenceTime) return false;

    const referenceDate = new Date(referenceTime.endsWith('Z') ? referenceTime : referenceTime + 'Z');
    const kioskDate = parseKioskTimestamp(kiosk.lastUpdated);
    if (!kioskDate) return false;

    const tenDaysAgo = new Date(referenceDate.getTime() - 10 * 24 * 60 * 60 * 1000);
    return kioskDate > tenDaysAgo;
};
/**
 * Fetches coordinates for a given address using Google Geocoding API.
 * @param {Object} addressComponents - The components of the address.
 * @returns {Promise<Object|null>} - A promise that resolves to an object with lat and lon, or null.
 */
export const geocodeAddress = async (addressComponents) => {
    const { stationaddress, city } = addressComponents;
    if (!stationaddress || !city) return null;

    try {
        const fn = httpsCallable(functions, "geocodeAddress");
        const result = await fn(addressComponents);
        return result.data.location ?? null; // { lat, lng } or null
    } catch (error) {
        console.error("Geocoding error:", error);
        return null;
    }
};
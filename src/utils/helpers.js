// src/utils/helpers.js

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
                    // A charger is present if it has a non-zero CID. This is the simplest, most reliable check.
                    const hasCharger = slotData && slotData.cid && slotData.cid !== '0000000000' && slotData.cid !== '0';
                    
                    const isSstatError = slotData.sstat === '0F' && (!slotData.cid || slotData.cid === '0000000000');
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
            hardware: kiosk.hardware || {},
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
 * Checks if a kiosk is considered online based on its last update time.
 * @param {Object} kiosk - The kiosk object.
 * @param {string} referenceTime - The reference time (ISO string) to compare against.
 * @returns {boolean} - True if the kiosk is online, false otherwise.
 */
export const isKioskOnline = (kiosk, referenceTime) => {
    if (!kiosk.lastUpdated || !referenceTime) return false;

    // Ensure timestamps are treated as UTC
    const referenceDate = new Date(referenceTime.endsWith('Z') ? referenceTime : referenceTime + 'Z');
    const fiveMinutesAgo = new Date(referenceDate.getTime() - 5 * 60 * 1000);
    
    let kioskDate = new Date(kiosk.lastUpdated.endsWith('Z') ? kiosk.lastUpdated : kiosk.lastUpdated + 'Z');

    // If the initial parsing is invalid, try to parse it as DD/MM/YYYY HH:mm:ss
    if (isNaN(kioskDate.getTime())) {
        const parts = kiosk.lastUpdated.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
        if (parts) {
            // new Date(year, monthIndex, day, hour, minute, second)
            // Note: month is 0-indexed in JavaScript's Date constructor
            kioskDate = new Date(parts[3], parts[2] - 1, parts[1], parts[4], parts[5], parts[6]);
        }
    }

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

    // Ensure timestamps are treated as UTC
    const referenceDate = new Date(referenceTime.endsWith('Z') ? referenceTime : referenceTime + 'Z');
    const tenDaysAgo = new Date(referenceDate.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days

    let kioskDate = new Date(kiosk.lastUpdated.endsWith('Z') ? kiosk.lastUpdated : kiosk.lastUpdated + 'Z');

    // If the initial parsing is invalid, try to parse it as DD/MM/YYYY HH:mm:ss
    if (isNaN(kioskDate.getTime())) {
        const parts = kiosk.lastUpdated.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
        if (parts) {
            kioskDate = new Date(parts[3], parts[2] - 1, parts[1], parts[4], parts[5], parts[6]);
        }
    }

    return kioskDate > tenDaysAgo;
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
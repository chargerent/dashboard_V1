// src/utils/helpers.js

const NEW_KIOSK_TYPES = new Set(['CT3', 'CT4', 'CT8', 'CT12', 'CK48']);
const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const LEGACY_TIMESTAMP_PATTERN = /(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/;
const HAS_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;
const DEFAULT_WIFI = { name: 'chargerent', password: 'Charger33' };
const DEFAULT_FORM_OPTIONS = { active: false };
const DEFAULT_MARKETING_OPTIONS = {
    active: true,
    title: {
        english: 'Get the Rogers app',
        french: "Obtenez l'application Rogers",
        spanish: 'Obtén la aplicación Rogers',
        german: 'Holen Sie sich die Rogers App',
        italian: "Scarica l'app Rogers",
        portuguese: 'Baixe o aplicativo Rogers',
    },
    offerText: {
        english: 'Manage your account, pay your bill and get exclusive offers all in one place.',
        french: "Gérez votre compte, payez votre facture et profitez d'offres exclusives en un seul endroit.",
        spanish: 'Administra tu cuenta, paga tu factura y obtén ofertas exclusivas en un solo lugar.',
        german: 'Verwalten Sie Ihr Konto, bezahlen Sie Ihre Rechnung und erhalten Sie exklusive Angebote an einem Ort.',
        italian: 'Gestisci il tuo account, paga la bolletta e accedi a offerte esclusive in un unico posto.',
        portuguese: 'Gerencie sua conta, pague sua fatura e acesse ofertas exclusivas em um só lugar.',
    },
    buttonText: {
        english: 'Download now',
        french: 'Télécharger maintenant',
        spanish: 'Descargar ahora',
        german: 'Jetzt herunterladen',
        italian: 'Scarica ora',
        portuguese: 'Baixar agora',
    },
    buttonUrl: 'https://www.rogers.com/support/apps',
};
const DEFAULT_ANALYTICS_OPTIONS = { active: false };
export const DEFAULT_KIOSK_POWER_THRESHOLD = 80;
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const mergeLocalizedMarketingValue = (value, defaults) => {
    if (typeof value === 'string') {
        return { ...defaults, english: value };
    }

    if (isPlainObject(value)) {
        return { ...defaults, ...value };
    }

    return { ...defaults };
};
const normalizeMarketingOptions = (marketingoptions) => {
    const source = isPlainObject(marketingoptions) ? marketingoptions : {};

    return {
        active: source.active == null ? DEFAULT_MARKETING_OPTIONS.active : source.active === true,
        title: mergeLocalizedMarketingValue(source.title, DEFAULT_MARKETING_OPTIONS.title),
        offerText: mergeLocalizedMarketingValue(source.offerText, DEFAULT_MARKETING_OPTIONS.offerText),
        buttonText: mergeLocalizedMarketingValue(source.buttonText, DEFAULT_MARKETING_OPTIONS.buttonText),
        buttonUrl: source.buttonUrl ?? DEFAULT_MARKETING_OPTIONS.buttonUrl,
    };
};

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

const inferNewSchemaHardwareType = (modules = []) => {
    const normalizedModules = Array.isArray(modules) ? modules : [];
    const moduleCount = normalizedModules.length;
    const totalSlots = normalizedModules.reduce((sum, module) => (
        sum + (Array.isArray(module?.slots) ? module.slots.length : 0)
    ), 0);

    if (totalSlots === 48) return 'CK48';
    if (totalSlots === 12) return 'CT12';
    if (totalSlots === 8) return 'CT8';
    if (totalSlots === 4) return 'CT4';
    if (totalSlots === 3) return 'CT3';

    // Tolerate stale mixed layouts left behind by the old CT parser, e.g. 12+4+4.
    if (moduleCount === 3 && totalSlots >= 12 && totalSlots <= 20) return 'CT12';
    if (moduleCount === 2 && totalSlots >= 8 && totalSlots <= 12) return 'CT8';
    if (moduleCount === 1 && totalSlots >= 20) return 'CK48';

    return totalSlots >= 20 ? 'CK48' : 'CT3';
};

export const isNewSchemaKiosk = (kiosk) => {
    if (!kiosk) return false;
    if (kiosk.isNewSchema === true) return true;
    return NEW_KIOSK_TYPES.has(String(kiosk.hardware?.type || '').toUpperCase());
};

export const getKioskPowerThreshold = (kiosk) => {
    const configuredPower = Number(kiosk?.hardware?.power);
    return Number.isFinite(configuredPower) ? configuredPower : DEFAULT_KIOSK_POWER_THRESHOLD;
};

export const getKioskInfoAddress = (info) => (
    String(info?.address ?? info?.stationaddress ?? '')
);

export const normalizeKioskInfoForSchema = (info, isNewSchema = false) => {
    const normalizedInfo = JSON.parse(JSON.stringify(info || {}));
    const address = getKioskInfoAddress(normalizedInfo);

    if (isNewSchema) {
        delete normalizedInfo.stationaddress;
        normalizedInfo.address = address;
        return normalizedInfo;
    }

    delete normalizedInfo.address;
    normalizedInfo.stationaddress = address;
    return normalizedInfo;
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
            const moduleSoftwareVersion = Number(module?.softwareVersion ?? 0);
            const moduleHardwareVersion = Number(module?.hardwareVersion ?? 0);
            const rawModuleTemperature = Number(module?.temperature ?? module?.temp);
            const moduleTemperature = Number.isFinite(rawModuleTemperature) ? rawModuleTemperature : null;

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
                chargeMetrics: module.chargeMetrics || null,
                softwareVersion: Number.isFinite(moduleSoftwareVersion) ? moduleSoftwareVersion : 0,
                hardwareVersion: Number.isFinite(moduleHardwareVersion) ? moduleHardwareVersion : 0,
                temperature: moduleTemperature,
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
            hardware = { ...hardware, type: inferNewSchemaHardwareType(normalizedModules) };
        }

        const fullThreshold = getKioskPowerThreshold({ hardware });
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

        const normalizedAddress = getKioskInfoAddress(kiosk.info);

        return {
            stationid: kiosk.stationid,
            provisionid: kiosk.provisionid,
            hardware,
            info: {
                location: kiosk.info?.location || '',
                place: kiosk.info?.place || '',
                address: normalizedAddress,
                stationaddress: normalizedAddress,
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
            wifi: {
                name: kiosk.wifi?.name || DEFAULT_WIFI.name,
                password: kiosk.wifi?.password || DEFAULT_WIFI.password,
            },
            formoptions: {
                active: kiosk.formoptions?.active === true || DEFAULT_FORM_OPTIONS.active,
            },
            marketingoptions: normalizeMarketingOptions(kiosk.marketingoptions),
            analyticsoptions: {
                active: kiosk.analyticsoptions?.active === true || DEFAULT_ANALYTICS_OPTIONS.active,
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

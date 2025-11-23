// src/pages/ProvisionPage.jsx

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
    FormInput,
    FormToggle,
    FormMultiSwitch,
    FormSlider,
    FormSelect,
    FormColorPicker
} from '../components/forms/FormFields.jsx';
import { formatDuration } from '../utils/dateFormatter';
import ConfirmationModal from '../components/UI/ConfirmationModal';

const initialFormData = {
    provisionid: '',
    hardware: { type: 'CT10', modversion: '2.0', mode: 'LIVE', modules: 1, hrate: '20', cpu: 'C4', gateway: 'PAYTERP68', screen: 'no screen', quarantine: { time: 0, unit: 'min' }, audio: 'on', power: '90', gatewayoptions: 'INITIALPRICE', port: '1884', server: 'chargerent.io' },
    info: { country: 'US', autoGeocode: true, account: 'OCHARGELLC', group: 'OCHARGELLC', rep: 'OCHARGELLC' },
    ui: { colors: { bcolor1: '#0000FF', bcolor2: '#008000' }, idletime: 20, defaultlanguage: 'ENGLISH', mode: 'media', reminder: {}, receipt: {}, coupons: {}, map: { active: false }, terms: { active: true }, languages: { active: true }, information: { active: true }, screensaver: { active: true } },
    pricing: { currency: 'US', symbol: '$', kioskmode: 'LEASE', text: 'LEASE - SIMPLE DAILY', webapp: true, mobileapp: true, online: true, startpage: { active: true }, taxrate: 0 }
};

const formatWaitTime = (startTime) => {
    if (!startTime) return 'unknown';
    const start = new Date(startTime.endsWith('Z') ? startTime : startTime + 'Z');
    const now = new Date();
    const diffSeconds = Math.floor((now - start) / 1000);

    const minutes = Math.floor(diffSeconds / 60);
    const seconds = diffSeconds % 60;

    const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    // Add an asterisk if it's been longer than a minute
    return diffSeconds > 60 ? `${formattedTime} *` : formattedTime;
};

const calculateRateArray = (pricing) => {
    const pricingstyle = pricing.text;
    const initialprice = Number(pricing.authamount || 0);
    const initialperiod = Number(pricing.initialperiod || 0); // in hours
    const dailyprice = Number(pricing.dailyprice || 0);
    const overdueby = Number(pricing.overdue || 0); // in days

    const rentprice = [];
    const DAY_IN_MINUTES = 1440; // 24 * 60

    switch (pricingstyle) {
        case "PURCHASE - SIMPLE DAILY":
            for (let i = 1; i <= overdueby; i++) {
                rentprice.push({ time: i * DAY_IN_MINUTES, price: i * dailyprice });
            }
            break;
        case "PURCHASE - MIXED DAILY":
            rentprice.push({ time: initialperiod * 60, price: initialprice });
            for (let i = 1; i <= overdueby; i++) {
                rentprice.push({ time: i * DAY_IN_MINUTES, price: i * dailyprice });
            }
            break;
        case "PURCHASE SIMPLE 24 HRS":
            rentprice.push({ time: DAY_IN_MINUTES, price: dailyprice });
            break;
        case "PURCHASE - MIXED DAY":
            rentprice.push({ time: initialperiod * 60, price: initialprice });
            rentprice.push({ time: DAY_IN_MINUTES, price: dailyprice });
            break;
        case "LEASE - SIMPLE DAILY":
            rentprice.push({ time: DAY_IN_MINUTES, price: 0 });
            for (let i = 1; i < overdueby; i++) {
                rentprice.push({ time: (i + 1) * DAY_IN_MINUTES, price: i * dailyprice });
            }
            break;
        case "LEASE - MIXED DAILY":
            rentprice.push({ time: initialperiod * 60, price: 0 });
            for (let i = 1; i <= overdueby; i++) {
                rentprice.push({ time: i * DAY_IN_MINUTES, price: i * dailyprice });
            }
            break;
    }
    return rentprice;
};

const ProvisionPage = ({ onNavigateToDashboard, onLogout, t, onCommand, allStationsData, lastProvisionedId }) => {
    const [formData, setFormData] = useState(initialFormData);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [missingFields, setMissingFields] = useState([]);

    const pendingStations = useMemo(() => {
        return (allStationsData || []).filter(k => k.status === 'pending-provision');
    }, [allStationsData]);

    useEffect(() => {
        if (lastProvisionedId && lastProvisionedId === formData.provisionid) {
            setFormData(initialFormData);
        }
    }, [lastProvisionedId]);

    const handleProvisionIdChange = (section, name, value) => {
        const provisionId = value.split(' ')[0];
        const selectedStation = pendingStations.find(s => s.provisionid === provisionId);
        if (selectedStation) {
            // Create a deep copy to avoid mutation
            const newFormData = JSON.parse(JSON.stringify(initialFormData));

            // Deep merge function
            const deepMerge = (target, source) => {
                for (const key in source) {
                    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                        target[key] = deepMerge(target[key] || {}, source[key]); // Recurse for nested objects
                    } else if (source[key] || source[key] === 0 || source[key] === false) { // Only merge if value is not empty/null/undefined
                        target[key] = source[key];
                    }
                }
                return target;
            };

            // Merge selected station data into the new form data object
            deepMerge(newFormData, selectedStation);

            setFormData(newFormData);
        } else {
            setFormData(initialFormData);
        }
    };

    const onDataChange = useCallback((section, path, value) => {
        setFormData(prev => {
            const newFormData = JSON.parse(JSON.stringify(prev)); // Deep copy for immutability
            const keys = path.split('.');
            let current = section ? newFormData[section] : newFormData;

            for (let i = 0; i < keys.length - 1; i++) {
                current = current[keys[i]] = current[keys[i]] || {};
            }

            // Convert to uppercase if it's a string
            if (typeof value === 'string') {
                value = value.toUpperCase();
            }
            current[keys[keys.length - 1]] = value;

            // Add logic to update modules based on hardware type
            if (section === 'hardware' && path === 'type') {
                const moduleMap = {
                    'CT10': 1,
                    'CK20': 2,
                    'CK30': 3,
                    'CK50': 5
                };
                newFormData.hardware.modules = moduleMap[value] || newFormData.hardware.modules;
            }

            return newFormData;
        });
    }, []);

    const isFormValid = useMemo(() => {
        const { provisionid, info } = formData;
        if (!provisionid) return false;

        const requiredInfoFields = [
            'location', 'place', 'stationaddress', 'city', 'state', 'zip',
            'locationtype', 'client', 'account', 'group', 'rep'
        ];

        for (const field of requiredInfoFields) {
            if (!info[field]) {
                return false;
            }
        }
        return true;
    }, [formData]);

    const handleMultiSwitchChange = (section, name, option, mapping) => {
        const valueToSave = mapping ? mapping[option] || option : option;
        onDataChange(section, name, valueToSave);
    };

    const handleCurrencyChange = (section, name, value) => {
        onDataChange(section, name, value);
        const symbolMap = { 'US': '$', 'CAN': '$', 'EUR': '€' };
        onDataChange(section, 'symbol', symbolMap[value] || '');
    };

    const handleProvision = () => {
        const { provisionid, info } = formData;
        const missing = [];
        if (!provisionid) {
            missing.push('provisionid');
        }

        const requiredInfoFields = [
            'location', 'place', 'stationaddress', 'city', 'state', 'zip',
            'locationtype', 'client', 'account', 'group', 'rep'
        ];

        for (const field of requiredInfoFields) {
            if (!info[field] && info[field] !== 0) {
                missing.push(`info.${field}`);
            }
        }

        const requiredHardwareFields = ['sn'];
        for (const field of requiredHardwareFields) {
            if (!formData.hardware[field]) {
                missing.push(`hardware.${field}`);
            }
        }

        const requiredPricingFields = [
            'authamount', 'dailyprice', 'buyprice', 'initialperiod', 'overdue', 'profile'
        ];
        for (const field of requiredPricingFields) {
            if (!formData.pricing[field] && formData.pricing[field] !== 0) {
                missing.push(`pricing.${field}`);
            }
        }

        const requiredUiFields = ['colors.bcolor1', 'colors.bcolor2', 'idletime'];
        for (const field of requiredUiFields) {
            const keys = field.split('.');
            const value = keys.reduce((obj, key) => (obj && obj[key] !== 'undefined') ? obj[key] : undefined, formData.ui);
            if (!value) {
                missing.push(`ui.${field}`);
            }
        }

        setMissingFields(missing);

        if (missing.length === 0) {
            setShowConfirmation(true);
        }
    };

    const confirmProvision = () => {
        setShowConfirmation(false);
        const payload = JSON.parse(JSON.stringify(formData));
        
        // Add rate array to pricing
        payload.pricing.rate = calculateRateArray(payload.pricing);
        
        // Add empty modules object
        payload.modules = {};

        // Ensure stationid is not part of the payload for provisioning
        delete payload.stationid;

        onCommand(null, 'provision', null, payload.provisionid, null, { kiosk: payload });
    };

    const SectionTitle = ({ title }) => (
        <h3 className="text-lg font-semibold text-gray-700 border-b border-gray-200 pb-2 mb-4 mt-6">
            {title}
        </h3>
    );

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-white shadow-sm">
                <div className="max-w-4xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
                    <img className="h-12 w-auto" src="/logo.png" alt="Company Logo" onError={(e) => { e.target.onerror = null; e.target.style.display='none' }}/>
                    <div className="flex items-center space-x-4">
                        <button onClick={onNavigateToDashboard} className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300" title={t('back_to_dashboard')}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg></button>
                        <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600" title={t('logout')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </button>
                    </div>
                </div>
            </header>
            <main className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
                <div className="bg-white p-6 rounded-lg shadow-md space-y-6">
                    <div>
                        <SectionTitle title="New Kiosk" />
                        <FormSelect 
                            label="Provision ID" 
                            name="provisionid" 
                            value={formData.provisionid} 
                            section="" 
                            onDataChange={handleProvisionIdChange} 
                            options={['', ...pendingStations.map(s => `${s.provisionid} (${formatWaitTime(s.lastUpdated)})`)]} isInvalid={missingFields.includes('provisionid')} />
                    </div>

                    {formData.provisionid && (
                        <>
                            <div className="p-4 rounded-lg bg-gray-50">
                                <SectionTitle title="Info" />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormInput label="Location" name="location" value={formData.info.location} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.location')} />
                                    <FormInput label="Place" name="place" value={formData.info.place} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.place')} />
                                    <FormInput label="Address" name="stationaddress" value={formData.info.stationaddress} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.stationaddress')} />
                                    <FormInput label="City" name="city" value={formData.info.city} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.city')} />
                                    <FormInput label="State" name="state" value={formData.info.state} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.state')} />
                                    <FormInput label="Zip Code" name="zip" value={formData.info.zip} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.zip')} />
                                    <FormInput label="Location Type" name="locationtype" value={formData.info.locationtype} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.locationtype')} />
                                    <FormInput label="Client" name="client" value={formData.info.client} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.client')} />
                                    <FormInput label="Account Name" name="account" value={formData.info.account} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.account')} />
                                    <FormInput label="Group" name="group" value={formData.info.group} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.group')} />
                                    <FormInput label="Rep" name="rep" value={formData.info.rep} section="info" onDataChange={onDataChange} isInvalid={missingFields.includes('info.rep')} />
                                    <FormMultiSwitch label="Country" name="country" options={['US', 'CA', 'FR']} value={formData.info.country} section="info" onDataChange={onDataChange} />
                                    <FormToggle label="Auto-Geocode" name="autoGeocode" checked={formData.info.autoGeocode} section="info" onDataChange={onDataChange} />
                                    {!formData.info.autoGeocode && (
                                        <><FormInput label="Latitude" name="lat" value={formData.info.lat} section="info" onDataChange={onDataChange} /><FormInput label="Longitude" name="lon" value={formData.info.lon} section="info" onDataChange={onDataChange} /></>
                                    )}
                                </div>
                            </div>

                            <div className="p-4 rounded-lg">
                                <SectionTitle title="Hardware" />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormMultiSwitch label="Type" name="type" options={['CT10', 'CK20', 'CK30', 'CK50']} value={formData.hardware.type} section="hardware" onDataChange={onDataChange} />
                                    <FormMultiSwitch label="Module Version" name="modversion" options={['1.0', '2.0']} value={formData.hardware.modversion} section="hardware" onDataChange={onDataChange} />
                                    <FormMultiSwitch label="Mode" name="mode" options={['LIVE', 'TEST']} value={formData.hardware.mode} section="hardware" onDataChange={onDataChange} />
                                    <FormInput label="Modules" name="modules" type="number" value={formData.hardware.modules} section="hardware" onDataChange={onDataChange} />
                                    <FormInput label="CPU" name="cpu" value={formData.hardware.cpu} section="hardware" onDataChange={onDataChange} />
                                    <FormMultiSwitch label="Heartbeat Rate" name="hrate" options={['20', '40', '60']} value={String(formData.hardware.hrate)} section="hardware" onDataChange={onDataChange} />
                                    <FormInput label="Quarantine Time" name="quarantine.time" type="number" value={formData.hardware.quarantine?.time} section="hardware" onDataChange={onDataChange} />
                                    <FormMultiSwitch label="Quarantine Unit" name="quarantine.unit" options={['min', 'hours', 'days']} value={formData.hardware.quarantine?.unit} section="hardware" onDataChange={onDataChange} />
                                    <FormMultiSwitch label="Audio" name="audio" options={['on', 'off']} value={formData.hardware.audio} section="hardware" onDataChange={onDataChange} />
                                    <FormSlider label="Volume" name="volume" value={formData.hardware.volume} section="hardware" min="0" max="100" onDataChange={onDataChange} />
                                    <FormSlider label="Power Threshold" name="power" value={formData.hardware.power} section="hardware" min="0" max="100" onDataChange={onDataChange} />
                                    <FormMultiSwitch label="Gateway" name="gateway" options={['P68', 'SWIPE', 'SCAN', 'RFID', 'STRIPE', 'APO', 'TOUCH']} value={{'PAYTERP68': 'P68', 'APOLLO': 'APO'}[formData.hardware.gateway] || formData.hardware.gateway} section="hardware" onDataChange={(sec, name, val) => handleMultiSwitchChange(sec, name, val, {'P68': 'PAYTERP68', 'APO': 'APOLLO'})} />
                                    <FormInput label="SN" name="sn" value={formData.hardware.sn} section="hardware" onDataChange={onDataChange} isInvalid={missingFields.includes('hardware.sn')} />
                                    <FormMultiSwitch label="Gateway Options" name="gatewayoptions" options={['INITIAL', 'FULL', 'OPEN', 'CLOSED', 'RES']} value={{'INITIALPRICE': 'INITIAL', 'FULLPRICE':'FULL', 'OPENMODE':'OPEN', 'CLOSEDLOOP':'CLOSED', 'RESERVATION':'RES'}[formData.hardware.gatewayoptions] || formData.hardware.gatewayoptions} section="hardware" onDataChange={(sec, name, val) => handleMultiSwitchChange(sec, name, val, {'INITIAL': 'INITIALPRICE', 'FULL': 'FULLPRICE', 'OPEN': 'OPENMODE', 'CLOSED': 'CLOSEDLOOP', 'RES': 'RESERVATION'})} />
                                    <FormMultiSwitch label="Screen" name="screen" options={['NO', '7', '10', '21', '32']} value={formData.hardware.screen?.toUpperCase() === 'NO SCREEN' ? 'NO' : formData.hardware.screen?.toUpperCase().replace('IN', '')} section="hardware" onDataChange={(sec, name, val) => handleMultiSwitchChange(sec, name, val, {'NO': 'no screen'}, false)} />
                                    <FormInput label="Port" name="port" value={formData.hardware.port} section="hardware" onDataChange={onDataChange} />
                                    <FormInput label="Server" name="server" value={formData.hardware.server} section="hardware" onDataChange={onDataChange} />
                                </div>
                            </div>

                            <div className="p-4 rounded-lg bg-gray-50">
                                <SectionTitle title="Pricing" />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormMultiSwitch label="Currency" name="currency" options={['US', 'CAN', 'EUR']} value={formData.pricing.currency} section="pricing" onDataChange={handleCurrencyChange} />
                                    <FormInput label="Symbol" name="symbol" value={formData.pricing.symbol} section="pricing" onDataChange={onDataChange} disabled />
                                    <FormInput label="Auth Amount" name="authamount" type="number" value={formData.pricing.authamount} section="pricing" onDataChange={onDataChange} isInvalid={missingFields.includes('pricing.authamount')} />
                                    <FormInput label="Daily Price" name="dailyprice" type="number" value={formData.pricing.dailyprice} section="pricing" onDataChange={onDataChange} isInvalid={missingFields.includes('pricing.dailyprice')} />
                                    <FormInput label="Buy Price" name="buyprice" type="number" value={formData.pricing.buyprice} section="pricing" onDataChange={onDataChange} isInvalid={missingFields.includes('pricing.buyprice')} />
                                    <FormInput label={t('lease_amount')} name="leaseamount" type="number" value={formData.pricing.leaseamount} section="pricing" onDataChange={onDataChange} disabled={formData.pricing.kioskmode === 'PURCHASE'} />
                                    <FormInput label="Tax Rate" name="taxrate" type="number" value={formData.pricing.taxrate} section="pricing" onDataChange={onDataChange} />
                                    <FormInput label="Initial Period (hrs)" name="initialperiod" type="number" value={formData.pricing.initialperiod} section="pricing" onDataChange={onDataChange} isInvalid={missingFields.includes('pricing.initialperiod')} />
                                    <FormInput label="Overdue (days)" name="overdue" type="number" value={formData.pricing.overdue} section="pricing" onDataChange={onDataChange} isInvalid={missingFields.includes('pricing.overdue')} />
                                    <FormInput label="Profile" name="profile" value={formData.pricing.profile} section="pricing" onDataChange={onDataChange} isInvalid={missingFields.includes('pricing.profile')} />
                                    <FormMultiSwitch label="Kiosk Mode" name="kioskmode" options={['PURCHASE', 'LEASE']} value={formData.pricing.kioskmode} section="pricing" onDataChange={onDataChange} />
                                    <FormSelect label="Text" name="text" value={formData.pricing.text} section="pricing" onDataChange={onDataChange} options={['PURCHASE - SIMPLE DAILY', 'PURCHASE - MIXED DAILY', 'PURCHASE SIMPLE 24 HRS', 'PURCHASE - MIXED DAY', 'LEASE - SIMPLE DAILY', 'LEASE - MIXED DAILY', 'EVENT - SIMPLE']} />
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                                    <FormToggle label="Start Page" name="startpage.active" checked={formData.pricing.startpage?.active} section="pricing" onDataChange={onDataChange} />
                                    <FormToggle label="Web App" name="webapp" checked={formData.pricing.webapp} section="pricing" onDataChange={onDataChange} />
                                    <FormToggle label="Mobile App" name="mobileapp" checked={formData.pricing.mobileapp} section="pricing" onDataChange={onDataChange} />
                                    <FormToggle label="Online" name="online" checked={formData.pricing.online} section="pricing" onDataChange={onDataChange} />
                                </div>
                            </div>

                            <div className="p-4 rounded-lg">
                                <SectionTitle title="UI" />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormColorPicker label="Background Color 1" name="colors.bcolor1" value={formData.ui.colors?.bcolor1} section="ui" onDataChange={onDataChange} isInvalid={missingFields.includes('ui.colors.bcolor1')} />
                                    <FormColorPicker label="Background Color 2" name="colors.bcolor2" value={formData.ui.colors?.bcolor2} section="ui" onDataChange={onDataChange} isInvalid={missingFields.includes('ui.colors.bcolor2')} />
                                    <FormInput label="Idle Time (seconds)" name="idletime" type="number" value={formData.ui.idletime} section="ui" onDataChange={onDataChange} isInvalid={missingFields.includes('ui.idletime')} />
                                    <FormMultiSwitch label="Default Language" name="defaultlanguage" options={['EN', 'FR', 'ES']} value={{'ENGLISH': 'EN', 'FRENCH': 'FR', 'SPANISH': 'ES'}[formData.ui.defaultlanguage] || formData.ui.defaultlanguage} section="ui" onDataChange={(sec, name, val) => handleMultiSwitchChange(sec, name, val, {'EN': 'ENGLISH', 'FR': 'FRENCH', 'ES': 'SPANISH'})} />
                                    <FormMultiSwitch label="Mode" name="mode" options={['media', 'ui']} value={formData.ui.mode} section="ui" onDataChange={onDataChange} />
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4 pt-4 border-t">
                                    <FormToggle label="Screensaver" name="screensaver.active" checked={formData.ui.screensaver?.active} section="ui" onDataChange={onDataChange} />
                                    <FormToggle label="Show Map" name="map.active" checked={formData.ui.map?.active} section="ui" onDataChange={onDataChange} />
                                    <FormToggle label="Show Terms" name="terms.active" checked={formData.ui.terms?.active} section="ui" onDataChange={onDataChange} />
                                    <FormToggle label="Show Languages" name="languages.active" checked={formData.ui.languages?.active} section="ui" onDataChange={onDataChange} />
                                    <FormToggle label="Show Information" name="information.active" checked={formData.ui.information?.active} section="ui" onDataChange={onDataChange} />
                                    <FormToggle label="Enable Coupons" name="coupons.active" checked={formData.ui.coupons?.active} section="ui" onDataChange={onDataChange} />
                                    <FormToggle label="Enable Receipt" name="receipt.active" checked={formData.ui.receipt?.active} section="ui" onDataChange={onDataChange} />
                                    <FormToggle label="Enable Reminder" name="reminder.active" checked={formData.ui.reminder?.active} section="ui" onDataChange={onDataChange} />
                                    <FormInput label="Reminder Delay (min)" name="reminder.delay" type="number" value={formData.ui.reminder?.delay} section="ui" onDataChange={onDataChange} />
                                    <FormToggle label="Reminder includes Receipt" name="reminder.receipt" checked={formData.ui.reminder?.receipt} section="ui" onDataChange={onDataChange} />
                                </div>
                            </div>

                            <div className="flex justify-end mt-6">
                                <button
                                    onClick={handleProvision}
                                    className="bg-blue-600 text-white font-bold py-3 px-8 rounded-lg shadow-md hover:bg-blue-700 transition-all duration-200"
                                >
                                    Provision Kiosk
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </main>
            <ConfirmationModal
                isOpen={showConfirmation}
                onClose={() => setShowConfirmation(false)}
                onConfirm={confirmProvision}
                details={{
                    title: t('confirm_provisioning'),
                    confirmationText: t('provisioning_confirmation_message'),
                    data: formData
                }}
                t={t}
            />
        </div>
    );
};

export default ProvisionPage;
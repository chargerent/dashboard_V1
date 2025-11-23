// src/components/kiosk/KioskEditPanel.jsx

import { useState, useEffect, memo } from 'react';
import {
    FormInput,
    FormToggle,
    FormMultiSwitch,
    FormSlider,
    FormSelect,
    FormColorPicker
} from '../forms/FormFields.jsx';
import { geocodeAddress } from '../../utils/helpers';
import KioskControlPanel from './KioskControlPanel';

export const Section = ({ title, sectionKey, children, isOpen, onToggle, onSave, data }) => (
        <div className="bg-white rounded-lg shadow-sm mb-2">
            <button
                onClick={() => onToggle(sectionKey)}
                className="w-full flex justify-between items-center p-3 font-semibold text-gray-700 hover:bg-gray-50"
            >
                <span>{title}</span>
                <svg className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            {isOpen && (
                <div className="p-4 border-t">
                    <div className="grid grid-cols-1 gap-4">
                        {children}
                    </div>
                    <div className="flex justify-end mt-4">
                        <button 
                            onClick={() => onSave(sectionKey, data)}
                            className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            Save {title}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );

// --- Main Edit Panel Component ---

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

function KioskEditPanel({ kiosk, onSave, onCommand, clientInfo, t, serverUiVersion, serverFlowVersion }) {
    const [formData, setFormData] = useState({
        info: kiosk.info || {},
        hardware: kiosk.hardware || {},
        pricing: kiosk.pricing || {},
        ui: kiosk.ui || {}
    });
    const [originalData, setOriginalData] = useState({
        info: kiosk.info || {},
        hardware: kiosk.hardware || {},
        pricing: kiosk.pricing || {},
        ui: kiosk.ui || {}
    });

    useEffect(() => { // This effect resets the form state whenever the kiosk prop changes.
        const initialInfo = { autoGeocode: true, ...kiosk.info };
        const initialPricing = { ...kiosk.pricing };
        const numericPricingFields = ['taxrate', 'buyprice', 'dailyprice', 'authamount', 'initialperiod', 'overdue'];
        const numericInfoFields = ['accountpercent', 'reppercent'];
        
        // Ensure numeric fields are numbers from the start
        numericPricingFields.forEach(field => {
            if (initialPricing[field] !== undefined && initialPricing[field] !== '') {
                initialPricing[field] = Number(initialPricing[field]);
            }
        });

        numericInfoFields.forEach(field => {
            if (initialInfo[field] !== undefined && initialInfo[field] !== '') {
                initialInfo[field] = Number(initialInfo[field]);
            }
        });

        setFormData({
            info: initialInfo,
            hardware: kiosk.hardware || {},
            pricing: initialPricing,
            ui: kiosk.ui || {}
        });
        setOriginalData({
            info: initialInfo,
            hardware: kiosk.hardware || {},
            pricing: initialPricing,
            ui: kiosk.ui || {}
        });
    }, [kiosk.stationid]); // Change dependency to kiosk.stationid

    const [openSection, setOpenSection] = useState(null);
    const onDataChange = (section, path, value, process = true) => {
        let processedValue = value;
        
        // For pricing section, convert specific fields to numbers.
        if (section === 'pricing') {
            const numericPricingFields = ['taxrate', 'buyprice', 'dailyprice', 'authamount', 'initialperiod', 'overdue'];
            if (numericPricingFields.includes(path)) {
                processedValue = value === '' ? '' : Number(value);
            }
        } else if (section === 'info') {
            const numericInfoFields = ['accountpercent', 'reppercent'];
            if (numericInfoFields.includes(path)) {
                processedValue = value === '' ? '' : Number(value);
            }
        }

        // By default, convert string values to uppercase before setting state.
        // The `process` flag can be set to false to skip this.
        if (process && typeof processedValue === 'string') {
            processedValue = processedValue.toUpperCase();
        }

        setFormData(prev => {
            const newFormData = JSON.parse(JSON.stringify(prev)); // Deep copy for nested objects
            const keys = path.split('.');
            let current = newFormData[section];
            for (let i = 0; i < keys.length - 1; i++) {
                current = current[keys[i]] = current[keys[i]] || {};
            }
            current[keys[keys.length - 1]] = processedValue;

            if (section === 'pricing') {
                const newRate = calculateRateArray(newFormData.pricing);
                newFormData.pricing.rate = newRate;
            }

            return newFormData;
        });
    };

    const handleGatewayChange = (section, name, option) => {
        let valueToSave = option;
        if (option === 'P68') {
            valueToSave = 'PAYTERP68';
        } else if (option === 'APO') {
            valueToSave = 'APOLLO';
        }
        onDataChange(section, name, valueToSave, false);
    };

    const handleScreenChange = (section, name, option) => {
        const valueToSave = option === 'NO' ? 'NO SCREEN' : `${option}IN`;
        onDataChange(section, name, valueToSave, false);
    };

    const handleGatewayOptionsChange = (section, name, option) => {
        const mapping = {
            'INITIAL': 'INITIALPRICE',
            'FULL': 'FULLPRICE',
            'OPEN': 'OPENMODE',
            'CLOSED': 'CLOSEDLOOP',
            'RES': 'RESERVATION',
        };
        onDataChange(section, name, mapping[option] || option);
    };

    const handleLanguageChange = (section, name, option) => {
        const mapping = {
            'EN': 'ENGLISH',
            'FR': 'FRENCH',
            'ES': 'SPANISH'
        };
        onDataChange(section, name, mapping[option] || option);
    };

    const handleCurrencyChange = (section, name, value) => {
        onDataChange(section, name, value, true); // Update currency
        const symbolMap = {
            'US': '$',
            'CAN': '$',
            'EUR': '€'
        };
        onDataChange(section, 'symbol', symbolMap[value] || '', false); // Update symbol, don't process
    };

    const handleToggleSection = (section) => {
        setOpenSection(openSection === section ? null : section);
    };

    const handleSave = async (section, data) => {
        if (section === 'info') {
            const originalInfo = kiosk.info || {}; // This is the original kiosk data before edits
            const newInfo = formData.info;
            const addressChanged =
                newInfo.stationaddress !== originalInfo.stationaddress ||
                newInfo.city !== originalInfo.city ||
                newInfo.state !== originalInfo.state ||
                newInfo.zip !== originalInfo.zip;

            if (newInfo.autoGeocode && addressChanged) {
                const location = await geocodeAddress({
                    stationaddress: newInfo.stationaddress,
                    city: newInfo.city,
                    state: newInfo.state,
                    zip: newInfo.zip,
                });

                if (location) {
                    const updatedData = { ...newInfo, lat: location.lat, lon: location.lng };
                    onSave(kiosk.stationid, section, { ...formData, info: updatedData }, newInfo.autoGeocode);
                    return; // Early return after successful geocoding
                }
            }
        }
        onSave(kiosk.stationid, section, formData, formData.info.autoGeocode);
    };

    return (
        <div className="detail-panel-enter detail-panel-enter-active">
            <div className="p-4 bg-gray-100 rounded-b-lg border-t border-gray-200">
                <h3 className="text-lg font-bold mb-4 text-gray-800">Edit Kiosk: {kiosk.stationid}</h3>

                <Section title="Info" sectionKey="info" isOpen={openSection === 'info'} onToggle={handleToggleSection} onSave={handleSave} data={formData.info} isChanged={JSON.stringify(formData.info) !== JSON.stringify(originalData.info)}>
                    <FormInput label="Location" name="location" value={formData.info?.location} section="info" onDataChange={onDataChange} />
                    <FormInput label="Place" name="place" value={formData.info?.place} section="info" onDataChange={onDataChange} />
                    <FormInput label="Address" name="stationaddress" value={formData.info?.stationaddress} section="info" onDataChange={onDataChange} />
                    <FormInput label="City" name="city" value={formData.info?.city} section="info" onDataChange={onDataChange} />
                    <FormInput label="State" name="state" value={formData.info?.state} section="info" onDataChange={onDataChange} />
                    <FormInput label="Zip Code" name="zip" value={formData.info?.zip} section="info" onDataChange={onDataChange} />
                    <FormMultiSwitch label="Country" name="country" options={['US', 'CA', 'FR']} value={formData.info?.country} section="info" onDataChange={onDataChange} />
                    <FormToggle label="Auto-Geocode" name="autoGeocode" checked={formData.info?.autoGeocode} section="info" onDataChange={onDataChange} />
                    {!formData.info?.autoGeocode && (
                        <><FormInput label="Latitude" name="lat" value={formData.info?.lat} section="info" onDataChange={onDataChange} /><FormInput label="Longitude" name="lon" value={formData.info?.lon} section="info" onDataChange={onDataChange} /></>
                    )}
                    <FormInput label="Location Type" name="locationtype" value={formData.info?.locationtype} section="info" onDataChange={onDataChange} />
                    <FormInput label="Client" name="client" value={formData.info?.client} section="info" onDataChange={onDataChange} />
                    <div className="grid grid-cols-2 gap-4">
                        <FormInput label="Account Name" name="account" value={formData.info?.account} section="info" onDataChange={onDataChange} />
                        <FormInput label="Account %" name="accountpercent" value={formData.info?.accountpercent} section="info" type="number" onDataChange={onDataChange} />
                    </div>
                    <FormInput label="Group" name="group" value={formData.info?.group} section="info" onDataChange={onDataChange} />
                    <div className="grid grid-cols-2 gap-4">
                        <FormInput label="Rep" name="rep" value={formData.info?.rep} section="info" onDataChange={onDataChange} />
                        <FormInput label="Rep %" name="reppercent" value={formData.info?.reppercent} section="info" type="number" onDataChange={onDataChange} />
                    </div>
                </Section>

                <Section title="Hardware" sectionKey="hardware" isOpen={openSection === 'hardware'} onToggle={handleToggleSection} onSave={handleSave} data={formData.hardware} isChanged={JSON.stringify(formData.hardware) !== JSON.stringify(originalData.hardware)}>
                    <FormInput label="Type" name="type" value={formData.hardware?.type} section="hardware" onDataChange={onDataChange} disabled />
                    <FormInput label="Module Version" name="modversion" value={formData.hardware?.modversion} section="hardware" onDataChange={onDataChange} />
                    <FormInput label="Mode" name="mode" value={formData.hardware?.mode} section="hardware" onDataChange={onDataChange} />
                    <div className="grid grid-cols-2 gap-4">
                        <FormInput label="Modules" name="modules" value={formData.hardware?.modules} section="hardware" onDataChange={onDataChange} disabled />
                        <FormInput label="CPU" name="cpu" value={formData.hardware?.cpu} section="hardware" onDataChange={onDataChange} disabled />
                    </div>
                    <FormMultiSwitch label="Heartbeat Rate" name="hrate" options={['20', '40', '60']} value={String(formData.hardware?.hrate)} section="hardware" onDataChange={onDataChange} />
                    <FormMultiSwitch 
                        label="Gateway" 
                        name="gateway" 
                        options={['P68', 'SWIPE', 'SCAN', 'RFID', 'STRIPE', 'APO', 'TOUCH']} 
                        value={{'PAYTERP68': 'P68', 'APOLLO': 'APO'}[formData.hardware?.gateway] || formData.hardware?.gateway} 
                        section="hardware" 
                        onDataChange={handleGatewayChange} />
                    <FormMultiSwitch 
                        label="Gateway Options" 
                        name="gatewayoptions" 
                        options={['INITIAL', 'FULL', 'OPEN', 'CLOSED', 'RES']} 
                        value={{'INITIALPRICE': 'INITIAL', 'FULLPRICE':'FULL', 'OPENMODE':'OPEN', 'CLOSEDLOOP':'CLOSED', 'RESERVATION':'RES'}[formData.hardware?.gatewayoptions] || formData.hardware?.gatewayoptions} 
                        section="hardware" 
                        onDataChange={handleGatewayOptionsChange} 
                    />
                    <FormMultiSwitch
                        label="Screen"
                        name="screen"
                        options={['NO', '7', '10', '21', '32']}
                        value={formData.hardware?.screen?.toUpperCase() === 'NO SCREEN' ? 'NO' : formData.hardware?.screen?.toUpperCase().replace('IN', '')}
                        section="hardware"
                        onDataChange={handleScreenChange} />
                    <FormInput label="Quarantine Time" name="quarantine.time" value={formData.hardware?.quarantine?.time} section="hardware" onDataChange={onDataChange} />
                    <FormMultiSwitch label="Quarantine Unit" name="quarantine.unit" options={['min', 'hours', 'days']} value={formData.hardware?.quarantine?.unit} section="hardware" onDataChange={onDataChange} />
                    <FormMultiSwitch label="Audio" name="audio" options={['on', 'off']} value={formData.hardware?.audio} section="hardware" onDataChange={onDataChange} />
                    <FormSlider label="Volume" name="volume" value={formData.hardware?.volume} section="hardware" min="0" max="100" onDataChange={onDataChange} />
                    <FormSlider label="Power Threshold" name="power" value={formData.hardware?.power} section="hardware" min="0" max="100" onDataChange={onDataChange} />
                    <FormInput label="Port" name="port" value={formData.hardware?.port} section="hardware" onDataChange={onDataChange} />
                    <FormInput label="Server" name="server" value={formData.hardware?.server} section="hardware" onDataChange={onDataChange} />
                    <FormInput label="SN" name="sn" value={formData.hardware?.sn} section="hardware" onDataChange={onDataChange} />
                </Section>
                
                <Section title="Pricing" sectionKey="pricing" isOpen={openSection === 'pricing'} onToggle={handleToggleSection} onSave={handleSave} data={formData.pricing} isChanged={JSON.stringify(formData.pricing) !== JSON.stringify(originalData.pricing)}>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                        <div className="col-span-2">
                            <FormMultiSwitch label="Currency" name="currency" options={['US', 'CAN', 'EUR']} value={formData.pricing?.currency} section="pricing" onDataChange={handleCurrencyChange} />
                        </div>
                        <FormInput label="Symbol" name="symbol" value={formData.pricing?.symbol} section="pricing" onDataChange={onDataChange} disabled />
                        <FormInput label="Auth Amount" name="authamount" value={formData.pricing?.authamount} section="pricing" onDataChange={onDataChange} />
                        <FormInput label="Daily Price" name="dailyprice" value={formData.pricing?.dailyprice} section="pricing" type="number" onDataChange={onDataChange} />
                        <FormInput label="Buy Price" name="buyprice" value={formData.pricing?.buyprice} section="pricing" type="number" onDataChange={onDataChange} />
                        <FormInput label={t('lease_amount')} name="leaseamount" value={formData.pricing?.leaseamount} section="pricing" type="number" onDataChange={onDataChange} disabled={formData.pricing?.kioskmode === 'PURCHASE'} />
                        <FormInput label="Tax Rate" name="taxrate" value={formData.pricing?.taxrate} section="pricing" type="number" onDataChange={onDataChange} />
                        <FormInput label="I. Period (hrs)" name="initialperiod" value={formData.pricing?.initialperiod} section="pricing" type="number" onDataChange={onDataChange} />
                        <FormInput label="Overdue" name="overdue" value={formData.pricing?.overdue} section="pricing" type="number" onDataChange={onDataChange} />
                    </div>
                    <FormInput label="Profile" name="profile" value={formData.pricing?.profile} section="pricing" onDataChange={onDataChange} />
                    <FormMultiSwitch label="Kiosk Mode" name="kioskmode" options={['PURCHASE', 'LEASE']} value={formData.pricing?.kioskmode} section="pricing" onDataChange={onDataChange} />
                    <FormSelect 
                        label="Text" 
                        name="text" 
                        value={formData.pricing?.text} 
                        section="pricing" 
                        onDataChange={onDataChange}
                        options={[
                            'PURCHASE - SIMPLE DAILY', 'PURCHASE - MIXED DAILY', 'PURCHASE SIMPLE 24 HRS', 
                            'PURCHASE - MIXED DAY', 'LEASE - SIMPLE DAILY', 'LEASE - MIXED DAILY', 'EVENT - SIMPLE'
                        ]}
                    />
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">UIDs</label>
                        <div className="grid grid-cols-3 gap-2">
                            {Array.from({ length: 9 }).map((_, index) => (
                                <FormInput
                                    key={`uid-${index}`}
                                    name={`uids.${index}`}
                                    value={formData.pricing?.uids?.[index]}
                                    section="pricing"
                                    onDataChange={onDataChange} />
                            ))}
                        </div>
                    </div>
                </Section>
                
                <Section title="UI" sectionKey="ui" isOpen={openSection === 'ui'} onToggle={handleToggleSection} onSave={handleSave} data={formData.ui} isChanged={JSON.stringify(formData.ui) !== JSON.stringify(originalData.ui)}>
                    <FormInput label="UI Version" name="version" value={formData.ui?.version} section="ui" onDataChange={onDataChange} disabled />
                    <div className="grid grid-cols-2 gap-4">
                        <FormColorPicker label="Background Color 1" name="colors.bcolor1" value={formData.ui?.colors?.bcolor1} section="ui" onDataChange={onDataChange} />
                        <FormColorPicker label="Background Color 2" name="colors.bcolor2" value={formData.ui?.colors?.bcolor2} section="ui" onDataChange={onDataChange} />
                    </div>
                    <FormInput label="Idle Time (seconds)" name="idletime" value={formData.ui?.idletime} section="ui" onDataChange={onDataChange} />
                    <div className="grid grid-cols-2 gap-4">
                        <FormMultiSwitch
                            label="Default Language"
                            name="defaultlanguage"
                            options={['EN', 'FR', 'ES']}
                            value={{'ENGLISH': 'EN', 'FRENCH': 'FR', 'SPANISH': 'ES'}[formData.ui?.defaultlanguage] || formData.ui?.defaultlanguage}
                            section="ui"
                            onDataChange={handleLanguageChange} />
                        <FormMultiSwitch label="Mode" name="mode" options={['MEDIA', 'UI']} value={formData.ui?.mode} section="ui" onDataChange={onDataChange} />
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4 mt-4 pt-4 border-t">
                        <FormToggle label="Screensaver" name="screensaver.active" checked={formData.ui?.screensaver?.active} section="ui" onDataChange={onDataChange} />
                        <FormToggle label="Show Map" name="map.active" checked={formData.ui?.map?.active} section="ui" onDataChange={onDataChange} />
                        <FormToggle label="Show Terms" name="terms.active" checked={formData.ui?.terms?.active} section="ui" onDataChange={onDataChange} />
                        <FormToggle label="Show Languages" name="languages.active" checked={formData.ui?.languages?.active} section="ui" onDataChange={onDataChange} />
                        <FormToggle label="Show Information" name="information.active" checked={formData.ui?.information?.active} section="ui" onDataChange={onDataChange} />
                        <FormToggle label="Enable Coupons" name="coupons.active" checked={formData.ui?.coupons?.active} section="ui" onDataChange={onDataChange} />
                        <FormToggle label="Enable Receipt" name="receipt.active" checked={formData.ui?.receipt?.active} section="ui" onDataChange={onDataChange} />
                        <FormToggle label="Enable Reminder" name="reminder.active" checked={formData.ui?.reminder?.active} section="ui" onDataChange={onDataChange} />
                        <FormInput label="Reminder Delay (min)" name="reminder.delay" value={formData.ui?.reminder?.delay} section="ui" onDataChange={onDataChange} />
                        <FormToggle label="Reminder includes Receipt" name="reminder.receipt" checked={formData.ui?.reminder?.receipt} section="ui" onDataChange={onDataChange} />
                    </div>
                </Section>
            </div>
        </div>
    );
};

export default memo(KioskEditPanel);
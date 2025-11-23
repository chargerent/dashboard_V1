// src/components/kiosk/KioskPanel.jsx

import { useMemo, useCallback, memo } from 'react';
import { isKioskOnline } from '../../utils/helpers';
import { formatDateTime } from '../../utils/dateFormatter';
import RentalStats from '../Dashboard/RentalStats';
import GatewayIcon from './GatewayIcon';
import { useTap, isTouchDevice } from './useTap';

function KioskPanel({ kiosk, isExpanded, onToggle, onToggleEdit, mockNow, rentalData, clientInfo, t, onCommand, onShowRentalDetails }) {
    const isOnline = isKioskOnline(kiosk, mockNow);
    const canExpand = clientInfo.features.details;
    
    const stats = useMemo(() => {
        let total = 0;
        let full = 0;
        let charging = 0;
        let locked = 0;
        let emptySlots = 0;
        let totalPhysicalSlots = 0;
        const fullThreshold = kiosk.hardware?.power || 80;

        kiosk.modules.forEach(module => {
            totalPhysicalSlots += module.slots.length;
            if (module.slots && Array.isArray(module.slots)) {
                module.slots.forEach(s => {
                    if (s.isLocked) {
                        locked++;
                    }

                    if (s.sn && s.sn !== 0) {
                        total++;
                        if (!kiosk.disabled && !s.isLocked && s.batteryLevel >= fullThreshold) {
                            full++;
                        }
                        if (s.chargingCurrent > 0) {
                            charging++;
                        }
                    }
                });
            }
        });
        
        emptySlots = totalPhysicalSlots - total;

        if (kiosk.disabled) {
            return { total, full: 0, charging, slot: emptySlots, locked };
        }

        return { total, full, charging, slot: emptySlots, locked };
    }, [kiosk]);

    const handleToggle = useCallback(() => {
        if (canExpand && isOnline) {
            onToggle(kiosk.stationid);
        }
    }, [canExpand, isOnline, onToggle, kiosk.stationid]);

    const tapHandlers = useTap(handleToggle);
    
    return (
        <div 
            className={`${kiosk.count === 0 ? 'bg-yellow-50' : 'bg-white'} shadow-md flex flex-col justify-between transition-all duration-300 rounded-lg ${isExpanded && canExpand ? 'ring-2 ring-blue-500' : ''} ${!isOnline ? 'border-red-400 border-2' : ''}`}>
            <div 
                {...tapHandlers}
                className={`p-4 ${canExpand && isOnline ? 'cursor-pointer' : 'cursor-default'}`}>
                <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-1.5">
                        {clientInfo.features.stationid ? (
                            <h3 className="font-bold text-lg text-gray-800">{kiosk.stationid}</h3>
                        ) : (
                            <h3 className="font-bold text-lg text-gray-800">{kiosk.info.place}</h3>
                        )}
                        {clientInfo.commands.edit && (
                            <button onClick={(e) => { e.stopPropagation(); onToggleEdit(kiosk.stationid); }} disabled={!isOnline} className="p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L14.732 3.732z" /></svg>
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5" title={t('gateway_type')}>
                            <GatewayIcon gateway={kiosk.hardware?.gateway} t={t} />
                        </div>
                        <div className="flex items-center gap-1.5" title={t('module_output_status')}>
                            {kiosk.modules.map(module => (<div key={module.id} className={`w-2 h-2 rounded-sm ${module.output ? 'bg-green-500' : 'bg-red-500'}`} />))}
                        </div>
                        <div className="flex flex-col items-center">
                            {clientInfo.commands.reboot ? (
                                <button onClick={(e) => { e.stopPropagation(); onCommand(kiosk.stationid, 'reboot'); }} disabled={!isOnline} className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${isOnline ? 'text-green-500 hover:bg-green-100' : 'text-red-500'} disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-not-allowed`} title={isOnline ? t('online') : t('offline')}>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
                                    </svg>
                                </button>
                            ) : (
                                <div className={`w-3 h-3 rounded-full mt-1 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} title={isOnline ? t('online') : t('offline')}></div>
                            )}
                        </div>
                        {canExpand && (
                            <button onClick={(e) => e.stopPropagation()}>
                                <svg className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </button>
                        )}
                    </div>
                </div>
                    {clientInfo.features.stationid && <p className="text-sm text-gray-500 -mt-2 mb-2">{kiosk.info.place}</p>}
                <div className={`grid ${clientInfo.commands.lock ? 'grid-cols-3' : 'grid-cols-3'} gap-2 text-center my-4`}>
                    <div>
                        <p className="text-2xl font-bold text-gray-700">{stats.total}</p>
                        <p className="text-xs text-gray-500">{t('total')}</p>
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-green-600">{stats.full}</p>
                        <p className="text-xs text-gray-500">{t('full')}</p>
                    </div>
                     <div>
                        <p className="text-2xl font-bold text-blue-500">{stats.charging}</p>
                        <p className="text-xs text-gray-500">{t('charging')}</p>
                    </div>
                     <div>
                        <p className="text-2xl font-bold text-gray-400">{stats.slot}</p>
                        <p className="text-xs text-gray-500">{t('slot')}</p>
                    </div>
                    {clientInfo.commands.lock && (
                        <div>
                            <p className="text-2xl font-bold text-red-500">{stats.locked}</p>
                            <p className="text-xs text-gray-500">{t('locked')}</p>
                        </div>
                    )}
                </div>
                {kiosk.disabled && <div className="mt-2 p-2 bg-red-100 text-red-700 text-center rounded-md text-sm font-semibold">{t('kiosk_disabled')}</div>}
                {!isOnline && (
                    <div className="mt-4 p-2 bg-red-100 text-red-800 text-center rounded-md text-xs font-semibold">
                        Offline since: {formatDateTime(kiosk.lastUpdated)}
                    </div>
                )}
                {clientInfo.features.rentals && (
                    <div className={`mt-4 ${isOnline ? 'border-t' : ''} pt-4`}>
                        <RentalStats 
                            rentalData={rentalData} 
                            clientInfo={clientInfo}
                            stationId={kiosk.stationid} 
                            referenceTime={mockNow}
                            t={t}
                            onShowRentalDetails={(period) => onShowRentalDetails(kiosk.stationid, period)}
                        />
                    </div>
                )}
                {clientInfo.features.pricing && kiosk.pricing && (
                    <div className={`mt-4 ${isOnline ? 'border-t' : ''} pt-4 text-xs text-gray-600`}>
                        <h4 className="font-semibold text-gray-700 mb-2">{t('pricing_structure')}</h4>
                        <div className="space-y-1">
                            <div className="flex justify-between">
                                <span>{t('profile')}:</span>
                                <span className="font-mono font-semibold">{kiosk.pricing?.text || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>{t('gateway_option')}:</span>
                                <span className="font-mono font-semibold">{kiosk.hardware?.gatewayoptions || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>{t('auth_amount')}:</span>
                                <span className="font-mono font-semibold">
                                    {kiosk.pricing?.symbol || '$'}{kiosk.hardware?.gatewayoptions === 'FULLPRICE' ? kiosk.pricing?.buyprice : (kiosk.pricing?.kioskmode === 'LEASE' ? '0' : kiosk.pricing?.authamount)}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>{t('initial_rate')}:</span>
                                <span className="font-mono font-semibold">{kiosk.pricing?.symbol || '$'}{kiosk.pricing?.kioskmode === 'LEASE' ? '0' : kiosk.pricing?.authamount} / {kiosk.pricing?.initialperiod} {t('hours')}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <div className="flex-1">
                                    <span>{t('daily_price')}:</span>
                                    <span className="font-mono font-semibold ml-2">{kiosk.pricing?.symbol || '$'}{kiosk.pricing?.dailyprice}</span>
                                </div>
                                <div className="flex-1 text-right">
                                    <span>{t('buy_price_short')}:</span>
                                    <span className="font-mono font-semibold ml-2">{kiosk.pricing?.symbol || '$'}{kiosk.pricing?.buyprice} / {kiosk.pricing?.overdue} {t('days')}</span>
                                </div>
                            </div>
                            {kiosk.pricing?.kioskmode === 'LEASE' && (
                                <div className="flex justify-between text-purple-600"><span className="font-semibold">{t('lease_amount')}:</span><span className="font-mono font-semibold">{kiosk.pricing?.symbol || '$'}{kiosk.pricing?.leaseamount}</span></div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default memo(KioskPanel);
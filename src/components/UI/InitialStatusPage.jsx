import React from 'react';
import { formatDateTime } from '../../utils/dateFormatter';

const InitialStatusPage = ({ offlineKiosksByCountry, onDone, t }) => {
    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-4xl bg-white rounded-lg shadow-xl p-6">
                <h2 className="text-2xl font-bold text-gray-800 text-center mb-4">{t('offline_kiosks_title')}</h2>
                <div className="max-h-[60vh] overflow-y-auto pr-2">
                    {Object.entries(offlineKiosksByCountry).map(([country, kiosks]) => (
                        <div key={country} className="mb-4">
                            <h3 className="font-bold text-lg text-gray-700 border-b pb-1 mb-2">{country} ({kiosks.length})</h3>
                            <ul className="space-y-1 text-sm">
                                {kiosks.map(kiosk => (
                                    <li key={kiosk.stationid} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                                        <span className="font-semibold text-gray-800">{kiosk.stationid} - {kiosk.info.location} - {kiosk.info.place}</span>
                                        <span className="text-red-600 font-mono text-xs">{formatDateTime(kiosk.lastUpdated)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
                <div className="mt-6 text-center">
                    <button onClick={onDone} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-8 rounded-lg transition-colors">
                        {t('done')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InitialStatusPage;
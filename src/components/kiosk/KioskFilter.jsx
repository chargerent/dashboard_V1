import React from 'react';
import { formatDateTime } from '../../utils/dateFormatter';

const KioskFilter = ({
    searchTerm,
    setSearchTerm,
    filter,
    setFilter,
    stats,
    lastUpdated,
    totalUpdatesToday,
    serverFlowVersion,
    t
}) => {

    const handleFilterChange = (key, value) => {
        setFilter(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="bg-white p-4 rounded-lg shadow-sm">
            <input
                type="text"
                placeholder={t('search_kiosks')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">{t('status')}</label>
                    <select
                        value={filter.status}
                        onChange={(e) => handleFilterChange('status', e.target.value)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    >
                        <option value="all">{t('all')} ({stats.total})</option>
                        <option value="online">{t('online')} ({stats.online})</option>
                        <option value="offline">{t('offline')} ({stats.offline})</option>
                        <option value="disabled">{t('disabled')} ({stats.disabled})</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">{t('version')}</label>
                    <select
                        value={filter.version}
                        onChange={(e) => handleFilterChange('version', e.target.value)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    >
                        <option value="all">{t('all')}</option>
                        <option value="latest">{t('latest')} ({serverFlowVersion})</option>
                        <option value="outdated">{t('outdated')}</option>
                    </select>
                </div>
                <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700">{t('sort_by')}</label>
                    <select
                        value={filter.sort}
                        onChange={(e) => handleFilterChange('sort', e.target.value)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    >
                        <option value="stationid_asc">{t('station_id_asc')}</option>
                        <option value="stationid_desc">{t('station_id_desc')}</option>
                        <option value="location_asc">{t('location_asc')}</option>
                        <option value="location_desc">{t('location_desc')}</option>
                        <option value="lastUpdated_desc">{t('last_updated_desc')}</option>
                        <option value="lastUpdated_asc">{t('last_updated_asc')}</option>
                    </select>
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500">
                <div className="flex justify-between">
                    <span>{t('last_kiosk_update')}:</span>
                    <span className="font-semibold">{lastUpdated ? formatDateTime(lastUpdated.toISOString()) : 'N/A'}</span>
                </div>
                <div className="flex justify-between mt-1">
                    <span>{t('total_updates_today')}:</span>
                    <span className="font-semibold">{totalUpdatesToday}</span>
                </div>
            </div>
        </div>
    );
};

export default KioskFilter;
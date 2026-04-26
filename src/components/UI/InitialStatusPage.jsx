import { formatDateTime } from '../../utils/dateFormatter';
import { ArchiveBoxXMarkIcon, BoltSlashIcon, SignalSlashIcon } from '@heroicons/react/24/outline';

const STATUS_STYLES = {
    offline: {
        icon: SignalSlashIcon,
        labelKey: 'offline',
        className: 'bg-red-50 text-red-700 ring-red-200',
    },
    soldout: {
        icon: ArchiveBoxXMarkIcon,
        labelKey: 'sold_out',
        className: 'bg-purple-50 text-purple-800 ring-purple-200',
    },
    disconnected: {
        icon: BoltSlashIcon,
        labelKey: 'module_disconnected',
        className: 'bg-orange-50 text-orange-800 ring-orange-200',
    },
};

const getIssueLabel = (issue, t) => {
    if (issue.type === 'disconnected' && issue.count > 1) {
        return `${issue.count} ${t('modules_disconnected')}`;
    }

    const style = STATUS_STYLES[issue.type];
    return style ? t(style.labelKey) : issue.type;
};

const StatusChip = ({ issue, t }) => {
    const style = STATUS_STYLES[issue.type] || STATUS_STYLES.offline;
    const Icon = style.icon;
    const label = getIssueLabel(issue, t);
    const moduleIds = Array.isArray(issue.moduleIds) ? issue.moduleIds : [];
    const title = moduleIds.length > 0 ? `${label} (${moduleIds.join(', ')})` : label;

    return (
        <span
            className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ring-1 ${style.className}`}
            title={title}
        >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{label}</span>
        </span>
    );
};

const normalizeLegacyOfflineGroups = (offlineKiosksByCountry = {}) => {
    return Object.entries(offlineKiosksByCountry).reduce((acc, [country, kiosks]) => {
        acc[country] = kiosks.map(kiosk => ({
            kiosk,
            issues: [{ type: 'offline' }],
        }));
        return acc;
    }, {});
};

const InitialStatusPage = ({ statusKiosksByCountry, offlineKiosksByCountry, onDone, onSelectKiosk, t }) => {
    const groupedStatuses = statusKiosksByCountry || normalizeLegacyOfflineGroups(offlineKiosksByCountry);
    const groupedEntries = Object.entries(groupedStatuses);

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-4xl bg-white rounded-lg shadow-xl p-6">
                <h2 className="text-2xl font-bold text-gray-800 text-center mb-4">{t('station_status_title')}</h2>
                <div className="max-h-[60vh] overflow-y-auto pr-2">
                    {groupedEntries.length > 0 ? (
                        groupedEntries.map(([country, rows]) => (
                            <div key={country} className="mb-4">
                                <h3 className="font-bold text-lg text-gray-700 border-b pb-1 mb-2">
                                    {country} ({rows.length})
                                </h3>
                                <ul className="space-y-2 text-sm">
                                    {rows.map(({ kiosk, issues }) => {
                                        const content = (
                                            <>
                                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                    <div className="min-w-0">
                                                        <div className="font-semibold text-gray-800">{kiosk.stationid}</div>
                                                        <div className="truncate text-xs text-gray-500">
                                                            {kiosk.info.location} - {kiosk.info.place}
                                                        </div>
                                                    </div>
                                                    <div className="flex max-w-full flex-wrap gap-1.5 sm:justify-end">
                                                        {issues.map(issue => (
                                                            <StatusChip key={issue.type} issue={issue} t={t} />
                                                        ))}
                                                    </div>
                                                </div>
                                                {kiosk.lastUpdated && (
                                                    <div className="mt-2 text-xs font-mono text-gray-500">
                                                        {formatDateTime(kiosk.lastUpdated)}
                                                    </div>
                                                )}
                                            </>
                                        );

                                        return (
                                            <li key={kiosk.stationid}>
                                                {onSelectKiosk ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => onSelectKiosk(kiosk.stationid)}
                                                        className="w-full rounded-md bg-gray-50 p-3 text-left transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                                    >
                                                        {content}
                                                    </button>
                                                ) : (
                                                    <div className="rounded-md bg-gray-50 p-3">
                                                        {content}
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))
                    ) : (
                        <p className="text-center text-gray-600">{t('no_station_status_issues')}</p>
                    )}
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

import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { formatDateTime } from '../../utils/dateFormatter';

const TELEMETRY_OVERDUE_TYPE = 'kiosk_telemetry_overdue';
const MODULE_TELEMETRY_OVERDUE_TYPE = 'module_telemetry_overdue';
const MODULE_DISCONNECTED_TYPE = 'module_disconnected';

const collapseRelatedModuleIncidents = (incidents) => {
    const disconnectedModuleIds = new Set(incidents
        .filter((incident) => incident.type === MODULE_DISCONNECTED_TYPE)
        .map((incident) => String(incident.moduleId || '')));
    return incidents.filter((incident) => (
        incident.type !== MODULE_TELEMETRY_OVERDUE_TYPE ||
        !disconnectedModuleIds.has(String(incident.moduleId || ''))
    ));
};

const formatDuration = (durationMs) => {
    const minutes = Math.max(0, Math.floor(Number(durationMs || 0) / 60000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
};

export default function KioskStatusAlert({
    incidents = [],
    isOnline,
    lastUpdated,
    stationId,
    onNavigateToActivity,
}) {
    const statusIncidents = isOnline
        ? incidents
        : incidents.filter((incident) => incident.type !== TELEMETRY_OVERDUE_TYPE);
    const visibleIncidents = collapseRelatedModuleIncidents(statusIncidents);

    if (isOnline && visibleIncidents.length === 0) return null;

    const primary = visibleIncidents[0];
    const critical = !isOnline || visibleIncidents.some((incident) => incident.severity === 'critical');
    const countLabel = `${visibleIncidents.length} urgent issue${visibleIncidents.length === 1 ? '' : 's'}`;
    const offlineDetail = visibleIncidents.length === 1
        ? primary.summary || primary.type
        : visibleIncidents.length > 1
            ? `${visibleIncidents.length} other urgent issues`
            : '';

    return (
        <div
            className={`mt-4 rounded-md border p-2.5 ${critical ? 'border-red-300 bg-red-50 text-red-900' : 'border-orange-200 bg-orange-50 text-orange-900'}`}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="flex items-start gap-2">
                <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold">{isOnline ? countLabel : 'Kiosk offline'}</p>
                    <p className="mt-0.5 truncate text-[11px] opacity-80">
                        {isOnline ? (
                            <>
                                {primary.summary || primary.type}
                                {primary.durationMs > 0 ? ` · ${formatDuration(primary.durationMs)}` : ''}
                            </>
                        ) : (
                            <>
                                {formatDateTime(lastUpdated)}
                                {offlineDetail ? ` · ${offlineDetail}` : ''}
                            </>
                        )}
                    </p>
                </div>
                {typeof onNavigateToActivity === 'function' && (
                    <button
                        type="button"
                        className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:no-underline"
                        onClick={() => onNavigateToActivity(stationId)}
                    >
                        View activity
                    </button>
                )}
            </div>
        </div>
    );
}

import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

const formatDuration = (durationMs) => {
    const minutes = Math.max(0, Math.floor(Number(durationMs || 0) / 60000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
};

export default function KioskUrgentAlert({ incidents = [], stationId, onNavigateToActivity }) {
    if (incidents.length === 0) return null;

    const primary = incidents[0];
    const critical = incidents.some((incident) => incident.severity === 'critical');
    const countLabel = `${incidents.length} urgent issue${incidents.length === 1 ? '' : 's'}`;

    return (
        <div
            className={`mt-4 rounded-md border p-2.5 ${critical ? 'border-red-300 bg-red-50 text-red-900' : 'border-orange-200 bg-orange-50 text-orange-900'}`}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="flex items-start gap-2">
                <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold">{countLabel}</p>
                    <p className="mt-0.5 truncate text-[11px] opacity-80">
                        {primary.summary || primary.type}
                        {primary.durationMs > 0 ? ` · ${formatDuration(primary.durationMs)}` : ''}
                    </p>
                </div>
                <button
                    type="button"
                    className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:no-underline"
                    onClick={() => onNavigateToActivity(stationId)}
                >
                    View activity
                </button>
            </div>
        </div>
    );
}

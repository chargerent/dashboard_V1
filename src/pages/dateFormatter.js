
export const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    // Ensure the date string is treated as UTC before converting to local time
    const date = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z');
    return date.toLocaleDateString(undefined, {
        month: 'short', day: 'numeric'
    });
};

export const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z');
    return date.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
}

export function formatDuration(start, end) {
    if (!start || !end) return 'N/A';

    const startDate = new Date(start.endsWith('Z') ? start : start + 'Z');
    const endDate = new Date(end.endsWith('Z') ? end : end + 'Z');

    let diff = (endDate.getTime() - startDate.getTime()) / 1000; // difference in seconds

    const days = Math.floor(diff / 86400);
    diff -= days * 86400;
    const hours = Math.floor(diff / 3600) % 24;
    diff -= hours * 3600;
    const minutes = Math.floor(diff / 60) % 60;

    return `${days > 0 ? `${days}d ` : ''}${hours > 0 ? `${hours}h ` : ''}${minutes}m`;
}
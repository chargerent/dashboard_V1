export const isAiBoothProvision = (station) => (
  String(station?.provisionid || '').trim().toLowerCase().startsWith('aid-') ||
  String(station?.hardware?.type || '').trim().toUpperCase() === 'CA36'
);

export const applyDashboardAssignedStationId = (payload, station, assignedStationId) => {
  const nextPayload = { ...payload };

  if (isAiBoothProvision(station) && assignedStationId) {
    nextPayload.stationid = assignedStationId;
  } else {
    delete nextPayload.stationid;
  }

  return nextPayload;
};

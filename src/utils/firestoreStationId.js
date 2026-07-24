export function getFirestoreKioskStationId(docSnap) {
  const embeddedStationId = docSnap.data()?.stationid;
  return String(embeddedStationId || docSnap.id || '').trim();
}

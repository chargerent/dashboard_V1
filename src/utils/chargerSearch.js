import { normalizeText, textIncludes } from './text.js';

export const chargerMatchesSearchTerm = (charger, searchTerm) => {
    const normalizedSearch = normalizeText(searchTerm);
    if (!normalizedSearch) return true;

    const stationIds = [
        charger?.location?.stationId,
        charger?.rentedFrom?.stationId,
        ...(Array.isArray(charger?.rentals)
            ? charger.rentals.flatMap(rental => [
                rental?.rentalStationid,
                rental?.returnStationid,
                rental?.returnStationId,
            ])
            : []),
    ];

    return (
        textIncludes(charger?.sn, normalizedSearch) ||
        stationIds.some(stationId => textIncludes(stationId, normalizedSearch))
    );
};

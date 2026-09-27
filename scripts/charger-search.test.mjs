import assert from 'node:assert/strict';
import test from 'node:test';

import { chargerMatchesSearchTerm } from '../src/utils/chargerSearch.js';

const charger = {
    sn: '9301AF2262',
    location: null,
    rentedFrom: { stationId: 'US0025' },
    rentals: [
        { rentalStationid: 'US0025', returnStationid: '' },
        { rentalStationid: 'US0039', returnStationid: 'US0118' },
    ],
};

test('matches a charger serial number without regard to case', () => {
    assert.equal(chargerMatchesSearchTerm(charger, '9301af'), true);
});

test('matches the station that most recently rented the charger', () => {
    assert.equal(chargerMatchesSearchTerm(charger, 'us0025'), true);
});

test('matches station IDs elsewhere in charger rental history', () => {
    assert.equal(chargerMatchesSearchTerm(charger, 'US0118'), true);
});

test('does not match an unrelated station', () => {
    assert.equal(chargerMatchesSearchTerm(charger, 'FR1020'), false);
});

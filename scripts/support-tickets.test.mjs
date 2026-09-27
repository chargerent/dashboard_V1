import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORT_REPLY_TEMPLATES,
  buildSupportReply,
  defaultSupportReplySenderKey,
  findCurrentChargerLocation,
  normalizeCardLastFour,
  rankRentalMatches,
  supportCreatedTimestamp,
  supportReplySendersForCategory,
  supportTicketDisplayNumber,
  supportTicketMatchesStatusFilter,
} from '../src/utils/supportTickets.js';

const ticket = {
  id: 'Q-test-123',
  ticketNumber: 'Q-test-123',
  category: 'customer_support',
  customer: { name: 'Taylor Customer' },
  payment: { cardLastFour: '4242' },
  details: {
    cardLastFour: '4242',
    rentalDate: '2026-09-22',
    rentalLocation: 'Terminal 3',
  },
};

const stations = [{
  stationid: 'US0108',
  lastUpdated: '2026-09-23T10:00:00.000Z',
  info: { location: 'Airport Terminal 3' },
  modules: [{ id: 'M1', slots: [{ position: 4, sn: 'PB-4242' }] }],
}];

test('open inquiry filtering hides resolved and closed cases unless explicitly selected', () => {
  assert.equal(supportTicketMatchesStatusFilter({ status: 'new' }, 'open'), true);
  assert.equal(supportTicketMatchesStatusFilter({ status: 'in_progress' }, 'open'), true);
  assert.equal(supportTicketMatchesStatusFilter({ status: 'waiting_customer' }, 'open'), true);
  assert.equal(supportTicketMatchesStatusFilter({ status: 'resolved' }, 'open'), false);
  assert.equal(supportTicketMatchesStatusFilter({ status: 'closed' }, 'open'), false);
  assert.equal(supportTicketMatchesStatusFilter({ status: 'resolved' }, 'resolved'), true);
  assert.equal(supportTicketMatchesStatusFilter({ status: 'new' }, 'resolved'), false);
});

test('inquiry chronology uses creation time instead of later case activity', () => {
  const olderWithRecentActivity = {
    createdAtIso: '2026-09-20T08:00:00.000Z',
    lastActivityAt: '2026-09-24T08:00:00.000Z',
  };
  const newerInquiry = {
    createdAtIso: '2026-09-23T08:00:00.000Z',
    lastActivityAt: '2026-09-23T08:00:00.000Z',
  };

  assert.ok(supportCreatedTimestamp(newerInquiry) > supportCreatedTimestamp(olderWithRecentActivity));
});

test('rental matching prioritizes the submitted date and location', () => {
  const matches = rankRentalMatches(ticket, [
    { documentId: 'older', card_last4: '4242', rentalTime: '2026-08-10T10:00:00.000Z', rentalStationid: 'US0001' },
    { documentId: 'expected', card_last4: '4242', rentalTime: '2026-09-22T18:00:00.000Z', rentalStationid: 'US0108', sn: 'PB-4242' },
  ], stations);

  assert.equal(matches[0].rental.documentId, 'expected');
  assert.equal(matches[0].chargerLocation.stationId, 'US0108');
});

test('rental matching excludes every rental whose last four do not exactly match', () => {
  const matches = rankRentalMatches(ticket, [
    { documentId: 'matching', card_last4: '4242', rentalTime: '2026-09-22T18:00:00.000Z' },
    { documentId: 'wrong-card', card_last4: '1111', rentalTime: '2026-09-22T18:00:00.000Z', rentalStationid: 'US0108' },
    { documentId: 'too-long', card_last4: '994242', rentalTime: '2026-09-22T18:00:00.000Z', rentalStationid: 'US0108' },
  ], stations);

  assert.deepEqual(matches.map((match) => match.rental.documentId), ['matching']);
});

test('rental matching includes only the three calendar days on either side of the stated date', () => {
  const matches = rankRentalMatches(ticket, [
    { documentId: 'three-days-before', card_last4: '4242', rentalTime: '2026-09-19T23:59:00.000Z' },
    { documentId: 'three-days-after', card_last4: '4242', rentalTime: '2026-09-25T00:01:00.000Z' },
    { documentId: 'four-days-before', card_last4: '4242', rentalTime: '2026-09-18T23:59:00.000Z' },
    { documentId: 'four-days-after', card_last4: '4242', rentalTime: '2026-09-26T00:01:00.000Z' },
  ], stations);

  assert.deepEqual(
    new Set(matches.map((match) => match.rental.documentId)),
    new Set(['three-days-before', 'three-days-after']),
  );
});

test('last-four normalization preserves leading-zero numeric records without accepting full card numbers', () => {
  assert.equal(normalizeCardLastFour(5), '0005');
  assert.equal(normalizeCardLastFour('0005'), '0005');
  assert.equal(normalizeCardLastFour('ending 0005'), '0005');
  assert.equal(normalizeCardLastFour('4242424242424242'), '');
});

test('long database ticket ids have a short category-specific display number', () => {
  assert.equal(supportTicketDisplayNumber({
    id: 'Q-da162054-9e41-4cec-a306-9b7dc11380fd',
    category: 'customer_support',
  }), 'CS-DA1620');
});

test('current charger lookup reports kiosk, module, and slot without inferring a refund', () => {
  assert.deepEqual(findCurrentChargerLocation({ sn: 'PB-4242' }, stations), {
    stationId: 'US0108',
    location: 'Airport Terminal 3',
    moduleId: 'M1',
    slotId: 4,
    chargerId: 'PB-4242',
    stationTimestamp: Date.parse('2026-09-23T10:00:00.000Z'),
  });

  const reply = buildSupportReply(ticket, {
    rental: { documentId: 'expected', sn: 'PB-4242', rentalStationid: 'US0108', refundStatus: '' },
    chargerLocation: findCurrentChargerLocation({ sn: 'PB-4242' }, stations),
  });
  assert.match(reply.body, /current kiosk data shows the charger/i);
  assert.doesNotMatch(reply.body, /reviewing the payment and refund status/i);
  assert.doesNotMatch(reply.body, /refund (?:of .* )?was processed/i);
});

test('the automatic reply confirms a refund only when the rental record confirms it', () => {
  const reply = buildSupportReply(ticket, {
    rental: {
      documentId: 'expected',
      sn: 'PB-4242',
      rentalStationid: 'US0108',
      refundStatus: 'refunded',
      refundAmount: 12,
      symbol: '$',
    },
    chargerLocation: findCurrentChargerLocation({ sn: 'PB-4242' }, stations),
  });
  assert.match(reply.subject, /Refund confirmed/);
  assert.match(reply.body, /refund of \$12\.00 was processed/i);
});

test('no rental match requests the mobile-wallet last four and rejects full card data', () => {
  const reply = buildSupportReply(ticket, null);
  assert.match(reply.body, /Apple Pay/);
  assert.match(reply.body, /Google Wallet/);
  assert.match(reply.body, /Do not send the complete card number/i);
});

test('an explicit template selection replaces the automatic reply', () => {
  const match = {
    rental: { documentId: 'expected', card_last4: '4242', rentalStationid: 'US0108' },
    chargerLocation: null,
  };
  const reply = buildSupportReply(ticket, match, 'request_wallet');
  assert.match(reply.subject, /Additional payment information needed/);
  assert.match(reply.body, /Apple Pay/);
});

test('evidence-dependent templates are fully pre-filled without placeholders', () => {
  const rentalReply = buildSupportReply(ticket, null, 'rental_found');
  const returnReply = buildSupportReply(ticket, null, 'return_recorded');
  const locationReply = buildSupportReply(ticket, null, 'charger_located');
  const refundReply = buildSupportReply(ticket, null, 'refund_confirmed');

  assert.match(rentalReply.subject, /found your Chargerent rental/i);
  assert.match(rentalReply.body, /ending in 4242/i);
  assert.match(rentalReply.body, /Terminal 3/i);
  assert.match(returnReply.body, /records show that the charger was returned/i);
  assert.match(locationReply.body, /has located the charger/i);
  assert.match(refundReply.body, /A refund was processed to the original payment method/i);
  for (const reply of [rentalReply, returnReply, locationReply, refundReply]) {
    assert.doesNotMatch(reply.body, /Apple Pay/);
    assert.doesNotMatch(reply.body, /\[(?:LAST FOUR|RENTAL LOCATION|RETURN DATE|RETURN LOCATION|STATION ID|LOCATION|REFUND AMOUNT|REFUND DATE)\]/);
  }
});

test('return-status template confirms the recorded return without claiming a refund', () => {
  const reply = buildSupportReply(ticket, {
    rental: {
      documentId: 'expected',
      card_last4: '4242',
      rentalStationid: 'US0108',
      returnStationid: 'US0108',
      returnTime: '2026-09-22T20:15:00.000Z',
      status: 'returned',
    },
  }, 'return_recorded');

  assert.match(reply.subject, /Return status/);
  assert.match(reply.body, /record shows that the charger was returned/i);
  assert.doesNotMatch(reply.body, /payment adjustment|refund/i);
  assert.doesNotMatch(reply.body, /refund (?:of .* )?was processed/i);
});

test('return-status template distinguishes kiosk position from an unrecorded return', () => {
  const reply = buildSupportReply(ticket, {
    rental: {
      documentId: 'expected',
      card_last4: '4242',
      rentalStationid: 'US0108',
      status: 'rented',
    },
    chargerLocation: {stationId: 'US0108', location: 'Airport Terminal 3'},
  }, 'return_recorded');

  assert.match(reply.body, /does not yet show a confirmed return/i);
  assert.match(reply.body, /kiosk position is separate from the rental return record/i);
});

test('return-instructions template includes the mailing address and card-last-four directions', () => {
  const reply = buildSupportReply(ticket, null, 'return_instructions');

  assert.match(reply.subject, /Return instructions/);
  assert.match(reply.body, /Ocharge LLC/);
  assert.match(reply.body, /P\.O\. Box 570673/);
  assert.match(reply.body, /Tarzana, CA 91357/);
  assert.match(reply.body, /last four digits of the card used/i);
  assert.match(reply.body, /credit any overages that you are charged/i);
});

test('sales and partnership replies use a company representative and propose a call', () => {
  const salesTicket = {...ticket, category: 'sales', subject: 'Venue request'};
  const partnershipTicket = {...ticket, category: 'partnership', subject: 'Route partnership'};
  const salesReply = buildSupportReply(salesTicket, null, 'sales', 'arthur');
  const partnershipReply = buildSupportReply(partnershipTicket, null, 'partnership', 'george');

  assert.equal(defaultSupportReplySenderKey('sales'), 'george');
  assert.deepEqual(
    supportReplySendersForCategory('partnership').map((sender) => sender.value),
    ['george', 'arthur'],
  );
  assert.match(salesReply.body, /brief call to go over your requirements/i);
  assert.match(salesReply.body, /Arthur\nCharge\.rent\narthur@charge\.rent/);
  assert.doesNotMatch(salesReply.body, /support@charge\.rent/);
  assert.match(partnershipReply.body, /brief call to go over your market/i);
  assert.match(partnershipReply.body, /George\nCharge\.rent\ngeorge@charge\.rent/);
});

test('every reply template has a complete French version', () => {
  const matchedRental = {
    rental: {
      documentId: 'expected',
      card_last4: '4242',
      rentalStationid: 'US0108',
      returnStationid: 'US0108',
      returnTime: '2026-09-22T20:15:00.000Z',
      status: 'refunded',
      refundStatus: 'refunded',
      refundAmount: 12,
      refundDate: '2026-09-23T10:30:00.000Z',
      symbol: '$',
    },
    chargerLocation: { stationId: 'US0108', location: 'Airport Terminal 3' },
  };
  const ticketsByTemplate = {
    sales: { ...ticket, category: 'sales', subject: '' },
    partnership: { ...ticket, category: 'partnership', subject: '' },
    general: { ...ticket, category: 'general', subject: '' },
  };
  const expectedFrenchCopy = {
    suggested: /Remboursement confirmé|Informations de paiement supplémentaires nécessaires/,
    request_wallet: /Les quatre derniers chiffres fournis ne correspondent pas/,
    rental_found: /Nous avons retrouvé votre location Chargerent/,
    return_recorded: /notre dossier de location indique que la batterie a été retournée/,
    return_instructions: /Veuillez retourner la batterie à l’adresse suivante/,
    charger_located: /Les données actuelles de notre borne indiquent/,
    refund_confirmed: /Le délai d’apparition du remboursement dépend/,
    sales: /bref appel afin de discuter de vos besoins/,
    partnership: /bref appel afin de discuter de votre marché/,
    general: /Un membre de notre équipe vous répondra/,
  };

  assert.deepEqual(
    SUPPORT_REPLY_TEMPLATES.map((template) => template.value).sort(),
    Object.keys(expectedFrenchCopy).sort(),
  );

  for (const template of SUPPORT_REPLY_TEMPLATES) {
    const templateTicket = ticketsByTemplate[template.value] || ticket;
    const senderKey = template.value === 'sales' ? 'arthur' : template.value === 'partnership' ? 'george' : '';
    const reply = buildSupportReply(templateTicket, matchedRental, template.value, senderKey, 'fr');
    assert.match(reply.body, /^Bonjour Taylor,/);
    assert.match(`${reply.subject}\n${reply.body}`, expectedFrenchCopy[template.value]);
    assert.match(reply.body, /Cordialement,/);
    assert.doesNotMatch(reply.body, /Kind regards,|Thank you for|Please reply|We matched/);
    assert.doesNotMatch(reply.body, /\[(?:LAST FOUR|RENTAL LOCATION|RETURN DATE|RETURN LOCATION|STATION ID|LOCATION|REFUND AMOUNT|REFUND DATE)\]/);
  }
});

test('French mobile-wallet and representative templates use localized instructions and signatures', () => {
  const walletReply = buildSupportReply(ticket, null, 'request_wallet', 'support', 'fr');
  const salesReply = buildSupportReply({ ...ticket, category: 'sales' }, null, 'sales', 'arthur', 'fr');

  assert.match(walletReply.body, /Apple Pay : ouvrez l’app Cartes/);
  assert.match(walletReply.body, /Google Wallet : ouvrez Google Wallet/);
  assert.match(walletReply.body, /Service client Chargerent\nsupport@charge\.rent/);
  assert.match(salesReply.body, /Arthur\nCharge\.rent\narthur@charge\.rent/);
  assert.doesNotMatch(salesReply.body, /support@charge\.rent/);
});

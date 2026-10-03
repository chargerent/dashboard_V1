import { isReturnedRentalStatus, isSuccessfulRefundStatus } from './rentals.js';

export const SUPPORT_CATEGORIES = [
  { value: 'customer_support', label: 'Customer support' },
  { value: 'sales', label: 'Sales' },
  { value: 'partnership', label: 'Partnerships' },
  { value: 'general', label: 'General' },
];

export const SUPPORT_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting_customer', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export const SUPPORT_PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export const CATEGORY_STYLES = {
  customer_support: 'border-rose-200 bg-rose-50 text-rose-700',
  sales: 'border-blue-200 bg-blue-50 text-blue-700',
  partnership: 'border-violet-200 bg-violet-50 text-violet-700',
  general: 'border-slate-200 bg-slate-50 text-slate-700',
};

export const STATUS_STYLES = {
  new: 'border-amber-200 bg-amber-50 text-amber-800',
  in_progress: 'border-blue-200 bg-blue-50 text-blue-700',
  waiting_customer: 'border-violet-200 bg-violet-50 text-violet-700',
  resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  closed: 'border-slate-200 bg-slate-100 text-slate-600',
};

const categoryLabelMap = new Map(SUPPORT_CATEGORIES.map(({ value, label }) => [value, label]));
const statusLabelMap = new Map(SUPPORT_STATUSES.map(({ value, label }) => [value, label]));

export const supportCategoryLabel = (value) => categoryLabelMap.get(value) || 'General';
export const supportStatusLabel = (value) => statusLabelMap.get(value) || 'New';

export const isResolvedSupportStatus = (value) => ['resolved', 'closed'].includes(value);

export const supportTicketMatchesStatusFilter = (ticket, statusFilter = 'open') => {
  if (!statusFilter) return true;
  if (statusFilter === 'open') return !isResolvedSupportStatus(ticket?.status);
  return ticket?.status === statusFilter;
};

export const safeSupportDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const supportTimestamp = (ticket) => (
  safeSupportDate(ticket?.lastActivityAt)?.getTime() ||
  safeSupportDate(ticket?.updatedAt)?.getTime() ||
  safeSupportDate(ticket?.createdAt)?.getTime() ||
  safeSupportDate(ticket?.createdAtIso)?.getTime() ||
  0
);

export const supportCreatedTimestamp = (ticket) => (
  safeSupportDate(ticket?.createdAt)?.getTime() ||
  safeSupportDate(ticket?.createdAtIso)?.getTime() ||
  0
);

export const supportDateLabel = (value, locale) => {
  const date = safeSupportDate(value);
  if (!date) return locale === 'fr-FR' ? 'Heure indisponible' : 'Time unavailable';
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const supportRelativeTime = (value, now = Date.now()) => {
  const date = safeSupportDate(value);
  if (!date) return 'Time unavailable';
  const elapsedMinutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
};

const text = (value) => String(value ?? '').trim();
const normalized = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const normalizeCardLastFour = (value) => {
  const digits = text(value).replace(/\D/g, '');
  if (!digits || digits.length > 4) return '';
  return digits.padStart(4, '0');
};

export const shouldShowEmailCaseMatchWarning = (ticket) => (
  ticket?.needsCaseMatch === true && [
    ticket?.source,
    ticket?.channel,
    ticket?.requestType,
  ].some((value) => normalized(value) === 'email')
);

export const shouldShowRentalNoMatchWarning = (ticket, {
  loading = false,
  error = '',
  matchCount = 0,
} = {}) => {
  const lastFour = normalizeCardLastFour(
    ticket?.payment?.cardLastFour || ticket?.details?.cardLastFour,
  );
  return ticket?.category === 'customer_support'
    && Boolean(lastFour)
    && !loading
    && !text(error)
    && Number(matchCount) === 0;
};

const TICKET_PREFIXES = {
  customer_support: 'CS',
  sales: 'SL',
  partnership: 'PT',
  general: 'GN',
};

export const supportTicketDisplayNumber = (ticket) => {
  const explicitNumber = text(ticket?.displayTicketNumber).toUpperCase();
  if (/^[A-Z]{2}-[A-Z0-9]{4,10}$/.test(explicitNumber)) return explicitNumber;

  const storedNumber = text(ticket?.ticketNumber || ticket?.id);
  if (/^(CS|SL|PT|GN)-[A-Z0-9]{4,10}$/i.test(storedNumber)) return storedNumber.toUpperCase();

  const compactId = storedNumber.replace(/^Q-/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const prefix = TICKET_PREFIXES[ticket?.category] || TICKET_PREFIXES.general;
  return `${prefix}-${(compactId.slice(0, 6) || '000000').padEnd(6, '0')}`;
};

export const ticketMatchesSearch = (ticket, searchTerm) => {
  const needle = normalized(searchTerm);
  if (!needle) return true;
  const details = ticket?.details || {};
  return normalized([
    supportTicketDisplayNumber(ticket),
    ticket?.ticketNumber,
    ticket?.subject,
    ticket?.message,
    ticket?.customer?.name,
    ticket?.customer?.email,
    ticket?.customer?.phone,
    ticket?.customer?.company,
    details.rentalLocation,
    details.eventCity,
    details.venueCity,
    details.cityRegion,
    ticket?.payment?.cardLastFour,
  ].filter(Boolean).join(' ')).includes(needle);
};

const isoDay = (value) => {
  const date = safeSupportDate(value);
  return date ? date.toISOString().slice(0, 10) : '';
};

const locationScore = (ticketLocation, rental, stationById) => {
  const station = stationById.get(text(rental?.rentalStationid).toUpperCase());
  const rentalLocation = normalized([
    rental?.rentalLocation,
    rental?.rentalPlace,
    station?.info?.location,
    station?.info?.place,
    station?.info?.city,
    rental?.rentalStationid,
  ].filter(Boolean).join(' '));
  const requested = normalized(ticketLocation);
  if (!requested || !rentalLocation) return 0;
  if (rentalLocation.includes(requested) || requested.includes(rentalLocation)) return 60;
  const requestedWords = new Set(requested.split(' ').filter((word) => word.length > 2));
  const sharedWords = rentalLocation.split(' ').filter((word) => requestedWords.has(word));
  return Math.min(45, sharedWords.length * 15);
};

export const findCurrentChargerLocation = (rental, stations) => {
  const chargerId = text(rental?.sn || rental?.chargerid);
  if (!chargerId) return null;

  let newest = null;
  for (const station of stations || []) {
    for (const module of station?.modules || []) {
      for (const slot of module?.slots || []) {
        if (text(slot?.sn) !== chargerId || text(slot?.sn) === '0') continue;
        const stationTimestamp = Date.parse(station?.lastUpdated || station?.lastUpdate || '') || 0;
        if (!newest || stationTimestamp >= newest.stationTimestamp) {
          newest = {
            stationId: text(station?.stationid),
            location: text(station?.info?.location || station?.info?.place),
            moduleId: text(module?.id),
            slotId: slot?.position ?? slot?.slotid ?? '',
            chargerId,
            stationTimestamp,
          };
        }
      }
    }
  }
  return newest;
};

export const rankRentalMatches = (ticket, rentals, stations) => {
  const requestedLastFour = normalizeCardLastFour(
    ticket?.payment?.cardLastFour || ticket?.details?.cardLastFour,
  );
  if (!requestedLastFour) return [];

  const requestedDate = text(ticket?.details?.rentalDate);
  const requestedDayTimestamp = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? Date.parse(`${requestedDate}T00:00:00Z`)
    : Number.NaN;
  if (!Number.isFinite(requestedDayTimestamp)) return [];

  const requestedLocation = text(ticket?.details?.rentalLocation);
  const stationById = new Map((stations || []).map((station) => [
    text(station?.stationid).toUpperCase(),
    station,
  ]));

  return (rentals || [])
    .filter((rental) => {
      if (normalizeCardLastFour(rental?.card_last4) !== requestedLastFour) return false;
      const rentalDay = isoDay(rental?.rentalTime || rental?.createdAt);
      if (!rentalDay) return false;
      const difference = Math.abs(requestedDayTimestamp - Date.parse(`${rentalDay}T00:00:00Z`));
      return difference <= 3 * 24 * 60 * 60 * 1000;
    })
    .map((rental) => {
    const rentalDay = isoDay(rental?.rentalTime || rental?.createdAt);
    let score = 1;
    if (requestedDate && requestedDate === rentalDay) score += 100;
    else if (requestedDate && rentalDay) {
      const difference = Math.abs(Date.parse(`${requestedDate}T00:00:00Z`) - Date.parse(`${rentalDay}T00:00:00Z`));
      if (difference <= 24 * 60 * 60 * 1000) score += 35;
    }
    score += locationScore(requestedLocation, rental, stationById);
    const chargerLocation = findCurrentChargerLocation(rental, stations);
    if (chargerLocation) score += 10;
      return { rental, chargerLocation, score };
    }).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return supportTimestamp(right.rental) - supportTimestamp(left.rental);
  });
};

const moneyLabel = (rental) => {
  const amount = Number(rental?.refundAmount ?? rental?.totalCharged ?? rental?.buyprice);
  if (!Number.isFinite(amount)) return '';
  return `${text(rental?.symbol) || '$'}${amount.toFixed(2)}`;
};

const firstName = (ticket) => text(ticket?.customer?.name).split(/\s+/)[0] || 'there';
const withoutCaseNumber = (value) => text(value)
  .replace(/\s*\[(?:CS|SL|PT|GN)-[A-Z0-9]{4,10}\]\s*/gi, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

export const SUPPORT_REPLY_SENDERS = [
  {
    value: 'support',
    label: 'Chargerent Customer Support',
    email: 'support@charge.rent',
    categories: ['customer_support', 'general'],
  },
  {
    value: 'george',
    label: 'George at Charge.rent',
    email: 'george@charge.rent',
    categories: ['sales', 'partnership'],
  },
  {
    value: 'arthur',
    label: 'Arthur at Charge.rent',
    email: 'arthur@charge.rent',
    categories: ['sales', 'partnership'],
  },
];

export const supportReplySendersForCategory = (category) => {
  const normalizedCategory = SUPPORT_CATEGORIES.some((option) => option.value === category)
    ? category
    : 'general';
  return SUPPORT_REPLY_SENDERS.filter((sender) => sender.categories.includes(normalizedCategory));
};

export const defaultSupportReplySenderKey = (category) => (
  supportReplySendersForCategory(category)[0]?.value || 'support'
);

const resolveSupportReplySender = (category, senderKey) => {
  const available = supportReplySendersForCategory(category);
  return available.find((sender) => sender.value === senderKey) || available[0] || SUPPORT_REPLY_SENDERS[0];
};

const GEORGE_EMAIL_SIGNATURE = 'George Gazelian |\u00A0Managing Director\u00A0| Chargerent\u00A0|\u00A0C:\u00A0818.996.0996';

const senderSignature = (sender, language = 'en') => {
  if (sender.value === 'george') return GEORGE_EMAIL_SIGNATURE;
  if (language === 'fr') {
    return sender.value === 'support'
      ? ['Cordialement,', 'Service client Chargerent', sender.email].join('\n')
      : ['Cordialement,', sender.label.split(' at ')[0], 'Charge.rent', sender.email].join('\n');
  }
  return sender.value === 'support'
    ? ['Kind regards,', sender.label, sender.email].join('\n')
    : ['Best,', sender.label.split(' at ')[0], 'Charge.rent', sender.email].join('\n');
};

export const SUPPORT_REPLY_TEMPLATES = [
  { value: 'suggested', label: 'Suggested' },
  { value: 'request_wallet', label: 'Ask for wallet number' },
  { value: 'rental_found', label: 'Rental found' },
  { value: 'return_recorded', label: 'Return recorded' },
  { value: 'return_instructions', label: 'Return instructions' },
  { value: 'charger_located', label: 'Charger located' },
  { value: 'refund_confirmed', label: 'Refund confirmed' },
  { value: 'sales', label: 'Sales follow-up' },
  { value: 'partnership', label: 'Partnership follow-up' },
  { value: 'general', label: 'General reply' },
];

export const buildSupportReply = (ticket, match, templateType = 'suggested', senderKey = '', language = 'en') => {
  const category = ticket?.category || 'general';
  const originalSubject = withoutCaseNumber(ticket?.subject);
  const replyLanguage = language === 'fr' ? 'fr' : 'en';
  const isFrench = replyLanguage === 'fr';
  const customerFirstName = firstName(ticket);
  const greeting = isFrench
    ? (customerFirstName === 'there' ? 'Bonjour,' : `Bonjour ${customerFirstName},`)
    : `Hi ${customerFirstName},`;
  const sender = resolveSupportReplySender(category, senderKey);
  const signature = senderSignature(sender, replyLanguage);
  const rental = match?.rental || ticket?.linkedRental || null;
  const chargerLocation = match?.chargerLocation || ticket?.linkedRental?.chargerLocation || null;
  const refundStatus = rental?.refundStatus || rental?.refund_status || '';
  const refundConfirmed = isSuccessfulRefundStatus(refundStatus) || text(rental?.status).toLowerCase() === 'refunded';
  const returnRecorded = Boolean(rental?.returnTime) || isReturnedRentalStatus(rental?.status);
  const lastFour = text(ticket?.payment?.cardLastFour || ticket?.details?.cardLastFour);
  const paymentReference = lastFour ? `payment ending in ${lastFour}` : 'payment details you provided';
  const frenchPaymentReference = lastFour
    ? `paiement se terminant par ${lastFour}`
    : 'paiement indiqué dans votre demande';
  const rentalLocation = text(ticket?.details?.rentalLocation || rental?.rentalLocation || rental?.rentalStationid);
  const localizedDateLabel = (value) => supportDateLabel(value, isFrench ? 'fr-FR' : undefined);
  let resolvedTemplate = templateType;

  if (resolvedTemplate === 'suggested') {
    if (category === 'sales') resolvedTemplate = 'sales';
    else if (category === 'partnership') resolvedTemplate = 'partnership';
    else if (category === 'general') resolvedTemplate = 'general';
    else if (rental && refundConfirmed) resolvedTemplate = 'refund_confirmed';
    else if (rental && chargerLocation) resolvedTemplate = 'charger_located';
    else if (rental) resolvedTemplate = 'rental_found';
    else resolvedTemplate = 'request_wallet';
  }

  if (resolvedTemplate === 'sales') {
    if (isFrench) {
      return {
        subject: `Re: ${originalSubject || 'Votre demande Chargerent'}`,
        body: [
          greeting,
          '',
          'Merci d’avoir contacté Chargerent. Nous avons bien reçu votre demande et examinons le lieu, les dates et les services indiqués.',
          '',
          'Seriez-vous disponible pour un bref appel afin de discuter de vos besoins, du calendrier, du lieu et de la configuration la mieux adaptée ? Merci de nous envoyer quelques créneaux qui vous conviennent, ainsi que votre fuseau horaire, et nous organiserons l’appel.',
          '',
          signature,
        ].join('\n'),
      };
    }
    return {
      subject: `Re: ${originalSubject || 'Your Chargerent request'}`,
      body: [
        greeting,
        '',
        'Thank you for reaching out to Chargerent. We received your request and are reviewing the venue, timing, and service details you provided.',
        '',
        'Would you be available for a brief call to go over your requirements, timeline, location, and the best setup? Please reply with a few times that work for you and your time zone, and we will schedule the call.',
        '',
        signature,
      ].join('\n'),
    };
  }

  if (resolvedTemplate === 'partnership') {
    if (isFrench) {
      return {
        subject: `Re: ${originalSubject || 'Votre demande de partenariat Chargerent'}`,
        body: [
          greeting,
          '',
          'Merci de l’intérêt que vous portez à un partenariat avec Chargerent. Nous avons bien reçu les informations concernant votre marché et votre secteur, et notre équipe chargée des partenariats les examine.',
          '',
          'Seriez-vous disponible pour un bref appel afin de discuter de votre marché, de vos emplacements, de vos besoins opérationnels et de la structure possible du partenariat ? Merci de nous envoyer quelques créneaux qui vous conviennent, ainsi que votre fuseau horaire, et nous organiserons l’appel.',
          '',
          signature,
        ].join('\n'),
      };
    }
    return {
      subject: `Re: ${originalSubject || 'Your Chargerent partnership inquiry'}`,
      body: [
        greeting,
        '',
        'Thank you for your interest in partnering with Chargerent. We received the information about your market and route and are reviewing it with our partnerships team.',
        '',
        'Would you be available for a brief call to go over your market, locations, operating requirements, and the potential partnership structure? Please reply with a few times that work for you and your time zone, and we will schedule the call.',
        '',
        signature,
      ].join('\n'),
    };
  }

  if (resolvedTemplate === 'general') {
    if (isFrench) {
      return {
        subject: `Re: ${originalSubject || 'Votre demande Chargerent'}`,
        body: [
          greeting,
          '',
          'Merci d’avoir contacté Chargerent. Nous avons bien reçu votre message et examinons les informations fournies.',
          '',
          'Un membre de notre équipe vous répondra dès que possible. Si vous disposez d’informations complémentaires qui pourraient nous être utiles, vous pouvez répondre à cet e-mail.',
          '',
          signature,
        ].join('\n'),
      };
    }
    return {
      subject: `Re: ${originalSubject || 'Your Chargerent inquiry'}`,
      body: [
        greeting,
        '',
        'Thank you for contacting Chargerent. We received your message and are reviewing the details you provided.',
        '',
        'A member of our team will follow up as soon as possible. If there is any additional information that may help us, please reply to this email.',
        '',
        signature,
      ].join('\n'),
    };
  }

  if (resolvedTemplate === 'refund_confirmed') {
    const amount = rental && refundConfirmed ? moneyLabel(rental) : '';
    if (isFrench) {
      return {
        subject: 'Remboursement confirmé pour votre location Chargerent',
        body: [
          greeting,
          '',
          'Je suis désolé pour l’inquiétude occasionnée par ce débit.',
          `Nous avons associé le ${frenchPaymentReference} à votre location${rentalLocation ? ` à ${rentalLocation}` : ''}.`,
          chargerLocation ? `Les données actuelles de notre borne indiquent que la batterie se trouve à ${chargerLocation.stationId}${chargerLocation.location ? ` — ${chargerLocation.location}` : ''}.` : '',
          '',
          rental && refundConfirmed
            ? `Nous avons vérifié qu’${amount ? `un remboursement de ${amount}` : 'un remboursement'} a été traité${rental?.refundDate ? ` le ${localizedDateLabel(rental.refundDate)}` : ''} vers le moyen de paiement d’origine. Le délai d’apparition du remboursement dépend de l’émetteur de votre carte.`
            : 'Un remboursement a été traité vers le moyen de paiement d’origine. Le délai d’apparition du remboursement dépend de l’émetteur de votre carte.',
          '',
          signature,
        ].filter((line) => line !== '').join('\n').replace(/\n{3,}/g, '\n\n'),
      };
    }
    return {
      subject: 'Refund confirmed for your Chargerent rental',
      body: [
        greeting,
        '',
        'I’m sorry for the concern regarding this charge.',
        `We matched the ${paymentReference} to your rental${rentalLocation ? ` at ${rentalLocation}` : ''}.`,
        chargerLocation ? `Our current kiosk data shows the charger at ${chargerLocation.stationId}${chargerLocation.location ? ` — ${chargerLocation.location}` : ''}.` : '',
        '',
        rental && refundConfirmed
          ? `We verified that ${amount ? `a refund of ${amount}` : 'the refund'} was processed${rental?.refundDate ? ` on ${localizedDateLabel(rental.refundDate)}` : ''} to the original payment method. Refund timing depends on your card issuer.`
          : 'A refund was processed to the original payment method. Refund timing depends on your card issuer.',
        '',
        signature,
      ].filter((line) => line !== '').join('\n').replace(/\n{3,}/g, '\n\n'),
    };
  }

  if (resolvedTemplate === 'return_recorded') {
    const returnLocation = text(rental?.returnStationid || rental?.returnLocation);
    if (!rental) {
      if (isFrench) {
        return {
          subject: 'Statut du retour de votre location Chargerent',
          body: [
            greeting,
            '',
            `Oui — nous avons associé le ${frenchPaymentReference} à votre location${rentalLocation ? ` à ${rentalLocation}` : ''}, et nos dossiers indiquent que la batterie a été retournée.`,
            '',
            signature,
          ].join('\n'),
        };
      }
      return {
        subject: 'Return status for your Chargerent rental',
        body: [
          greeting,
          '',
          `Yes — we matched the ${paymentReference} to your rental${rentalLocation ? ` at ${rentalLocation}` : ''}, and our records show that the charger was returned.`,
          '',
          signature,
        ].join('\n'),
      };
    }
    if (isFrench) {
      return {
        subject: 'Statut du retour de votre location Chargerent',
        body: returnRecorded ? [
          greeting,
          '',
          `Oui — nous avons associé le paiement se terminant par ${lastFour || 'les chiffres que vous avez fournis'} à votre location${rentalLocation ? ` à ${rentalLocation}` : ''}, et notre dossier de location indique que la batterie a été retournée${rental?.returnTime ? ` le ${localizedDateLabel(rental.returnTime)}` : ''}${returnLocation ? ` à la borne ${returnLocation}` : ''}.`,
          '',
          signature,
        ].join('\n') : [
          greeting,
          '',
          `Nous avons associé le paiement se terminant par ${lastFour || 'les chiffres que vous avez fournis'} à votre location${rentalLocation ? ` à ${rentalLocation}` : ''}, mais le dossier de location ne confirme pas encore le retour.`,
          chargerLocation ? `Les données actuelles de notre borne indiquent que la batterie se trouve à ${chargerLocation.stationId}${chargerLocation.location ? ` — ${chargerLocation.location}` : ''}, mais cet emplacement est distinct du statut de retour dans le dossier de location.` : '',
          '',
          'Nous vérifions les détails du retour et vous répondrons dès que le dossier de location sera confirmé.',
          '',
          signature,
        ].filter((line) => line !== '').join('\n').replace(/\n{3,}/g, '\n\n'),
      };
    }
    return {
      subject: 'Return status for your Chargerent rental',
      body: returnRecorded ? [
        greeting,
        '',
        `Yes — we matched the payment ending in ${lastFour || 'the digits you provided'} to your rental${rentalLocation ? ` at ${rentalLocation}` : ''}, and our rental record shows that the charger was returned${rental?.returnTime ? ` on ${localizedDateLabel(rental.returnTime)}` : ''}${returnLocation ? ` to station ${returnLocation}` : ''}.`,
        '',
        signature,
      ].join('\n') : [
        greeting,
        '',
        `We matched the payment ending in ${lastFour || 'the digits you provided'} to your rental${rentalLocation ? ` at ${rentalLocation}` : ''}, but the rental record does not yet show a confirmed return.`,
        chargerLocation ? `Our current kiosk data shows the charger at ${chargerLocation.stationId}${chargerLocation.location ? ` — ${chargerLocation.location}` : ''}, but that kiosk position is separate from the rental return record.` : '',
        '',
        'We are reviewing the return details and will follow up once the rental record is confirmed.',
        '',
        signature,
      ].filter((line) => line !== '').join('\n').replace(/\n{3,}/g, '\n\n'),
    };
  }

  if (resolvedTemplate === 'return_instructions') {
    if (isFrench) {
      return {
        subject: 'Instructions de retour pour votre batterie Chargerent',
        body: [
          greeting,
          '',
          'Veuillez retourner la batterie à l’adresse suivante :',
          '',
          'Ocharge LLC',
          'P.O. Box 570673',
          'Tarzana, CA 91357',
          '',
          'Merci de joindre dans l’enveloppe une note indiquant les quatre derniers chiffres de la carte utilisée pour la location. Nous créditerons les frais supplémentaires qui pourraient vous être facturés.',
          '',
          signature,
        ].join('\n'),
      };
    }
    return {
      subject: 'Return instructions for your Chargerent charger',
      body: [
        greeting,
        '',
        'Please return the charger to the following address:',
        '',
        'Ocharge LLC',
        'P.O. Box 570673',
        'Tarzana, CA 91357',
        '',
        'Please include a note in the envelope with the last four digits of the card used for the rental, and we will make sure to credit any overages that you are charged.',
        '',
        signature,
      ].join('\n'),
    };
  }

  if (resolvedTemplate === 'charger_located') {
    if (isFrench) {
      return {
        subject: 'Nous avons retrouvé votre location Chargerent',
        body: [
          greeting,
          '',
          'Je suis désolé pour l’inquiétude occasionnée par ce débit.',
          `Nous avons associé le ${frenchPaymentReference} à votre location${rentalLocation ? ` à ${rentalLocation}` : ''}. ${chargerLocation ? `Les données actuelles de notre borne indiquent que la batterie se trouve à ${chargerLocation.stationId}${chargerLocation.location ? ` — ${chargerLocation.location}` : ''}.` : 'Notre équipe a retrouvé la batterie et confirmé qu’elle n’est plus associée à une location en cours à votre nom.'}`,
          '',
          signature,
        ].join('\n'),
      };
    }
    return {
      subject: 'We located your Chargerent rental',
      body: [
        greeting,
        '',
        'I’m sorry for the concern regarding this charge.',
        `We matched the ${paymentReference} to your rental${rentalLocation ? ` at ${rentalLocation}` : ''}. ${chargerLocation ? `Our current kiosk data shows the charger at ${chargerLocation.stationId}${chargerLocation.location ? ` — ${chargerLocation.location}` : ''}.` : 'Our team has located the charger and confirmed that it is no longer checked out to you.'}`,
        '',
        signature,
      ].join('\n'),
    };
  }

  if (resolvedTemplate === 'rental_found') {
    if (isFrench) {
      return {
        subject: 'Nous avons retrouvé votre location Chargerent',
        body: [
          greeting,
          '',
          `Merci d’avoir contacté Chargerent. Nous avons associé le ${frenchPaymentReference} à une location${rentalLocation ? ` à ${rentalLocation}` : ''}.`,
          '',
          'Nous vérifions actuellement le retour de la batterie et le statut du paiement, et nous vous répondrons dès que cet examen sera terminé.',
          '',
          signature,
        ].join('\n'),
      };
    }
    return {
      subject: 'We found your Chargerent rental',
      body: [
        greeting,
        '',
        `Thank you for contacting Chargerent. We matched the ${paymentReference} to a rental${rentalLocation ? ` at ${rentalLocation}` : ''}.`,
        '',
        'We are reviewing the charger return and payment status and will follow up as soon as that review is complete.',
        '',
        signature,
      ].join('\n'),
    };
  }

  if (resolvedTemplate === 'request_wallet' || !rental) {
    if (isFrench) {
      return {
        subject: 'Informations de paiement supplémentaires nécessaires',
        body: [
          greeting,
          '',
          lastFour
            ? 'Merci d’avoir contacté Chargerent. Les quatre derniers chiffres fournis ne correspondent pas à une location pour le lieu et la date indiqués dans votre demande. Cela peut arriver lorsqu’Apple Pay ou Google Wallet utilise un numéro de carte propre à l’appareil ou un numéro de carte virtuelle.'
            : 'Merci d’avoir contacté Chargerent. Pour retrouver votre location, merci de nous transmettre les quatre derniers chiffres du moyen de paiement utilisé. Si vous avez payé avec Apple Pay ou Google Wallet, il peut s’agir d’un numéro propre à l’appareil ou d’un numéro de carte virtuelle.',
          '',
          'Apple Pay : ouvrez l’app Cartes, sélectionnez la carte utilisée, puis touchez le bouton Numéro de carte pour afficher les quatre derniers chiffres du numéro de compte de l’appareil.',
          '',
          'Google Wallet : ouvrez Google Wallet, sélectionnez la carte utilisée, puis touchez Plus pour afficher les quatre derniers chiffres de la carte virtuelle.',
          '',
          'Merci de répondre uniquement avec ces quatre derniers chiffres et de confirmer le lieu ainsi que l’heure approximative de la location. N’envoyez pas le numéro complet de la carte, sa date d’expiration ni son cryptogramme.',
          '',
          signature,
        ].join('\n'),
      };
    }
    return {
      subject: 'Additional payment information needed',
      body: [
        greeting,
        '',
        lastFour
          ? 'Thank you for contacting Chargerent. The last four digits provided do not match a rental for the location and date in your request. This can happen when Apple Pay or Google Wallet uses a device-specific or virtual card number.'
          : 'Thank you for contacting Chargerent. To locate your rental, please provide the last four digits of the payment method used. If you paid with Apple Pay or Google Wallet, this may be a device-specific or virtual card number.',
        '',
        'Apple Pay: Open Wallet, select the card used, then tap the Card Number button to find the last four digits of the Device Account Number.',
        '',
        'Google Wallet: Open Google Wallet, select the card used, then tap More to view the last four digits of the virtual card.',
        '',
        'Please reply with only those last four digits and confirm the rental location and approximate time. Do not send the complete card number, expiration date, or security code.',
        '',
        signature,
      ].join('\n'),
    };
  }

  return buildSupportReply(ticket, match, 'rental_found', senderKey, replyLanguage);
};

export const linkedRentalPayload = (match) => {
  if (!match?.rental) return null;
  const rental = match.rental;
  return {
    documentId: text(rental.documentId),
    rawid: text(rental.rawid),
    orderid: text(rental.orderid),
    transactionid: text(rental.transactionid || rental.transactionId),
    cardLastFour: text(rental.card_last4),
    chargerId: text(rental.sn || rental.chargerid),
    rentalStationid: text(rental.rentalStationid),
    rentalLocation: text(rental.rentalLocation),
    rentalTime: text(rental.rentalTime),
    returnStationid: text(rental.returnStationid),
    returnTime: text(rental.returnTime),
    status: text(rental.status),
    refundStatus: text(rental.refundStatus),
    refundDate: text(rental.refundDate),
    totalCharged: Number.isFinite(Number(rental.totalCharged)) ? Number(rental.totalCharged) : null,
    refundAmount: Number.isFinite(Number(rental.refundAmount)) ? Number(rental.refundAmount) : null,
    symbol: text(rental.symbol),
    chargerLocation: match.chargerLocation ? {
      stationId: text(match.chargerLocation.stationId),
      location: text(match.chargerLocation.location),
      moduleId: text(match.chargerLocation.moduleId),
      slotId: match.chargerLocation.slotId ?? '',
      chargerId: text(match.chargerLocation.chargerId),
    } : null,
  };
};

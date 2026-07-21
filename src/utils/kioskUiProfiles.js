export const KIOSK_PROFILE_LANGUAGES = [
  { key: 'en', label: 'English' },
  { key: 'fr', label: 'French' },
  { key: 'es', label: 'Spanish' },
];

export const KIOSK_PROFILE_SCREENS = [
  { key: 'startpage', label: 'Start' },
  { key: 'rentpage', label: 'Rent / Return' },
  { key: 'hiw', label: 'How It Works' },
  { key: 'returnpage', label: 'Return Info' },
  { key: 'returntypage', label: 'Return Complete' },
  { key: 'paymentpage', label: 'Payment' },
  { key: 'wait', label: 'Wait' },
  { key: 'thankyoupage', label: 'Thank You' },
  { key: 'receiptpage', label: 'Receipt' },
  { key: 'termspage', label: 'Terms' },
  { key: 'errorpage', label: 'Error' },
  { key: 'declinedpage', label: 'Declined' },
  { key: 'ooopage', label: 'Out Of Order' },
  { key: 'payter', label: 'Payter' },
  { key: 'mapspage', label: 'Map' },
];

const RETURN_COMPLETE_DEPOSIT_NOTICE = {
  en: [
    'Your deposit will be released automatically.',
    'Any applicable rental fees will be deducted.',
    'Processing times may vary depending on your bank.',
  ],
  fr: [
    'Votre caution sera remboursée automatiquement.',
    'Les frais de location applicables seront déduits.',
    'Le délai de traitement dépend de votre banque.',
  ],
  es: [
    'Su depósito se liberará automáticamente.',
    'Se deducirán las tarifas de alquiler aplicables.',
    'El tiempo de procesamiento depende de su banco.',
  ],
};

export const DEFAULT_KIOSK_UI = {
  version: '',
  profileId: '',
  profileVersion: 1,
  mode: 'UI',
  defaultlanguage: 'ENGLISH',
  idletime: 20,
  colors: {
    bcolor1: '#078B8C',
    bcolor2: '#131E3A',
  },
  theme: {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    primary: '#078B8C',
    secondary: '#131E3A',
    text: '#111827',
    buttonText: '#FFFFFF',
    danger: '#DC2626',
  },
  layout: {
    textPlacement: 'middle',
    textAlign: 'center',
    fontScale: 1,
    buttonRadius: 8,
  },
  viewport: {
    width: 600,
    height: 1024,
    orientation: 'portrait',
    sourceResolution: '1024x600',
    dashboardColumns: 14,
    dashboardRowHeight: 48,
    dashboardGap: 8,
  },
  screens: {
    startpage: { enabled: true, textPlacement: 'middle', textAlign: 'center' },
    rentpage: { enabled: true, textPlacement: 'middle', textAlign: 'center' },
    workspage: { enabled: true, textPlacement: 'middle', textAlign: 'center' },
    returninfopage: { enabled: true, textPlacement: 'middle', textAlign: 'center' },
    thankyoupage: { enabled: true, textPlacement: 'middle', textAlign: 'center' },
    receiptpage: { enabled: true, textPlacement: 'middle', textAlign: 'center' },
    termspage: { enabled: true, textPlacement: 'middle', textAlign: 'center' },
    errorpage: { enabled: true, textPlacement: 'middle', textAlign: 'center' },
    declinedpage: { enabled: true, textPlacement: 'middle', textAlign: 'center' },
    ooopage: { enabled: true, textPlacement: 'middle', textAlign: 'center' },
  },
  languages: { active: true },
  map: { active: true },
  terms: { active: true },
  information: { active: true },
  receipt: { active: true },
  screensaver: { active: false },
  coupons: { active: false },
  reminder: { active: false, delay: 30, receipt: false },
};

export const DEFAULT_KIOSK_LANGUAGES = {
  en: {
    startpage: {
      startbutton: 'Start',
      termsbutton: 'terms',
      languagebutton: 'english',
      pricing: {
        leasesimpledaily: {
          one: 'Free For First 24 Hrs',
          two: 'For Each Additional 24 Hrs',
          three: 'If Not Returned After',
          four: 'days',
          five: 'Integrated cables',
          six: 'Micro USB, USB C, Iphone',
        },
        purchasemixday: {
          one: 'For first',
          two: 'Hrs',
          three: 'For the day',
          four: 'If not returned after end of day',
          five: 'Integrated cables',
          six: 'Micro USB, USB C, Iphone',
        },
      },
    },
    hiw: {
      renttitle: 'To rent',
      renttext: 'Use your payment card or your smartphone to pay and receive a charger',
      chargetitle: 'To charge',
      chargetext: 'Connect the charger to your device using the built-in cables',
      returntitle: 'To return',
      returntext: 'Find any Chargerent kiosk insert the charger in a slot',
      help: 'Need help? Please call: +33 805 088 812',
    },
    rentpage: {
      rentbutton: 'Rent',
      returnbutton: 'Return',
      infotext: 'What would you like to do?',
      soldout: 'Rent - Soldout',
    },
    returnpage: {
      returntitle: 'To return charger',
      returntext: 'insert the charger into a slot and wait for confirmation',
      confirmationtext: 'If you do not receive a confirmation slightly push on the returned charger',
    },
    returntypage: {
      return: 'Return complete',
      ty: 'Thank you!',
    },
    paymentpage: {
      text: 'To pay please use your credit card',
      payterms: 'You accept to pay all rental fees for more info please review our terms',
    },
    wait: 'please wait...',
    thankyoupage: {
      thankyoutitle: 'Thank you !',
      thankyoutext: 'Please take charger from slot',
      thankyoutext2: 'Connect the cable to your device charging will start automatically return the charger to any of our locations',
    },
    receiptpage: {
      text: 'For your receipt please scan this QR Code',
    },
    termspage: {
      text1: 'For our rental terms and conditions',
      text2: 'Please scan this QR code',
    },
    errorpage: {
      text: 'Transaction error, Please try again',
    },
    declinedpage: {
      text: 'Declined card, Please try again',
    },
    ooopage: {
      text: 'Out of order',
    },
    payter: {
      start: 'PRESS ₭ to start',
      takecharger: 'Take Charger',
      returned: 'Returned',
      wait: 'Please Wait',
      soldout: 'Soldout',
    },
    mapspage: {
      title: 'Scan the QR code for',
      text: 'Station locations',
      text2: 'Walking directions',
      text3: 'Live availability',
    },
    language: 'english',
  },
  fr: {
    startpage: {
      startbutton: 'Commencer',
      termsbutton: 'Les Conditions',
      languagebutton: 'français',
      pricing: {
        leasesimpledaily: {
          one: 'Gratuit Pour Les Premières 24 Hrs',
          two: 'Pour Chaque 24 Hrs Supplémentaire',
          three: 'Si Non Restituté Après',
          four: 'Jours',
          five: 'câbles intégrés',
          six: 'Micro USB, USB C, Iphone',
        },
        purchasemixday: {
          one: 'pour les premières',
          two: 'Hrs',
          three: 'Pour la journée',
          four: 'Si non restitué après la fin de la journée',
          five: 'câbles intégrés',
          six: 'Micro USB, USB C, Iphone',
        },
      },
    },
    hiw: {
      renttitle: 'Pour louer',
      renttext: 'Utilisez votre carte de crédit pour payer et recevoir un chargeur',
      chargetitle: 'Pour Charger',
      chargetext: 'Connecter le chargeur a votre appareil en utilisant les câbles intégrés',
      returntitle: 'Pour restituer',
      returntext: 'Trouvez une borne Chargerent inserez le chargeur dans une fente',
      help: "Besoin d'aide ? Veuillez appeler: +33 805 088 812",
    },
    rentpage: {
      rentbutton: 'Louer',
      returnbutton: 'Restituer',
      infotext: 'Que Desirez Vous faire?',
      soldout: 'Louer - Épuisé',
    },
    returnpage: {
      returntitle: 'Pour retourner le chargeur',
      returntext: 'Insérez le chargeur dans une fente vide et attendez la confirmation',
      confirmationtext: 'Si vous ne recevez pas de confirmation appuyez légèrement sur le chargeur restitué',
    },
    returntypage: {
      return: 'Restitution terminé',
      ty: 'Merci !',
    },
    paymentpage: {
      text: 'Pour payer veuillez utiliser votre carte de crédit',
      payterms: "Vous acceptez de payer tous les frais de location pour plus d'info veuillez consulter nos conditions",
    },
    wait: 'Veuillez patienter...',
    thankyoupage: {
      thankyoutitle: 'Merci !',
      thankyoutext: 'Veuillez prendre le chargeur de la fente',
      thankyoutext2: "Connectez le câble à votre appareil le rechargement commencera automatiquement restituez le chargeur dans l'un de nos emplacements",
    },
    receiptpage: {
      text: 'Pour votre reçu veuillez scanner le code QR',
    },
    termspage: {
      text1: 'Pour consulter nos conditions',
      text2: 'Veuillez scanner ce code QR',
    },
    errorpage: {
      text: 'Erreur, Veuillez reessayer',
    },
    declinedpage: {
      text: 'Carte refusée, Veuillez reessayer',
    },
    ooopage: {
      text: 'Hors Service',
    },
    payter: {
      start: 'Pour louer appuyez ₭',
      takecharger: 'Veuillez prendre le chargeur',
      returned: 'Chargeur restitué',
      wait: 'Veuillez patienter',
      soldout: 'Stock épuisé',
    },
    mapspage: {
      title: 'Scannez le code QR pour',
      text: 'Les emplacements des bornes',
      text2: 'Itinéraire à pied',
      text3: 'Disponibilités en temps réel',
    },
    language: 'french',
  },
  es: {
    startpage: {
      startbutton: 'Comienzo',
      termsbutton: 'Condiciones',
      languagebutton: 'español',
      pricing: {
        leasesimpledaily: {
          one: 'Primeras 24 horas gratis',
          two: 'por cada 24 horas adicionales',
          three: 'si no se devuelve después de',
          four: 'días',
          five: 'Cables integrados',
          six: 'Micro USB, USB C, Iphone',
        },
        purchasemixday: {
          one: 'por las primeras',
          two: 'horas',
          three: 'por el día',
          four: 'si no se devuelve después del final del día',
          five: 'Cables integrados',
          six: 'Micro USB, USB C, Iphone',
        },
      },
    },
    hiw: {
      renttitle: 'Para alquilar',
      renttext: 'Utiliza tu tarjeta de crédito para pagar y recibir un cargador',
      chargetitle: 'Para cargar',
      chargetext: 'Conecte el cargador a su dispositivo usando los cables incorporados',
      returntitle: 'Para regresar',
      returntext: 'Busque cualquier quiosco Chargerent inserte el cargador en una ranura',
      help: '¿Necesitas ayuda? Por favor, llama: +33 805 088 812',
    },
    rentpage: {
      rentbutton: 'Alquilar',
      returnbutton: 'Regresar',
      infotext: '¿Que te gustaría hacer?',
      soldout: 'Alquilar - Agotado',
    },
    returnpage: {
      returntitle: 'Para devolver el cargador',
      returntext: 'Insértelo en una ranura y espere la confirmación',
      confirmationtext: 'Si no recibe una confirmación presione ligeramente el cargador devuelto',
    },
    returntypage: {
      return: 'Retorno completo',
      ty: '¡Gracias!',
    },
    paymentpage: {
      text: 'Para pagar utilice tu tarjeta de crédito',
      payterms: 'Acepta pagar todas las tarifas de alquiler para obtener más información consulte nuestros términos',
    },
    wait: 'Por favor espera...',
    thankyoupage: {
      thankyoutitle: '¡Gracias!',
      thankyoutext: 'Tome el cargador de la ranura',
      thankyoutext2: 'Conecte el cable a su dispositivo La carga comenzará automáticamente devuelva el cargador a cualquiera de nuestras ubicaciones',
    },
    receiptpage: {
      text: 'Para su recibo escanee el código QR',
    },
    termspage: {
      text1: 'Para consultar nuestros términos y condiciones de alquiler',
      text2: 'Por favor escanee este código QR',
    },
    errorpage: {
      text: 'Error de transacción, Inténtelo de nuevo',
    },
    declinedpage: {
      text: 'Tarjeta rechazada, Inténtelo de nuevo',
    },
    ooopage: {
      text: 'Fuera de servicio',
    },
    payter: {
      start: 'Presione ₭ para comenzar',
      takecharger: 'Toma el cargador',
      returned: 'Regresó',
      wait: 'Espere por favor',
      soldout: 'Agotado',
    },
    mapspage: {
      title: 'Escanee el código QR para',
      text: 'Ubicaciones de estaciones',
      text1: 'Indicaciones a pie',
      text2: 'Disponibilidad en tiempo real',
    },
    language: 'spanish',
  },
};

const LOCALE_META = {
  en: { code: 'en', name: 'English', urlLanguage: 'english' },
  fr: { code: 'fr', name: 'Français', urlLanguage: 'fr' },
  es: { code: 'es', name: 'Español', urlLanguage: 'spanish' },
};

const SUPPORT_PREFIX = {
  en: 'Need help? Please call:',
  fr: 'Besoin d’aide ? Veuillez appeler :',
  es: '¿Necesita ayuda? Llame al:',
};

const PRICING_COPY = {
  en: {
    plans: {
      PURCHASE_MIXED_DAILY: {
        within: '{amount} if returned within {hours} hours',
        sameDay: '{amount} if returned the same day',
        notReturned: '{amount} if not returned',
        deposit: 'A deposit of {amount} is collected when renting',
      },
      LEASE_SIMPLE_DAILY: {
        first: 'Free for the first 24 hours',
        additional: '{amount} for each additional 24-hour period',
        notReturned: '{amount} if not returned after {days} days',
        deposit: 'A deposit of {amount} is collected when renting',
      },
    },
    common: { integratedCables: 'Integrated cables', cableTypes: 'Lightning · USB-C · Micro-USB' },
    payment: {
      instructionsByGateway: {
        PAYTERP68: 'To pay, use a bank card or phone on the contactless terminal.',
        DEFAULT: 'Follow the instructions shown by the payment service.',
      },
      termsByGatewayOption: {
        FULLPRICE: [
          'I accept the {amount} deposit, applicable rental charges, and the Terms and Conditions.',
          'The deposit is refunded upon return, less applicable rental charges.',
        ],
        INITIALPRICE: [
          'I accept the applicable rental charges and the Terms and Conditions.',
          'The final charge depends on the rental duration.',
        ],
      },
    },
    unavailable: 'Pricing is unavailable. Please contact support.',
  },
  fr: {
    plans: {
      PURCHASE_MIXED_DAILY: {
        within: '{amount} si restituée sous {hours} h',
        sameDay: '{amount} si restituée dans la journée',
        notReturned: '{amount} si non restituée',
        deposit: 'Caution de {amount} prélevée à la location',
      },
      LEASE_SIMPLE_DAILY: {
        first: 'Gratuit pendant les premières 24 h',
        additional: '{amount} par période supplémentaire de 24 h',
        notReturned: '{amount} si non restituée après {days} jours',
        deposit: 'Caution de {amount} prélevée à la location',
      },
    },
    common: { integratedCables: 'Câbles intégrés', cableTypes: 'Lightning · USB-C · Micro-USB' },
    payment: {
      instructionsByGateway: {
        PAYTERP68: 'Pour payer, utilisez une carte bancaire ou un téléphone sur le terminal sans contact.',
        DEFAULT: 'Suivez les instructions affichées par le service de paiement.',
      },
      termsByGatewayOption: {
        FULLPRICE: [
          'J’accepte la caution de {amount}, les frais de location applicables et les Conditions Générales.',
          'Caution remboursée lors de la restitution, moins les frais de location applicables.',
        ],
        INITIALPRICE: [
          'J’accepte les frais de location applicables et les Conditions Générales.',
          'Le montant final dépend de la durée de location.',
        ],
      },
    },
    unavailable: 'Tarification indisponible. Veuillez contacter l’assistance.',
  },
  es: {
    plans: {
      PURCHASE_MIXED_DAILY: {
        within: '{amount} si se devuelve en un plazo de {hours} horas',
        sameDay: '{amount} si se devuelve el mismo día',
        notReturned: '{amount} si no se devuelve',
        deposit: 'Se cobra un depósito de {amount} al alquilar',
      },
      LEASE_SIMPLE_DAILY: {
        first: 'Gratis durante las primeras 24 horas',
        additional: '{amount} por cada período adicional de 24 horas',
        notReturned: '{amount} si no se devuelve después de {days} días',
        deposit: 'Se cobra un depósito de {amount} al alquilar',
      },
    },
    common: { integratedCables: 'Cables integrados', cableTypes: 'Lightning · USB-C · Micro-USB' },
    payment: {
      instructionsByGateway: {
        PAYTERP68: 'Para pagar, use una tarjeta bancaria o un teléfono en el terminal sin contacto.',
        DEFAULT: 'Siga las instrucciones mostradas por el servicio de pago.',
      },
      termsByGatewayOption: {
        FULLPRICE: [
          'Acepto el depósito de {amount}, los cargos de alquiler aplicables y las Condiciones Generales.',
          'El depósito se reembolsa al devolver el cargador, menos los cargos de alquiler aplicables.',
        ],
        INITIALPRICE: [
          'Acepto los cargos de alquiler aplicables y las Condiciones Generales.',
          'El cargo final depende de la duración del alquiler.',
        ],
      },
    },
    unavailable: 'La tarifa no está disponible. Comuníquese con soporte.',
  },
};

function legacyLocaleToV2(language, locale) {
  const source = language || {};
  const map = source.mapspage || {};
  return {
    meta: LOCALE_META[locale],
    support: { helpPrefix: SUPPORT_PREFIX[locale] },
    terminals: {
      PAYTERP68: {
        start: source.payter?.start || '',
        takeCharger: source.payter?.takecharger || '',
        returned: source.payter?.returned || '',
        wait: source.payter?.wait || '',
        soldOut: source.payter?.soldout || '',
      },
    },
    screens: {
      start: {
        startButton: source.startpage?.startbutton || '',
        termsButton: source.startpage?.termsbutton || '',
        languageButton: source.startpage?.languagebutton || '',
      },
      rentReturn: {
        question: source.rentpage?.infotext || '',
        rentButton: source.rentpage?.rentbutton || '',
        returnButton: source.rentpage?.returnbutton || '',
        soldOut: source.rentpage?.soldout || '',
      },
      howItWorks: {
        rentTitle: source.hiw?.renttitle || '',
        rentText: source.hiw?.renttext || '',
        chargeTitle: source.hiw?.chargetitle || '',
        chargeText: source.hiw?.chargetext || '',
        returnTitle: source.hiw?.returntitle || '',
        returnText: source.hiw?.returntext || '',
      },
      returnInfo: {
        title: source.returnpage?.returntitle || '',
        text: source.returnpage?.returntext || '',
        confirmation: source.returnpage?.confirmationtext || '',
      },
      rentalComplete: {
        title: source.thankyoupage?.thankyoutitle || '',
        text: source.thankyoupage?.thankyoutext || '',
        detail: source.thankyoupage?.thankyoutext2 || '',
      },
      returnComplete: {
        returnText: source.returntypage?.return || '',
        thankYou: source.returntypage?.ty || '',
        depositNotice: RETURN_COMPLETE_DEPOSIT_NOTICE[locale],
      },
      wait: { message: typeof source.wait === 'string' ? source.wait : '' },
      receipt: { message: source.receiptpage?.text || '' },
      error: { message: source.errorpage?.text || '' },
      declined: { message: source.declinedpage?.text || '' },
      outOfOrder: { message: source.ooopage?.text || '' },
      terms: { line1: source.termspage?.text1 || '', line2: source.termspage?.text2 || '' },
      map: {
        title: map.title || '',
        stationLocations: map.text || '',
        walkingDirections: map.text1 || map.text2 || '',
        liveAvailability: map.text3 || (map.text1 ? map.text2 : '') || '',
      },
    },
    pricing: PRICING_COPY[locale],
  };
}

export const DEFAULT_KIOSK_LANGUAGES_V2 = {
  schemaVersion: 2,
  defaultLocale: 'en',
  supportedLocales: ['en', 'fr', 'es'],
  support: {
    phoneByMarket: {
      EUR: '+33 1 89 71 17 16',
      US: '818.996.9991',
      CAN: '647.560.8200',
    },
  },
  locales: Object.fromEntries(
    KIOSK_PROFILE_LANGUAGES.map(({ key }) => [key, legacyLocaleToV2(DEFAULT_KIOSK_LANGUAGES[key], key)]),
  ),
};

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const merged = { ...base };
  Object.entries(override).forEach(([key, value]) => {
    merged[key] = isPlainObject(value) && isPlainObject(base[key])
      ? deepMerge(base[key], value)
      : value;
  });
  return merged;
}

export function cloneProfileValue(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

export function normalizeKioskLanguages(value) {
  const source = isPlainObject(value) ? value : {};
  if (isPlainObject(source.locales)) {
    return deepMerge(DEFAULT_KIOSK_LANGUAGES_V2, source);
  }

  const legacyLocales = Object.fromEntries(
    KIOSK_PROFILE_LANGUAGES.map(({ key }) => [
      key,
      legacyLocaleToV2(deepMerge(DEFAULT_KIOSK_LANGUAGES[key], source[key] || {}), key),
    ]),
  );

  return deepMerge(DEFAULT_KIOSK_LANGUAGES_V2, { locales: legacyLocales });
}

export function createDefaultKioskUiProfile(clientId = '') {
  const normalizedClientId = String(clientId || '').trim().toUpperCase();
  const profileId = normalizedClientId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return {
    id: profileId,
    name: normalizedClientId ? `${normalizedClientId} Kiosk UI` : 'Default Kiosk UI',
    clientId: normalizedClientId,
    status: 'draft',
    version: 1,
    admin: {
      userpassword: '',
      adminpassword: '',
    },
    ui: cloneProfileValue(DEFAULT_KIOSK_UI),
    languages: cloneProfileValue(DEFAULT_KIOSK_LANGUAGES_V2),
  };
}

export function resolveKioskUiSnapshot(profile) {
  const ui = deepMerge(DEFAULT_KIOSK_UI, profile?.ui || {});
  const languages = normalizeKioskLanguages(profile?.languages);
  const profileId = String(profile?.id || profile?.profileId || ui.profileId || '').trim();
  const profileVersion = Number(profile?.version || ui.profileVersion || 1);

  return {
    ...ui,
    profileId,
    profileName: String(profile?.name || ui.profileName || '').trim(),
    profileVersion: Number.isFinite(profileVersion) ? profileVersion : 1,
    languages: {
      ...languages,
      active: ui.languages?.active !== false,
    },
  };
}

export function flattenLanguageFields(value, prefix = '') {
  if (typeof value === 'string' || typeof value === 'number') {
    return [{ path: prefix, value: String(value ?? '') }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((child, index) => (
      flattenLanguageFields(child, prefix ? `${prefix}.${index}` : String(index))
    ));
  }

  if (!isPlainObject(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => (
    flattenLanguageFields(child, prefix ? `${prefix}.${key}` : key)
  ));
}

export function getNestedValue(source, path, fallback = '') {
  return String(path || '').split('.').reduce((current, key) => (
    current && Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined
  ), source) ?? fallback;
}

export function setNestedValue(source, path, value) {
  const next = cloneProfileValue(source);
  const keys = String(path || '').split('.').filter(Boolean);
  let cursor = next;

  keys.slice(0, -1).forEach((key, index) => {
    if (!isPlainObject(cursor[key]) && !Array.isArray(cursor[key])) {
      cursor[key] = /^\d+$/.test(keys[index + 1]) ? [] : {};
    }
    cursor = cursor[key];
  });

  if (keys.length > 0) {
    cursor[keys[keys.length - 1]] = value;
  }

  return next;
}

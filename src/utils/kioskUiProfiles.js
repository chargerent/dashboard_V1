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

export function createDefaultKioskUiProfile(clientId = '') {
  const normalizedClientId = String(clientId || '').trim().toUpperCase();
  return {
    id: '',
    name: normalizedClientId ? `${normalizedClientId} Default` : 'Default Kiosk UI',
    clientId: normalizedClientId,
    status: 'draft',
    version: 1,
    ui: cloneProfileValue(DEFAULT_KIOSK_UI),
    languages: cloneProfileValue(DEFAULT_KIOSK_LANGUAGES),
  };
}

export function resolveKioskUiSnapshot(profile) {
  const ui = deepMerge(DEFAULT_KIOSK_UI, profile?.ui || {});
  const languages = deepMerge(DEFAULT_KIOSK_LANGUAGES, profile?.languages || {});
  const profileId = String(profile?.id || profile?.profileId || ui.profileId || '').trim();
  const profileVersion = Number(profile?.version || ui.profileVersion || 1);

  return {
    ...ui,
    profileId,
    profileName: String(profile?.name || ui.profileName || '').trim(),
    profileVersion: Number.isFinite(profileVersion) ? profileVersion : 1,
    languages,
  };
}

export function flattenLanguageFields(value, prefix = '') {
  if (typeof value === 'string' || typeof value === 'number') {
    return [{ path: prefix, value: String(value ?? '') }];
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

  keys.slice(0, -1).forEach((key) => {
    if (!isPlainObject(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  });

  if (keys.length > 0) {
    cursor[keys[keys.length - 1]] = value;
  }

  return next;
}

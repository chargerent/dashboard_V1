// Canonical seed copied from the Apollo flow used by YYZ in the shared Canada
// Node-RED runtime. Keep this module dependency-free so both Functions and the
// dashboard editor use the exact same seed.
export const YYZ_APOLLO_PROFILE_TEMPLATE_META = {
  id: 'yyz-apollo-v1',
  source: 'YYZ Apollo flow (Canada Node-RED shared runtime)',
  verifiedAt: '2026-09-07',
};

// These are the named states exposed by the existing YYZ flow. A removable
// screen is presentation-only: its business event still runs and the Apollo
// bridge advances to the fallback screen. Core customer-action screens remain
// required so a profile cannot hide payment or return instructions.
export const YYZ_APOLLO_ESTABLISHED_SCREENS = [
  {key: 'startpage', label: 'Startpage', displayLabel: 'Start', removable: false},
  {key: 'rentpage', label: 'Rentpage', displayLabel: 'Rent or return', removable: false},
  {key: 'availabilitypage', label: 'Availabilitypage', displayLabel: 'Availability', removable: false},
  {key: 'paymentpage', label: 'Paymentpage', displayLabel: 'Payment', removable: false},
  {key: 'thankyoupage', label: 'Thankyoupage', displayLabel: 'Rental complete', removable: true, removeFallback: 'startpage'},
  {key: 'ejectpage', label: 'Ejectpage', displayLabel: 'Dispensing', removable: false},
  {key: 'returnpage', label: 'Returnpage', displayLabel: 'Return instructions', removable: false},
  {key: 'returntypage', label: 'Returntypage', displayLabel: 'Return complete', removable: true, removeFallback: 'startpage'},
  {key: 'soldoutpage', label: 'Soldoutpage', displayLabel: 'Sold out', removable: true, removeFallback: 'startpage'},
  {key: 'canceledpage', label: 'Canceledpage', displayLabel: 'Canceled', removable: true, removeFallback: 'startpage'},
  {key: 'languagepage', label: 'Languagepage', displayLabel: 'Language', removable: true, removeFallback: 'startpage'},
  {key: 'nocardpage', label: 'Nocardpage', displayLabel: 'No card', removable: true, removeFallback: 'paymentpage'},
  {key: 'offlinemodepage', label: 'Offlinemodepage', displayLabel: 'Offline mode', removable: true, removeFallback: 'startpage'},
];

export const YYZ_APOLLO_TRANSLATIONS = {
  en: {
    availabilitypage: {subtitle: 'Checking availability', title: 'Please wait'},
    ejectpage: {subtitle: 'Dispensing charger', title: 'Please wait'},
    paymentpage: {subtitle: 'Authorization only', title: 'Tap%20your%20card'},
    rentpage: {cancel: 'Cancel', infotext: 'Select', rentbutton: 'Rent', returnbutton: 'Return'},
    returnpage: {returntext: 'Insert the charger into a slot and wait for confirmation', returntitle: 'To return'},
    returntypage: {modulelabel: 'Module', message: 'Return accepted', slotlabel: 'Slot', title: 'Thank you'},
    soldoutpage: {subtitle: 'No available chargers', title: 'Soldout'},
    canceledpage: {subtitle: 'Transaction canceled', title: 'Machine error'},
    startpage: {startbutton: 'Start', subtitle: 'Press start', title: 'Welcome'},
    thankyoupage: {message: 'Remove it from the kiosk', modulelabel: 'Module', slotlabel: 'Slot', title: 'Take your charger'},
    offlinemodepage: {message: 'Approved', title: 'Thank you'},
    nocardpage: {subtitle: 'Please try again', title: 'No QR scanned'},
    languagepage: {en: 'English', fr: 'French', es: 'Spanish'},
  },
  es: {
    availabilitypage: {subtitle: 'Comprobando disponibilidad', title: 'Por favor espera'},
    ejectpage: {subtitle: 'Expulsar el cargador', title: 'Por favor espera'},
    paymentpage: {subtitle: 'Solo autorización', title: 'Toque%20su%20tarjeta'},
    rentpage: {cancel: 'Cancelar', infotext: 'Seleccionar', rentbutton: 'Alquilar', returnbutton: 'Regresar'},
    returnpage: {returntext: 'Insértelo en una ranura y espere la confirmación', returntitle: 'Para devolver'},
    returntypage: {modulelabel: 'Módulo', message: 'Devolución aceptada', slotlabel: 'Ranura', title: 'Gracias'},
    soldoutpage: {subtitle: 'No hay cargadores disponibles', title: 'Agotado'},
    canceledpage: {subtitle: 'Transacción cancelada', title: 'Error de la máquina'},
    startpage: {startbutton: 'Comienzo', subtitle: 'Presione comienzo', title: 'Bienvenido'},
    thankyoupage: {message: 'Retírelo del quiosco', modulelabel: 'Módulo', slotlabel: 'Ranura', title: 'Retire su cargador'},
    offlinemodepage: {message: 'Aprobado', title: 'Gracias'},
    nocardpage: {subtitle: 'Inténtalo de nuevo', title: 'No se escaneó ningún QR'},
    languagepage: {en: 'Inglés', fr: 'Francés', es: 'Español'},
  },
  fr: {
    availabilitypage: {subtitle: 'Vérification de la disponibilité', title: 'Veuillez patienter'},
    ejectpage: {subtitle: 'Ejecting charger', title: 'Please wait'},
    paymentpage: {subtitle: 'Autorisation%20uniquement', title: 'Approchez%20votre%20carte'},
    rentpage: {cancel: 'Annuler', infotext: 'Sélectionner', rentbutton: 'Louer', returnbutton: 'Restituer'},
    returnpage: {returntext: 'Insérez le chargeur dans une fente vide et attendez la confirmation', returntitle: 'Pour retourner'},
    returntypage: {modulelabel: 'Module', message: 'Retour accepté', slotlabel: 'Fente', title: 'Merci'},
    soldoutpage: {subtitle: 'Aucun chargeur disponible', title: 'Stock épuisé'},
    canceledpage: {subtitle: 'Transaction annulée', title: 'Erreur de machine'},
    startpage: {startbutton: 'Commencer', subtitle: 'Appuyez sur Commencer', title: 'Bienvenu'},
    thankyoupage: {message: 'Retirez-le de la borne', modulelabel: 'Module', slotlabel: 'Fente', title: 'Prenez votre chargeur'},
    offlinemodepage: {message: 'Approuvé', title: 'Merci'},
    nocardpage: {subtitle: 'Veuillez réessayer', title: 'Aucun QR numérisé'},
    languagepage: {en: 'Anglais', fr: 'Français', es: 'Espagnol'},
  },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export function normalizeApolloClientId(value) {
  return String(value || '').trim().toUpperCase().slice(0, 120);
}

export function apolloClientProfileId(clientId) {
  return normalizeApolloClientId(clientId)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function createYyzApolloProfileSection() {
  return {
    template: clone(YYZ_APOLLO_PROFILE_TEMPLATE_META),
    translations: clone(YYZ_APOLLO_TRANSLATIONS),
    screenFlow: {version: 1, entryScreenId: '', screens: [], removedEstablishedScreenIds: []},
    qr: {
      enabled: false,
      provider: 'chargerent-issued',
      promptTitle: 'Borrow a charger',
      promptMessage: 'Scan your QR code',
    },
  };
}

export function createYyzApolloClientProfile(clientId, timestamp, actor = 'system:apollo-provisioning') {
  const normalizedClientId = normalizeApolloClientId(clientId);
  if (!normalizedClientId) throw new Error('Apollo client is required.');
  return {
    name: `${normalizedClientId} Kiosk UI`,
    clientId: normalizedClientId,
    status: 'draft',
    version: 1,
    admin: {userpassword: '', adminpassword: ''},
    ui: {},
    languages: {},
    terminalProfiles: {apollo: createYyzApolloProfileSection()},
    sectionVersions: {apollo: 1},
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedByUid: '',
    updatedByUsername: actor,
  };
}

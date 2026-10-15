// Shared customer UI contract. Monetary amounts and checkout decisions are never configured here.
export const STRIPE_UI_LANGUAGES = [{key:'en',label:'English'},{key:'fr',label:'French'},{key:'es',label:'Spanish'}];
export const STRIPE_UI_COLORS = [
  ['background','Panel background'],['surface','Secondary button background'],['primary','Primary button'],['secondary','Secondary button text'],
  ['text','Main text'],['muted','Supporting text'],['buttonText','Primary button text'],['danger','Error text'],
].map(([key,label])=>({key,label}));
const common = {
  brand:['Brand','chargerent','chargerent','chargerent'],
  terminalConnected:['Connected terminal icon label','Payment terminal connected','Terminal de paiement connecté','Terminal de pago conectado'],
  terminalUnavailable:['Unavailable terminal icon label','Payment terminal unavailable','Terminal de paiement indisponible','Terminal de pago no disponible'],
  language:['Language selector','Language','Langue','Idioma'],
  start:['Start button','Start','Commencer','Comenzar'],
  information:['Information button','How it works','Comment ça marche','Cómo funciona'],
  map:['Map button','Station map','Carte des stations','Mapa de estaciones'],
  termsButton:['Terms button','Rental terms','Conditions de location','Condiciones de alquiler'],
  receipt:['Receipt button','Receipt','Reçu','Recibo'],
  receiptScan:['Receipt QR caption','Scan for your receipt','Scannez pour obtenir votre reçu','Escanea para obtener tu recibo'],
  receiptPending:['Receipt generating message','Generating receipt…','Génération du reçu…','Generando recibo…'],
  helpTitle:['Help QR heading','Need help?','Besoin d’aide ?','¿Necesitas ayuda?'],
  helpTermsTitle:['Combined help and terms QR heading','Help & terms','Aide et conditions','Ayuda y condiciones'],
  helpScan:['Help QR instruction','Scan me!','Scannez-moi !','¡Escanéame!'],
  support:['Help QR caption','Scan to text Chargerent support.','Scannez pour envoyer un SMS au support Chargerent.','Escanea para enviar un mensaje de texto al soporte de Chargerent.'],
  linkUnavailable:['Link unavailable','This link is unavailable. Scan the help QR code.','Ce lien est indisponible. Scannez le code QR d’aide.','Este enlace no está disponible. Escanea el código QR de ayuda.'],
  mockQr:['QR code label','Scan QR code','Scannez le code QR','Escanea el código QR'],
  openLink:['Show QR code button','Show QR code','Afficher le code QR','Mostrar código QR'],
  'information.rentTitle':['Rent instruction title','Check out','Emprunter','Retirar'],
  'information.rentBody':['Rent instruction','Scan the QR code to borrow a charger.','Scannez le code QR pour prendre un chargeur.','Escanea el código QR para tomar un cargador.'],
  'information.cardTitle':['Card gateway instruction title','Use a credit card','Utilisez une carte bancaire','Usa una tarjeta'],
  'information.cardBody':['Card gateway instruction','Tap or insert your card.','Présentez ou insérez votre carte.','Acerca o inserta tu tarjeta.'],
  'information.scannerTitle':['Scanner gateway instruction title','Scan barcode','Scannez le code-barres','Escanea el código de barras'],
  'information.scannerBody':['Scanner gateway instruction','Scan your barcode.','Scannez votre code-barres.','Escanea tu código de barras.'],
  'information.phoneTitle':['Phone gateway instruction title','Validate phone number','Validez votre numéro','Valida tu número'],
  'information.phoneBody':['Phone gateway instruction','Enter and verify your number.','Saisissez et vérifiez votre numéro.','Introduce y verifica tu número.'],
  'information.chargeTitle':['Charge instruction title','Charge Your Phone','Rechargez votre téléphone','Carga tu teléfono'],
  'information.chargeBody':['Charge instruction','Take the power bank and charge your phone anywhere.','Emportez la batterie et rechargez votre téléphone partout.','Lleva la batería y carga tu teléfono donde quieras.'],
  'information.returnTitle':['Return instruction title','Return','Rendre','Devolver'],
  'information.returnBody':['Return instruction','Return it to any station when done.','Rendez-le à une station quand vous avez terminé.','Devuélvelo en una estación cuando termines.'],
  rent:['Rent button','Rent a charger','Louer un chargeur','Alquilar un cargador'],
  return:['Return button','Return a charger','Rendre un chargeur','Devolver un cargador'],
  availability:['Charger availability','{available} chargers available','{available} chargeurs disponibles','{available} cargadores disponibles'],
  availabilityUnavailable:['Availability unavailable','Charger availability is currently unavailable.','Impossible de vérifier la disponibilité des chargeurs pour le moment.','No se puede consultar la disponibilidad de cargadores en este momento.'],
  tap:['Tap card button','Tap card','Présenter la carte','Acercar tarjeta'],
  insert:['Insert card button','Insert card','Insérer la carte','Insertar tarjeta'],
  demoTap:['Demo tap button','Fake tap','Faux paiement','Simular tarjeta'],
  demoScan:['Demo scan button','Fake scan','Faux scan','Simular escaneo'],
  demoNotice:['Demo payment message','Choose a fake tap or scan. No card will be charged.','Choisissez un faux paiement ou scan. Aucune carte ne sera débitée.','Elige una tarjeta o escaneo simulado. No se cobrará ninguna tarjeta.'],
  continue:['Continue button','Continue','Continuer','Continuar'],
  back:['Back button','Back','Retour','Atrás'],
  cancel:['Cancel button','Cancel','Annuler','Cancelar'],
  done:['Done button','Done','Terminé','Listo'],
  retry:['Try again button','Start again','Recommencer','Volver a empezar'],
  consent:['Rental consent','I agree to the rental terms','J’accepte les conditions de location','Acepto las condiciones de alquiler'],
  terms:['Rental terms','Review the rental terms before continuing.','Consultez les conditions de location avant de continuer.','Consulta las condiciones de alquiler antes de continuar.'],
  pricing:['Price summary','{deposit} deposit · {fee} rental fee · {refund} refund on return','Caution : {deposit} · Location : {fee} · Remboursement au retour : {refund}','Depósito: {deposit} · Alquiler: {fee} · Reembolso al devolver: {refund}'],
  eventBorrowTitle:['Event card payment heading','Tap your card to borrow.','Présentez votre carte pour emprunter.','Acerca tu tarjeta para tomar una batería.'],
  touchBorrowTitle:['No-touch card payment heading','Tap your card on the reader below to borrow.','Présentez votre carte au lecteur ci-dessous pour emprunter.','Acerca tu tarjeta al lector de abajo para tomar una batería.'],
  eventFreeDay:['Event free-day pricing','Free if returned by end of day.','Gratuit si rendu avant la fin de la journée.','Gratis si se devuelve antes de que termine el día.'],
  eventLateDay:['Event day-end charge','{eventCharge} if not returned by end of day.','{eventCharge} si non rendu avant la fin de la journée.','{eventCharge} si no se devuelve antes de que termine el día.'],
  eventLateDays:['Event configured overdue charge','{eventCharge} if not returned after {overdueDays} days.','{eventCharge} si non rendu après {overdueDays} jours.','{eventCharge} si no se devuelve después de {overdueDays} días.'],
  eventNotReturned:['Event not-returned charge','{eventCharge} if not returned.','{eventCharge} si non rendu.','{eventCharge} si no se devuelve.'],
  touchConsent:["Direct tap consent", "By tapping your card, you agree to the rental terms.", "En présentant votre carte, vous acceptez les conditions de location.", "Al acercar tu tarjeta, aceptas las condiciones de alquiler."],
  returnAnySlot:["Return to any available slot", "Return your charger to any available slot.", "Rendez votre batterie dans un compartiment vide.", "Devuelve tu batería en cualquier compartimento vacío."],
  returnConfirmationHint:['Return confirmation instruction','Insert fully and wait for on-screen confirmation.','Insérez-la complètement et attendez la confirmation à l’écran.','Insértala completamente y espera la confirmación en pantalla.'],
  touchHold:['Direct tap card hold','{deposit} temporary card hold.','Empreinte bancaire temporaire de {deposit}.','Retención temporal de {deposit} en tu tarjeta.'],
  touchUpfrontPayment:['Direct tap upfront payment','{deposit} upfront payment.','Paiement initial de {deposit}.','Pago inicial de {deposit}.'],
  readerReady:['Reader ready','Reader ready · {available} chargers available','Lecteur prêt · {available} chargeurs disponibles','Lector listo · {available} cargadores disponibles'],
  readerUnavailable:['Reader unavailable','The card reader is unavailable. Scan the help QR code.','Le lecteur de carte est indisponible. Scannez le code QR d’aide.','El lector de tarjetas no está disponible. Escanea el código QR de ayuda.'],
  connecting:['Connecting','Connecting to the card reader…','Connexion au lecteur de carte…','Conectando al lector de tarjetas…'],
  readerUpdating:['Reader updating','Updating the card reader. Keep it powered and nearby.','Mise à jour du lecteur de carte. Gardez-le allumé et à proximité.','Actualizando el lector de tarjetas. Mantenlo encendido y cerca.'],
  connectionLost:['Connection lost','Connection lost. Your rental will recover when the connection returns.','Connexion interrompue. Votre location reprendra au rétablissement de la connexion.','Conexión perdida. Tu alquiler se recuperará cuando vuelva la conexión.'],
  unavailable:['Rental unavailable','Rentals are temporarily unavailable. Scan the help QR code.','Les locations sont temporairement indisponibles. Scannez le code QR d’aide.','Los alquileres no están disponibles temporalmente. Escanea el código QR de ayuda.'],
  starting:['Starting checkout','Starting…','Démarrage…','Iniciando…'],
  waitingSlot:['Waiting for slot','Waiting for the charger slot…','En attente de l’ouverture du compartiment…','Esperando la apertura del compartimento…'],
  settlementRefunded:['Refund confirmed','{refund} refunded · {fee} rental fee','{refund} remboursés · Location : {fee}','Reembolso: {refund} · Alquiler: {fee}'],
  settlementVoided:['Authorization released','Payment authorization released.','Autorisation de paiement annulée.','Autorización de pago anulada.'],
  settlementCaptured:['Payment completed','Payment completed.','Paiement effectué.','Pago completado.'],
  settlementAuthorized:['Payment authorized','Payment authorized; waiting for release.','Paiement autorisé ; en attente de la remise du chargeur.','Pago autorizado; esperando la entrega del cargador.'],
  returnConfirmed:['Return confirmed','Return confirmed. Your rental is complete.','Retour confirmé. Votre location est terminée.','Devolución confirmada. Tu alquiler ha finalizado.'],
  returnSlot:['Returned slot','Returned to slot {slot}','Rendu dans le compartiment {slot}','Devuelto en el compartimento {slot}'],
  errorGeneric:['Checkout error','We could not complete that request. Try again or scan the help QR code.','La demande n’a pas pu aboutir. Réessayez ou scannez le code QR d’aide.','No se ha podido completar la solicitud. Inténtalo de nuevo o escanea el código QR de ayuda.'],
  offerChanged:['Price changed','The rental details changed. Please review the current price and terms.','Les détails de location ont changé. Vérifiez le tarif et les conditions actuels.','Los detalles del alquiler han cambiado. Revisa el precio y las condiciones actuales.'],
  returnPending:['Return pending','Waiting for the kiosk to confirm your return.','En attente de confirmation du retour par la borne.','Esperando a que el quiosco confirme la devolución.'],
  'popup.success':['Charger released popup','Take your charger from slot {slot}.','Prenez votre chargeur dans le compartiment {slot}.','Recoge tu cargador del compartimento {slot}.'],
  'popup.return':['Charger returned popup','Charger returned. Thank you!','Chargeur rendu. Merci !','Cargador devuelto. ¡Gracias!'],
  'popup.failure':['Release failed popup','Unable to release a charger. Scan the help QR code on the rental screen.','Impossible de remettre un chargeur. Scannez le code QR d’aide sur l’écran de location.','No se ha podido entregar un cargador. Escanea el código QR de ayuda en la pantalla de alquiler.'],
};
const legacyHowItWorks = {
  en:{'information.rentTitle':'Rent','information.rentBody':'Choose Rent a charger, review the price and use the card reader.','information.chargeTitle':'Charge','information.chargeBody':'Take the released charger and connect it to your device.','information.returnBody':'Insert your charger fully into an empty slot and wait for confirmation.'},
  fr:{'information.rentTitle':'Louer','information.rentBody':'Choisissez Louer un chargeur, vérifiez le tarif et utilisez le lecteur de carte.','information.chargeTitle':'Recharger','information.chargeBody':'Prenez le chargeur remis et branchez-le à votre appareil.','information.returnBody':'Insérez complètement le chargeur dans un compartiment vide et attendez la confirmation.'},
  es:{'information.rentTitle':'Alquilar','information.rentBody':'Elige Alquilar un cargador, revisa el precio y utiliza el lector de tarjetas.','information.chargeTitle':'Cargar','information.chargeBody':'Recoge el cargador entregado y conéctalo a tu dispositivo.','information.returnBody':'Introduce el cargador completamente en un compartimento vacío y espera la confirmación.'},
};
const previousHowItWorks = {
  en:{'information.rentBody':'Guests scan the QR code to borrow a charger. You choose whether they use a credit card, phone number, or no verification at all.','information.chargeBody':'Guests carry the charger and connect with USB-C or Lightning.','information.returnBody':'When finished, they return the charger to the station.'},
  fr:{'information.rentBody':'Les invités scannent le code QR pour emprunter un chargeur. Vous choisissez s’ils utilisent une carte bancaire, un numéro de téléphone ou aucune vérification.','information.chargeBody':'Les invités emportent le chargeur et le connectent en USB-C ou Lightning.','information.returnBody':'Lorsqu’ils ont terminé, ils rapportent le chargeur à la station.'},
  es:{'information.rentBody':'Los invitados escanean el código QR para tomar prestado un cargador. Tú eliges si usan una tarjeta de crédito, un número de teléfono o ninguna verificación.','information.chargeBody':'Los invitados llevan el cargador y lo conectan mediante USB-C o Lightning.','information.returnBody':'Cuando terminan, devuelven el cargador a la estación.'},
};
const previousChargeCopy={
  en:{'information.chargeTitle':'Charge on the go','information.chargeBody':'Plug in with USB-C or Lightning.'},
  fr:{'information.chargeTitle':'Rechargez où que vous alliez','information.chargeBody':'Branchez-le en USB-C ou Lightning.'},
  es:{'information.chargeTitle':'Carga donde vayas','information.chargeBody':'Conéctalo por USB-C o Lightning.'},
};
const legacyCheckoutCopy = {touchConsent:'By tapping, you accept the rental terms.',returnAnySlot:'Return your charger to any empty slot.',returnConfirmationHint:'Insert it fully and wait for confirmation on this screen.'};
const legacyUtilityCopy = {
  en:{mockQr:'Sample QR code · link coming soon','terms.body':'Scan the QR code to read our rental terms and conditions.','map.body':'Scan the QR code to see station locations.'},
  fr:{mockQr:'Exemple de code QR · lien bientôt disponible','terms.body':'Scannez le code QR pour consulter nos conditions de location.','map.body':'Scannez le code QR pour voir les emplacements des stations.'},
  es:{mockQr:'Código QR de muestra · enlace disponible próximamente','terms.body':'Escanea el código QR para consultar nuestras condiciones de alquiler.','map.body':'Escanea el código QR para ver las ubicaciones de las estaciones.'},
};
const legacyStaffHelp = {
  en:{support:'Need help? Please ask a staff member.',linkUnavailable:'This link is not available yet. Please ask a staff member.',readerUnavailable:'The card reader is unavailable. Please ask a staff member.',unavailable:'Rentals are temporarily unavailable. Please ask a staff member.',errorGeneric:'We could not complete that request. Please try again or ask a staff member.','popup.failure':'Unable to release a charger. Please ask a staff member.','out_of_order.body':'Rentals are temporarily unavailable. Please ask a staff member.','failed.body':'No release was confirmed. Please ask a staff member before trying again.'},
  fr:{support:'Besoin d’aide ? Adressez-vous au personnel.',linkUnavailable:'Ce lien n’est pas encore disponible. Adressez-vous au personnel.',readerUnavailable:'Le lecteur de carte est indisponible. Adressez-vous au personnel.',unavailable:'Les locations sont temporairement indisponibles. Adressez-vous au personnel.',errorGeneric:'La demande n’a pas pu aboutir. Réessayez ou adressez-vous au personnel.','popup.failure':'Impossible de remettre un chargeur. Adressez-vous au personnel.','out_of_order.body':'Les locations sont temporairement indisponibles. Adressez-vous au personnel.','failed.body':'La remise du chargeur n’a pas été confirmée. Adressez-vous au personnel avant de réessayer.'},
  es:{support:'¿Necesitas ayuda? Consulta al personal.',linkUnavailable:'Este enlace aún no está disponible. Consulta al personal.',readerUnavailable:'El lector de tarjetas no está disponible. Consulta al personal.',unavailable:'Los alquileres no están disponibles temporalmente. Consulta al personal.',errorGeneric:'No se ha podido completar la solicitud. Inténtalo de nuevo o consulta al personal.','popup.failure':'No se ha podido entregar un cargador. Consulta al personal.','out_of_order.body':'Los alquileres no están disponibles temporalmente. Consulta al personal.','failed.body':'No se ha confirmado la entrega. Consulta al personal antes de volver a intentarlo.'},
};
const legacyReturnedBodies = {
  en:'Return confirmed. Any refund will appear after settlement is confirmed.',
  fr:'Retour confirmé. Le remboursement apparaîtra après confirmation du règlement.',
  es:'Devolución confirmada. El reembolso aparecerá cuando se confirme la liquidación.',
};
const stages = {
  sold_out:["Sold out", "Rupture de stock", "Agotado", "No charged power banks are available to rent.", "Aucune batterie chargée n’est disponible à la location.", "No hay baterías cargadas disponibles para alquilar."],
  touch_ready:["Tap your card to rent", "Présentez votre carte pour louer", "Acerca tu tarjeta para alquilar", "Use the card reader below the screen. Your charger will release after payment approval.", "Utilisez le lecteur sous l’écran. Votre batterie sera remise après validation du paiement.", "Usa el lector debajo de la pantalla. La batería se entregará tras aprobarse el pago."],
  start:['Stay charged','Restez connecté','Mantén la carga','Rent a portable charger here.','Louez un chargeur portable ici.','Alquila un cargador portátil aquí.'],
  information:['How it works','Comment ça marche','Cómo funciona','Rent, charge and return in three simple steps.','Louez, rechargez et rendez en trois étapes simples.','Alquila, carga y devuelve en tres sencillos pasos.'],
  terms:['Rental terms','Conditions de location','Condiciones de alquiler','Scan the QR code to read rental terms.','Scannez le code QR pour consulter les conditions de location.','Escanea el código QR para consultar las condiciones de alquiler.'],
  map:['Find a station','Trouver une station','Encuentra una estación','Scan the QR code to locate nearby stations.','Scannez le code QR pour trouver les stations à proximité.','Escanea el código QR para localizar estaciones cercanas.'],
  receipt:['Your receipt','Votre reçu','Tu recibo','Scan the QR code to look up your rental receipt.','Scannez le code QR pour retrouver votre reçu de location.','Escanea el código QR para buscar tu recibo de alquiler.'],
  out_of_order:['Temporarily unavailable','Temporairement indisponible','Temporalmente fuera de servicio','Rentals are temporarily unavailable. Scan the help QR code.','Les locations sont temporairement indisponibles. Scannez le code QR d’aide.','Los alquileres no están disponibles temporalmente. Escanea el código QR de ayuda.'],
  loading:['Getting this kiosk ready','Préparation de la borne','Preparando este quiosco','Checking the reader and charger availability…','Vérification du lecteur et des chargeurs disponibles…','Comprobando el lector y los cargadores disponibles…'],
  ready:['Rent a portable charger','Louez un chargeur portable','Alquila un cargador portátil','Stay charged wherever you go.','Restez connecté partout où vous allez.','Mantén tus dispositivos cargados donde vayas.'],
  review:['Review your rental','Vérifiez votre location','Revisa tu alquiler','Review the price and rental terms before continuing.','Vérifiez le tarif et les conditions de location avant de continuer.','Revisa el precio y las condiciones de alquiler antes de continuar.'],
  waiting_for_card:['Tap or insert a card','Présentez ou insérez votre carte','Acerca o inserta una tarjeta','{deposit} deposit. Use the card reader below the screen.','Caution : {deposit}. Utilisez le lecteur de carte sous l’écran.','Depósito: {deposit}. Utiliza el lector de tarjetas debajo de la pantalla.'],
  authorizing:['Checking your payment','Vérification du paiement','Comprobando tu pago','Please wait while your payment is authorized.','Veuillez patienter pendant l’autorisation du paiement.','Espera mientras se autoriza tu pago.'],
  dispensing:['Releasing your charger','Remise de votre chargeur','Entregando tu cargador','Please wait for the kiosk to confirm your charger was released.','Veuillez attendre la confirmation de la remise du chargeur.','Espera a que el quiosco confirme la entrega de tu cargador.'],
  succeeded:['Take your charger · Slot {slot}','Prenez votre chargeur · Compartiment {slot}','Recoge tu cargador · Compartimento {slot}','Your charger is ready. Keep it until you are ready to return it.','Votre chargeur est prêt. Gardez-le jusqu’à ce que vous souhaitiez le rendre.','Tu cargador está listo. Consérvalo hasta que quieras devolverlo.'],
  declined:['Your card was declined','Votre carte a été refusée','Tu tarjeta fue rechazada','No payment was captured. You can start again.','Aucun paiement n’a été encaissé. Vous pouvez recommencer.','No se ha cobrado ningún pago. Puedes volver a empezar.'],
  cancelled:['Rental cancelled','Location annulée','Alquiler cancelado','Your checkout has been cancelled.','Votre demande de location a été annulée.','Se ha cancelado tu solicitud de alquiler.'],
  failed:['Charger was not released','Le chargeur n’a pas été remis','No se ha entregado el cargador','No release was confirmed. Scan the help QR code before trying again.','La remise du chargeur n’a pas été confirmée. Scannez le code QR d’aide avant de réessayer.','No se ha confirmado la entrega. Escanea el código QR de ayuda antes de volver a intentarlo.'],
  recovering:['Checking your checkout','Vérification de votre location','Comprobando tu alquiler','Restoring your existing checkout. Please wait before starting another rental.','Récupération de votre location en cours. Veuillez patienter avant d’en commencer une autre.','Recuperando tu alquiler actual. Espera antes de iniciar otro.'],
  returning:['Return your charger','Rendez votre chargeur','Devuelve tu cargador','Insert your charger fully into an empty slot.','Insérez complètement votre chargeur dans un compartiment vide.','Introduce el cargador completamente en un compartimento vacío.'],
  returned:['Charger returned · Thank you','Chargeur rendu · Merci','Cargador devuelto · Gracias','Your return is complete.','Votre retour est terminé.','Tu devolución ha finalizado.'],
};
export const STRIPE_UI_FIELDS = [
  ...Object.entries(common).map(([key,[label]])=>({key,label,section:'General'})),
  ...Object.keys(stages).flatMap(key=>[{key:`${key}.title`,label:'Title',section:key},{key:`${key}.body`,label:'Message',section:key}]),
];
export const CARD_OPACITY_DEFAULT_PERCENT=92;
export const SCREEN_TIMEOUT_DEFAULT_SECONDS=45;
export const SCREEN_TIMEOUT_MIN_SECONDS=10;
export const SCREEN_TIMEOUT_MAX_SECONDS=120;

export const RENT_RETURN_PLANS = [
  ['EVENT_SIMPLE','Event Simple'], ['PURCHASE_SIMPLE_DAILY','Purchase · Simple daily'],
  ['PURCHASE_MIXED_DAILY','Purchase · Mixed daily'], ['PURCHASE_SIMPLE_24_HRS','Purchase · 24 hours'],
  ['PURCHASE_MIXED_DAY','Purchase · Mixed day'], ['LEASE_SIMPLE_DAILY','Lease · Simple daily'],
  ['LEASE_MIXED_DAILY','Lease · Mixed daily'],
].map(([key,label])=>({key,label}));
export const RENT_RETURN_TEXT_KEYS = ['ready.title','ready.body','rent','return','cancel','map','termsButton','information','helpTitle','helpTermsTitle','helpScan',
  'touchBorrowTitle','eventFreeDay','eventLateDay','eventLateDays','eventNotReturned','returnAnySlot','returnConfirmationHint',
  'touchConsent','touchHold','touchUpfrontPayment','pricing'];
// Preserve legacy hold fields in saved profiles; the no-touch footer shows consent.
export function directTapFooterKeys(gatewayOption) {
  return [...(gatewayOption==='INITIALPRICE'?['touchUpfrontPayment']:[]),'touchConsent'];
}

export const rentReturnPlanCode = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_');
export function rentReturnOverrides(profile, language, planCode, touch=true) {
  const locales=profile?.rentReturn?.[rentReturnPlanCode(planCode)]?.[touch?'touch':'noTouch'];
  // A missing translation inherits the shared copy in that language.
  return locales?.[resolveStripeLanguage(profile,language)] || {};
}
export function stripeRentReturnText(profile,language,key,planCode,touch,values={}) {
  const override=rentReturnOverrides(profile,language,planCode,touch)[key];
  if(override===undefined)return stripeText(profile,language,key,values);
  return override.replace(/\{(deposit|fee|refund|slot|available|eventCharge|overdueDays|rateSummary)\}/g,(match,name)=>values[name]===undefined?match:String(values[name]));
}

export function defaultStripeUi() {
  const locales={};
  STRIPE_UI_LANGUAGES.forEach(({key},i)=>{
    locales[key]=Object.fromEntries(Object.entries(common).map(([field,values])=>[field,values[i+1]]));
    Object.entries(stages).forEach(([stage,values])=>{locales[key][`${stage}.title`]=values[i];locales[key][`${stage}.body`]=values[i+3];});
  });
  return {schemaVersion:1,bootWifiSetup:false,cardOpacityPercent:CARD_OPACITY_DEFAULT_PERCENT,screenTimeoutSeconds:SCREEN_TIMEOUT_DEFAULT_SECONDS,defaultLanguage:'en',enabledLanguages:['en','fr','es'],navigation:{language:true,information:true,terms:true,map:true,receipt:false},links:{terms:'',map:'',receipt:'',help:''},theme:{background:'#f6f9f4',surface:'#e2ebdf',primary:'#143c2d',secondary:'#143c2d',text:'#143c2d',muted:'#426354',buttonText:'#ffffff',danger:'#943925'},locales,pages:[]};
}
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const reject=message=>{throw Object.assign(new Error(message),{status:400,code:'INVALID_STRIPE_UI'});};
const known=(value,keys,label)=>{if(!plain(value))reject(`${label} must be an object.`);if(Object.keys(value).some(key=>!keys.includes(key)))reject(`${label} has an unsupported field.`);};
// eslint-disable-next-line no-control-regex
const textValue=(value,label,max=2000)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))reject(`${label} must be text of at most ${max} characters.`);return value;};
export function validateStripeUi(input) {
  const result=defaultStripeUi();
  known(input,['schemaVersion','bootWifiSetup','cardOpacityPercent','screenTimeoutSeconds','defaultLanguage','enabledLanguages','navigation','links','theme','locales','pages','rentReturn'],'Stripe UI');
  if(input.bootWifiSetup!==undefined){
    if(typeof input.bootWifiSetup!=='boolean')reject('Boot Wi-Fi setup must be enabled or disabled.');
    result.bootWifiSetup=input.bootWifiSetup;
  }
  if(input.schemaVersion!==1)reject('Unsupported Stripe UI version.');
  if(input.screenTimeoutSeconds!==undefined){
    if(!Number.isInteger(input.screenTimeoutSeconds) || input.screenTimeoutSeconds<SCREEN_TIMEOUT_MIN_SECONDS || input.screenTimeoutSeconds>SCREEN_TIMEOUT_MAX_SECONDS)reject('Screen timeout must be a whole number from 10 to 120 seconds.');
    result.screenTimeoutSeconds=input.screenTimeoutSeconds;
  }
  if(input.cardOpacityPercent!==undefined){
    if(!Number.isInteger(input.cardOpacityPercent) || input.cardOpacityPercent<0 || input.cardOpacityPercent>100)reject('Card opacity must be a whole number from 0 to 100 percent.');
    result.cardOpacityPercent=input.cardOpacityPercent;
  }
  const languages=STRIPE_UI_LANGUAGES.map(({key})=>key);
  if(input.rentReturn!==undefined){
    known(input.rentReturn,RENT_RETURN_PLANS.map(({key})=>key),'Rent / Return pricing');
    result.rentReturn={};
    for(const [plan,modes] of Object.entries(input.rentReturn)){
      known(modes,['touch','noTouch'],`${plan} screen modes`);result.rentReturn[plan]={};
      for(const [mode,locales] of Object.entries(modes)){
        known(locales,languages,`${plan} ${mode} languages`);result.rentReturn[plan][mode]={};
        for(const [language,fields] of Object.entries(locales)){
          known(fields,RENT_RETURN_TEXT_KEYS,`${plan} ${mode} ${language} text`);
          result.rentReturn[plan][mode][language]=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,textValue(value,`${plan} ${mode} ${language} ${key}`)]));
        }
      }
    }
  }
  if(!Array.isArray(input.enabledLanguages)||!input.enabledLanguages.length||input.enabledLanguages.some(key=>!languages.includes(key))||new Set(input.enabledLanguages).size!==input.enabledLanguages.length)reject('Choose at least one supported language without duplicates.');
  if(!input.enabledLanguages.includes(input.defaultLanguage))reject('The default language must be enabled.');
  result.defaultLanguage=input.defaultLanguage;result.enabledLanguages=[...input.enabledLanguages];
  if(input.navigation!==undefined){
    known(input.navigation,Object.keys(result.navigation),'Navigation');
    for(const [key,value] of Object.entries(input.navigation)){if(typeof value!=='boolean')reject('Navigation controls must be enabled or disabled.');result.navigation[key]=value;}
  }
  if(input.links!==undefined){
    known(input.links,Object.keys(result.links),'Links');
    for(const [key,value] of Object.entries(input.links)){
      const link=textValue(value,`${key} link`,1000).trim();
      const variables=link.match(/\{[^{}]+\}/g) || [];
      if(key==='help' && variables.some(variable=>variable!=='{stationId}'))reject('The Help QR URL supports only the {stationId} variable.');
      if(key!=='help' && variables.length)reject('Only the Help QR URL supports a variable.');
      const resolved=key==='help'?link.replaceAll('{stationId}','US8004'):link;
      if(/[{}]/.test(resolved))reject('Links contain an unsupported variable.');
      if(resolved){let url;try{url=new URL(resolved);}catch{reject('Links must be valid HTTPS addresses or blank.');}if(url.protocol!=='https:'||!url.hostname||url.username||url.password||/[\s\\]/.test(resolved))reject('Links must be valid HTTPS addresses without credentials.');}
      result.links[key]=link;
    }
  }
  known(input.theme,STRIPE_UI_COLORS.map(({key})=>key),'Colors');
  for(const [key,value] of Object.entries(input.theme)){if(typeof value!=='string'||!/^#[a-f\d]{6}$/i.test(value))reject('Colors must use six hexadecimal digits.');result.theme[key]=value.toLowerCase();}
  known(input.locales,languages,'Languages');
  for(const [language,fields] of Object.entries(input.locales)){
    known(fields,STRIPE_UI_FIELDS.map(({key})=>key),`${language} text`);
    for(const [key,value] of Object.entries(fields)){
      const text=textValue(value,`${language} ${key}`);
      if(key==='receiptPending' && ({en:['Receipt available soon','Receipt unavailable','Receipt not available'],fr:['Reçu bientôt disponible','Reçu indisponible'],es:['Recibo disponible pronto','Recibo no disponible']})[language]?.includes(text))continue;
      if(key==='returned.body' && ({en:'Your return is complete. Scan the QR code for your receipt.',fr:'Votre retour est terminé. Scannez le code QR pour obtenir votre reçu.',es:'Tu devolución ha finalizado. Escanea el código QR para obtener tu recibo.'})[language]===text)continue;
      if(language==='en' && legacyCheckoutCopy[key]===text || legacyHowItWorks[language]?.[key]===text || previousHowItWorks[language]?.[key]===text || previousChargeCopy[language]?.[key]===text || legacyUtilityCopy[language]?.[key]===text || legacyStaffHelp[language]?.[key]===text || key==='returned.body' && legacyReturnedBodies[language]===text)continue;
      result.locales[language][key]=text;
    }
  }
  if(!Array.isArray(input.pages)||input.pages.length>12)reject('Use at most 12 added pages.');
  const ids=new Set();
  result.pages=input.pages.map(page=>{
    known(page,['id','name','enabled','locales'],'Page');
    if(typeof page.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(page.id)||ids.has(page.id))reject('Added pages need unique IDs.');
    ids.add(page.id);
    if(typeof page.enabled!=='boolean')reject('Choose whether each page is enabled.');
    const name=textValue(page.name,'Page name',80);if(!name.trim())reject('Give each added page a name.');
    known(page.locales,languages,'Page languages');
    const locales={};
    for(const language of languages){
      const content=page.locales[language] || {};
      known(content,['title','body','nextLabel'],'Page content');
      locales[language]={title:textValue(content.title??'','Page title',200),body:textValue(content.body??'','Page message'),nextLabel:textValue(content.nextLabel??'','Page button',80)};
    }
    if(!locales[result.defaultLanguage].title.trim())reject('Enter a page title in the default language.');
    return {id:page.id,name,enabled:page.enabled,locales};
  });
  return result;
}
export function resolveStripeLanguage(profile,language) {
  return profile?.enabledLanguages?.includes(language)?language:profile?.defaultLanguage||'en';
}
export function stripeText(profile,language,key,values={}) {
  const defaults=defaultStripeUi(),selected=resolveStripeLanguage(profile,language);
  const supplied=profile?.locales?.[selected]?.[key] ?? profile?.locales?.[profile.defaultLanguage]?.[key];
  const template=Object.values(legacyStaffHelp).some(copy=>copy[key]===supplied) ? (defaults.locales[selected]?.[key] ?? defaults.locales.en[key] ?? '') : (supplied ?? defaults.locales[selected]?.[key] ?? defaults.locales.en[key] ?? '');
  return template.replace(/\{(deposit|fee|refund|slot|available|eventCharge|overdueDays)\}/g,(match,name)=>values[name]===undefined?match:String(values[name]));
}
export function stripePageText(profile,page,language,key,values={}) {
  const selected=resolveStripeLanguage(profile,language);
  const template=page?.locales?.[selected]?.[key] || page?.locales?.[profile.defaultLanguage]?.[key] || (key==='nextLabel'?stripeText(profile,selected,'continue'): '');
  return template.replace(/\{(deposit|fee|refund|slot|available|eventCharge|overdueDays)\}/g,(match,name)=>values[name]===undefined?match:String(values[name]));
}

export function eventReturnDeadline(offer={}) {
  const value=offer?.overdueDays ?? offer?.pricing?.overdueDays ?? offer?.pricingSnapshot?.overdue;
  const days=typeof value==='number' || typeof value==='string' && value.trim()?Number(value):NaN;
  if(!Number.isInteger(days) || days<=0)return {key:'eventNotReturned',days:null};
  return {key:days===1?'eventLateDay':'eventLateDays',days};
}

// Shared customer UI contract. Monetary amounts and checkout decisions are never configured here.
export const STRIPE_UI_LANGUAGES = [{key:'en',label:'English'},{key:'fr',label:'French'},{key:'es',label:'Spanish'}];
export const STRIPE_UI_COLORS = [
  ['background','Panel background'],['surface','Secondary button background'],['primary','Primary button'],['secondary','Secondary button text'],
  ['text','Main text'],['muted','Supporting text'],['buttonText','Primary button text'],['danger','Error text'],
].map(([key,label])=>({key,label}));
const common = {
  brand:['Brand','chargerent','chargerent','chargerent'],
  language:['Language selector','Language','Langue','Idioma'],
  start:['Start button','Start','Commencer','Comenzar'],
  information:['Information button','How it works','Comment ça marche','Cómo funciona'],
  map:['Map button','Station map','Carte des stations','Mapa de estaciones'],
  termsButton:['Terms button','Rental terms','Conditions de location','Condiciones de alquiler'],
  receipt:['Receipt button','Receipt','Reçu','Recibo'],
  receiptScan:['Return receipt QR caption','Scan for your receipt','Scannez pour obtenir votre reçu','Escanea para obtener tu recibo'],
  receiptPending:['Return receipt pending','Receipt available soon','Reçu bientôt disponible','Recibo disponible pronto'],
  helpTitle:['Help QR heading','Need help?','Besoin d’aide ?','¿Necesitas ayuda?'],
  helpScan:['Help QR instruction','Scan me!','Scannez-moi !','¡Escanéame!'],
  support:['Support message','Need help? Please ask a staff member.','Besoin d’aide ? Adressez-vous au personnel.','¿Necesitas ayuda? Consulta al personal.'],
  linkUnavailable:['Link unavailable','This link is not available yet. Please ask a staff member.','Ce lien n’est pas encore disponible. Adressez-vous au personnel.','Este enlace aún no está disponible. Consulta al personal.'],
  openLink:['Show QR code button','Show QR code','Afficher le code QR','Mostrar código QR'],
  'information.rentTitle':['Rent instruction title','Rent','Louer','Alquilar'],
  'information.rentBody':['Rent instruction','Choose Rent a charger, review the price and use the card reader.','Choisissez Louer un chargeur, vérifiez le tarif et utilisez le lecteur de carte.','Elige Alquilar un cargador, revisa el precio y utiliza el lector de tarjetas.'],
  'information.chargeTitle':['Charge instruction title','Charge','Recharger','Cargar'],
  'information.chargeBody':['Charge instruction','Take the released charger and connect it to your device.','Prenez le chargeur remis et branchez-le à votre appareil.','Recoge el cargador entregado y conéctalo a tu dispositivo.'],
  'information.returnTitle':['Return instruction title','Return','Rendre','Devolver'],
  'information.returnBody':['Return instruction','Insert your charger fully into an empty slot and wait for confirmation.','Insérez complètement le chargeur dans un compartiment vide et attendez la confirmation.','Introduce el cargador completamente en un compartimento vacío y espera la confirmación.'],
  rent:['Rent button','Rent a charger','Louer un chargeur','Alquilar un cargador'],
  return:['Return button','Return a charger','Rendre un chargeur','Devolver un cargador'],
  availability:['Charger availability','{available} chargers available','{available} chargeurs disponibles','{available} cargadores disponibles'],
  availabilityUnavailable:['Availability unavailable','Charger availability is currently unavailable.','Impossible de vérifier la disponibilité des chargeurs pour le moment.','No se puede consultar la disponibilidad de cargadores en este momento.'],
  tap:['Tap card button','Tap card','Présenter la carte','Acercar tarjeta'],
  insert:['Insert card button','Insert card','Insérer la carte','Insertar tarjeta'],
  continue:['Continue button','Continue','Continuer','Continuar'],
  back:['Back button','Back','Retour','Atrás'],
  cancel:['Cancel button','Cancel','Annuler','Cancelar'],
  done:['Done button','Done','Terminé','Listo'],
  retry:['Try again button','Start again','Recommencer','Volver a empezar'],
  consent:['Rental consent','I agree to the rental terms','J’accepte les conditions de location','Acepto las condiciones de alquiler'],
  terms:['Rental terms','Review the rental terms before continuing.','Consultez les conditions de location avant de continuer.','Consulta las condiciones de alquiler antes de continuar.'],
  pricing:['Price summary','{deposit} deposit · {fee} rental fee · {refund} refund on return','Caution : {deposit} · Location : {fee} · Remboursement au retour : {refund}','Depósito: {deposit} · Alquiler: {fee} · Reembolso al devolver: {refund}'],
  readerReady:['Reader ready','Reader ready · {available} chargers available','Lecteur prêt · {available} chargeurs disponibles','Lector listo · {available} cargadores disponibles'],
  readerUnavailable:['Reader unavailable','The card reader is unavailable. Please ask a staff member.','Le lecteur de carte est indisponible. Adressez-vous au personnel.','El lector de tarjetas no está disponible. Consulta al personal.'],
  connecting:['Connecting','Connecting…','Connexion…','Conectando…'],
  connectionLost:['Connection lost','Connection lost. Your rental will recover when the connection returns.','Connexion interrompue. Votre location reprendra au rétablissement de la connexion.','Conexión perdida. Tu alquiler se recuperará cuando vuelva la conexión.'],
  unavailable:['Rental unavailable','Rentals are temporarily unavailable. Please ask a staff member.','Les locations sont temporairement indisponibles. Adressez-vous au personnel.','Los alquileres no están disponibles temporalmente. Consulta al personal.'],
  starting:['Starting checkout','Starting…','Démarrage…','Iniciando…'],
  waitingSlot:['Waiting for slot','Waiting for the charger slot…','En attente de l’ouverture du compartiment…','Esperando la apertura del compartimento…'],
  settlementRefunded:['Refund confirmed','{refund} refunded · {fee} rental fee','{refund} remboursés · Location : {fee}','Reembolso: {refund} · Alquiler: {fee}'],
  settlementVoided:['Authorization released','Payment authorization released.','Autorisation de paiement annulée.','Autorización de pago anulada.'],
  settlementCaptured:['Payment completed','Payment completed.','Paiement effectué.','Pago completado.'],
  settlementAuthorized:['Payment authorized','Payment authorized; waiting for release.','Paiement autorisé ; en attente de la remise du chargeur.','Pago autorizado; esperando la entrega del cargador.'],
  returnConfirmed:['Return confirmed','Return confirmed. Your rental is complete.','Retour confirmé. Votre location est terminée.','Devolución confirmada. Tu alquiler ha finalizado.'],
  returnSlot:['Returned slot','Returned to slot {slot}','Rendu dans le compartiment {slot}','Devuelto en el compartimento {slot}'],
  errorGeneric:['Checkout error','We could not complete that request. Please try again or ask a staff member.','La demande n’a pas pu aboutir. Réessayez ou adressez-vous au personnel.','No se ha podido completar la solicitud. Inténtalo de nuevo o consulta al personal.'],
  offerChanged:['Price changed','The rental details changed. Please review the current price and terms.','Les détails de location ont changé. Vérifiez le tarif et les conditions actuels.','Los detalles del alquiler han cambiado. Revisa el precio y las condiciones actuales.'],
  returnPending:['Return pending','Waiting for the kiosk to confirm your return.','En attente de confirmation du retour par la borne.','Esperando a que el quiosco confirme la devolución.'],
  'popup.success':['Charger released popup','Take your charger from slot {slot}.','Prenez votre chargeur dans le compartiment {slot}.','Recoge tu cargador del compartimento {slot}.'],
  'popup.return':['Charger returned popup','Charger returned. Thank you!','Chargeur rendu. Merci !','Cargador devuelto. ¡Gracias!'],
  'popup.failure':['Release failed popup','Unable to release a charger. Please ask a staff member.','Impossible de remettre un chargeur. Adressez-vous au personnel.','No se ha podido entregar un cargador. Consulta al personal.'],
};
const stages = {
  start:['Stay charged','Restez connecté','Mantén la carga','Rent a portable charger here.','Louez un chargeur portable ici.','Alquila un cargador portátil aquí.'],
  information:['How it works','Comment ça marche','Cómo funciona','Rent, charge and return in three simple steps.','Louez, rechargez et rendez en trois étapes simples.','Alquila, carga y devuelve en tres sencillos pasos.'],
  terms:['Rental terms','Conditions de location','Condiciones de alquiler','Scan the QR code to read our rental terms and conditions.','Scannez le code QR pour consulter nos conditions de location.','Escanea el código QR para consultar nuestras condiciones de alquiler.'],
  map:['Find a station','Trouver une station','Encuentra una estación','Scan the QR code to see station locations.','Scannez le code QR pour voir les emplacements des stations.','Escanea el código QR para ver las ubicaciones de las estaciones.'],
  receipt:['Your receipt','Votre reçu','Tu recibo','Scan the QR code to look up your rental receipt.','Scannez le code QR pour retrouver votre reçu de location.','Escanea el código QR para buscar tu recibo de alquiler.'],
  out_of_order:['Temporarily unavailable','Temporairement indisponible','Temporalmente fuera de servicio','Rentals are temporarily unavailable. Please ask a staff member.','Les locations sont temporairement indisponibles. Adressez-vous au personnel.','Los alquileres no están disponibles temporalmente. Consulta al personal.'],
  loading:['Getting this kiosk ready','Préparation de la borne','Preparando este quiosco','Checking the reader and charger availability…','Vérification du lecteur et des chargeurs disponibles…','Comprobando el lector y los cargadores disponibles…'],
  ready:['Rent a portable charger','Louez un chargeur portable','Alquila un cargador portátil','Stay charged wherever you go.','Restez connecté partout où vous allez.','Mantén tus dispositivos cargados donde vayas.'],
  review:['Review your rental','Vérifiez votre location','Revisa tu alquiler','Review the price and rental terms before continuing.','Vérifiez le tarif et les conditions de location avant de continuer.','Revisa el precio y las condiciones de alquiler antes de continuar.'],
  waiting_for_card:['Tap or insert a card','Présentez ou insérez votre carte','Acerca o inserta una tarjeta','{deposit} deposit. Use the card reader below the screen.','Caution : {deposit}. Utilisez le lecteur de carte sous l’écran.','Depósito: {deposit}. Utiliza el lector de tarjetas debajo de la pantalla.'],
  authorizing:['Checking your payment','Vérification du paiement','Comprobando tu pago','Please wait while your payment is authorized.','Veuillez patienter pendant l’autorisation du paiement.','Espera mientras se autoriza tu pago.'],
  dispensing:['Releasing your charger','Remise de votre chargeur','Entregando tu cargador','Please wait for the kiosk to confirm your charger was released.','Veuillez attendre la confirmation de la remise du chargeur.','Espera a que el quiosco confirme la entrega de tu cargador.'],
  succeeded:['Take your charger · Slot {slot}','Prenez votre chargeur · Compartiment {slot}','Recoge tu cargador · Compartimento {slot}','Your charger is ready. Keep it until you are ready to return it.','Votre chargeur est prêt. Gardez-le jusqu’à ce que vous souhaitiez le rendre.','Tu cargador está listo. Consérvalo hasta que quieras devolverlo.'],
  declined:['Your card was declined','Votre carte a été refusée','Tu tarjeta fue rechazada','No payment was captured. You can start again.','Aucun paiement n’a été encaissé. Vous pouvez recommencer.','No se ha cobrado ningún pago. Puedes volver a empezar.'],
  cancelled:['Rental cancelled','Location annulée','Alquiler cancelado','Your checkout has been cancelled.','Votre demande de location a été annulée.','Se ha cancelado tu solicitud de alquiler.'],
  failed:['Charger was not released','Le chargeur n’a pas été remis','No se ha entregado el cargador','No release was confirmed. Please ask a staff member before trying again.','La remise du chargeur n’a pas été confirmée. Adressez-vous au personnel avant de réessayer.','No se ha confirmado la entrega. Consulta al personal antes de volver a intentarlo.'],
  recovering:['Checking your checkout','Vérification de votre location','Comprobando tu alquiler','Restoring your existing checkout. Please wait before starting another rental.','Récupération de votre location en cours. Veuillez patienter avant d’en commencer une autre.','Recuperando tu alquiler actual. Espera antes de iniciar otro.'],
  returning:['Return your charger','Rendez votre chargeur','Devuelve tu cargador','Insert your charger fully into an empty slot.','Insérez complètement votre chargeur dans un compartiment vide.','Introduce el cargador completamente en un compartimento vacío.'],
  returned:['Charger returned · Thank you','Chargeur rendu · Merci','Cargador devuelto · Gracias','Your return is complete. Scan the QR code for your receipt.','Votre retour est terminé. Scannez le code QR pour obtenir votre reçu.','Tu devolución ha finalizado. Escanea el código QR para obtener tu recibo.'],
};
const legacyReturnedBodies = {
  en:'Return confirmed. Any refund will appear after settlement is confirmed.',
  fr:'Retour confirmé. Le remboursement apparaîtra après confirmation du règlement.',
  es:'Devolución confirmada. El reembolso aparecerá cuando se confirme la liquidación.',
};
export const STRIPE_UI_FIELDS = [
  ...Object.entries(common).map(([key,[label]])=>({key,label,section:'General'})),
  ...Object.keys(stages).flatMap(key=>[{key:`${key}.title`,label:'Title',section:key},{key:`${key}.body`,label:'Message',section:key}]),
];
export function defaultStripeUi() {
  const locales={};
  STRIPE_UI_LANGUAGES.forEach(({key},i)=>{
    locales[key]=Object.fromEntries(Object.entries(common).map(([field,values])=>[field,values[i+1]]));
    Object.entries(stages).forEach(([stage,values])=>{locales[key][`${stage}.title`]=values[i];locales[key][`${stage}.body`]=values[i+3];});
  });
  return {schemaVersion:1,defaultLanguage:'en',enabledLanguages:['en','fr','es'],navigation:{language:true,information:true,terms:true,map:true,receipt:false},links:{terms:'',map:'',receipt:'',help:''},theme:{background:'#f6f9f4',surface:'#e2ebdf',primary:'#143c2d',secondary:'#143c2d',text:'#143c2d',muted:'#426354',buttonText:'#ffffff',danger:'#943925'},locales,pages:[]};
}
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const reject=message=>{throw Object.assign(new Error(message),{status:400,code:'INVALID_STRIPE_UI'});};
const known=(value,keys,label)=>{if(!plain(value))reject(`${label} must be an object.`);if(Object.keys(value).some(key=>!keys.includes(key)))reject(`${label} has an unsupported field.`);};
// eslint-disable-next-line no-control-regex
const textValue=(value,label,max=2000)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))reject(`${label} must be text of at most ${max} characters.`);return value;};
export function validateStripeUi(input) {
  const result=defaultStripeUi();
  known(input,['schemaVersion','defaultLanguage','enabledLanguages','navigation','links','theme','locales','pages'],'Stripe UI');
  if(input.schemaVersion!==1)reject('Unsupported Stripe UI version.');
  const languages=STRIPE_UI_LANGUAGES.map(({key})=>key);
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
      if(key==='returned.body' && legacyReturnedBodies[language]===text)continue;
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
  const template=profile?.locales?.[selected]?.[key] ?? profile?.locales?.[profile.defaultLanguage]?.[key] ?? defaults.locales[selected]?.[key] ?? defaults.locales.en[key] ?? '';
  return template.replace(/\{(deposit|fee|refund|slot|available)\}/g,(match,name)=>values[name]===undefined?match:String(values[name]));
}
export function stripePageText(profile,page,language,key,values={}) {
  const selected=resolveStripeLanguage(profile,language);
  const template=page?.locales?.[selected]?.[key] || page?.locales?.[profile.defaultLanguage]?.[key] || (key==='nextLabel'?stripeText(profile,selected,'continue'): '');
  return template.replace(/\{(deposit|fee|refund|slot|available)\}/g,(match,name)=>values[name]===undefined?match:String(values[name]));
}

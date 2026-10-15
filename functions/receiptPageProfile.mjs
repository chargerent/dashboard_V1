// Text and branding for the web page opened by a transaction's receipt QR.
// This is separate from the native checkout UI and never supplies rental values.
export const RECEIPT_PAGE_GROUPS = ['Page headings', 'Rental status', 'Rental details', 'Payment details', 'Footer and messages'];
const copy = [
  ['pageTitle','Browser title',0,'Your charging receipt','Votre reçu de recharge','Tu recibo de carga'],
  ['eyebrow','Receipt heading',0,'YOUR CHARGING RECEIPT','VOTRE REÇU DE RECHARGE','TU RECIBO DE CARGA'],
  ['loadingTitle','Opening message',0,'Opening your receipt…','Ouverture de votre reçu…','Abriendo tu recibo…'],
  ['loadingStatus','Loading status',0,'Loading','Chargement','Cargando'],
  ['loadingSummary','Opening description',0,'Your receipt stays at this link after you return the charger.','Votre reçu reste accessible à ce lien après le retour de la batterie.','Tu recibo seguirá en este enlace después de devolver la batería.'],
  ['rentalHeading','Rental details heading',0,'Rental details','Détails de la location','Detalles del alquiler'],
  ['paymentHeading','Payment details heading',0,'Payment details','Détails du paiement','Detalles del pago'],
  ['transactionHeading','Transaction ID heading',0,'Transaction ID','Identifiant de transaction','ID de transacción'],
  ['rentingTitle','Active rental title',1,'Your charger is ready','Votre batterie est prête','Tu batería está lista'],
  ['returnedTitle','Returned title',1,'Charger returned','Batterie rendue','Batería devuelta'],
  ['purchasedTitle','Purchase title',1,'Your purchase receipt','Votre reçu d’achat','Tu recibo de compra'],
  ['rentingStatus','Active rental status',1,'Rental active','Location en cours','Alquiler activo'],
  ['returnedStatus','Returned status',1,'Returned','Rendue','Devuelta'],
  ['purchasedStatus','Purchased status',1,'Purchased','Achetée','Comprada'],
  ['rentingSummary','Active rental description',1,'Keep this link. It will update automatically when your charger is returned.','Conservez ce lien. Il sera mis à jour automatiquement au retour de votre batterie.','Guarda este enlace. Se actualizará automáticamente cuando devuelvas la batería.'],
  ['returnedSummary','Returned description',1,'Thank you for returning your charger. Your latest payment details are below.','Merci d’avoir rendu votre batterie. Les derniers détails du paiement figurent ci-dessous.','Gracias por devolver la batería. A continuación encontrarás los últimos detalles del pago.'],
  ['purchasedSummary','Purchase description',1,'Your latest payment details are below.','Les derniers détails du paiement figurent ci-dessous.','A continuación encontrarás los últimos detalles del pago.'],
  ['rentalStationLabel','Rental station label',2,'Rental station','Station de location','Estación de alquiler'],
  ['rentedAtLabel','Rental time label',2,'Rented at','Début de location','Fecha de alquiler'],
  ['returnedAtLabel','Return time label',2,'Returned at','Retour effectué le','Fecha de devolución'],
  ['returnStationLabel','Return station label',2,'Return station','Station de retour','Estación de devolución'],
  ['initialAmountLabel','Initial amount label',3,'Initial amount','Montant initial','Importe inicial'],
  ['cardHoldLabel','Card hold label',3,'Card hold','Empreinte bancaire','Retención en tarjeta'],
  ['depositLabel','Deposit label',3,'Deposit charged','Caution débitée','Depósito cobrado'],
  ['initialPaymentLabel','Initial payment label',3,'Initial payment','Paiement initial','Pago inicial'],
  ['finalChargeLabel','Final charge label',3,'Final rental charge','Montant final de la location','Cargo final del alquiler'],
  ['refundLabel','Refund label',3,'Refund sent','Remboursement envoyé','Reembolso enviado'],
  ['holdReleasedLabel','Released hold label',3,'Hold released','Empreinte libérée','Retención liberada'],
  ['offlineDeclinedNote','Offline payment declined message',3,'The card payment collected offline was declined when submitted. Please contact support.','Le paiement par carte collecté hors ligne a été refusé lors de son envoi. Contactez l’assistance.','El pago con tarjeta recogido sin conexión fue rechazado al enviarse. Contacta con soporte.'],
  ['offlinePendingNote','Offline payment pending message',3,'Card payment approval is pending. Refresh this receipt after the station reconnects.','L’approbation du paiement est en attente. Actualisez ce reçu après la reconnexion de la station.','La aprobación del pago está pendiente. Actualiza este recibo cuando la estación vuelva a conectarse.'],
  ['refundNote','Refund timing message',3,'Refund arrival time depends on your bank.','Le délai de remboursement dépend de votre banque.','El plazo del reembolso depende de tu banco.'],
  ['holdReleasedNote','Hold release timing message',3,'The hold release may take time to appear with your bank.','La libération de l’empreinte peut mettre du temps à apparaître auprès de votre banque.','La liberación de la retención puede tardar en aparecer en tu banco.'],
  ['settlementPendingNote','Settlement pending message',3,'Your charger is returned. Payment settlement is still being confirmed.','Votre batterie est rendue. Le règlement du paiement est en cours de confirmation.','Tu batería ha sido devuelta. La liquidación del pago aún se está confirmando.'],
  ['authorizationNote','Card authorization message',3,'This amount is a card authorization, not a completed charge.','Ce montant est une autorisation bancaire, pas un débit définitif.','Este importe es una autorización de tarjeta, no un cargo completado.'],
  ['settledNote','Confirmed payment message',3,'Payment details reflect the latest backend confirmation.','Les détails du paiement correspondent à la dernière confirmation du service.','Los detalles del pago reflejan la última confirmación del servicio.'],
  ['activeNote','Final charge explanation',3,'Your final rental charge is confirmed after return.','Le montant final de votre location est confirmé après le retour.','El cargo final del alquiler se confirma después de la devolución.'],
  ['saveButton','Save / print button',4,'Save / print receipt','Enregistrer / imprimer le reçu','Guardar / imprimir recibo'],
  ['refreshButton','Refresh button',4,'Refresh','Actualiser','Actualizar'],
  ['footer','Footer message',4,'This receipt stays at the same link.','Ce reçu reste accessible au même lien.','Este recibo permanece en el mismo enlace.'],
  ['checkingStatus','Checking for updates message',4,'Checking the latest rental status…','Vérification du statut de la location…','Comprobando el estado del alquiler…'],
  ['lastUpdated','Last updated message',4,'Last updated {updatedAt}','Dernière mise à jour : {updatedAt}','Última actualización: {updatedAt}'],
  ['pending','Pending value',4,'Pending','En attente','Pendiente'],
  ['unavailableTitle','Unavailable title',4,'Receipt unavailable','Reçu indisponible','Recibo no disponible'],
  ['unavailableStatus','Unavailable status',4,'Unavailable','Indisponible','No disponible'],
  ['unavailableSummary','Unavailable description',4,'Check the receipt link or try again shortly.','Vérifiez le lien du reçu ou réessayez dans quelques instants.','Comprueba el enlace del recibo o inténtalo de nuevo en unos momentos.'],
  ['unavailableMessage','Unavailable message',4,'This receipt is unavailable.','Ce reçu est indisponible.','Este recibo no está disponible.'],
  ['refreshFailedMessage','Refresh failed message',4,'Could not refresh. The last confirmed details are shown.','Actualisation impossible. Les derniers détails confirmés sont affichés.','No se pudo actualizar. Se muestran los últimos datos confirmados.'],
];
export const RECEIPT_PAGE_FIELDS = copy.map(([key,label,group]) => ({key,label,group:RECEIPT_PAGE_GROUPS[group],multiline:/Summary|Note|Message$|^footer$/.test(key)}));
const languages = ['en','fr','es'];
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = message => {throw new Error(message);};
export function defaultReceiptPage() {
  return {schemaVersion:1,defaultLanguage:'en',enabledLanguages:[...languages],locales:Object.fromEntries(languages.map((language,index) => [language,Object.fromEntries(copy.map(([key,,, ...values])=>[key,values[index]]))]))};
}
export function normalizeReceiptPage(input = defaultReceiptPage()) {
  if (!plain(input) || Object.keys(input).some(key=>!['schemaVersion','defaultLanguage','enabledLanguages','locales','logo'].includes(key)) || input.schemaVersion!==1) fail('A supported receipt page is required.');
  const result=defaultReceiptPage();
  if (!languages.includes(input.defaultLanguage) || !Array.isArray(input.enabledLanguages) || !input.enabledLanguages.length || input.enabledLanguages.some(language=>!languages.includes(language)) || new Set(input.enabledLanguages).size!==input.enabledLanguages.length || !input.enabledLanguages.includes(input.defaultLanguage)) fail('Choose supported receipt languages and an enabled default language.');
  result.defaultLanguage=input.defaultLanguage;result.enabledLanguages=[...input.enabledLanguages];
  if (!plain(input.locales) || Object.keys(input.locales).some(language=>!languages.includes(language))) fail('Receipt page languages are invalid.');
  const keys=RECEIPT_PAGE_FIELDS.map(field=>field.key);
  for (const [language,fields] of Object.entries(input.locales)) {
    if (!plain(fields) || Object.keys(fields).some(key=>!keys.includes(key))) fail('Receipt page text contains an unsupported field.');
    for (const [key,value] of Object.entries(fields)) {
      if (typeof value!=='string' || value.length>2000 || [...value].some(character=>character.charCodeAt(0)<32 && ![9,10,13].includes(character.charCodeAt(0)))) fail('Receipt text must contain at most 2000 characters per field.');
      result.locales[language][key]=value;
    }
  }
  if (Object.hasOwn(input,'logo')) {
    result.logo=null;
    if (input.logo!==null) {
      if (!plain(input.logo) || Object.keys(input.logo).some(key=>!['url','path','contentType','name','updatedAt'].includes(key)) || !['image/png','image/jpeg','image/webp'].includes(input.logo.contentType)) fail('Choose a PNG, JPEG, or WebP receipt logo.');
      let url;try {url=new URL(input.logo.url);} catch {fail('The receipt logo must use a valid HTTPS URL.');}
      if (url.protocol!=='https:' || url.username || url.password || url.hash || url.href.length>2000) fail('The receipt logo must use a valid HTTPS URL.');
      result.logo={url:url.href,contentType:input.logo.contentType};
      for (const key of ['path','name','updatedAt']) if (input.logo[key]!==undefined) {
        if (typeof input.logo[key]!=='string' || input.logo[key].length>1000) fail('Receipt logo details are invalid.');
        result.logo[key]=input.logo[key];
      }
    }
  }
  return result;
}

import {checkoutPricingOffer,formatPricingMoney,howItWorksCopy} from './howItWorks.js';

export const EVENT_SIMPLE_REVIEW_COPY={
  en:{
    title:'FREE DAILY RENTAL',
    rental:'Rent a charger for FREE — return it by the end of the day.',
    deposit:'A {amount} refundable deposit is temporarily charged when you rent the charger.',
    depositReturn:'Return the charger by the end of the day and your {amount} deposit will be refunded.',
    upfront:'A {amount} upfront payment is temporarily charged when you rent the charger.',
    upfrontReturn:'Return the charger by the end of the day and your {amount} upfront payment will be refunded.',
    hold:'A temporary {amount} card hold is placed when you rent the charger.',
    holdReturn:'Return the charger by the end of the day and your {amount} card hold will be released.',
    refundBank:'Refund timing depends on your bank and may take a few business days to appear.',
    holdBank:'Release timing depends on your bank and may take a few business days to appear.',
  },
  fr:{
    title:'LOCATION GRATUITE À LA JOURNÉE',
    rental:'Louez un chargeur GRATUITEMENT — rendez-le avant la fin de la journée.',
    deposit:'Une caution remboursable de {amount} est temporairement débitée lorsque vous louez le chargeur.',
    depositReturn:'Rendez le chargeur avant la fin de la journée et votre caution de {amount} sera remboursée.',
    upfront:'Un paiement initial de {amount} est temporairement débité lorsque vous louez le chargeur.',
    upfrontReturn:'Rendez le chargeur avant la fin de la journée et votre paiement initial de {amount} sera remboursé.',
    hold:'Une empreinte bancaire temporaire de {amount} est effectuée lorsque vous louez le chargeur.',
    holdReturn:'Rendez le chargeur avant la fin de la journée et votre empreinte bancaire de {amount} sera libérée.',
    refundBank:'Le délai de remboursement dépend de votre banque et peut prendre quelques jours ouvrés pour apparaître.',
    holdBank:'Le délai de libération dépend de votre banque et peut prendre quelques jours ouvrés pour apparaître.',
  },
  es:{
    title:'ALQUILER DIARIO GRATIS',
    rental:'Alquila un cargador GRATIS — devuélvelo antes de que termine el día.',
    deposit:'Se cobra temporalmente un depósito reembolsable de {amount} al alquilar el cargador.',
    depositReturn:'Devuelve el cargador antes de que termine el día y se reembolsará tu depósito de {amount}.',
    upfront:'Se cobra temporalmente un pago inicial de {amount} al alquilar el cargador.',
    upfrontReturn:'Devuelve el cargador antes de que termine el día y se reembolsará tu pago inicial de {amount}.',
    hold:'Se aplica una retención temporal de {amount} en tu tarjeta al alquilar el cargador.',
    holdReturn:'Devuelve el cargador antes de que termine el día y se liberará la retención de {amount} en tu tarjeta.',
    refundBank:'El plazo del reembolso depende de tu banco y puede tardar unos días laborables en aparecer.',
    holdBank:'El plazo de liberación depende de tu banco y puede tardar unos días laborables en aparecer.',
  },
};

/** Display-only summary; charge and return rules still come from kiosk pricing. */
export function checkoutEventSimpleReview(checkout={},language='en'){
  const offer=checkoutPricingOffer(checkout);
  const plan=typeof offer.planCode==='string'?offer.planCode.trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_'):'';
  const lang=Object.hasOwn(EVENT_SIMPLE_REVIEW_COPY,language)?language:'en';
  const facts=howItWorksCopy(offer,lang).pricing;
  const amount=formatPricingMoney(facts.paymentCents,facts.currency,lang);
  if(plan!=='EVENT_SIMPLE' || amount===null || !(facts.paymentCents>0) || !['charged','held'].includes(facts.paymentMode))return null;
  const words=EVENT_SIMPLE_REVIEW_COPY[lang];
  const phrase=key=>words[key].replaceAll('{amount}',amount);
  return {title:words.title,paragraphs:[words.rental,phrase('deposit'),phrase('depositReturn'),words.refundBank]};
}

export function checkoutEventSimpleReviewGeometry(base,width,height,review){
  if(!review)return base;
  return {...base,contentScale:Math.min(base.contentScale ?? 1,base.expandedHeight/((height>width?768:680)*base.scale))};
}

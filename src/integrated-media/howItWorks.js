// Structured kiosk pricing supplies amounts and payment facts. Event Simple
// uses the approved plan-specific display copy; this module never sets charges.
import {checkoutGatewayStep} from './checkoutGateway.js';

const number=value=>{
  if(!['number','string'].includes(typeof value) || typeof value==='string' && !value.trim())return null;
  const result=Number(typeof value==='string'?value.trim().replace(',','.'):value);
  return Number.isFinite(result)?result:null;
};
const cents=value=>{const result=number(value);return result!==null && Number.isSafeInteger(result) && result>=0?result:null;};
const major=value=>{const result=number(value);if(result===null || result<0)return null;const amount=Math.round(result*100);return Number.isSafeInteger(amount) && Math.abs(result*100-amount)<.00001?amount:null;};
const currencyCode=value=>{const code=String(value || '').trim().toUpperCase();return ({US:'USD',CAN:'CAD',CA:'CAD',FR:'EUR'})[code] || code;};
export const HOW_IT_WORKS_COPY={
  en:{freeByEndOfDay:'Free if returned by end of day.',returnByEndOfDay:'Return by end of day.',backDepositByEndOfDay:'Return by end of day to receive your {amount} deposit back.',backUpfrontByEndOfDay:'Return by end of day for a full refund of your {amount} upfront payment.',releaseHoldByEndOfDay:'Return by end of day to release your {amount} card hold.',tap:'Tap to Rent',scan:'Scan to Rent',phone:'Verify Your Number',rent:'Rent a Charger',chargeTitle:'Charge Your Phone',chargeBody:'Take the power bank and charge your phone anywhere.',finish:'Return & Finish Rental',refunded:'Return & Get Refunded',release:'Return & Release Hold',settle:'Return & Settle',hour:'hour',hours:'hours',minute:'minute',minutes:'minutes',free:'Free for the first {duration}.',first:'{amount} for the first {duration}.',configured:'Rental charges follow the configured plan.',deposit:'{amount} refundable deposit charged.',upfront:'{amount} upfront payment charged.',hold:'{amount} temporary card hold.',review:'Review the payment amount at checkout.',backDeposit:'Return within {duration} to receive your {amount} deposit back.',backUpfront:'Return within {duration} for a full refund of your {amount} upfront payment.',releaseHold:'Return within {duration} to release your {amount} card hold.',insert:'Insert the power bank fully into an empty slot to finish your rental.',unusedDeposit:'Any unused deposit is refunded after rental charges.',unusedUpfront:'Any unused upfront payment is refunded after rental charges.',finalHold:'Only the final rental charge is collected. The unused card hold is released.',finalTerms:'The final charge follows your rental terms.',footer:'Payment and refund details are shown at checkout.',depositBank:'Deposit refund timing depends on your bank.',refundBank:'Refund timing depends on your bank.',holdBank:'Card hold release timing depends on your bank.'},
  fr:{freeByEndOfDay:'Gratuit si la batterie est rendue avant la fin de la journée.',returnByEndOfDay:'Rendez la batterie avant la fin de la journée.',backDepositByEndOfDay:'Rendez la batterie avant la fin de la journée pour récupérer votre caution de {amount}.',backUpfrontByEndOfDay:'Rendez la batterie avant la fin de la journée pour le remboursement intégral de votre paiement initial de {amount}.',releaseHoldByEndOfDay:'Rendez la batterie avant la fin de la journée pour libérer votre empreinte bancaire de {amount}.',tap:'Présentez votre carte pour louer',scan:'Scannez pour louer',phone:'Vérifiez votre numéro',rent:'Louez un chargeur',chargeTitle:'Rechargez votre téléphone',chargeBody:'Emportez la batterie et rechargez votre téléphone partout.',finish:'Rendez et terminez la location',refunded:'Rendez et soyez remboursé',release:'Rendez et libérez la caution',settle:'Rendez et réglez',hour:'heure',hours:'heures',minute:'minute',minutes:'minutes',free:'Gratuit pendant {duration}.',first:'{amount} pour {duration}.',configured:'Les frais suivent le tarif configuré.',deposit:'Caution remboursable de {amount} encaissée.',upfront:'Paiement initial de {amount} encaissé.',hold:'Empreinte bancaire temporaire de {amount}.',review:'Vérifiez le montant au moment du paiement.',backDeposit:'Rendez sous {duration} pour récupérer votre caution de {amount}.',backUpfront:'Rendez sous {duration} pour le remboursement intégral de votre paiement initial de {amount}.',releaseHold:'Rendez sous {duration} pour libérer votre empreinte bancaire de {amount}.',insert:'Insérez complètement la batterie dans un compartiment vide pour terminer la location.',unusedDeposit:'La caution inutilisée est remboursée après déduction des frais.',unusedUpfront:'Le paiement initial inutilisé est remboursé après déduction des frais.',finalHold:'Seuls les frais finaux sont encaissés. Le solde de l’empreinte est libéré.',finalTerms:'Le montant final suit vos conditions de location.',footer:'Les détails du paiement et du remboursement sont affichés au paiement.',depositBank:'Le délai de remboursement de la caution dépend de votre banque.',refundBank:'Le délai de remboursement dépend de votre banque.',holdBank:'Le délai de libération de l’empreinte dépend de votre banque.'},
  es:{freeByEndOfDay:'Gratis si devuelves la batería antes de que termine el día.',returnByEndOfDay:'Devuelve la batería antes de que termine el día.',backDepositByEndOfDay:'Devuelve la batería antes de que termine el día para recuperar tu depósito de {amount}.',backUpfrontByEndOfDay:'Devuelve la batería antes de que termine el día para el reembolso completo de tu pago inicial de {amount}.',releaseHoldByEndOfDay:'Devuelve la batería antes de que termine el día para liberar la retención de {amount}.',tap:'Acerca tu tarjeta para alquilar',scan:'Escanea para alquilar',phone:'Verifica tu número',rent:'Alquila un cargador',chargeTitle:'Carga tu teléfono',chargeBody:'Lleva la batería y carga tu teléfono donde quieras.',finish:'Devuelve y termina el alquiler',refunded:'Devuelve y recibe el reembolso',release:'Devuelve y libera la retención',settle:'Devuelve y liquida',hour:'hora',hours:'horas',minute:'minuto',minutes:'minutos',free:'Gratis durante {duration}.',first:'{amount} por {duration}.',configured:'Los cargos siguen el plan configurado.',deposit:'Se cobra un depósito reembolsable de {amount}.',upfront:'Se cobra un pago inicial de {amount}.',hold:'Retención temporal en la tarjeta de {amount}.',review:'Revisa el importe al pagar.',backDeposit:'Devuelve en {duration} para recuperar tu depósito de {amount}.',backUpfront:'Devuelve en {duration} para el reembolso completo de tu pago inicial de {amount}.',releaseHold:'Devuelve en {duration} para liberar la retención de {amount}.',insert:'Introduce la batería completamente en un compartimento vacío para terminar el alquiler.',unusedDeposit:'El depósito no utilizado se reembolsa tras descontar los cargos.',unusedUpfront:'El pago inicial no utilizado se reembolsa tras descontar los cargos.',finalHold:'Solo se cobra el importe final. La retención restante se libera.',finalTerms:'El cargo final sigue tus condiciones de alquiler.',footer:'Los detalles del pago y del reembolso se muestran al pagar.',depositBank:'El plazo del reembolso del depósito depende de tu banco.',refundBank:'El plazo del reembolso depende de tu banco.',holdBank:'El plazo de liberación de la retención depende de tu banco.'},
};
function rateTiers(snapshot){
  const rate=snapshot?.rate,tax=number(snapshot && Object.hasOwn(snapshot,'taxrate')?snapshot.taxrate:snapshot && Object.hasOwn(snapshot,'taxpercent')?snapshot.taxpercent:0);
  if(!Array.isArray(rate) || !rate.length || tax===null || tax<0)return null;
  let previous=0;const result=[];
  for(const entry of rate){
    const minutes=number(entry?.time),priceCents=major(entry?.price);
    if(minutes===null || !Number.isSafeInteger(minutes) || minutes<=previous || priceCents===null)return null;
    const totalCents=Math.round(priceCents*(1+tax/100));if(!Number.isSafeInteger(totalCents) || totalCents<0)return null;
    result.push({minutes,priceCents,totalCents});previous=minutes;
  }
  return result;
}
export function formatPricingMoney(amount,currency,language){
  if(amount===null || !/^[A-Z]{3}$/.test(currency))return null;
  const supported=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('currency'):['USD','CAD','EUR','GBP'];
  if(!supported.includes(currency))return null;
  try{return new Intl.NumberFormat(({en:'en-US',fr:'fr-FR',es:'es-ES'})[language],{style:'currency',currency,minimumFractionDigits:amount%100===0?0:2,maximumFractionDigits:2}).format(amount/100);}catch{return null;}
}

export function howItWorksCopy(offer={},language='en',gateway='rent'){
  const words=HOW_IT_WORKS_COPY[language] || HOW_IT_WORKS_COPY.en,lang=HOW_IT_WORKS_COPY[language]?language:'en';
  const phrase=(key,values={})=>words[key].replace(/\{(\w+)\}/g,(_match,name)=>values[name] ?? '—');
  const duration=minutes=>{const hours=minutes%60===0,value=hours?minutes/60:minutes;return `${value} ${words[hours?(value===1?'hour':'hours'):(value===1?'minute':'minutes')]}`;};
  const currency=currencyCode(offer.currency),option=String(offer.gatewayOption || '').trim().toUpperCase().replace(/[ _-]/g,'');
  const paymentCents=cents(offer.paymentAmountCents ?? offer.amountCents),capCents=cents(offer.buyPriceCents ?? major(offer.pricingSnapshot?.buyprice));
  const amount=formatPricingMoney(paymentCents,currency,lang),tiers=rateTiers(offer.pricingSnapshot),validTiers=tiers!==null;
  let freeMinutes=0;for(const tier of tiers || []){if(tier.priceCents!==0)break;freeMinutes=tier.minutes;}
  const planCode=typeof offer.planCode==='string'?offer.planCode.trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_'):'';
  const paymentMode=option==='INITIALPRICE'?'charged':option==='FULLPRICE'?'held':'unknown';
  const upfrontKind=paymentMode==='charged' && paymentCents!==null && capCents!==null && capCents>0 && paymentCents===capCents?'deposit':'upfront_payment';
  const knownPayment=amount!==null && paymentCents>0,firstAmount=validTiers?formatPricingMoney(tiers[0].totalCents,currency,lang):null;
  const title=({card:words.tap,scanner:words.scan,phone:words.phone})[gateway] || words.rent;
  if(planCode==='EVENT_SIMPLE'){
    // The plan selects Event Simple's display policy, including legacy stations
    // with empty rate arrays. The actual quote and billing facts stay intact.
    const showDeposit=knownPayment && paymentMode!=='unknown';
    return {cards:[
      {title,lines:[phrase('freeByEndOfDay'),showDeposit?phrase('deposit',{amount}):phrase('review')]},
      {title:words.chargeTitle,lines:[words.chargeBody]},
      {title:showDeposit?words.refunded:words.finish,lines:[showDeposit?phrase('backDepositByEndOfDay',{amount}):phrase('returnByEndOfDay')]},
    ],footer:phrase(showDeposit?'depositBank':'footer'),pricing:{validTiers,freeMinutes,paymentMode,upfrontKind,currency,paymentCents,capCents,tiers,presentationPolicy:'event_simple'}};
  }
  const firstLines=[freeMinutes>0?phrase('free',{duration:duration(freeMinutes)}):validTiers && firstAmount!==null?phrase('first',{amount:firstAmount,duration:duration(tiers[0].minutes)}):phrase('configured')];
  firstLines.push(paymentMode==='charged' && knownPayment?phrase(upfrontKind==='deposit'?'deposit':'upfront',{amount}):paymentMode==='held' && knownPayment?phrase('hold',{amount}):phrase('review'));
  let returnTitle=words.finish;const returnLines=[];
  if(freeMinutes>0 && paymentMode==='charged' && knownPayment){returnTitle=words.refunded;returnLines.push(phrase(upfrontKind==='deposit'?'backDeposit':'backUpfront',{amount,duration:duration(freeMinutes)}));}
  else if(freeMinutes>0 && paymentMode==='held' && knownPayment){returnTitle=words.release;returnLines.push(phrase('releaseHold',{amount,duration:duration(freeMinutes)}));}
  else{returnLines.push(phrase('insert'));if(paymentMode==='charged' && knownPayment)returnLines.push(phrase(upfrontKind==='deposit'?'unusedDeposit':'unusedUpfront'));else if(paymentMode==='held' && knownPayment){returnTitle=words.settle;returnLines.push(phrase('finalHold'));}else returnLines.push(phrase('finalTerms'));}
  const footer=knownPayment && paymentMode==='charged'?phrase(upfrontKind==='deposit'?'depositBank':'refundBank'):knownPayment && paymentMode==='held'?phrase('holdBank'):phrase('footer');
  return {cards:[{title,lines:firstLines},{title:words.chargeTitle,lines:[words.chargeBody]},{title:returnTitle,lines:returnLines}],footer,pricing:{validTiers,freeMinutes,paymentMode,upfrontKind,currency,paymentCents,capCents,tiers}};
}

export function checkoutPricingOffer(checkout={}){
  const offer=checkout.offer || {},terminalPricing=checkout.liveTerminalEnabled===true && ['pricingSnapshot','gatewayOption','paymentAmountCents','buyPriceCents'].some(key=>Object.hasOwn(offer,key));
  // A real terminal offer may use a configured test-account currency override.
  // Its current structured quote has priority over passive station pricing.
  return terminalPricing?offer:checkout.checkoutPresentation || offer;
}

export function checkoutHowItWorks(checkout={},language='en',charge={}){
  const gateway=checkoutGatewayStep(checkout),result=howItWorksCopy(checkoutPricingOffer(checkout),language,gateway);
  // Operational charging instructions remain editable. Payment-related copy is
  // derived above, so a saved profile cannot retain a stale price or promise.
  if(charge.title?.trim())result.cards[1].title=charge.title;
  if(charge.body?.trim())result.cards[1].lines=[charge.body];
  return {...result,gateway};
}

/** Same structured pricing input for the dashboard's selected kiosk preview. */
export function howItWorksOfferFromKiosk(kiosk={}){
  const pricing=kiosk.pricing || {},hardware=kiosk.hardware || {};
  const gatewayOption=String(hardware.gatewayoptions || hardware.gatewayOptions || '').trim().toUpperCase().replace(/[ _-]/g,'');
  const initialAmountCents=major(pricing.authamount),buyPriceCents=major(pricing.buyprice);
  const paymentAmountCents=gatewayOption==='FULLPRICE'?buyPriceCents:gatewayOption==='INITIALPRICE'?initialAmountCents:null;
  return {stationId:kiosk.stationid || kiosk.stationId,touch:pricing.touch!==false,paymentRequired:pricing.offline!==true,planCode:typeof pricing.text==='string'?pricing.text.trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_'):'',currency:currencyCode(pricing.currency).toLowerCase(),gateway:hardware.gateway || '',scannerOnly:hardware.scannerOnly===true,gatewayOption,paymentAmountCents,amountCents:paymentAmountCents,buyPriceCents,initialAmountCents,pricingSnapshot:{...pricing},canRent:true,availableCount:4,reader:{status:'ready'}};
}

// Fit the three priced columns within the selected card height.
export function checkoutHowItWorksGeometry(base,width,height,stage){
  if(stage!=='information')return base;
  return {...base,contentScale:Math.min(base.contentScale ?? 1,base.expandedHeight/((height>width?640:560)*base.scale))};
}

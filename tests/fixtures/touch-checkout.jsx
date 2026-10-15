import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CheckoutPanel} from '../../src/integrated-media/CheckoutPreview.jsx';
import {defaultStripeUi} from '../../src/integrated-media/stripeUi.js';
import StationBrandBackground from '../../src/integrated-media/StationBrandBackground.jsx';
import '../../src/index.css';
import '../../src/integrated-media/media-studio.css';
const profile=defaultStripeUi();
const params=new URLSearchParams(location.search);
const portrait=params.get('orientation')==='portrait';
const width=portrait?1080:1280,height=portrait?1920:800;
profile.defaultLanguage=params.get('lang') || 'en';
if(params.has('opacity'))profile.cardOpacityPercent=Number(params.get('opacity'));
const eventPricing=params.get('terms')==='true';
const offer={touch:false,paymentRequired:true,currency:'usd',amountCents:3000,depositAmountCents:3000,
  planCode:params.get('terms')==='true'?'EVENT_SIMPLE':'PURCHASE_SIMPLE_DAILY',controllerOnline:true,availableCount:1,canRent:true,
  pricingLines:['$30.00 temporary card authorization','$2.00 if returned the same day','$30.00 if not returned'],
  paymentTerms:['Only the final rental charge is collected; the unused authorization is released.'],reader:{status:'ready'}};
if(eventPricing)Object.assign(offer,{amountCents:100,depositAmountCents:100,gatewayOption:'FULLPRICE',buyPriceCents:100,
 paymentAmountCents:100,initialAmountCents:100,dailyPriceCents:100,initialPeriodHours:24,overdueDays:Number(params.get('overdue')) || 30,
 pricingSnapshot:{taxrate:0,rate:[{time:1440,price:0},{time:2880,price:1}]},
 pricingLines:['Free if returned by end of day (first 24 hours)','$1.00 for each additional 24-hour period','$1.00 if not returned after 30 days'],
 paymentTerms:['I accept the $1.00 temporary card authorization, applicable rental charges, and the Terms and Conditions.','Only the final rental charge is collected; the unused authorization is released.']});
if(params.get('gateway')==='INITIALPRICE')offer.gatewayOption='INITIALPRICE';
function Preview(){
 const [checkout,setCheckout]=useState({stationId:'US6000',connected:true,availabilityFresh:true,liveTerminalEnabled:true,offer});
 useEffect(()=>{window.touchPreview={soldOut:()=>setCheckout(c=>({...c,offer:{...offer,availableCount:0,canRent:false}})),
  refill:()=>setCheckout(c=>({...c,offer})),
  returnWhileCollecting:progress=>setCheckout(c=>({...c,busy:'pay',paymentProgress:progress,
    interaction:{id:'next-rental',stationId:'US6000',phase:'authorizing',moneyStatus:'pending',amountCents:100,currency:'usd',slot:3},
    returnEvent:{type:'charger_returned',stationId:'US6000',eventId:'physical-return-001',slot:9,occurredAt:new Date().toISOString(),transactionId:'returned-rental',receiptUrl:'https://chargerentstations.com/receipt/returned-rental?key=fixture-receipt'}})),
  collectionProgress:progress=>setCheckout(c=>({...c,paymentProgress:progress,offer:{...c.offer,canRent:false,controllerOnline:false}})),
  collectionStopped:()=>setCheckout(c=>({...c,busy:false,paymentProgress:null,interaction:{...c.interaction,phase:'cancelled',moneyStatus:'voided'}})),
  unknown:()=>setCheckout(c=>({...c,offer:{...offer,availableCount:0,canRent:false,controllerOnline:false}})),
  touchOn:()=>setCheckout(c=>({...c,offer:{...offer,touch:true},interaction:{id:'fixture-card-wait',phase:'awaiting_payment',amountCents:100,currency:'usd'},returnEvent:null})),
  phase:phase=>setCheckout(c=>({...c,interaction:{id:'rental-1',stationId:'US6000',phase,moneyStatus:phase==='succeeded'?'authorized':'pending',slot:3,amountCents:100,currency:'usd',transactionId:'rental-1',receiptUrl:'https://chargerentstations.com/receipt/rental-1?key=fixture-receipt'},returnEvent:null})),
  returned:()=>setCheckout(c=>({...c,returnEvent:{type:'charger_returned',stationId:'US6000',eventId:'physical-return-001',slot:9,occurredAt:new Date().toISOString(),transactionId:'rental-1',receiptUrl:'https://chargerentstations.com/receipt/rental-1?key=fixture-receipt'}}))};return()=>{delete window.touchPreview;};},[]);
 return <main style={{position:'relative',width,height,background:'#142f3c','--ms-preview-pixel':'1px'}}><StationBrandBackground brand="chargerent"/><CheckoutPanel checkout={checkout} stripeUi={profile} height={Number(params.get('height')) || .32} viewportWidth={width} viewportHeight={height}/></main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);

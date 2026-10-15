import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import StripeProfileEditor from '../../src/integrated-media/StripeProfileEditor.jsx';
import {defaultStripeUi} from '../../src/integrated-media/stripeUi.js';
import {defaultReceiptPage} from '../../functions/receiptPageProfile.mjs';
import '../../src/index.css';

// Read-only US8012 display settings checked on 2026-10-15. Availability is an example.
const pricing={text:'EVENT - SIMPLE',touch:false,currency:'US',authamount:1,buyprice:55,dailyprice:55,overdue:30,initialperiod:24,rate:[{time:1440,price:0},{time:2880,price:55}]};
const kiosks=[{stationid:'US8012',hardware:{type:'CK40',gateway:'STRIPE',gatewayoptions:'FULLPRICE'},pricing},
  {stationid:'TOUCH_DEMO',hardware:{gateway:'STRIPE',gatewayoptions:'INITIALPRICE'},pricing:{...pricing,text:'PURCHASE - SIMPLE DAILY',touch:true,rate:[{time:1440,price:5}]}}];
const manifest={stationId:'US8012',orientation:'portrait',zones:[],assets:[],checkout:{enabled:true,height:.28}};
function Harness(){
  const [profile,setProfile]=useState(defaultStripeUi());
  const [receiptPage,setReceiptPage]=useState(defaultReceiptPage()),[logoFile,setLogoFile]=useState(null);
  const [checkout,setCheckout]=useState(manifest.checkout);
  useEffect(()=>{window.editorDraft=profile;},[profile]);
  useEffect(()=>{window.editorCheckoutDraft=checkout;},[checkout]);
  useEffect(()=>{window.receiptPageDraft=receiptPage;},[receiptPage]);
  return <main style={{maxWidth:1400,margin:'0 auto',padding:24}}><StripeProfileEditor value={profile} checkout={checkout} onCheckoutChange={setCheckout} receiptPage={receiptPage} onReceiptPageChange={setReceiptPage} receiptLogoFile={logoFile} onReceiptLogoFileChange={setLogoFile} receiptLogoUploadEnabled receiptBrandName="Gartner" manifest={manifest} previewStations={kiosks.map(k=>k.stationid)} previewKiosks={kiosks} onChange={setProfile}/></main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);

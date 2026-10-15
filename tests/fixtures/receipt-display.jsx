import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CheckoutPanel} from '../../src/integrated-media/CheckoutPreview.jsx';
import {defaultStripeUi} from '../../src/integrated-media/stripeUi.js';
import '../../src/index.css';
import '../../src/integrated-media/media-studio.css';

const params=new URLSearchParams(location.search);
const directTap=params.get('directTap')==='true';
const portrait=params.get('orientation')==='portrait';
const width=portrait?1080:1280,screenHeight=portrait?1920:800;
const offer={touch:!directTap,currency:'usd',amountCents:0,availableCount:4,canRent:true,paymentRequired:directTap,reader:{status:'ready'}};
const receipt={transactionId:'tx_fixture_123',receiptUrl:'https://example.test/receipt/tx_fixture_123?key=fixture_signed_key'};
function ReceiptExample({kind}) {
  const [event,setEvent]=useState(()=>({eventId:`receipt-${kind}`,type:kind==='returned'?'charger_returned':'rental_dispensed',stationId:'LOCAL-KIOSK',slot:3,occurredAt:new Date().toISOString()}));
  const profile=defaultStripeUi();profile.screenTimeoutSeconds=120;
  profile.defaultLanguage=params.get('lang') || 'en';
  if(params.get('longCaption')==='true'){
    profile.locales[profile.defaultLanguage].receiptScan='Scan this QR code to view your receipt and rental details.';
    profile.locales[profile.defaultLanguage].receiptPending='Your receipt is being prepared. Please wait a moment.';
  }
  const checkout={stationId:'LOCAL-KIOSK',connected:true,offer,...(kind==='returned'?{returnEvent:event}:{vendEvent:event})};
  return <section data-testid={kind}>
    <div style={{position:'relative',width,height:screenHeight,background:'#eef2ee','--ms-preview-pixel':'1px'}}>
      <CheckoutPanel stripeUi={profile} checkout={checkout} height={Number(params.get('height')) || .27} viewportWidth={width} viewportHeight={screenHeight}/>
    </div>
    <button onClick={()=>setEvent(value=>({...value,slot:4,...receipt}))}>Wrong slot receipt</button>
    <button onClick={()=>setEvent(value=>({...value,slot:3,...receipt}))}>Deliver receipt</button>
    <button onClick={()=>setEvent(value=>({...value}))}>Repeat receipt</button>
    <button onClick={()=>setEvent(value=>({...value,receiptUrl:`${receipt.receiptUrl}&refresh=${Date.now()}`}))}>Update receipt link</button>
  </section>;
}
createRoot(document.getElementById('root')).render(<main><ReceiptExample kind="returned"/><ReceiptExample kind="succeeded"/></main>);

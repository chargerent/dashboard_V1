import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CheckoutPanel} from '../../src/integrated-media/CheckoutPreview.jsx';
import {defaultStripeUi} from '../../src/integrated-media/stripeUi.js';
import '../../src/index.css';
import '../../src/integrated-media/media-studio.css';

const offer={currency:'usd',amountCents:0,availableCount:4,canRent:true,paymentRequired:false,reader:{status:'ready'}};
const receipt={transactionId:'tx_fixture_123',receiptUrl:'https://example.test/receipt/tx_fixture_123?key=fixture_signed_key'};
function ReceiptExample({kind}) {
  const [event,setEvent]=useState(()=>({eventId:`receipt-${kind}`,type:kind==='returned'?'charger_returned':'rental_dispensed',stationId:'LOCAL-KIOSK',slot:3,occurredAt:new Date().toISOString()}));
  const profile=defaultStripeUi();profile.screenTimeoutSeconds=120;
  const checkout={stationId:'LOCAL-KIOSK',connected:true,offer,...(kind==='returned'?{returnEvent:event}:{vendEvent:event})};
  return <section data-testid={kind}>
    <div style={{position:'relative',width:1280,height:800,background:'#eef2ee','--ms-preview-pixel':'1px'}}>
      <CheckoutPanel stripeUi={profile} checkout={checkout} height={.27} viewportWidth={1280} viewportHeight={800}/>
    </div>
    <button onClick={()=>setEvent(value=>({...value,slot:4,...receipt}))}>Wrong slot receipt</button>
    <button onClick={()=>setEvent(value=>({...value,slot:3,...receipt}))}>Deliver receipt</button>
    <button onClick={()=>setEvent(value=>({...value}))}>Repeat receipt</button>
  </section>;
}
createRoot(document.getElementById('root')).render(<main><ReceiptExample kind="returned"/><ReceiptExample kind="succeeded"/></main>);

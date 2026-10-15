import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {CheckoutPanel} from '../../src/integrated-media/CheckoutPreview.jsx';
import profile from './app-test-v2-effective-20261003.json';
import '../../src/index.css';
import '../../src/integrated-media/media-studio.css';

const offer={currency:'usd',amountCents:100,availableCount:4,canRent:true,reader:{status:'ready'}};
const scenarios=[
  {name:'awaiting-payment',phase:'awaiting_payment'},
  {name:'authorizing',phase:'authorizing'},
  {name:'dispensing',phase:'dispensing',moneyStatus:'authorized'},
  {name:'unknown',phase:'unknown'},
  {name:'no-interaction'},
  {name:'succeeded',phase:'succeeded',slot:7,moneyStatus:'captured'},
  {name:'missing-slot',phase:'succeeded',moneyStatus:'refunded'},
  {name:'release-failed',phase:'failed'},
  {name:'cancelled',phase:'cancelled'},
  {name:'returned',phase:'succeeded',slot:7,moneyStatus:'refunded'},
];

function ReturnAvailabilityHarness() {
  const [status,setStatus]=useState('ready');
  const connected=status!=='offline';
  const currentOffer=status==='sold-out'?{...offer,canRent:false,availableCount:0}:offer;
  return <section data-testid="return-availability">
    <div>
      <button onClick={()=>setStatus('sold-out')}>Simulate sold out</button>
      <button onClick={()=>setStatus('error')}>Simulate return failure</button>
      <button onClick={()=>setStatus('offline')}>Simulate offline</button>
    </div>
    <div style={{position:'relative',width:1080,height:1920,background:'#000','--ms-preview-pixel':'1px'}}>
      <CheckoutPanel checkout={{connected,offer:currentOffer,error:status==='error'?'Return session unavailable':''}} stripeUi={profile.stripeUi} height={profile.checkout.height} viewportWidth={1080} viewportHeight={1920}/>
    </div>
  </section>;
}

createRoot(document.getElementById('root')).render(<main style={{display:'grid',gap:24}}>
  <ReturnAvailabilityHarness/>
  {scenarios.map(({name,phase,slot,moneyStatus})=><section key={name} data-testid={`recovery-${name}`} style={{position:'relative',width:1080,height:1920,background:'#000','--ms-preview-pixel':'1px'}}>
    <CheckoutPanel checkout={{stationId:'FR8011',connected:false,recovering:true,liveTerminalEnabled:true,offer,
      interaction:phase?{id:`rental-${name}`,phase,slot,moneyStatus:moneyStatus || 'none',currency:'usd',amountCents:100}:null}}
      stripeUi={profile.stripeUi} height={profile.checkout.height} viewportWidth={1080} viewportHeight={1920}/>
  </section>)}
</main>);

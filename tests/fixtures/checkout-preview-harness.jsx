import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import StripeProfileEditor from '../../src/integrated-media/StripeProfileEditor.jsx';
import {CheckoutPanel} from '../../src/integrated-media/CheckoutPreview.jsx';
import appTestV2 from './app-test-v2-effective-20261003.json';
import '../../src/index.css';

// The Checkout UI and panel height are the read-only effective App Test v2
// snapshot after the hosted validator. Media is absent from that profile.
const manifest = {
  schemaVersion: 1,
  stationId: 'FR8011',
  revision: 0,
  orientation: 'portrait',
  background: '#000000',
  zones: [],
  assets: [],
  checkout: appTestV2.checkout,
};
// A separate local-lab offer matches the Android simulator's Review values.
// It does not claim to be the current FR8011 station quote.
const labOffer = {currency:'usd',amountCents:100,depositAmountCents:100,rentalFeeCents:100,refundAmountCents:0,availableCount:4,canRent:true,gateway:'STRIPE',reader:{status:'ready'}};

function Harness() {
  const [profile,setProfile]=useState(appTestV2.stripeUi);
  return <main style={{maxWidth:1400,margin:'0 auto',padding:24}}>
    <StripeProfileEditor value={profile} checkout={manifest.checkout} manifest={manifest} previewOffer={labOffer} previewStations={['FR8011']} onChange={setProfile}/>
    {new URLSearchParams(window.location.search).has('offer-lines') && <section data-testid="live-offer-lines-example" style={{position:'relative',width:1080,height:1920,marginTop:32,background:'#000','--ms-preview-pixel':'1px'}}>
      <CheckoutPanel checkout={{stationId:'FR8011',connected:true,liveTerminalEnabled:true,offer:{currency:'usd',amountCents:500,depositAmountCents:500,pricingLines:['$1.00 for 24 hours','$20.00 if not returned'],availableCount:4,canRent:true,reader:{status:'ready'}}}} previewOnly previewStage="review" stripeUi={profile} height={manifest.checkout.height} viewportWidth={1080} viewportHeight={1920}/>
    </section>}
  </main>;
}

createRoot(document.getElementById('root')).render(<Harness/>);

import '../../src/index.css';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import StationBrandBackground from '../../src/integrated-media/StationBrandBackground.jsx';
import StripeProfileEditor from '../../src/integrated-media/StripeProfileEditor.jsx';
import {defaultStripeUi} from '../../src/integrated-media/stripeUi.js';
const kiosks=[{stationid:'US8001',stationBrand:'chargedrops'},{stationid:'US6000',stationBrand:'eventcharging'},{stationid:'FR8011',stationBrand:'chargerent'}];
function Fixture() {
 const [brand,setBrand]=useState('chargedrops');
 return <><label>Owner <select aria-label="Owner" value={brand} onChange={e=>setBrand(e.target.value)}>{kiosks.map(k=><option key={k.stationBrand}>{k.stationBrand}</option>)}</select></label>
 <div data-testid="owner-home" style={{position:'relative',width:1280,height:800}}><StationBrandBackground brand={brand}/></div>
 <StripeProfileEditor value={defaultStripeUi()} checkout={{enabled:true,height:.16}} previewStations={kiosks.map(k=>k.stationid)} previewKiosks={kiosks} manifest={{stationId:'EXAMPLE',orientation:'landscape',stationBrandBackground:true,stationBrand:'chargerent',assets:[],zones:[]}} onChange={()=>{}}/>
 </>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);

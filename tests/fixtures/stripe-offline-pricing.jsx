import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import KioskEditPanel from '../../src/components/kiosk/KioskEditPanel.jsx';
import '../../src/index.css';
const local = new URLSearchParams(location.search).get('legacy') !== 'true';
const sample = {stationid:'US6000',stationBrand:'eventcharging',info:{location:'Offline pricing preview'},
  hardware:{type:'CT12',vendor:'lita',gateway:'STRIPE',gatewayoptions:'FULLPRICE',checkoutExecution:local?'local':'server',billingOwner:local?'local_station_v1':'amazon_v2'},
  pricing:{currency:'US',symbol:'$',authamount:2,dailyprice:2,buyprice:30,initialperiod:24,overdue:7,text:'PURCHASE - SIMPLE DAILY'}};
function Preview() {
 const [kiosk,setKiosk] = useState(sample);
 return <main className="mx-auto max-w-3xl p-4"><KioskEditPanel kiosk={kiosk} t={key=>key} onSave={(stationId,section,form)=>{
   window.savedPricing={stationId,section,pricing:form.pricing};setKiosk({...kiosk,pricing:form.pricing});
 }}/><pre id="saved">{JSON.stringify(window.savedPricing?.pricing||{},null,2)}</pre></main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);

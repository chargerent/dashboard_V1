import qrcode from './vendor/qrcode.mjs';
import {stringToBytes} from './vendor/qrcode_UTF8.mjs';

// Encode locally: configured customer links never go to a third-party QR service.
qrcode.stringToBytes=stringToBytes;
const HELP_PHONE='+18189969991';
const STATION_ID=/^[A-Z0-9_-]{1,64}$/;

function qrDataUrl(payload) {
  const qr=qrcode(0,'M');qr.addData(payload,'Byte');qr.make();
  const modules=qr.getModuleCount(),margin=4,size=modules+margin*2;
  let path='';
  for(let y=0;y<modules;y++)for(let x=0;x<modules;x++)if(qr.isDark(y,x))path+=`M${x+margin} ${y+margin}h1v1h-1z`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path d="${path}" fill="#000"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function customerHelpSmsUrl(stationId) {
  const station=String(stationId || '').trim().toUpperCase();
  if(!STATION_ID.test(station))return null;
  return `sms:${HELP_PHONE}?body=${encodeURIComponent(`I need help! ${station}`)}`;
}

export function customerHelpUrl(template,stationId) {
  const station=String(stationId || '').trim().toUpperCase();
  if(!STATION_ID.test(station))return null;
  const value=String(template || '').trim();
  if(!value)return customerHelpSmsUrl(station);
  const variables=value.match(/\{[^{}]+\}/g) || [];
  if(variables.some(variable=>variable!=='{stationId}'))return null;
  const link=value.replaceAll('{stationId}',encodeURIComponent(station));
  if(/[{}]/.test(link))return null;
  try {
    const url=new URL(link);
    if(url.protocol!=='https:'||!url.hostname||url.username||url.password||/[\s\\]/.test(link))return null;
    return link;
  } catch {return null;}
}

export async function customerHelpQrDataUrl(template,stationId) {
  if(stationId===undefined){stationId=template;template='';}
  const link=customerHelpUrl(template,stationId);
  return link ? qrDataUrl(link) : null;
}

// One customer landing page keeps support and the matching rental document reachable.
export function customerHelpTermsUrl(template,stationId,planCode,language='en') {
  const help=customerHelpUrl(template,stationId);
  if(!help)return null;
  const url=new URL('https://chargerentstations.com/terms/help-and-terms.html');
  url.searchParams.set('station',String(stationId).trim().toUpperCase());
  const plan=String(planCode || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_');
  if(plan)url.searchParams.set('plan',plan);
  url.searchParams.set('lang',['en','fr','es'].includes(language)?language:'en');
  if(String(template || '').trim())url.searchParams.set('help',help);
  return url.href;
}

export async function stripeQrDataUrl(value) {
  if(typeof value!=='string'||!value.trim()||value.length>1000)return null;
  const link=value.trim();
  try {
    const url=new URL(link);
    if(url.protocol!=='https:'||!url.hostname||url.username||url.password||/[\s\\]/.test(link))return null;
    return qrDataUrl(link);
  } catch {return null;}
}

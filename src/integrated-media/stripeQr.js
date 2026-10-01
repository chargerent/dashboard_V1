import qrcode from './vendor/qrcode.mjs';
import {stringToBytes} from './vendor/qrcode_UTF8.mjs';

// Encode locally: configured customer links never go to a third-party QR service.
qrcode.stringToBytes=stringToBytes;
const HELP_PHONE='+18189969991';
const STATION_ID=/^[A-Z0-9_-]{1,64}$/;

function qrDataUrl(payload) {
  const qr=qrcode(0,'M');qr.addData(payload,'Byte');qr.make();
  return qr.createDataURL(5,20);
}

export function customerHelpSmsUrl(stationId) {
  const station=String(stationId || '').trim().toUpperCase();
  if(!STATION_ID.test(station))return null;
  return `sms:${HELP_PHONE}?body=${encodeURIComponent(`I need help! ${station}`)}`;
}

export async function customerHelpQrDataUrl(stationId) {
  const link=customerHelpSmsUrl(stationId);
  return link ? qrDataUrl(link) : null;
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

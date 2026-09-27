import qrcode from './vendor/qrcode.mjs';
import {stringToBytes} from './vendor/qrcode_UTF8.mjs';

// Encode locally: configured customer links never go to a third-party QR service.
qrcode.stringToBytes=stringToBytes;
export async function stripeQrDataUrl(value) {
  if(typeof value!=='string'||!value.trim()||value.length>1000)return null;
  const link=value.trim();
  try {
    const url=new URL(link);
    if(url.protocol!=='https:'||!url.hostname||url.username||url.password||/[\s\\]/.test(link))return null;
    const qr=qrcode(0,'M');qr.addData(link,'Byte');qr.make();
    return qr.createDataURL(5,20);
  } catch {return null;}
}

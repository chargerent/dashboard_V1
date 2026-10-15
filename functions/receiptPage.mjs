/* global document, navigator, window */
import {defaultReceiptPage, normalizeReceiptPage} from './receiptPageProfile.mjs';
// Public, transaction-specific receipt view. Its API returns a narrow server-side
// projection; the browser never reads Firestore or decides a payment settlement.
const htmlText = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const scriptJson = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

export function renderReceiptPage({transactionId, apiUrl, receipt = null, initialReceipt = receipt, page = initialReceipt?.page, language, preview = false, previewLogoUrl} = {}) {
  if (typeof transactionId !== 'string' || !transactionId.trim()) throw new TypeError('A transaction ID is required.');
  if (typeof apiUrl !== 'string' || !/^\/(?:media-kiosk\/)?api\/receipts\/[A-Za-z0-9_.:%-]+\?key=[A-Za-z0-9_.%~-]+$/.test(apiUrl)) throw new TypeError('A same-origin receipt API URL is required.');
  const profile=normalizeReceiptPage(page || defaultReceiptPage());
  const selected=profile.enabledLanguages.includes(language)?language:profile.defaultLanguage;
  const text=key=>htmlText(profile.locales[selected][key]);
  const config = scriptJson({transactionId, apiUrl, receipt:initialReceipt, page:profile, language, preview, previewLogoUrl:preview?previewLogoUrl:undefined});
  return `<!doctype html>
<html lang="${selected}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow,noarchive"><title>${text('pageTitle')}</title>
<style>
:root{color-scheme:light;--ink:#123e31;--muted:#53645d;--line:#dee6df;--paper:#fff;--wash:#f4f7f3;--tint:#eaf3eb}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:15px;line-height:1.45}.receipt{max-width:480px;margin:32px auto;padding:32px;background:var(--paper);border-radius:20px}header{display:flex;gap:18px;align-items:center;justify-content:space-between;margin-bottom:32px}.logo{display:block;max-width:180px;max-height:58px;object-fit:contain;object-position:left center}.brand{font-size:20px;font-weight:650;overflow-wrap:anywhere}.eyebrow{color:var(--muted);font-size:13px;margin:0 0 6px}.tag{border-radius:20px;background:var(--tint);padding:5px 11px;white-space:nowrap;font-size:13px}h1{font-size:28px;line-height:1.2;margin:0 0 8px;font-weight:650}.summary{margin:0 0 26px;color:var(--muted)}.section{border-top:1px solid var(--line);padding:20px 0}.section h2{font-size:14px;font-weight:600;margin:0 0 14px}.row{display:flex;justify-content:space-between;gap:20px;padding:5px 0;align-items:start}.row dt{color:var(--muted)}.row dd{margin:0;text-align:right;overflow-wrap:anywhere;max-width:65%;font-variant-numeric:tabular-nums}.money{font-weight:600;color:var(--ink)}dl{margin:0}.payment-note{margin:12px 0 0;color:var(--muted);font-size:13px}.transaction{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}.pricing{padding:0;margin:12px 0 0;list-style:none;color:var(--muted);font-size:13px}.pricing li+li{margin-top:5px}.footer{padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}.actions{display:flex;gap:12px;margin-top:22px}button{font:inherit;min-height:44px;border:0;border-radius:12px;padding:10px 16px;background:var(--tint);color:var(--ink);cursor:pointer}button:first-child{background:var(--ink);color:var(--paper);flex:1}button:disabled{opacity:.6}.notice{font-size:13px;color:var(--muted);margin:12px 0 0}[hidden]{display:none!important}@media(max-width:520px){body{background:var(--paper)}.receipt{margin:0;max-width:none;padding:28px 22px;border-radius:0}}@media print{body{background:#fff}.receipt{margin:0;max-width:none}.actions,.notice{display:none}}
:root{--ink:#153e31;--muted:#5b6c62;--line:#e1e9e1;--tint:#edf4ed}body{font-size:14px;line-height:1.5}.receipt{padding:28px}header{justify-content:flex-start;margin-bottom:26px}.brand{font-size:17px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase}.eyebrow{font-size:11px;letter-spacing:1.5px;margin-bottom:7px}h1{font-weight:600;letter-spacing:-.5px;margin-bottom:10px}.summary{font-size:13px;margin-bottom:22px}.tag{display:inline-block;font-size:12px;margin-bottom:22px;padding:5px 10px}.section{padding:17px 0}.section h2{font-size:12px;margin-bottom:12px}.money{font-weight:400}.payment-note,.pricing{font-size:12px}.transaction{font-size:11px}.footer{border-top:0;padding-top:0}.actions{margin-top:20px}.actions button{font-size:14px;font-weight:500;border-radius:11px}.receipt-foot{font-size:11px;text-align:center;margin:14px 0 0}.updates{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;margin-top:12px}.updates button{background:transparent;font-size:12px;padding:0 5px;min-height:32px;text-decoration:underline}@media(max-width:520px){.receipt{padding:28px 22px}}@media print{.updates{justify-content:flex-start}.updates button{display:none}}
.row.total dt,.row.total dd{font-weight:700;color:var(--ink)}
</style></head><body><main class="receipt" id="receipt-view" aria-label="Rental receipt" data-receipt-style="clean">
<header><div><img class="logo" id="logo" hidden alt="Client logo" referrerpolicy="no-referrer"><span class="brand" id="brand">Chargerent</span></div></header>
<p class="eyebrow" id="eyebrow">${text('eyebrow')}</p><h1 id="heading">${text('loadingTitle')}</h1><p class="summary" id="summary">${text('loadingSummary')}</p>
<span class="tag" id="status">${text('loadingStatus')}</span>
<section class="section"><h2 id="rental-heading">${text('rentalHeading')}</h2><dl id="rental-details"></dl></section>
<section class="section"><h2 id="payment-heading">${text('paymentHeading')}</h2><dl id="payment-details"></dl><p class="payment-note" id="payment-note"></p><ul class="pricing" id="pricing"></ul></section>
<section class="section"><h2 id="transaction-heading">${text('transactionHeading')}</h2><div class="transaction" id="transaction"></div></section>
<footer class="footer"><div class="actions"><button type="button" id="save">${text('saveButton')}</button></div><p class="receipt-foot" id="footer-message">${text('footer')}</p><div class="updates"><span id="updated">${text('checkingStatus')}</span><button type="button" id="refresh">${text('refreshButton')}</button></div><p id="notice" class="notice" role="status" aria-live="polite"></p></footer>
</main><script>(${receiptBoot.toString()})(${config});</script></body></html>`;
}

function receiptBoot(config) {
  const el = id => document.getElementById(id);
  let current = null, loading = false, copy, locale;
  const applyPage = page => {
    const preferred=config.language || navigator.language?.split('-')[0];
    locale=page.enabledLanguages.includes(preferred)?preferred:page.defaultLanguage;
    copy=page.locales[locale];
    document.documentElement.lang=locale;document.title=copy.pageTitle;
    for (const [id,key] of Object.entries({'eyebrow':'eyebrow','rental-heading':'rentalHeading','payment-heading':'paymentHeading','transaction-heading':'transactionHeading','save':'saveButton','refresh':'refreshButton','footer-message':'footer','updated':'checkingStatus'})) el(id).textContent=copy[key];
  };
  applyPage(config.page);
  const t = key => copy[key] ?? config.page.locales[config.page.defaultLanguage][key];
  const date = value => {const time=new Date(value);return value && Number.isFinite(time.getTime())?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(time):t('pending');};
  const money = (value,currency) => {
    if (!Number.isSafeInteger(value) || value<0) return t('pending');
    try {return new Intl.NumberFormat(locale,{style:'currency',currency:currency.toUpperCase()}).format(value/100);} catch {return t('pending');}
  };
  const row = (target,label,value,amount=false,total=false) => {
    const wrap=document.createElement('div');wrap.className=total?'row total':'row';
    const name=document.createElement('dt');name.textContent=label;
    const text=document.createElement('dd');text.textContent=value;if(amount)text.className='money';
    wrap.append(name,text);target.append(wrap);
  };
  const location = value => value?[value.name,value.id].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · '):t('pending');
  const safeLogo = value => {try {const url=new URL(value);return (url.protocol==='https:' || config.preview && /^data:image\/(png|jpeg|webp);base64,/.test(value)) && !url.username && !url.password && !url.hash?url.href:null;} catch {return null;}};
  function render(value) {
    if (!value || value.transactionId!==config.transactionId) throw new Error('This receipt does not match the transaction.');
    applyPage(value.page || config.page);
    current=value;
    const returned=value.status==='returned',purchased=value.status==='purchased',payment=value.payment||{},currency=value.currency||'';
    const state=returned?'returned':purchased?'purchased':'renting';
    el('status').textContent=t(state+'Status');el('heading').textContent=t(state+'Title');el('summary').textContent=t(state+'Summary');
    el('brand').textContent=value.brand?.name||'Chargerent';
    const page=value.page || config.page;
    const logo=safeLogo(config.previewLogoUrl || (Object.hasOwn(page,'logo')?page.logo?.url:value.brand?.logoUrl));
    el('logo').hidden=!logo;el('brand').hidden=!!logo;
    if(logo){el('logo').src=logo;el('logo').alt=(value.brand?.name||'Client')+' logo';}else el('logo').removeAttribute('src');
    el('rental-details').replaceChildren();row(el('rental-details'),t('rentalStationLabel'),location(value.station));row(el('rental-details'),t('rentedAtLabel'),date(value.rentedAt));
    if(returned){row(el('rental-details'),t('returnedAtLabel'),date(value.returnedAt));row(el('rental-details'),t('returnStationLabel'),location(value.returnStation));}
    el('payment-details').replaceChildren();
    row(el('payment-details'),t(['pending','declined'].includes(payment.state)?'initialAmountLabel':payment.state==='authorized'?'cardHoldLabel':payment.upfrontKind==='deposit'?'depositLabel':'initialPaymentLabel'),money(payment.upfrontCents,currency),true,!returned&&!purchased&&payment.state==='captured');
    if(returned||purchased)row(el('payment-details'),t('finalChargeLabel'),money(payment.finalChargeCents,currency),true,true);
    if(Number.isSafeInteger(payment.refundedCents)&&payment.refundedCents>0)row(el('payment-details'),t('refundLabel'),money(payment.refundedCents,currency),true);
    if(Number.isSafeInteger(payment.releasedCents)&&payment.releasedCents>0)row(el('payment-details'),t('holdReleasedLabel'),money(payment.releasedCents,currency),true);
    el('payment-note').textContent=t(payment.state==='declined'?'offlineDeclinedNote':payment.state==='pending'&&payment.collectedOffline===true&&!returned&&!purchased?'offlinePendingNote':payment.refundedCents>0?'refundNote':payment.releasedCents>0?'holdReleasedNote':returned&&payment.state!=='settled'?'settlementPendingNote':payment.state==='authorized'?'authorizationNote':returned?'settledNote':'activeNote');
    el('pricing').replaceChildren();for(const line of value.pricingLines||[]){if(typeof line!=='string')continue;const item=document.createElement('li');item.textContent=line;el('pricing').append(item);}
    el('transaction').textContent=value.transactionId;el('updated').textContent=t('lastUpdated').replaceAll('{updatedAt}',date(value.updatedAt));el('notice').textContent='';
  }
  async function refresh() {
    if(loading || config.preview)return;loading=true;el('refresh').disabled=true;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch(config.apiUrl,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
      const data=await response.json();if(!response.ok)throw new Error(t('unavailableMessage'));
      render(data.receipt||data);
    } catch {
      if(!current){el('heading').textContent=t('unavailableTitle');el('status').textContent=t('unavailableStatus');el('summary').textContent=t('unavailableSummary');}
      el('notice').textContent=t(current?'refreshFailedMessage':'unavailableMessage');
    } finally {clearTimeout(timeout);loading=false;el('refresh').disabled=false;}
  }
  el('logo').addEventListener('error',()=>{el('logo').hidden=true;el('brand').hidden=false;});
  if(!config.preview){el('save').addEventListener('click',()=>window.print());el('refresh').addEventListener('click',refresh);}
  if(config.receipt){try{render(config.receipt);}catch{ /* Refresh still verifies the transaction. */ }}
  if(!config.preview){refresh();setInterval(()=>{if(!document.hidden)refresh();},15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});}
}

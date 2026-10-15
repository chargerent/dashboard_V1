import {useEffect,useMemo,useState} from 'react';
import ReceiptLogoField from '../components/ReceiptLogoField.jsx';
import VariableTextField from './VariableTextField.jsx';
import {defaultReceiptPage,RECEIPT_PAGE_FIELDS,RECEIPT_PAGE_GROUPS} from '../../functions/receiptPageProfile.mjs';
import {renderReceiptPage} from '../../functions/receiptPage.mjs';

const inputClass='mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10';
const updatedAtVariable=[{name:'updatedAt',description:'The latest confirmed receipt update time'}];

export function ReceiptPageFields({value,onChange,language,logoFile,onLogoFileChange,onLogoCheckingChange,logoUploadEnabled=true}) {
  const [group,setGroup]=useState(RECEIPT_PAGE_GROUPS[0]),[query,setQuery]=useState('');
  const page=value || defaultReceiptPage();
  const fields=RECEIPT_PAGE_FIELDS.filter(field=>(query || field.group===group) && (!query || `${field.label} ${page.locales?.[language]?.[field.key] || ''}`.toLowerCase().includes(query.toLowerCase())));
  return <section aria-label="Receipt page fields" className="space-y-5">
    <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4 text-sm leading-6 text-cyan-900">This is the page customers open after scanning their receipt QR. Save and publish this client profile to apply the text and logo. Station names, dates, amounts and payment status come from each transaction.</div>
    <ReceiptLogoField value={page.logo} file={logoFile} onFileChange={onLogoFileChange} onCheckingChange={onLogoCheckingChange}
      disabled={!logoUploadEnabled} onRemove={()=>{onLogoFileChange?.(null);onChange({...page,logo:null});}}/>
    {!logoUploadEnabled && <p className="text-xs text-slate-500">Logo uploads are available to administrators in the live editor.</p>}
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Receipt text group<select aria-label="Receipt text group" value={group} onChange={event=>{setGroup(event.target.value);setQuery('');}} className={inputClass}>{RECEIPT_PAGE_GROUPS.map(name=><option key={name}>{name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Find receipt text<input aria-label="Find receipt text" value={query} onChange={event=>setQuery(event.target.value)} className={inputClass}/></label></div>
    {fields.map(field=><label key={field.key} className="block text-sm font-semibold text-slate-700">{field.label}<VariableTextField
      as={field.multiline?'textarea':'input'} rows={field.multiline?3:undefined} aria-label={`Receipt ${field.label}`} maxLength={2000}
      variables={field.key==='lastUpdated'?updatedAtVariable:[]} value={page.locales?.[language]?.[field.key] ?? defaultReceiptPage().locales[language][field.key]}
      onChange={text=>onChange({...page,locales:{...page.locales,[language]:{...page.locales?.[language],[field.key]:text}}})} className={inputClass}/>
      {field.key==='lastUpdated' && <span className="mt-1 block text-xs font-normal text-slate-500">Use {'{updatedAt}'} for the confirmed update time.</span>}</label>)}
    {!fields.length && <p className="text-sm text-slate-500">No matching receipt text.</p>}
  </section>;
}

export function ReceiptPagePreview({value,language,logoFile,brandName='Client'}) {
  const [state,setState]=useState('returned'),[logoUrl,setLogoUrl]=useState('');
  useEffect(()=>{
    setLogoUrl('');
    if(!logoFile)return;
    const reader=new FileReader();let active=true;
    reader.onload=()=>{if(active)setLogoUrl(String(reader.result));};
    reader.readAsDataURL(logoFile);
    return()=>{active=false;if(reader.readyState===FileReader.LOADING)reader.abort();};
  },[logoFile]);
  const html=useMemo(()=>{
    const page=value || defaultReceiptPage();
    const closed=['returned','refunded','purchased'].includes(state);
    const receipt={transactionId:'example-receipt-8012',status:state==='purchased'?'purchased':closed?'returned':'renting',rentedAt:'2026-10-15T10:00:00Z',returnedAt:closed?'2026-10-15T11:00:00Z':null,
      station:{id:'US8012',name:'Example venue'},returnStation:closed?{id:'US8012',name:'Example venue'}:null,currency:'USD',pricingLines:[],
      payment:{state:state==='offlinePending'?'pending':state==='offlineDeclined'?'declined':closed?'settled':'authorized',collectedOffline:state.startsWith('offline'),upfrontKind:'hold',upfrontCents:100,finalChargeCents:closed?0:null,refundedCents:state==='refunded'?100:0,releasedCents:state==='returned'?100:0},
      brand:{name:brandName},updatedAt:'2026-10-15T11:00:00Z'};
    try {return renderReceiptPage({transactionId:receipt.transactionId,apiUrl:'/api/receipts/example-receipt-8012?key=preview.signature',initialReceipt:receipt,page,language,preview:true,previewLogoUrl:logoUrl});}
    catch {return '';}
  },[value,language,state,logoUrl,brandName]);
  return <aside className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:sticky xl:top-4" aria-label="Receipt preview">
    <h3 className="font-bold text-slate-900">Receipt page preview</h3><p className="mt-1 text-xs leading-5 text-slate-500">Example transaction. The published page uses the customer’s rental details.</p>
    <label className="mt-3 block text-xs font-semibold text-slate-600">Receipt status<select aria-label="Receipt preview status" value={state} onChange={event=>setState(event.target.value)} className={inputClass}>
      <option value="renting">Rental active</option><option value="returned">Returned · hold released</option><option value="refunded">Returned · refunded</option><option value="purchased">Purchased</option><option value="offlinePending">Offline payment pending</option><option value="offlineDeclined">Offline payment declined</option>
    </select></label>
    <iframe title="Receipt page preview" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={html} className="mt-4 h-[900px] w-full rounded-xl border border-slate-200 bg-white"/>
  </aside>;
}

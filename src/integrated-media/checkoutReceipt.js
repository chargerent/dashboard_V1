// Receipt access belongs to one proven vend. A profile link or slot number
// never identifies a customer's transaction.
export function checkoutTransactionReceipt(value) {
  const id=value?.transactionId,link=value?.receiptUrl;
  if(typeof id!=='string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(id) || typeof link!=='string' || link.length>1000 || /[\s\\]/.test(link))return null;
  try {
    const url=new URL(link);
    const segments=url.pathname.split('/');
    if(url.protocol!=='https:' || url.username || url.password || url.hash || segments.at(-2)!=='receipt' || decodeURIComponent(segments.at(-1))!==id || !url.searchParams.get('key'))return null;
    return {transactionId:id,url:url.href};
  } catch {return null;}
}
export function checkoutVendReceipt(interaction) {
  return interaction?.phase==='succeeded' && Number.isSafeInteger(interaction.slot) && interaction.slot>0?checkoutTransactionReceipt(interaction):null;
}
export function checkoutReturnedReceipt(event,interaction) {
  if(event)return event.type==='charger_returned' && Number.isSafeInteger(event.slot) && event.slot>0?checkoutTransactionReceipt(event):null;
  return checkoutVendReceipt(interaction);
}

// Receipt delivery enriches this visible event without reopening it or resetting its timeout.
export function enrichCheckoutNoticeReceipt(notice,event,now=Date.now()) {
  const receipt=checkoutTransactionReceipt(event);
  if(!notice || !receipt || checkoutTransactionReceipt(notice) || notice.noticeExpiresAt<=now ||
    notice.eventId!==event.eventId || notice.type!==event.type || notice.stationId!==event.stationId ||
    notice.slot!==event.slot || Date.parse(notice.occurredAt)!==Date.parse(event.occurredAt))return notice;
  return {...notice,transactionId:receipt.transactionId,receiptUrl:receipt.url};
}

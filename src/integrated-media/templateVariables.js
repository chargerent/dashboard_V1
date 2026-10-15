// These lists describe substitutions already supported by the checkout renderer.
export const CHECKOUT_VARIABLES = [
  {name:'deposit',description:'Card payment or authorization amount'},
  {name:'fee',description:'Rental fee'},
  {name:'refund',description:'Refund amount'},
  {name:'slot',description:'Charger slot number'},
  {name:'available',description:'Available charger count'},
  {name:'eventCharge',description:'Configured non-return price'},
  {name:'overdueDays',description:'Configured non-return deadline in days'},
];
export const PRICING_VARIABLES = [...CHECKOUT_VARIABLES,{name:'rateSummary',description:'Configured station rates, one per line'}];
export const HELP_URL_VARIABLES = [{name:'stationId',description:'Kiosk station ID'}];
export const POPUP_VARIABLES = CHECKOUT_VARIABLES.filter(({name})=>name==='slot');

export function templateVariableQuery(value,selectionStart,selectionEnd=selectionStart) {
  if(selectionStart!==selectionEnd || !Number.isInteger(selectionStart))return null;
  const before=String(value).slice(0,selectionStart);
  const match=before.match(/\{([a-zA-Z0-9_]*)$/);
  if(!match || before[match.index-1]==='{')return null;
  const after=String(value).slice(selectionStart);
  const remainder=after.match(/^[a-zA-Z0-9_]*\}/)?.[0] || '';
  return {start:match.index,end:selectionStart+remainder.length,query:match[1]};
}

export const STATION_BACKGROUNDS = Object.freeze({
  chargerent: {id:'chargerent', label:'Chargerent', website:'charge.rent', accent:'#8D51A3'},
  eventcharging: {id:'eventcharging', label:'Event Charging', website:'eventcharging.com', accent:'#D91F2D'},
  chargedrops: {id:'chargedrops', label:'ChargeDrops', website:'chargedrops.com', accent:'#3E5BCF'},
});
export function stationBackground(value) {
  const key = String(value || 'chargerent').trim().toLowerCase();
  if (!Object.hasOwn(STATION_BACKGROUNDS, key)) throw new Error('Unsupported station owner brand.');
  return STATION_BACKGROUNDS[key];
}

export function ownerBackgroundDraft(draft) {
  if (draft.stationBrandBackground === false) return draft;
  return {...draft, stationBrandBackground:true, background:'#ffffff',
    zones:[{id:'owner',x:0,y:0,width:1,height:1,type:'text',text:'',background:'#ffffff'}]};
}

import {stationBackground} from './stationBackground.js';

/** Uses the same bundled logo and proportions as Android's owner background. */
export default function StationBrandBackground({brand='chargerent', style={}}) {
  const owner = stationBackground(brand);
  return <div role="img" aria-label={`${owner.label} station background`} data-station-brand={owner.id}
    style={{position:'absolute',inset:0,background:'#ffffff',overflow:'hidden',containerType:'size',...style}}>
    <img src={`${import.meta.env.BASE_URL}station-brand/${owner.id}.png`} alt="" style={{position:'absolute',left:'50%',top:'42.625%',transform:'translate(-50%,-50%)',width:'78.125%',maxHeight:'25%',objectFit:'contain'}}/>
    <span style={{position:'absolute',left:0,right:0,top:'59.5%',transform:'translateY(-80%)',textAlign:'center',fontFamily:'Roboto, Arial, sans-serif',fontSize:'min(2.65625cqw, 4.25cqh)',lineHeight:1,color:'#666b72'}}>{owner.website}</span>
    <div style={{position:'absolute',inset:'98.5% 0 0',background:owner.accent}}/>
  </div>;
}

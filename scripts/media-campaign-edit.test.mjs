import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCampaignDraft,campaignEditorValues,campaignReplacementAssignments,campaignsForClient} from '../src/utils/mediaCampaign.js';

const base={name:'Existing campaign',layout:'full',mediaType:'image',stationIds:['US8012'],orientation:'landscape',stationBrandBackground:false,background:'#123456',checkout:{enabled:false,height:.28},
  zones:[{id:'legacy-main',x:0,y:0,width:1,height:1,type:'playlist',muted:false,items:[{assetId:'asset-one',durationMs:27000,rotation:90,fit:'contain'}]}],popup:{durationMs:7000,successTemplate:'Take it.',returnTemplate:'Thank you.',failureTemplate:'Try again.'}};
test('opening and resaving a campaign retains its identity, geometry, timing, fit, rotation and checkout settings',()=>{
  const values=campaignEditorValues({draft:base});
  const result=buildCampaignDraft({clientId:' gartner ',id:'campaign-id',expectedVersion:3,name:'Updated name',layout:{id:values.layout,zones:base.zones},mediaType:values.mediaType,checkoutEnabled:values.checkoutEnabled,stationIds:values.stationIds,zoneMedia:values.zoneMedia,library:[{id:'asset-one'}],baseDraft:base});
  assert.equal(result.clientId,'GARTNER');assert.equal(result.id,'campaign-id');assert.equal(result.expectedVersion,3);
  assert.equal(result.orientation,'landscape');assert.deepEqual(result.zones,base.zones);assert.deepEqual(result.checkout,base.checkout);assert.deepEqual(result.popup,base.popup);
  assert.equal(result.name,'Updated name');assert.equal(result.stationBrandBackground,false);
});
test('legacy omitted owner flag distinguishes playlist media from station branding',()=>{
  const image=structuredClone(base);delete image.stationBrandBackground;
  assert.equal(campaignEditorValues({draft:image}).mediaType,'image');
  const owner={...image,zones:[{id:'owner',type:'text',text:''}]};
  assert.equal(campaignEditorValues({draft:owner}).mediaType,'brand');
  assert.equal(campaignEditorValues(null).mediaType,'brand');
});
test('publication replacement review includes only other campaigns assigned to the selected kiosks',()=>{
  const result=campaignReplacementAssignments([{id:'self',stationIds:['US8012']},{id:'other',stationIds:['FR8012','US6000']},{id:'draft',stationIds:[],draftStationIds:['US8012']}],['US8012','FR8012'],'self');
  assert.deepEqual(result,{FR8012:'other'});
});

test('an unfiltered legacy response of four campaigns shows only the campaign whose kiosks belong to Gartner',()=>{
  const kiosks=[['US8012','GARTNER'],['FR8012','BESITER'],['US6000','LITA'],['FR8011','APP TEST']].map(([stationid,client])=>({stationid,info:{client}}));
  const campaigns=[{id:'main',name:'GARTNER IT 2026 (MAIN)',stationIds:['US8012']},{id:'old',name:'gartner',stationIds:['FR8012']},{id:'event',stationIds:['US6000']},{id:'test',stationIds:['FR8011']}];
  const result=campaignsForClient(campaigns,' gartner ',kiosks);
  assert.deepEqual(result.map(item=>item.id),['main']);
  assert.equal(result[0].clientId,'GARTNER');assert.equal(result[0].needsClientAssignment,true);
  assert.equal(campaigns[0].clientId,undefined,'display filtering never mutates saved ownership');
});

test('client lists exclude unknown, empty, conflicting and mixed-client legacy assignments',()=>{
  const kiosks=[{stationid:'US8012',info:{client:'GARTNER'}},{stationid:'FR8012',info:{client:'BESITER'}},{stationid:'US6000',info:{client:'GARTNER'}},{stationid:'US6000',info:{client:'LITA'}}];
  const campaigns=[{stationIds:[]},{stationIds:['US9999']},{stationIds:['US8012','FR8012']},{stationIds:['US6000']},{clientId:'BESITER',stationIds:['US8012']}];
  assert.deepEqual(campaignsForClient(campaigns,'GARTNER',kiosks),[]);
  assert.deepEqual(campaignsForClient([{id:'explicit',clientId:'gartner',stationIds:[]}],'GARTNER',kiosks).map(item=>item.id),['explicit']);
  assert.deepEqual(campaignsForClient(campaigns,'',kiosks),[]);
});

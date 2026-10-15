import test from 'node:test';
import assert from 'node:assert/strict';
import {CHECKOUT_VARIABLES,PRICING_VARIABLES,HELP_URL_VARIABLES,POPUP_VARIABLES,templateVariableQuery} from '../src/integrated-media/templateVariables.js';
import {defaultStripeUi,stripeText,stripePageText,stripeRentReturnText,validateStripeUi} from '../src/integrated-media/stripeUi.js';

test('suggestions follow the caret and replace the entire existing token',()=>{
  assert.deepEqual(templateVariableQuery('Pay {dep',8),{start:4,end:8,query:'dep'});
  assert.deepEqual(templateVariableQuery('Pay {deposit} today',8),{start:4,end:13,query:'dep'});
  assert.deepEqual(templateVariableQuery('Refund:\n{',9),{start:8,end:9,query:''});
  for(const value of ['Completed {deposit}','A {not a variable','Literal {{dep','Plain text'])assert.equal(templateVariableQuery(value,value.length),null);
  assert.equal(templateVariableQuery('Pay {dep',5,8),null);
});

test('every suggested checkout and page variable is understood by the existing renderer',()=>{
  const profile=defaultStripeUi(),values=Object.fromEntries(CHECKOUT_VARIABLES.map(({name})=>[name,`value:${name}`]));
  for(const {name} of CHECKOUT_VARIABLES){
    profile.locales.en['ready.title']=`{${name}}`;
    assert.equal(stripeText(profile,'en','ready.title',values),values[name]);
    assert.equal(stripePageText(profile,{locales:{en:{title:`{${name}}`}}},'en','title',values),values[name]);
  }
  profile.rentReturn={EVENT_SIMPLE:{noTouch:{en:{pricing:'{rateSummary}'}}}};
  assert.equal(stripeRentReturnText(profile,'en','pricing','EVENT_SIMPLE',false,{rateSummary:'$5 per day'}),'$5 per day');
  assert.equal(PRICING_VARIABLES.length,CHECKOUT_VARIABLES.length+1);
  assert.ok(!CHECKOUT_VARIABLES.some(({name})=>name==='rateSummary'));
});

test('Help URLs and media popups offer only their supported variables',()=>{
  assert.deepEqual(HELP_URL_VARIABLES.map(({name})=>name),['stationId']);
  assert.deepEqual(POPUP_VARIABLES.map(({name})=>name),['slot']);
  const profile=defaultStripeUi();profile.links.help='https://example.com/help?station={stationId}';
  assert.doesNotThrow(()=>validateStripeUi(profile));
  profile.links.help='https://example.com/help?amount={deposit}';
  assert.throws(()=>validateStripeUi(profile),/only the \{stationId\}/);
});

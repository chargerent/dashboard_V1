import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRateArray} from '../src/utils/kioskPricing.js';
import {checkoutHowItWorks,howItWorksOfferFromKiosk} from '../src/integrated-media/howItWorks.js';

const basePricing={authamount:2,dailyprice:5,buyprice:30,initialperiod:3,overdue:4,taxrate:0,currency:'FR'};
const leaseFourDays=[
  {time:1440,price:0},
  {time:2880,price:5},
  {time:4320,price:10},
  {time:5760,price:15},
];

test('Event Simple and Lease Simple Daily have the same first free day and subsequent daily totals',()=>{
  for(const plan of ['EVENT - SIMPLE','LEASE - SIMPLE DAILY']){
    assert.deepEqual(calculateRateArray({...basePricing,text:plan,overdue:1}),[{time:1440,price:0}]);
    assert.deepEqual(calculateRateArray({...basePricing,text:plan}),leaseFourDays);
  }
});

test('Event Simple accepts numeric strings and follows the configured daily price',()=>{
  const pricing={...basePricing,text:'EVENT - SIMPLE',authamount:'30',dailyprice:'3.5',initialperiod:'7',overdue:'4'};
  const expected=[{time:1440,price:0},{time:2880,price:3.5},{time:4320,price:7},{time:5760,price:10.5}];
  assert.deepEqual(calculateRateArray(pricing),expected);
  assert.deepEqual(calculateRateArray({...pricing,text:'LEASE - SIMPLE DAILY'}),expected);
});

test('Event Simple free daily rates do not depend on the initial hours or authorization amount',()=>{
  for(const [initialperiod,authamount] of [[1,0],[7,2],[24,30],[48,80]]){
    assert.deepEqual(calculateRateArray({...basePricing,text:'EVENT - SIMPLE',initialperiod,authamount}),leaseFourDays);
  }
});

test('saving Event Simple pricing can regenerate a previously empty rate list',()=>{
  const input={...basePricing,text:'EVENT - SIMPLE',rate:[]};
  const before=JSON.stringify(input),rates=calculateRateArray(input);
  assert.deepEqual(rates,leaseFourDays);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(input.rate,[]);
  assert.notEqual(rates,input.rate);
});

test('the six existing pricing plans retain their known tier formulas',()=>{
  const expectations={
    'PURCHASE - SIMPLE DAILY':[{time:1440,price:5},{time:2880,price:10},{time:4320,price:15},{time:5760,price:20}],
    'PURCHASE - MIXED DAILY':[{time:180,price:2},{time:1440,price:5},{time:2880,price:10},{time:4320,price:15},{time:5760,price:20}],
    'PURCHASE SIMPLE 24 HRS':[{time:1440,price:5}],
    'PURCHASE - MIXED DAY':[{time:180,price:2},{time:1440,price:5}],
    'LEASE - SIMPLE DAILY':leaseFourDays,
    'LEASE - MIXED DAILY':[{time:180,price:0},{time:1440,price:5},{time:2880,price:10},{time:4320,price:15},{time:5760,price:20}],
  };
  for(const [text,expected] of Object.entries(expectations)){
    assert.deepEqual(calculateRateArray({...basePricing,text}),expected,text);
  }
});

test('unknown pricing plans retain an empty rate list',()=>{
  assert.deepEqual(calculateRateArray({...basePricing,text:'UNKNOWN'}),[]);
});

test('rate generation does not mutate a saved pricing snapshot or reuse its arrays',()=>{
  const savedTier=Object.freeze({time:60,price:99});
  const savedRate=Object.freeze([savedTier]);
  const input=Object.freeze({...basePricing,text:'EVENT - SIMPLE',rate:savedRate});
  const before=JSON.stringify(input),first=calculateRateArray(input),second=calculateRateArray(input);
  assert.deepEqual(first,leaseFourDays);assert.equal(JSON.stringify(input),before);
  assert.equal(input.rate,savedRate);assert.equal(input.rate[0],savedTier);
  assert.notEqual(first,savedRate);assert.notEqual(first,second);assert.notEqual(first[0],second[0]);
});

test('Event and Lease share financial tiers while showing their own return deadline instructions',()=>{
  for(const [language,eventLine,leaseLine] of [
    ['en','Free if returned by end of day.','Free for the first 24 hours.'],
    ['fr','Gratuit si la batterie est rendue avant la fin de la journée.','Gratuit pendant 24 heures.'],
    ['es','Gratis si devuelves la batería antes de que termine el día.','Gratis durante 24 horas.'],
  ]){
    const content=plan=>{
      const pricing={...basePricing,text:plan,authamount:30};
      const kiosk={stationid:'FR8012',hardware:{gateway:'STRIPE',gatewayoptions:'INITIALPRICE'},pricing:{...pricing,rate:calculateRateArray(pricing)}};
      return checkoutHowItWorks({offer:howItWorksOfferFromKiosk(kiosk)},language);
    };
    const event=content('EVENT - SIMPLE'),lease=content('LEASE - SIMPLE DAILY');
    assert.equal(event.cards[0].lines[0],eventLine);assert.equal(lease.cards[0].lines[0],leaseLine);
    assert.deepEqual(event.pricing.tiers,lease.pricing.tiers);
    assert.equal(event.pricing.freeMinutes,1440);assert.equal(lease.pricing.freeMinutes,1440);
    assert.equal(event.pricing.paymentMode,lease.pricing.paymentMode);
    assert.equal(event.pricing.paymentCents,lease.pricing.paymentCents);
    assert.equal(event.gateway,'card');assert.equal(lease.gateway,'card');
  }
});

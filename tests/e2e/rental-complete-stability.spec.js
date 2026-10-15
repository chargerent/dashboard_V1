import {test,expect} from '@playwright/test';

for(const orientation of ['portrait','landscape'])for(const lang of ['en','fr','es'])test(`${orientation} ${lang} rental instructions stay fixed while the receipt loads and refreshes @desktop`,async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const height of [.15,.28]){
    await page.goto(`/portal/tests/fixtures/receipt-display.html?directTap=true&orientation=${orientation}&lang=${lang}&height=${height}&longCaption=${height===.28}`);
    await page.evaluate(()=>document.fonts.ready);
    const example=page.getByTestId('succeeded'),card=example.locator('.ms-checkout-panel');
    await expect(card).toHaveAttribute('data-checkout-phase','succeeded');
    await expect(card.getByRole('status')).toBeVisible();
    const measure=()=>card.evaluate(node=>{
      const card=node.getBoundingClientRect(),group=node.querySelector('.ms-checkout-vend-return').getBoundingClientRect();
      return {x:group.left-card.left,y:group.top-card.top,width:group.width,height:group.height};
    });
    const initial=await measure();
    const frames=card.evaluate(async node=>{
      const positions=[];
      for(let i=0;i<40;i++){
        await new Promise(requestAnimationFrame);
        const card=node.getBoundingClientRect(),group=node.querySelector('.ms-checkout-vend-return').getBoundingClientRect();
        positions.push({x:group.left-card.left,y:group.top-card.top});
      }
      return positions;
    });
    await example.getByRole('button',{name:'Deliver receipt',exact:true}).click();
    await expect(card.locator('.ms-return-receipt img')).toBeVisible();
    for(let refresh=0;refresh<3;refresh++){
      await example.getByRole('button',{name:'Update receipt link',exact:true}).click();
      await expect(card.locator('.ms-return-receipt img')).toBeVisible();
      await example.getByRole('button',{name:'Repeat receipt',exact:true}).click();
    }
    for(const value of [...await frames,await measure()]){
      expect(Math.abs(value.x-initial.x)).toBeLessThan(1);
      expect(Math.abs(value.y-initial.y)).toBeLessThan(1);
    }
    const baselines=await card.evaluate(node=>{
      const baseline=element=>{
        const marker=document.createElement('span');marker.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';
        element.append(marker);const y=marker.getBoundingClientRect().top;marker.remove();return y;
      };
      return {hint:baseline(node.querySelector('.ms-checkout-vend-return small')),caption:baseline(node.querySelector('.ms-receipt-scan-caption'))};
    });
    expect(Math.abs(baselines.hint-baselines.caption)).toBeLessThan(1);
  }
});

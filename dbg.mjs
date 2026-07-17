import { chromium } from 'playwright';
const URL='http://localhost:4173/';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:390,height:844}})).newPage();
page.on('console', m => { const t=m.text(); if(t.includes('DEEPLINK')) console.log('  [browser]', t); });
await page.goto(URL,{waitUntil:'domcontentloaded'});
await page.waitForSelector('input[type="email"]',{timeout:20000});
await page.fill('input[type="email"]',process.env.SMOKE_EMAIL);
await page.fill('input[type="password"]',process.env.SMOKE_PASSWORD);
await page.click('button:has-text("Sign In")');
await page.waitForFunction(()=>typeof window.__setView==='function',{timeout:35000});
await page.waitForTimeout(2500);

console.log('\n--- control: does __setView("tasks") actually change the screen? ---');
await page.evaluate(()=>window.__setView('tasks'));
await page.waitForTimeout(1200);
console.log('  after __setView(tasks), first 90 chars of body:');
console.log('   ', (await page.locator('body').innerText()).replace(/\n/g,' | ').slice(0,90));

console.log('\n--- the real thing: cold boot at ?view=tasks ---');
await page.goto(URL+'?view=tasks',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>typeof window.__setView==='function',{timeout:35000});
await page.waitForTimeout(2500);
console.log('  after cold boot, first 90 chars of body:');
console.log('   ', (await page.locator('body').innerText()).replace(/\n/g,' | ').slice(0,90));
await b.close();

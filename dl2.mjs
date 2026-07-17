// Deep links, tested the way a shortcut actually launches: logged in, cold boot,
// straight to ?view=X. Logged out proves nothing — the login screen swallows it.
import { chromium } from 'playwright';
const URL='http://localhost:4173/';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:390,height:844}});
const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e.message||e)));
await page.goto(URL,{waitUntil:'domcontentloaded'});
await page.waitForSelector('input[type="email"]',{timeout:20000});
await page.fill('input[type="email"]',process.env.SMOKE_EMAIL);
await page.fill('input[type="password"]',process.env.SMOKE_PASSWORD);
await page.click('button:has-text("Sign In")');
await page.waitForFunction(()=>typeof window.__setView==='function',{timeout:35000});
console.log('logged in ok\n');
for (const v of ['prospecting','contacts','tasks','calendar','production','bogus_view']) {
  await page.goto(URL+'?view='+v,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.__setView==='function',{timeout:35000});
  await page.waitForTimeout(1500);
  const boundary = await page.locator('text=This view ran into an error').count();
  const search = await page.evaluate(()=>location.search);
  const body = (await page.locator('body').innerText()).slice(0,4000).toLowerCase();
  const hit = { prospecting:'prospect', contacts:'contact', tasks:'task', calendar:'calendar',
                production:'commission', bogus_view:null }[v];
  const landed = hit ? body.includes(hit) : true;
  console.log(`  ?view=${v.padEnd(12)} url:"${search}" ${search===''?'cleaned':'DIRTY'} | crash:${boundary?'YES':'no'} | ${hit?(landed?'landed on '+v:'DID NOT LAND'):'ignored (whitelist) -> dashboard'}`);
}
console.log('\npage errors:', errs.length?errs.slice(0,2):'none');
await b.close();

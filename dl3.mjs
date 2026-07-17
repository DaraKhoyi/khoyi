import { chromium } from 'playwright';
const URL='http://localhost:4173/';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:390,height:844}})).newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e.message||e)));
await page.goto(URL,{waitUntil:'domcontentloaded'});
await page.waitForSelector('input[type="email"]',{timeout:20000});
await page.fill('input[type="email"]',process.env.SMOKE_EMAIL);
await page.fill('input[type="password"]',process.env.SMOKE_PASSWORD);
await page.click('button:has-text("Sign In")');
await page.waitForFunction(()=>typeof window.__getView==='function',{timeout:35000});
await page.waitForTimeout(2000);
console.log('logged in. current view =', await page.evaluate(()=>window.__getView()), '\n');

let bad=0;
for (const [v,expect] of [['prospecting','prospecting'],['contacts','contacts'],['tasks','tasks'],
                          ['calendar','calendar'],['production','production'],
                          ['bogus_view','dashboard'],['../evil','dashboard']]) {
  await page.goto(URL+'?view='+encodeURIComponent(v),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.__getView==='function',{timeout:35000});
  await page.waitForTimeout(1600);
  const got = await page.evaluate(()=>window.__getView());
  const url = await page.evaluate(()=>location.search);
  const ok = got===expect;
  if(!ok) bad++;
  console.log(`  ?view=${v.padEnd(12)} -> ${String(got).padEnd(12)} expected ${expect.padEnd(11)} ${ok?'PASS':'FAIL'}  url:"${url}"`);
}
console.log('\npage errors:', errs.length?errs.slice(0,2):'none');
console.log(bad? `${bad} FAILURES` : 'ALL DEEP LINKS PASS');
await b.close(); process.exit(bad?1:0);

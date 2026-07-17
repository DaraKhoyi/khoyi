import { chromium } from 'playwright';
const URL='http://localhost:4173/';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:390,height:844}})).newPage();
await page.goto(URL,{waitUntil:'domcontentloaded'});
await page.waitForSelector('input[type="email"]',{timeout:20000});
await page.fill('input[type="email"]',process.env.SMOKE_EMAIL);
await page.fill('input[type="password"]',process.env.SMOKE_PASSWORD);
await page.click('button:has-text("Sign In")');
await page.waitForFunction(()=>typeof window.__setView==='function',{timeout:35000});
await page.waitForTimeout(2500);

const strip = t => t.replace(/\s+/g,' ').replace(/REALTY ?ONE ?GROUP ?Advantage.*?powered by Prism/gi,'').trim();
const snap = async () => strip(await page.locator('main, #root').first().innerText()).slice(0,140);

await page.evaluate(()=>window.__setView('dashboard')); await page.waitForTimeout(1200);
const dash = await snap();
await page.evaluate(()=>window.__setView('tasks')); await page.waitForTimeout(1200);
const tasks = await snap();
console.log('  __setView(dashboard):', dash.slice(0,70));
console.log('  __setView(tasks)    :', tasks.slice(0,70));
console.log('  -> these differ?', dash !== tasks ? 'YES (good, views are distinguishable)' : 'NO — test is blind');

await page.goto(URL+'?view=tasks',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>typeof window.__setView==='function',{timeout:35000});
await page.waitForTimeout(2500);
const cold = await snap();
console.log('\n  cold boot ?view=tasks:', cold.slice(0,70));
console.log('  -> matches tasks?', cold === tasks ? 'YES — DEEP LINK WORKS' : (cold === dash ? 'NO — landed on Dashboard' : 'different again'));
await b.close();

import { decide, pushPlan, portalOf, PORTAL_FLOOR, THRESHOLD } from "./verdict.ts";
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const base = { muted: false, vouched: false, colleague: false, repeat: false };
const L = (name: string, email: string, source: string | null, text: string) => ({ lead: { lead_name: name, lead_email: email, source, channel: "email" }, text });
const yordani = L("Yordani", "2w4cpzzww8maui56uvs6qg9r92v@convo.zillow.com", "Zillow",
 "Source: Zillow\nProperty: 1250 Redondo Way, Wesley Chapel, FL, 33543\nSubject: Yordani is requesting information about 1250 Redondo Way, Wesley Chapel, FL, 33543\nBrand logo New message 1250 Redondo Way, Wesley Chapel, FL, 33543. Yordani Abreu says: I would like to schedule a tour. Send application Reply directly to this email or See Yordani&#39;s phone contact");
const ashley = L("Ashley", "4s0s1rda5s4ygi4aj34zpt6u4c4@convo.zillow.com", "Zillow",
 "Source: Zillow\nProperty: 1250 Redondo Way, Wesley Chapel, FL, 33543\nSubject: Ashley is requesting information about 1250 Redondo Way, Wesley Chapel, FL, 33543\nBrand logo New message 1250 Redondo Way, Wesley Chapel, FL, 33543. Ashley Reyes says: I&#39;m interested in your property. Send application Reply directly to this email or See Ashley&#39;s phone");
const heather = L("Heather", "1dfb66u725j80i1p64qv91ufdxy@convo.zillow.com", "Zillow",
 "Source: Zillow\nProperty: 1250 Redondo Way, Wesley Chapel, FL, 33543\nSubject: Heather is requesting information about 1250 Redondo Way, Wesley Chapel, FL, 33543\nBrand logo New message 1250 Redondo Way, Wesley Chapel, FL, 33543. Heather A James says: I am interested in this rental and would like to schedule a viewing. Please let me know when this would be");
const scamReply = L("Assistant Zllw", "2zvxhd7zxpn97i4cnrmz838n7rs@convo.zillow.com", null,
 "Subject: Re: Message from 1250 Redondo Way\n\nProperty: &quot;1250 Redondo Way&quot; Ref: {#267886) Status: pending (confirmation) Please complete the required step - https://tinyurl.com/Zillow-informatiom");
const jennifer = L("Jennifer Ruiz", "3fp4trrnjaukmi55vcv947zkuca@convo.zillow.com", null,
 "Subject: Jennifer is requesting information about 1250 Redondo Way, Wesley Chapel, FL, 33543\n\nBrand logo New message 1250 Redondo Way, Wesley Chapel, FL, 33543. Jennifer Ruiz says: I am interested in this rental and would like to schedule a viewing. Please let me know when this would be");
const vendor = L("Pat Seller", "pat@creativeoutdoor.com", null, "Subject: Signs for your listings\n\nWould you be interested in yard signs for your listings? Call me 813-555-1212");
const stranger = L("Kim", "kim@gmail.com", null, "Subject: house\n\nlooking to buy a house in the area");
const direct = L("Kim Lee", "kim@gmail.com", "Direct inquiry", "Subject: house\n\nlooking to buy a house in the area");

Deno.test("Zillow example: v9 behaviour (portal_live off) still suppresses at 35", () => {
  for (const x of [yordani, ashley, heather]) {
    const d = decide({ ...base, ...x, portalLive: false });
    eq([d.send, d.reason], [false, "not enough signal (35)"], x.lead.lead_name);
  }
});
Deno.test("Zillow example: portal_live on -> alert, score floor above threshold", () => {
  for (const x of [yordani, ashley, heather]) {
    const d = decide({ ...base, ...x, portalLive: true });
    eq(d.send, true, x.lead.lead_name + " send");
    eq(d.score >= PORTAL_FLOOR && d.score > THRESHOLD, true, "floor");
    eq(d.portal, "Zillow", "portal");
    eq(d.reason, `portal lead (Zillow) · score floor 60 (raw 35)`, "reason");
  }
});
Deno.test("relay address alone is recognised even with no source tag", () => {
  eq(portalOf(jennifer.lead), "Zillow", "relay");
  eq(decide({ ...base, ...jennifer, portalLive: true }).send, true, "jennifer");
});
Deno.test("portal still respects: Not lead, colleague, repeat, and Re: (phishing)", () => {
  eq(decide({ ...base, ...yordani, muted: true, portalLive: true }).send, false, "muted");
  eq(decide({ ...base, ...yordani, colleague: true, portalLive: true }).send, false, "colleague");
  eq(decide({ ...base, ...yordani, repeat: true, portalLive: true }).send, false, "repeat");
  const s = decide({ ...base, ...scamReply, portalLive: true });
  eq([s.send, s.reason], [false, "a reply in an existing thread, not a new lead"], "scam reply");
});
Deno.test("no loosening for anyone else", () => {
  for (const pl of [false, true]) {
    const v = decide({ ...base, ...vendor, portalLive: pl });
    eq([v.send, v.portal], [true, null], "vendor scores 55+ under v9 as before (unchanged): " + v.reason);
    const s = decide({ ...base, ...stranger, portalLive: pl });
    eq([s.send, s.reason, s.portal], [false, "not enough signal (35)", null], "stranger unchanged");
    const d = decide({ ...base, ...direct, portalLive: pl });
    eq([d.send, d.portal], [false, null], "Direct inquiry gets no floor");
  }
});
Deno.test("push timing", () => {
  const now = new Date("2026-10-08T03:00:00Z"); // 11 PM ET
  eq(pushPlan("2026-10-08T02:55:00Z", now, 23, "x"), { push: true, tag: "lead-new-x", why: "fresh lead" }, "fresh at night -> urgent");
  eq(pushPlan("2026-10-08T02:30:00Z", now, 23, "x").push, false, "30-min-old at night -> no push");
  eq(pushPlan("2026-10-07T16:00:00Z", new Date("2026-10-07T17:00:00Z"), 13, "x"), { push: true, tag: "new-lead-x", why: "daytime" }, "day");
  eq(pushPlan("2026-10-08T11:50:00Z", new Date("2026-10-08T12:00:00Z"), 8, "x").tag, "lead-new-x", "8 AM fresh");
  eq(pushPlan("2026-10-08T00:30:00Z", new Date("2026-10-08T01:00:00Z"), 21, "x").push, false, "9 PM old -> quiet");
});

-- 2026-10-02c — contact research always was about a contact; the old rows now say so.
--
-- The Accountant (panel), 2 Oct: "contact-research: 9 of 17 calls had no named
-- subject — $0.31/call spent on research about nobody… The fix is a call-time
-- guard that rejects invocations without a contact record ID."
--
-- Checked against the rows: that guard has always existed (contact-research
-- returns 400 without a contact_id and 404 for one that does not exist, before
-- any model is called). No research was ever run about nobody. What was missing
-- is the RECORD: until 19 Sep the cost row was written without saying which
-- contact it was for. Every one of those rows matches exactly one contact whose
-- research finished in the same minute for the same person's account.
--
-- This writes that contact onto each old row — only where the match is exact
-- (one contact, research stamped within two minutes of the cost row). Anything
-- ambiguous is left alone rather than guessed. Idempotent.
with match as (
  select l.id, min(p.contact_id::text)::uuid contact_id, count(*) n
    from ai_usage_log l
    join profiles p on p.research_taken_at between l.created_at - interval '2 minutes' and l.created_at + interval '2 minutes'
    join contacts c on c.id = p.contact_id and c.user_id = l.user_id
   where l.fn = 'contact-research' and l.subject_id is null and l.contact_id is null
   group by l.id
)
update ai_usage_log l
   set subject_type = 'contact', subject_id = m.contact_id, contact_id = m.contact_id, about = 'person',
       subject_email = coalesce(l.subject_email, (select lower(c.email) from contacts c where c.id = m.contact_id))
  from match m
 where m.id = l.id and m.n = 1;

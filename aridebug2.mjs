import { createClient } from '@supabase/supabase-js';
const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsZ2ZzcG5vampndmt1aXRjb2FmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTk1NzksImV4cCI6MjA5NDk3NTU3OX0.t6stnTptCp6T7YC-ogUKA9OP5YXhCf5Zm-0-WLkEnm0';
const admin=createClient('https://xlgfspnojjgvkuitcoaf.supabase.co', process.env.SVC);
const email='dbg2_'+Date.now()+'@example.com', password='Test!12345';
const { data:cu }=await admin.auth.admin.createUser({email,password,email_confirm:true});
const uid=cu.user.id;
const { data:rb, error:re } = await admin.from('robots').insert({ user_id:uid, name:'Ari', permissions:{ tasks_read:true } }).select('id,permissions').single();
console.log('robot insert err:', re?re.message:'none', '| permissions stored:', JSON.stringify(rb&&rb.permissions));
await admin.from('tasks').insert({ user_id:uid, title:'Send the Wellington addendum', due_date:'2026-07-08', priority:'high', completed:false });
const anon=createClient('https://xlgfspnojjgvkuitcoaf.supabase.co',ANON);
const { data:sess }=await anon.auth.signInWithPassword({email,password});
const r = await fetch('https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/robot-chat',{
  method:'POST',
  headers:{'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+sess.session.access_token},
  body: JSON.stringify({ robot_id: rb.id, message:'Use the next_actions tool and tell me exactly what it returned.', history:[] })
});
const d = await r.json();
console.log('HTTP', r.status);
console.log('RESPONSE:', JSON.stringify(d).slice(0,700));
await admin.from('tasks').delete().eq('user_id',uid);
await admin.auth.admin.deleteUser(uid);

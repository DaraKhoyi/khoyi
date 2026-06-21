// Pure commission/CDA math — extracted from App.js so it can be unit-tested in isolation.
// computeCDA is the single source of truth for every CDA disbursement waterfall.

function num(v){ return v===''||v===null||v===undefined||isNaN(Number(v))?null:Number(v); }

function pctOf(b,p){ const v=num(p); return v?b*v/100:0; }

function computeCDA(f, cda, plan, capYtd){
  cda=cda||{}; plan=plan||{}; capYtd=num(capYtd)||0;
  const price=num(f.contract_price)||0;
  const totalRate=num(cda.total_rate);
  const totalComm=num(cda.total_commission)!=null?num(cda.total_commission):(totalRate!=null?price*totalRate/100:0);
  const sides=cda.sides||'buyer';
  let ourGci;
  if(num(cda.our_gci)!=null) ourGci=num(cda.our_gci);
  else if(num(cda.our_side_rate)!=null) ourGci=price*num(cda.our_side_rate)/100;
  else if(sides==='both') ourGci=totalComm;
  else ourGci=totalComm/2;
  const coopGci= sides==='both'?0:Math.max(0,totalComm-ourGci);
  const referral=num(cda.referral_fee)||0;
  const gciAfterRef=ourGci-referral;
  let royalty=pctOf(gciAfterRef,plan.royalty_pct); if(num(plan.royalty_cap)!=null) royalty=Math.min(royalty,num(plan.royalty_cap));
  const gciNet=gciAfterRef-royalty;
  const split=num(plan.agent_split_pct);
  let agentGross, companyDollar, capNote=null;
  if(plan.split_type==='flat'){ agentGross=gciNet; companyDollar=0; }
  else if(plan.split_type==='cap' && num(plan.cap_amount)!=null){
    const capRemaining=Math.max(0, num(plan.cap_amount)-capYtd);
    const normalCo= split!=null? gciNet*(1-split/100): 0;
    companyDollar=Math.min(normalCo, capRemaining);
    agentGross=gciNet-companyDollar;
    if(capRemaining<=0){ capNote='Capped (100%)'; if(num(plan.post_cap_fee)){} }
    else if(companyDollar<normalCo){ capNote='Cap reached this deal'; }
  }
  else { agentGross= split!=null? gciNet*split/100 : gciNet; companyDollar=gciNet-agentGross; }
  const fees=[];
  if(plan.split_type==='cap' && num(plan.cap_amount)!=null && (num(plan.cap_amount)-capYtd)<=0 && num(plan.post_cap_fee)) fees.push({label:'Post-cap transaction fee',amount:num(plan.post_cap_fee)});
  if(num(plan.transaction_fee)) fees.push({label:'Transaction fee',amount:num(plan.transaction_fee)});
  if((sides==='buyer'||sides==='both')&&num(plan.buyer_side_fee)) fees.push({label:'Buyer-side fee',amount:num(plan.buyer_side_fee)});
  if((sides==='seller'||sides==='both')&&num(plan.seller_side_fee)) fees.push({label:'Seller-side fee',amount:num(plan.seller_side_fee)});
  if(num(plan.tc_fee)) fees.push({label:`TC fee${plan.tc_payee?` \u2014 ${plan.tc_payee}`:''}`,amount:num(plan.tc_fee)});
  if(plan.mentor_fee_type==='flat'&&num(plan.mentor_fee_value)) fees.push({label:'Mentor fee',amount:num(plan.mentor_fee_value)});
  if(plan.mentor_fee_type==='pct'&&num(plan.mentor_fee_value)) fees.push({label:`Mentor fee (${plan.mentor_fee_value}% GCI)`,amount:pctOf(gciNet,plan.mentor_fee_value)});
  for(const cf of (plan.custom_fees||[])){ const amt= cf.type==='pct'? pctOf(gciNet,cf.amount):(num(cf.amount)||0); if(amt) fees.push({label:cf.label||'Fee',amount:amt,hidden:!cf.disclose}); }
  const owes=num(cda.agent_owes)||0; if(owes) fees.push({label:cda.agent_owes_note||'Owed to brokerage',amount:owes});
  const disclosedFees=fees.filter(x=>!x.hidden); const hiddenFees=fees.filter(x=>x.hidden);
  const totalFees=fees.reduce((s,x)=>s+x.amount,0);
  const agentNet=agentGross-totalFees;
  const contrib=[];
  const sav= plan.auto_savings_type==='pct'? pctOf(agentNet,plan.auto_savings_value):(plan.auto_savings_type==='flat'?num(plan.auto_savings_value)||0:0);
  if(sav) contrib.push({label:'Auto-savings',amount:sav});
  const ret= plan.retirement_type==='pct'? pctOf(agentNet,plan.retirement_value):(plan.retirement_type==='flat'?num(plan.retirement_value)||0:0);
  if(ret) contrib.push({label:plan.retirement_label||'Retirement',amount:ret});
  const totalContrib=contrib.reduce((s,x)=>s+x.amount,0);
  const agentCash=agentNet-totalContrib;
  const profitShare= pctOf(gciNet, plan.profit_share_pct);
  return { price, totalRate, totalComm, sides, ourGci, coopGci, referral, royalty, gciNet, split, agentGross, companyDollar, capNote, fees, disclosedFees, hiddenFees, totalFees, agentNet, contrib, totalContrib, agentCash, profitShare, savings:sav, retirement:ret };
}

// ===================== LEAD ENGINE (Phase 2) =====================

export { computeCDA, num, pctOf };

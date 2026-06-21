import { describe, it, expect } from 'vitest';
import { computeCDA, num, pctOf } from './cda';

// A $400k deal at 6% total, our side 3% => $24k total commission, $12k our GCI.
const FILE = { contract_price: 400000 };
const BUYER = { total_rate: 6, sides: 'buyer', our_side_rate: 3 };

describe('num / pctOf helpers', () => {
  it('num coerces and guards', () => {
    expect(num('')).toBe(null);
    expect(num(null)).toBe(null);
    expect(num(undefined)).toBe(null);
    expect(num('abc')).toBe(null);
    expect(num('12.5')).toBe(12.5);
    expect(num(0)).toBe(0);
  });
  it('pctOf computes percentage of base, 0 when no pct', () => {
    expect(pctOf(1000, 10)).toBe(100);
    expect(pctOf(1000, undefined)).toBe(0);
    expect(pctOf(1000, 0)).toBe(0);
  });
});

describe('computeCDA — commission derivation', () => {
  it('derives total commission, our GCI and co-op GCI for a buyer-side deal', () => {
    const r = computeCDA(FILE, BUYER, { split_type: 'percentage', agent_split_pct: 80 }, 0);
    expect(r.totalComm).toBe(24000);
    expect(r.ourGci).toBe(12000);
    expect(r.coopGci).toBe(12000);
    expect(r.gciNet).toBe(12000);
  });

  it('uses explicit total_commission over a rate when provided', () => {
    const r = computeCDA(FILE, { total_commission: 30000, sides: 'buyer', our_side_rate: 3 },
      { split_type: 'flat' }, 0);
    expect(r.totalComm).toBe(30000);
  });

  it('both sides => our GCI is the full commission and co-op is zero', () => {
    const r = computeCDA(FILE, { total_commission: 24000, sides: 'both' },
      { split_type: 'percentage', agent_split_pct: 70, buyer_side_fee: 100, seller_side_fee: 150 }, 0);
    expect(r.ourGci).toBe(24000);
    expect(r.coopGci).toBe(0);
    expect(r.agentGross).toBe(16800);
    // both side fees apply when sides === 'both'
    expect(r.totalFees).toBe(250);
  });
});

describe('computeCDA — split types', () => {
  it('percentage split divides GCI by the agent split', () => {
    const r = computeCDA(FILE, BUYER, { split_type: 'percentage', agent_split_pct: 80 }, 0);
    expect(r.agentGross).toBe(9600);
    expect(r.companyDollar).toBe(2400);
    expect(r.agentNet).toBe(9600);
  });

  it('flat plan gives 100% to the agent, no company dollar', () => {
    const r = computeCDA(FILE, BUYER, { split_type: 'flat' }, 0);
    expect(r.agentGross).toBe(12000);
    expect(r.companyDollar).toBe(0);
  });
});

describe('computeCDA — cap behavior', () => {
  const capPlan = { split_type: 'cap', cap_amount: 16000, agent_split_pct: 80 };

  it('before the cap: normal company dollar, no cap note', () => {
    const r = computeCDA(FILE, BUYER, capPlan, 0);
    // cap branch computes via (1 - split/100), which carries floating-point dust
    // (2399.9999999999995) — harmless since every figure is money-rounded on display.
    expect(r.companyDollar).toBeCloseTo(2400, 6);
    expect(r.agentGross).toBeCloseTo(9600, 6);
    expect(r.capNote).toBe(null);
  });

  it('cap reached this deal: company dollar limited to the remaining cap', () => {
    const r = computeCDA(FILE, BUYER, capPlan, 15000); // only $1,000 of cap left
    expect(r.companyDollar).toBe(1000);
    expect(r.agentGross).toBe(11000);
    expect(r.capNote).toBe('Cap reached this deal');
  });

  it('fully capped: agent keeps 100%, post-cap fee applies', () => {
    const r = computeCDA(FILE, BUYER, { ...capPlan, post_cap_fee: 250 }, 16000);
    expect(r.companyDollar).toBe(0);
    expect(r.agentGross).toBe(12000);
    expect(r.capNote).toBe('Capped (100%)');
    expect(r.fees.some(x => x.label === 'Post-cap transaction fee' && x.amount === 250)).toBe(true);
    expect(r.agentNet).toBe(11750);
  });
});

describe('computeCDA — referral and franchise royalty', () => {
  it('subtracts referral before royalty, and caps the royalty', () => {
    const r = computeCDA(FILE, { ...BUYER, referral_fee: 2000 },
      { split_type: 'percentage', agent_split_pct: 80, royalty_pct: 6, royalty_cap: 500 }, 0);
    expect(r.referral).toBe(2000);
    // 6% of (12000-2000)=600, capped at 500
    expect(r.royalty).toBe(500);
    expect(r.gciNet).toBe(9500);
    expect(r.agentGross).toBe(7600);
  });
});

describe('computeCDA — fees, custom lines, disclosure, amounts owed', () => {
  it('sums every fee type and separates hidden from disclosed', () => {
    const plan = {
      split_type: 'flat',
      transaction_fee: 300,
      tc_fee: 150, tc_payee: 'TC Co',
      mentor_fee_type: 'pct', mentor_fee_value: 10, // 10% of 12000 = 1200
      custom_fees: [
        { label: 'Tech', type: 'flat', amount: 50, disclose: true },
        { label: 'Hidden', type: 'pct', amount: 5, disclose: false }, // 5% of 12000 = 600
      ],
    };
    const cda = { ...BUYER, agent_owes: 200, agent_owes_note: 'Sign fee' };
    const r = computeCDA(FILE, cda, plan, 0);
    expect(r.totalFees).toBe(300 + 150 + 1200 + 50 + 600 + 200); // 2500
    expect(r.agentNet).toBe(9500);
    expect(r.hiddenFees.length).toBe(1);
    expect(r.hiddenFees[0].amount).toBe(600);
    expect(r.disclosedFees.length).toBe(5);
  });
});

describe('computeCDA — savings, retirement, profit share', () => {
  it('routes auto-savings and retirement out of net to compute take-home cash', () => {
    const plan = {
      split_type: 'flat',
      auto_savings_type: 'pct', auto_savings_value: 10,   // 10% of 12000 = 1200
      retirement_type: 'flat', retirement_value: 500, retirement_label: '401k',
      profit_share_pct: 4,                                 // 4% of gciNet 12000 = 480
    };
    const r = computeCDA(FILE, BUYER, plan, 0);
    expect(r.savings).toBe(1200);
    expect(r.retirement).toBe(500);
    expect(r.totalContrib).toBe(1700);
    expect(r.agentCash).toBe(10300);
    expect(r.profitShare).toBe(480);
  });
});

describe('computeCDA — resilience', () => {
  it('handles empty cda/plan without throwing', () => {
    const r = computeCDA({ contract_price: 300000 }, {}, {}, 0);
    expect(r.price).toBe(300000);
    expect(typeof r.agentNet).toBe('number');
  });
});

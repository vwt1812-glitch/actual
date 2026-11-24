'use strict';

// All amounts and weights are read from the ignored, deployment-local config.
const config = require('./config.cjs');
const monthlyByFund = Object.freeze(Object.fromEntries(config.funds.map(fund => [fund.key, fund.monthlyCents])));
const cents = Object.freeze({
  totalMonthlyGrant: config.grantMonthlyCents,
  monthlyByFund,
});
const sharedWeights = Object.freeze(config.sharedWeights);

function assertCents(value, label = 'amount') {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be integer cents`);
}

function allocateMonthlyGrant() {
  const sum = Object.values(cents.monthlyByFund).reduce((a, b) => a + b, 0);
  if (sum !== cents.totalMonthlyGrant) throw new Error('Monthly allocation does not equal the grant');
  return { ...cents.monthlyByFund };
}

function splitSharedExpense(amountCents) {
  assertCents(amountCents);
  if (amountCents < 0) throw new RangeError('Shared expense must be non-negative');
  const denominator = sharedWeights.reduce((sum, [, weight]) => sum + weight, 0);
  const rows = sharedWeights.map(([fund, weight], order) => {
    const numerator = amountCents * weight;
    return { fund, order, amount: Math.floor(numerator / denominator), remainder: numerator % denominator };
  });
  let unallocated = amountCents - rows.reduce((sum, row) => sum + row.amount, 0);
  rows.sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (let i = 0; i < unallocated; i++) rows[i].amount++;
  rows.sort((a, b) => a.order - b.order);
  return Object.fromEntries(rows.map(({ fund, amount }) => [fund, amount]));
}

function summarizeExpenses(expenseLines) {
  const byFund = Object.fromEntries([...Object.keys(cents.monthlyByFund)].map(key => [key, 0]));
  const byExpenseType = {};
  let agTotal = 0;
  for (const line of expenseLines) {
    assertCents(line.amountCents, 'line.amountCents');
    if (line.amountCents < 0) throw new RangeError('Expense amount must be non-negative');
    if (!line.expenseType) throw new Error(`Missing expense type for ${line.id ?? 'expense'}`);
    const allocations = line.fundAllocations ?? { [line.fund]: line.amountCents };
    if (!allocations || !Object.keys(allocations).length) throw new Error(`Missing fund allocation for ${line.id ?? 'expense'}`);
    const allocated = Object.entries(allocations).reduce((sum, [fund, amount]) => {
      assertCents(amount, `allocation.${fund}`);
      if (!(fund in byFund)) throw new Error(`Unknown fund: ${fund}`);
      if (amount < 0) throw new RangeError(`Negative allocation for ${fund}`);
      byFund[fund] += amount;
      return sum + amount;
    }, 0);
    if (allocated !== line.amountCents) throw new Error(`Fund shares do not equal expense ${line.id ?? ''}`);
    agTotal += line.amountCents;
    byExpenseType[line.expenseType] = (byExpenseType[line.expenseType] ?? 0) + line.amountCents;
  }
  return { agTotal, byFund, byExpenseType };
}

module.exports = { cents, sharedWeights, allocateMonthlyGrant, splitSharedExpense, summarizeExpenses };


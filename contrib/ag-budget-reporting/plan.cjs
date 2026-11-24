const config = require('./config.cjs');
const groups = config.funds.map(({ categoryId, name }) => [categoryId, name]);
function yearInBerlin(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', year: 'numeric' }).format(date));
}
function plan(year, december) {
  const categories = december.categoryGroups.flatMap(g => g.categories);
  return groups.map(([id, name]) => {
    const category = categories.find(c => c.id === id);
    if (!category || !Number.isSafeInteger(category.balance)) throw new Error('Gruppenbudget fehlt oder enth�lt einen ung�ltigen Saldo: ' + name);
    // Positive Restbetr�ge werden immer �bertragen. Negative nur mit carryover.
    const carried = category.balance < 0 && !category.carryover ? 0 : category.balance;
    return { id, name, month: `${year}-01`, archiveName: `${year - 1} - ${name}`, reset: -carried, reserve: carried };
  });
}
module.exports = { groups, yearInBerlin, plan };


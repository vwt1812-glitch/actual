const fs = require('node:fs/promises');
const api = require('@actual-app/api');
const config = require('./config.cjs');
const { groups, yearInBerlin, plan } = require('./plan.cjs');
const syncId = config.budgetId;
const statePath = process.env.JOURNAL_PATH || '/data/journal.json';
const grantAccountId = config.accountId;
const grantPayeeId = config.grantPayeeId;
const grantSplitStart = config.grantSplitStart;
const grantMonthlyCents = config.grantMonthlyCents;
const grantShares = config.funds.map(fund => [fund.categoryId, fund.monthlyCents]);
const pause = ms => new Promise(r => setTimeout(r, ms));
async function save(state) {
  await fs.writeFile(statePath + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(statePath + '.tmp', statePath);
}
async function allocateNewGrantTransactions() {
  const end = new Date().toISOString().slice(0, 10);
  if (end < grantSplitStart) return 0;
  const transactions = await api.getTransactions(grantAccountId, grantSplitStart, end);
  const categoryIds = new Set(grantShares.map(([id]) => id));
  let changed = 0;
  for (const transaction of transactions) {
    if (transaction.is_child || transaction.amount <= 0) continue;
    if (transaction.payee !== grantPayeeId && !String(transaction.notes || '').includes('#monatszuschuss')) continue;
    if (transaction.amount % grantMonthlyCents !== 0) {
      console.error(`Zuschuss ${transaction.date}: Betrag ist kein ganzzahliges Monatsvielfaches; Split nicht ge�ndert.`);
      continue;
    }
    const months = transaction.amount / grantMonthlyCents;
    const expected = new Map(grantShares.map(([id, amount]) => [id, amount * months]));
    const children = transaction.subtransactions || [];
    if (children.some(child => !categoryIds.has(child.category))) {
      console.error(`Zuschuss ${transaction.date}: unbekannte Split-Kategorie; Split nicht ge�ndert.`);
      continue;
    }
    const current = new Map();
    for (const child of children) current.set(child.category, (current.get(child.category) || 0) + child.amount);
    if (children.length === grantShares.length && [...expected].every(([id, amount]) => current.get(id) === amount) && children.reduce((sum, child) => sum + child.amount, 0) === transaction.amount) continue;
    const nextChildren = grantShares.map(([category, amount]) => {
      const previous = children.find(child => child.category === category);
      return {
        ...(previous?.id ? { id: previous.id } : {}),
        amount: amount * months,
        account: transaction.account,
        date: transaction.date,
        parent_id: transaction.id,
        is_child: true,
        is_parent: false,
        category,
        payee: transaction.payee,
        notes: previous?.notes ?? null,
      };
    });
    await api.updateTransaction(transaction.id, { is_parent: true, subtransactions: nextChildren });
    changed++;
    console.log(`Zuschuss ${transaction.date}: ${months} Monatsanteil(e) auf f�nf T�pfe verteilt.`);
  }
  return changed;
}

async function run() {
  let started = false;
  try {
    const password = (await fs.readFile('/run/secrets/actual_password', 'utf8')).replace(/\r?\n$/, '');
    await fs.mkdir('/data/cache', { recursive: true });
    await api.init({ dataDir: '/data/cache', serverURL: config.serverURL, password });
    started = true;
    await api.downloadBudget(syncId);
    const known = await api.getCategories();
    if (await allocateNewGrantTransactions()) await api.sync();
    for (const [id, name] of groups) if (!known.some(c => c.id === id)) throw new Error('Falsche Budgetdatei oder gel�schte Kategorie: ' + name);
    const endYear = yearInBerlin();
    if (endYear < config.firstCloseYear) {
      console.log(`Verbindung gepr\u00fcft. Jahresabschluss aktiv; erster Reset am 01.01.${config.firstCloseYear}.`);
      return;
    }
    let state;
    try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; state = {}; }
    let archiveGroup;
    const allGroups = await api.getCategoryGroups();
    archiveGroup = allGroups.find(g => g.name === 'Vorjahresmittel - nicht im laufenden Budget' && !g.is_income);
    const groupId = archiveGroup?.id || await api.createCategoryGroup({ name: 'Vorjahresmittel - nicht im laufenden Budget', is_income: false });
    for (let year = config.firstCloseYear; year <= endYear; year++) {
      const rows = plan(year, await api.getBudgetMonth(`${year - 1}-12`));
      const january = await api.getBudgetMonth(`${year}-01`);
      const current = january.categoryGroups.flatMap(g => g.categories);
      // Januar-Zuteilungen sind f�r den Jahresabschluss reserviert. Fremde
      // �nderungen werden nicht still �berschrieben.
      for (const row of rows) {
        const amount = current.find(c => c.id === row.id)?.budgeted;
        const previous = state[year]?.[row.id];
        const allowed = previous ? [previous.applied, previous.planned] : [0];
        if (!allowed.includes(amount)) throw new Error(`Januar ${year}: manuelle Budget�nderung bei ${row.name}. Abschluss gestoppt.`);
      }
      await fs.mkdir('/data/backups', { recursive: true });
      const backup = await api.exportBudget();
      await fs.writeFile(`/data/backups/vor-jahresabschluss-${year}.zip`, backup, { mode: 0o600 });
      state[year] ||= {};
      for (const row of rows) {
        const old = state[year][row.id] || { applied: 0 };
        state[year][row.id] = { ...old, planned: row.reset };
      }
      // Journal vor �nderungen: auch nach einem Neustart werden bereits
      // gesetzte Betr�ge als eigene �nderungen erkannt.
      await save(state);
      const cats = await api.getCategories();
      for (const row of rows) {
        const reserve = cats.find(c => c.group_id === groupId && c.name === row.archiveName);
        const reserveId = reserve?.id || await api.createCategory({ group_id: groupId, name: row.archiveName, is_income: false });
        await api.setBudgetAmount(row.month, row.id, row.reset);
        await api.setBudgetAmount(row.month, reserveId, row.reserve);
        await api.updateNote(reserveId, `Restmittel aus ${year - 1}, getrennt vom laufenden Budget. Im Jahresnachweis als nicht verbrauchte Mittel/R�ckzahlungsbedarf ausweisen. Automatischer Jahresabschluss; erstellt ausdr�cklich keine Bankbuchung. Nachtr�gliche Vorjahresbuchungen werden bei der n�chsten Pr�fung ber�cksichtigt.`);
      }
      await api.sync();
      for (const row of rows) state[year][row.id].applied = row.reset;
      await save(state);
      console.log(`Jahresabschluss ${year - 1}: Gruppenbudget ${year} ohne Vorjahres�bertrag.`);
    }
  } finally { if (started) await api.shutdown(); }
}
(async () => {
  while (true) {
    try { await run(); }
    catch (e) { console.error('Jahresabschluss nicht ausgef�hrt: ' + e.message); }
    await pause(60 * 60 * 1000);
  }
})();


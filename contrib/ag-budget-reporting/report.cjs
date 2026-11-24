'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const api = require('@actual-app/api');
const { splitSharedExpense } = require('./funding-model.cjs');

const config = require('./config.cjs');

function euro(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value / 100);
}
function germanDate(value) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`));
}

function allocateGrant(totalCents) {
  const totalMonthly = config.funds.reduce((sum, fund) => sum + fund.monthlyCents, 0);
  const rows = config.funds.map((fund, index) => {
    const numerator = totalCents * fund.monthlyCents;
    return { key: fund.key, amount: Math.floor(numerator / totalMonthly), remainder: numerator % totalMonthly, index };
  });
  let remaining = totalCents - rows.reduce((sum, row) => sum + row.amount, 0);
  rows.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i++) rows[i].amount++;
  return Object.fromEntries(rows.map(row => [row.key, row.amount]));
}

function expenseTypes(transaction, knownTags) {
  const text = [transaction.notes, ...(transaction.subtransactions || []).map(x => x.notes)].filter(Boolean).join(' ');
  const hashtags = new Set([...text.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map(match => match[1].toLowerCase()));
  const known = new Set(knownTags.map(tag => String(tag.tag).replace(/^#/, '').toLowerCase()));
  return config.costTags.filter(item => (hashtags.has(item.tag) && known.has(item.tag)) || (item.aliases || []).some(alias => hashtags.has(alias)));
}

async function loadReceiptIndex() {
  const byTransaction = new Map();
  let budgetDirs;
  try { budgetDirs = await fs.readdir(config.receiptRoot, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return byTransaction; throw error; }
  for (const budgetDir of budgetDirs.filter(entry => entry.isDirectory())) {
    const transactions = await fs.readdir(path.join(config.receiptRoot, budgetDir.name), { withFileTypes: true });
    for (const transactionDir of transactions.filter(entry => entry.isDirectory())) {
      const receiptDirs = await fs.readdir(path.join(config.receiptRoot, budgetDir.name, transactionDir.name), { withFileTypes: true });
      const receipts = [];
      for (const receiptDir of receiptDirs.filter(entry => entry.isDirectory() && !entry.name.startsWith('pending-'))) {
        const directory = path.join(config.receiptRoot, budgetDir.name, transactionDir.name, receiptDir.name);
        try {
          const meta = JSON.parse(await fs.readFile(path.join(directory, 'meta.json'), 'utf8'));
          const blobPath = path.join(directory, 'blob');
          await fs.access(blobPath);
          receipts.push({ id: meta.id || receiptDir.name, name: path.basename(String(meta.name || 'Beleg')), mime: meta.mime || 'application/octet-stream', size: Number(meta.size) || 0, blobPath });
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      }
      if (receipts.length) byTransaction.set(transactionDir.name, receipts);
    }
  }
  return byTransaction;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(buffer) { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosDateTime(date = new Date()) {
  return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}
async function writeZip(zipPath, entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10); local.writeUInt16LE(stamp.date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12); central.writeUInt16LE(stamp.date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  await fs.writeFile(zipPath, Buffer.concat([...localParts, ...centralParts, end]), { mode: 0o600 });
}
function safeFilename(name) { return String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.{2,}/g, '.').slice(0, 160) || 'Beleg'; }

function fundByCategory(categoryId) {
  return config.funds.find(fund => fund.categoryId === categoryId)?.key;
}

function normalizeExpense(transaction, knownTags) {
  const amountCents = Math.abs(transaction.amount);
  const allocations = {};
  const warnings = [];
  const children = transaction.subtransactions || [];
  if (children.length) {
    for (const child of children) {
      const share = Math.abs(child.amount);
      const key = fundByCategory(child.category);
      if (key) allocations[key] = (allocations[key] || 0) + share;
      else if (child.category === config.commonCategoryId) {
        for (const [fund, value] of Object.entries(splitSharedExpense(share))) allocations[fund] = (allocations[fund] || 0) + value;
      } else warnings.push(`Unbekannter Kostentr�ger in Split ${child.id}`);
    }
    if (Object.values(allocations).reduce((sum, value) => sum + value, 0) !== amountCents) warnings.push('Split-Anteile stimmen nicht mit dem Zahlbetrag �berein.');
  } else {
    const key = fundByCategory(transaction.category);
    if (key) allocations[key] = amountCents;
    else if (transaction.category === config.commonCategoryId) Object.assign(allocations, splitSharedExpense(amountCents));
    else warnings.push('Kein bekannter Budgettopf zugeordnet.');
  }
  const types = expenseTypes(transaction, knownTags);
  if (!types.length) warnings.push('Keine st�dtische Verwendungsart als Actual-Tag im Belegtext/Notiz erkennbar.');
  if (types.length > 1) warnings.push('Mehrere Verwendungsarten markiert; zur eindeutigen Summierung bitte splitten.');
  for (const type of types) {
    if (type.status === 'ineligible') warnings.push(`Als nicht zuschussf�hig markiert: ${type.label}.`);
    if (type.status === 'restricted') warnings.push(`Eingeschr�nkte Kostenart pr�fen: ${type.label}${type.note ? ` - ${type.note}` : ''}`);
  }
  const notes = transaction.notes || '';
  const pending = !transaction.cleared && /buchungstag\s+geplant|geplant/i.test(notes);
  if (!transaction.cleared && !pending) warnings.push('Buchung ist in Actual nicht abgeglichen; Ist-Zahlung vor Einreichung pr�fen.');
  return { id: transaction.id, date: transaction.date, amountCents, cleared: Boolean(transaction.cleared), pending, payeeId: transaction.payee, notes, types, allocations, warnings };
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`),
  ].join('\n');
}

function makeReport(year, incomeCents, expenses, receiptCounts, incomeRows = [], reportStatus = 'Jahresbericht', periodEnd = `${year}-12-31`) {
  const incomeByFund = allocateGrant(incomeCents);
  const realized = expenses.filter(expense => !expense.pending);
  const pending = expenses.filter(expense => expense.pending);
  const expenseByFund = Object.fromEntries(config.funds.map(fund => [fund.key, 0]));
  const pendingByFund = Object.fromEntries(config.funds.map(fund => [fund.key, 0]));
  const byType = new Map();
  for (const expense of realized) {
    for (const [fund, amount] of Object.entries(expense.allocations)) expenseByFund[fund] += amount;
    const selected = expense.types.length === 1 ? expense.types[0] : null;
    const type = selected ? `${selected.label}${selected.status === 'restricted' ? ' (eingeschr�nkt)' : selected.status === 'ineligible' ? ' (nicht zuschussf�hig)' : ''}` : 'Zu kl�ren';
    byType.set(type, (byType.get(type) || 0) + expense.amountCents);
  }
  for (const expense of pending) for (const [fund, amount] of Object.entries(expense.allocations)) pendingByFund[fund] += amount;
  const agSpent = realized.reduce((sum, expense) => sum + expense.amountCents, 0);
  const agPending = pending.reduce((sum, expense) => sum + expense.amountCents, 0);
  const agRemaining = incomeCents - agSpent;
  const isFinal = reportStatus === 'Jahresbericht';
  const attachedReceiptCount = expenses.reduce((sum, expense) => sum + (receiptCounts[expense.id] || 0), 0);
  const receiptExplanation = attachedReceiptCount
    ? 'Das zugeh�rige ZIP-Archiv enth�lt die hochgeladenen Originalbelege und ein Belegverzeichnis. Gruppierungsarchive enthalten Belege zu direkt oder anteilig zugeordneten Ausgaben.'
    : 'Im aktuellen Zwischenstand sind keine Ausgaben mit Rechnungsbelegen erfasst. Sobald eine Ausgabe in Actual eingetragen und ihr Beleg hochgeladen ist, wird die Originaldatei dem passenden ZIP-Nachweis beigef�gt.';
  const rows = expenses.map(expense => [expense.date, expense.payeeId || '', expense.notes, euro(expense.amountCents), expense.types.length === 1 ? expense.types[0].label : 'Zu kl�ren', expense.cleared ? 'gebucht/abgeglichen' : 'offen/nicht abgeglichen', receiptCounts[expense.id] ? `${receiptCounts[expense.id]} Beleg(e)` : 'Beleg fehlt', expense.warnings.join(' ')]);
  const md = [
    `# ${reportStatus}: Mittelverwendungsnachweis AG - ${year}`,
    '',
    `Berichtszeitraum: 01.01.${year}-${germanDate(periodEnd)}`,
    '',
    `- Eingegangener Zuschuss: **${euro(incomeCents)}**`,
    `- Ausgaben insgesamt (physische Zahlungen einmal gez�hlt): **${euro(agSpent)}**`,
    `- Vorgemerkte, noch nicht gebuchte Ausgaben (nicht als Ist-Ausgabe gez�hlt): **${euro(agPending)}**`,
    isFinal ? `- Restmittel/R�ckzahlungsbedarf vor tats�chlicher R�ckzahlung: **${euro(Math.max(0, agRemaining))}**` : `- Rechnerischer Restbestand am Stichtag: **${euro(agRemaining)}**`,
    reportStatus === 'Zwischenstand (nicht final)' ? '- Dieser Zwischenstand umfasst Buchungen bis zum Stichtag und ist kein abschlie�ender Verwendungsnachweis.' : '',
    '',
    '## Zuschusseing�nge (Mittelherkunft)',
    '',
    markdownTable(['Zahlungsempf�nger', 'Datum', 'Notiz', 'Betrag'], incomeRows.map(row => [row.payee, row.date, row.note, euro(row.amountCents)])),
    '',
    '## Mittelverwendung nach Verwendungsart',
    '',
    markdownTable(['Verwendungsart', 'Ausgaben'], [...byType].map(([type, amount]) => [type, euro(amount)])),
    '',
    '## Einzelne Ausgaben und Belegstatus',
    '',
    receiptExplanation,
    '',
    markdownTable(['Datum', 'Zahlungsempf�nger', 'Notiz', 'Betrag', 'Verwendungsart', 'Buchungsstatus', 'Beleg', 'Kl�rung'], rows),
    '',
    '## Verteilung der vorgemerkten Ausgaben',
    '',
    markdownTable(['Topf', 'Vorgemerkt'], config.funds.map(fund => [fund.name, euro(pendingByFund[fund.key])])),
    '',
    '## Verteilung der Restmittel nach Topf',
    '',
    markdownTable(['Topf', 'Zugeordnete Mittel', 'Ist-Ausgaben', 'Vorgemerkt', 'Rest/R�ckzahlung'], config.funds.map(fund => [fund.name, euro(incomeByFund[fund.key]), euro(expenseByFund[fund.key]), euro(pendingByFund[fund.key]), euro(incomeByFund[fund.key] - expenseByFund[fund.key])])),
    '',
    '## Erl�uterung von Zweck, Wirtschaftlichkeit und Ergebnis',
    '',
    '_Bitte vor Einreichung erg�nzen._',
    '',
    '## Kl�rung vor Einreichung',
    '',
    ...expenses.flatMap(expense => expense.warnings.map(warning => `- ${expense.date} - ${expense.id}: ${warning}`)),
    expenses.some(expense => expense.warnings.length) ? '' : '- Keine automatisch erkannten Kl�rungsf�lle.',
  ].join('\n');
  return { year, incomeCents, agSpentCents: agSpent, agPendingCents: agPending, unspentCents: agRemaining, refundDueCents: isFinal ? Math.max(0, agRemaining) : null, incomeByFund, expenseByFund, pendingByFund, expenses, markdown: md };
}

async function main(year = new Date().getFullYear()) {
  const password = (await fs.readFile(config.passwordFile, 'utf8')).replace(/\r?\n$/, '');
  await fs.mkdir('/data/cache/grant-report', { recursive: true });
  await api.init({ dataDir: '/data/cache/grant-report', serverURL: config.serverURL, password });
  try {
    await api.downloadBudget(config.budgetId);
    const transactions = await api.getTransactions(config.accountId, `${year}-01-01`, `${year}-12-31`);
    const payees = await api.getPayees();
    const tags = await api.getTags();
    const grantPayeeName = payees.find(payee => payee.id === config.grantPayeeId)?.name || 'Stadt N�rnberg';
    const live = transactions.filter(tx => !tx.is_child && !tx.tombstone);
    const income = live.filter(tx => tx.amount > 0 && (tx.payee === config.grantPayeeId || String(tx.notes || '').toLowerCase().includes('#monatszuschuss')));
    const expenses = live.filter(tx => tx.amount < 0 && !tx.transfer_id).map(tx => normalizeExpense(tx, tags));
    const receiptIndex = await loadReceiptIndex();
    for (const expense of expenses) {
      expense.receipts = receiptIndex.get(expense.id) || [];
      expense.receiptCount = expense.receipts.length;
      if (!expense.receiptCount) expense.warnings.push('Kein hochgeladener Beleg am Actual-Belegsystem gefunden.');
    }
    for (const expense of expenses) expense.payeeId = payees.find(payee => payee.id === expense.payeeId)?.name || expense.payeeId || '';
    const realized = expenses.filter(expense => !expense.pending);
    const pending = expenses.filter(expense => expense.pending);
    const incomeRows = income.map(tx => ({ date: tx.date, amountCents: tx.amount, payee: grantPayeeName, note: tx.notes || '' }));
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const currentYear = Number(today.slice(0, 4));
    const isPartialYear = year === currentYear && today < `${year}-12-31`;
    const reportStatus = isPartialYear ? 'Zwischenstand (nicht final)' : 'Jahresbericht';
    const periodEnd = isPartialYear ? today : `${year}-12-31`;
    const report = makeReport(year, income.reduce((sum, tx) => sum + tx.amount, 0), expenses, Object.fromEntries(expenses.map(x => [x.id, x.receiptCount])), incomeRows, reportStatus, periodEnd);
    report.incomeTransactions = incomeRows;
    report.reportStatus = reportStatus;
    report.periodEnd = periodEnd;
    await fs.mkdir(config.outputDir, { recursive: true, mode: 0o700 });
    const writtenFiles = [];
    const agMarkdownPath = path.join(config.outputDir, `AG-Mittelverwendungsnachweis-${year}.md`);
    const jsonPath = path.join(config.outputDir, `AG-Mittelverwendungsnachweis-${year}.json`);
    await fs.writeFile(agMarkdownPath, report.markdown, { mode: 0o600 });
    const reportJson = JSON.stringify(report, (key, value) => key === 'blobPath' ? undefined : value, 2);
    await fs.writeFile(jsonPath, reportJson, { mode: 0o600 });
    writtenFiles.push(agMarkdownPath, jsonPath);
    const agZipEntries = [
      { name: `AG-Mittelverwendungsnachweis-${year}.md`, data: report.markdown },
      { name: `AG-Mittelverwendungsnachweis-${year}.json`, data: reportJson },
    ];
    const agManifest = [['Buchung', 'Beleg-ID', 'Dateiname', 'MIME', 'Betrag EUR'].join(';')];
    for (const expense of expenses) for (const receipt of expense.receipts) {
      const filename = safeFilename(receipt.name);
      agZipEntries.push({ name: `Belege/${expense.date}_${expense.id.slice(0, 8)}_${receipt.id.slice(0, 8)}_${filename}`, data: await fs.readFile(receipt.blobPath) });
      agManifest.push([expense.id, receipt.id, filename, receipt.mime, (expense.amountCents / 100).toFixed(2).replace('.', ',')].join(';'));
    }
    agZipEntries.push({ name: `Belegverzeichnis-${year}.csv`, data: `\ufeff${agManifest.join('\r\n')}\r\n` });
    const agZipPath = path.join(config.outputDir, `AG-Mittelverwendungsnachweis-${year}.zip`);
    await writeZip(agZipPath, agZipEntries);
    writtenFiles.push(agZipPath);
    for (const fund of config.funds.filter(item => !item.isGeneral)) {
      const fundRows = expenses.filter(expense => (expense.allocations[fund.key] || 0) > 0).map(expense => [expense.date, expense.notes, euro(expense.allocations[fund.key]), expense.types.length === 1 ? expense.types[0].label : 'Zu kl�ren', expense.cleared ? 'gebucht/abgeglichen' : 'offen/nicht abgeglichen', expense.receiptCount ? `${expense.receiptCount} Beleg(e)` : 'Beleg fehlt', expense.warnings.join(' ')]);
      const spent = realized.reduce((sum, expense) => sum + (expense.allocations[fund.key] || 0), 0);
      const committed = pending.reduce((sum, expense) => sum + (expense.allocations[fund.key] || 0), 0);
      const grantShare = report.incomeByFund[fund.key];
      const groupMarkdown = [
        `# ${reportStatus}: Mittelverwendungsnachweis ${fund.name} - ${year}`,
        '',
        `Berichtszeitraum: 01.01.${year}-${germanDate(periodEnd)}`,
        '',
        `Zugeordnete Zuschussmittel: **${euro(grantShare)}**`,
        `Direkte Ausgaben einschlie�lich anteiliger gemeinsamer Anschaffungen: **${euro(spent)}**`,
        `Vorgemerkte, noch nicht gebuchte Ausgaben: **${euro(committed)}**`,
        `${reportStatus === 'Jahresbericht' ? 'Restmittel/R�ckzahlungsbedarf' : 'Rechnerischer Restbestand am Stichtag'}: **${euro(grantShare - spent)}**`,
        '',
        markdownTable(['Datum', 'Notiz', 'Anteil', 'Verwendungsart', 'Buchungsstatus', 'Beleg', 'Kl�rung'], fundRows),
      ].join('\n');
      const groupPath = path.join(config.outputDir, `${fund.key}-Mittelverwendungsnachweis-${year}.md`);
      await fs.writeFile(groupPath, groupMarkdown, { mode: 0o600 });
      writtenFiles.push(groupPath);
      const groupZipEntries = [{ name: `${fund.key}-Mittelverwendungsnachweis-${year}.md`, data: groupMarkdown }];
      const groupManifest = [['Buchung', 'Beleg-ID', 'Dateiname', 'MIME', 'Anteil EUR'].join(';')];
      for (const expense of expenses.filter(item => (item.allocations[fund.key] || 0) > 0)) for (const receipt of expense.receipts) {
        const filename = safeFilename(receipt.name);
        groupZipEntries.push({ name: `Belege/${expense.date}_${expense.id.slice(0, 8)}_${receipt.id.slice(0, 8)}_${filename}`, data: await fs.readFile(receipt.blobPath) });
        groupManifest.push([expense.id, receipt.id, filename, receipt.mime, (expense.allocations[fund.key] / 100).toFixed(2).replace('.', ',')].join(';'));
      }
      groupZipEntries.push({ name: `Belegverzeichnis-${fund.key}-${year}.csv`, data: `\ufeff${groupManifest.join('\r\n')}\r\n` });
      const groupZipPath = path.join(config.outputDir, `${fund.key}-Mittelverwendungsnachweis-${year}.zip`);
      await writeZip(groupZipPath, groupZipEntries);
      writtenFiles.push(groupZipPath);
    }
    if (process.env.REPORT_OWNER_UID && process.env.REPORT_OWNER_GID) {
      const uid = Number(process.env.REPORT_OWNER_UID);
      const gid = Number(process.env.REPORT_OWNER_GID);
      if (Number.isSafeInteger(uid) && Number.isSafeInteger(gid)) await Promise.all(writtenFiles.map(file => fs.chown(file, uid, gid)));
    }
    console.log(JSON.stringify({ year, incomeCents: report.incomeCents, agSpentCents: report.agSpentCents, refundDueCents: report.refundDueCents, outputDir: config.outputDir, expenseCount: expenses.length, receiptCount: expenses.reduce((sum, item) => sum + item.receiptCount, 0), archives: [agZipPath, ...config.funds.filter(item => !item.isGeneral).map(fund => path.join(config.outputDir, `${fund.key}-Mittelverwendungsnachweis-${year}.zip`))] }, null, 2));
  } finally { await api.shutdown(); }
}

if (require.main === module) main(Number(process.argv[2]) || undefined).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { allocateGrant, normalizeExpense, makeReport };


'use strict';

// Copy this file to config.cjs and replace every placeholder locally.
// Do not commit config.cjs: it contains your Actual IDs and funding setup.
module.exports = {
  budgetId: 'REPLACE_WITH_ACTUAL_BUDGET_ID',
  accountId: 'REPLACE_WITH_AG_ACCOUNT_ID',
  grantPayeeId: 'REPLACE_WITH_GRANT_PAYEE_ID',
  commonCategoryId: 'REPLACE_WITH_COMMON_EXPENSE_CATEGORY_ID',
  grantSplitStart: 'YYYY-MM-DD',
  grantMonthlyCents: 0,
  firstCloseYear: 2027,
  reportStartYear: 2026,
  sharedWeights: [
    ['groupA', 2],
    ['groupB', 1],
    ['groupC', 1],
    ['groupD', 1],
  ],
  costTags: [
    { tag: 'REPLACE_WITH_TAG', label: 'Replace with an allowed expense type', status: 'eligible' },
  ],
  funds: [
    { key: 'groupA', name: 'Group A', categoryId: 'REPLACE_WITH_CATEGORY_ID', monthlyCents: 0 },
    { key: 'groupB', name: 'Group B', categoryId: 'REPLACE_WITH_CATEGORY_ID', monthlyCents: 0 },
    { key: 'groupC', name: 'Group C', categoryId: 'REPLACE_WITH_CATEGORY_ID', monthlyCents: 0 },
    { key: 'groupD', name: 'Group D', categoryId: 'REPLACE_WITH_CATEGORY_ID', monthlyCents: 0 },
    { key: 'agGeneral', name: 'General group expenses', categoryId: 'REPLACE_WITH_CATEGORY_ID', monthlyCents: 0, isGeneral: true },
  ],
  receiptRoot: process.env.ACTUAL_RECEIPT_ROOT || '/receipts',
  outputDir: process.env.REPORT_OUTPUT_DIR || '/reports',
  passwordFile: process.env.ACTUAL_PASSWORD_FILE || '/run/secrets/actual_password',
  serverURL: process.env.ACTUAL_SERVER_URL || 'http://127.0.0.1:5006',
};


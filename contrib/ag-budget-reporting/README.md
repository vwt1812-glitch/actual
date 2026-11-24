# Annual funding reports for Actual Budget

This optional add-on creates one annual report for a whole group and one report
per configured fund. Shared expenses appear once in the group report and are
allocated across fund reports using configured weights. The add-on reads
transaction tags for eligible expense types and includes uploaded receipt files
in the ZIP report that matches each transaction.

## Keep your configuration private

Copy `config.example.cjs` to `config.cjs`, then set your Actual budget, account,
payee, category IDs, fund names, cent amounts, shared-expense weights and allowed
expense tags. `config.cjs` is ignored by Git because it contains deployment
identifiers and funding details. Do not add actual budgets, invoices, passwords
or generated reports to this repository.

The monthly fund amounts must sum to `grantMonthlyCents`. All money fields use
integer cents. `sharedWeights` should list only the funds that participate in a
shared expense; a separate general fund can remain outside that allocation.

## Start the services

The Actual server must be reachable at `127.0.0.1:5006`. Provide a local
`actual-password` file or set `ACTUAL_PASSWORD_PATH`, and point
`ACTUAL_RECEIPTS_PATH` to the server's receipts directory. Then start the
services:

```bash
docker compose up -d year-close report-web-ui
```

The report page listens on `127.0.0.1:5008` and uses the Actual server password
with HTTP Basic authentication. It is bound to loopback so report data and
invoice files are not exposed on the LAN. To use it remotely, open an SSH
tunnel:

```bash
ssh -N -L 15008:127.0.0.1:5008 <user>@<actual-host>
```

Then open `http://localhost:15008`, select a year, generate reports and download
the AG ZIP or individual fund ZIPs. For command-line generation:

```bash
docker compose --profile cli run --rm reporter 2026
```

Reports are written to `./reports`. The ZIP archive contains the report and a
receipt manifest. An invoice is included only when its receipt is attached to a
transaction included in the report. Unmatched receipt files are intentionally
left out for manual reconciliation.

## Report checks before submission

The output is an interim accounting aid, not a signed statement. Review the
period, transactions, expense tags, fund allocations, receipt links and remaining
funds. Complete any explanatory text required by the grantor and confirm the
current eligible-expense rules before submitting. Annual rollover records
remaining funds but does not transfer money or create a repayment transaction.


# Configuration and operation

1. Copy `config.example.cjs` to `config.cjs` and replace every placeholder.
2. Keep `config.cjs`, Actual's password file, Actual data, receipts and report
   outputs outside version control.
3. Set `ACTUAL_PASSWORD_PATH` and `ACTUAL_RECEIPTS_PATH` if their locations
   differ from the defaults.
4. Start `year-close` and `report-web-ui` with Docker Compose.
5. Access the report page through an SSH tunnel to loopback port 5008.

The UI uses the Actual password with HTTP Basic authentication. Reports and
invoice files stay on the host. The tool does not perform bank transfers. It
records the year-end reserve in the budget and leaves repayment as a manual
transaction.

The Actual API package version is pinned in the Dockerfile. Review Actual
release changes before changing that pin or the receipt-storage layout.


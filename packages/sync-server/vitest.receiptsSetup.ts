import fs from 'node:fs/promises';

import { getAccountDb } from './src/account-db';
import { config } from './src/load-config';
import { run } from './src/migrations';

export async function setup() {
  await run();
  const db = getAccountDb();
  for (const [id, name, role] of [
    ['genericAdmin', 'admin', 'ADMIN'],
    ['genericUser', 'user', 'BASIC'],
  ]) {
    db.mutate(
      'INSERT INTO users (id, user_name, display_name, enabled, owner, role) VALUES (?, ?, ?, 1, 1, ?)',
      [id, name, name, role],
    );
  }
  for (const [token, userId] of [
    ['valid-token', 'genericAdmin'],
    ['valid-token-user', 'genericUser'],
  ]) {
    db.mutate(
      'INSERT INTO sessions (token, expires_at, user_id) VALUES (?, -1, ?)',
      [token, userId],
    );
  }
}

export async function teardown() {
  // Both the test worker and global setup close their SQLite connections before
  // removing these dedicated fixtures. Windows does not allow unlinking open DBs.
  getAccountDb().close();
  await fs.rm(config.get('serverFiles'), { recursive: true, force: true });
  await fs.rm(config.get('userFiles'), { recursive: true, force: true });
}


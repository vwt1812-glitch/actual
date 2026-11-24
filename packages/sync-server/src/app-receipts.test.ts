import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';

import request from 'supertest';

import { getAccountDb } from './account-db';
import { handlers } from './app-receipts';
import { config } from './load-config';
import { createReceiptStore, MAX_RECEIPT_BYTES } from './receipt-store';

const fileId = randomUUID();
const otherFileId = randomUUID();
const transactionId = randomUUID();
const endpoint = `/${fileId}/${transactionId}`;
const pdf = Buffer.from('%PDF-1.4\n% test receipt\n%%EOF');
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

beforeAll(() => {
  const db = getAccountDb();
  db.mutate('INSERT INTO files (id, owner, deleted) VALUES (?, ?, 0)', [
    fileId,
    'genericAdmin',
  ]);
  db.mutate('INSERT INTO files (id, owner, deleted) VALUES (?, ?, 0)', [
    otherFileId,
    'genericAdmin',
  ]);
});
afterAll(async () => {
  getAccountDb().mutate('DELETE FROM user_access WHERE file_id = ?', [fileId]);
  getAccountDb().mutate('DELETE FROM files WHERE id IN (?, ?)', [
    fileId,
    otherFileId,
  ]);
  await fs.rm(join(resolve(config.get('serverFiles')), 'receipts', fileId), {
    recursive: true,
    force: true,
  });
  getAccountDb().close();
});

describe('transaction receipts', () => {
  it('rejects unauthenticated requests for every operation', async () => {
    const id = randomUUID();
    for (const response of [
      await request(handlers).get(endpoint),
      await request(handlers).get(`/${fileId}/_status`),
      await request(handlers)
        .post(endpoint)
        .set('Content-Type', 'application/octet-stream')
        .send(pdf),
      await request(handlers).get(`${endpoint}/${id}`),
      await request(handlers).delete(`${endpoint}/${id}`),
    ]) {
      expect(response.status).toBe(401);
    }
  });

  it('rejects expired sessions', async () => {
    getAccountDb().mutate(
      'INSERT INTO sessions (token, expires_at, user_id) VALUES (?, ?, ?)',
      ['receipt-expired', 1, 'genericAdmin'],
    );
    const response = await request(handlers)
      .get(endpoint)
      .set('x-actual-token', 'receipt-expired');
    expect(response.status).toBe(401);
    getAccountDb().mutate('DELETE FROM sessions WHERE token = ?', [
      'receipt-expired',
    ]);
  });

  it('rejects users without budget access, including writes', async () => {
    const id = randomUUID();
    for (const response of [
      await request(handlers)
        .get(`/${fileId}/_status`)
        .set('x-actual-token', 'valid-token-user'),
      await request(handlers)
        .get(endpoint)
        .set('x-actual-token', 'valid-token-user'),
      await request(handlers)
        .post(endpoint)
        .set('x-actual-token', 'valid-token-user')
        .set('Content-Type', 'application/octet-stream')
        .send(pdf),
      await request(handlers)
        .get(`${endpoint}/${id}`)
        .set('x-actual-token', 'valid-token-user'),
      await request(handlers)
        .delete(`${endpoint}/${id}`)
        .set('x-actual-token', 'valid-token-user'),
    ]) {
      expect(response.status).toBe(403);
    }
  });

  it('uploads, lists and downloads the original bytes across a new store instance, then deletes', async () => {
    const upload = await request(handlers)
      .post(endpoint)
      .set('x-actual-token', 'valid-token')
      .set('Content-Type', 'application/octet-stream')
      .set('x-receipt-name', encodeURIComponent('Rechnung Getr�nke.pdf'))
      .send(pdf);
    expect(upload.status).toBe(200);
    expect(upload.body.data.name).toBe('Rechnung Getr�nke.pdf');
    const id: string = upload.body.data.id;
    const listing = await request(handlers)
      .get(endpoint)
      .set('x-actual-token', 'valid-token');
    expect(
      listing.body.data.map((receipt: { id: string }) => receipt.id),
    ).toContain(id);
    const restarted = createReceiptStore(
      join(resolve(config.get('serverFiles')), 'receipts'),
    );
    expect(
      (await restarted.get(fileId, transactionId, id)).data.equals(pdf),
    ).toBe(true);
    const download = await request(handlers)
      .get(`${endpoint}/${id}`)
      .set('x-actual-token', 'valid-token');
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['cache-control']).toBe('no-store');
    expect(download.headers['content-disposition']).toContain('attachment;');
    const wrongBudget = await request(handlers)
      .get(`/${otherFileId}/${transactionId}/${id}`)
      .set('x-actual-token', 'valid-token');
    expect(wrongBudget.status).toBe(404);
    const wrongTransaction = await request(handlers)
      .get(`/${fileId}/${randomUUID()}/${id}`)
      .set('x-actual-token', 'valid-token');
    expect(wrongTransaction.status).toBe(404);
    expect(
      (
        await request(handlers)
          .delete(`${endpoint}/${id}`)
          .set('x-actual-token', 'valid-token')
      ).status,
    ).toBe(200);
    expect(
      (
        await request(handlers)
          .get(`${endpoint}/${id}`)
          .set('x-actual-token', 'valid-token')
      ).status,
    ).toBe(404);
  });

  it('rejects disguised HTML, unsafe names, excessive size and invalid paths', async () => {
    const html = await request(handlers)
      .post(endpoint)
      .set('x-actual-token', 'valid-token')
      .set('Content-Type', 'application/octet-stream')
      .set('x-receipt-name', 'invoice.pdf')
      .send(Buffer.from('<script>alert(1)</script>'));
    expect(html.status).toBe(415);
    const unsafe = await request(handlers)
      .post(endpoint)
      .set('x-actual-token', 'valid-token')
      .set('Content-Type', 'application/octet-stream')
      .set('x-receipt-name', '..%2Finvoice.pdf')
      .send(pdf);
    expect(unsafe.status).toBe(400);
    const tooLarge = await request(handlers)
      .post(endpoint)
      .set('x-actual-token', 'valid-token')
      .set('Content-Type', 'application/octet-stream')
      .set('x-receipt-name', 'invoice.pdf')
      .send(Buffer.alloc(MAX_RECEIPT_BYTES + 1));
    expect(tooLarge.status).toBe(413);
    expect(
      (
        await request(handlers)
          .get(`/${fileId}/bad%3Aid`)
          .set('x-actual-token', 'valid-token')
      ).status,
    ).toBe(400);
  });

  it('does not store plaintext receipts for encrypted budgets', async () => {
    getAccountDb().mutate('UPDATE files SET encrypt_keyid = ? WHERE id = ?', [
      'encrypted-key',
      fileId,
    ]);
    const result = await request(handlers)
      .post(endpoint)
      .set('x-actual-token', 'valid-token')
      .set('Content-Type', 'application/octet-stream')
      .set('x-receipt-name', 'invoice.pdf')
      .send(pdf);
    expect(result.status).toBe(409);
    expect(result.body.reason).toBe('receipt-encrypted-budget');
    getAccountDb().mutate(
      'UPDATE files SET encrypt_keyid = NULL WHERE id = ?',
      [fileId],
    );
  });

  it('allows collaborators and serializes simultaneous uploads without lost receipts', async () => {
    const db = getAccountDb();
    db.mutate('INSERT INTO user_access (file_id, user_id) VALUES (?, ?)', [
      fileId,
      'genericUser',
    ]);
    const responses = await Promise.all(
      [1, 2, 3].map(index =>
        request(handlers)
          .post(endpoint)
          .set('x-actual-token', 'valid-token-user')
          .set('Content-Type', 'application/octet-stream')
          .set('x-receipt-name', `receipt-${index}.png`)
          .send(png),
      ),
    );
    expect(responses.every(response => response.status === 200)).toBe(true);
    const listing = await request(handlers)
      .get(endpoint)
      .set('x-actual-token', 'valid-token-user');
    for (const response of responses) {
      expect(
        listing.body.data.map((receipt: { id: string }) => receipt.id),
      ).toContain(response.body.data.id);
    }
    db.mutate('DELETE FROM user_access WHERE file_id = ?', [fileId]);
  });
});

it('indexes only attached receipts in the requested budget and drops empty transaction folders', async () => {
  const id = randomUUID();
  const url = `/${fileId}/${id}`;
  const upload = await request(handlers)
    .post(url)
    .set('x-actual-token', 'valid-token')
    .set('Content-Type', 'application/octet-stream')
    .set('x-receipt-name', 'receipt.pdf')
    .send(pdf);
  expect(upload.status).toBe(200);
  const index = () =>
    request(handlers)
      .get(`/${fileId}/_status`)
      .set('x-actual-token', 'valid-token');
  expect((await index()).body.data).toContain(id);
  const other = await request(handlers)
    .get(`/${otherFileId}/_status`)
    .set('x-actual-token', 'valid-token');
  expect(other.body.data).not.toContain(id);
  await request(handlers)
    .delete(`${url}/${upload.body.data.id}`)
    .set('x-actual-token', 'valid-token')
    .expect(200);
  expect((await index()).body.data).not.toContain(id);
});


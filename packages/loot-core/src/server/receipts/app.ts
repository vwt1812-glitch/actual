import * as asyncStorage from '#platform/server/asyncStorage';
import { fetch } from '#platform/server/fetch';
import { createApp } from '#server/app';
import * as db from '#server/db';
import { getPrefs } from '#server/prefs';
import { getServer } from '#server/server-config';
import type { Receipt, ReceiptResult } from '#types/receipts';

type Target = { transactionId: string; fileId: string };
export type ReceiptHandlers = {
  'receipts-status': typeof status;
  'receipts-list': typeof list;
  'receipts-upload': typeof upload;
  'receipts-download': typeof download;
  'receipts-delete': typeof remove;
};

export const app = createApp<ReceiptHandlers>();
app.method('receipts-status', status);
app.method('receipts-list', list);
app.method('receipts-upload', upload);
app.method('receipts-download', download);
app.method('receipts-delete', remove);

async function request(
  target: Target,
  receiptId: string | undefined,
  options: RequestInit = {},
) {
  const prefs = getPrefs();
  const server = getServer();
  const token = await asyncStorage.getItem('user-token');
  if (!server || !token || !prefs?.cloudFileId) {
    throw new Error('receipt-server-required');
  }
  if (
    prefs.cloudFileId !== target.fileId ||
    getPrefs()?.cloudFileId !== target.fileId
  ) {
    throw new Error('receipt-server-required');
  }
  if (prefs.encryptKeyId) throw new Error('receipt-encrypted-budget');
  const transaction = await db.first<{ id: string; parent_id: string | null }>(
    'SELECT id, parent_id FROM transactions WHERE id = ? AND tombstone = 0',
    [target.transactionId],
  );
  if (!transaction) throw new Error('receipt-save-transaction');
  if (getPrefs()?.cloudFileId !== target.fileId) {
    throw new Error('receipt-server-required');
  }
  const id = transaction.parent_id || transaction.id;
  const url = `${server.BASE_SERVER.replace(/\/$/, '')}/receipts/${encodeURIComponent(prefs.cloudFileId)}/${encodeURIComponent(id)}${receiptId ? `/${encodeURIComponent(receiptId)}` : ''}`;
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(60000),
    headers: { ...options.headers, 'x-actual-token': token },
  });
  const contentType = response.headers.get('content-type') || '';
  const isDownload = Boolean(receiptId && !options.method);
  if (
    contentType.includes('text/html') ||
    (!isDownload && !contentType.includes('application/json'))
  ) {
    throw new Error('receipt-server-missing');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const reason =
      body &&
      typeof body === 'object' &&
      'reason' in body &&
      typeof body.reason === 'string'
        ? body.reason
        : 'receipt-network-failure';
    throw new Error(reason);
  }
  return response;
}

async function safely<T>(
  operation: () => Promise<T>,
): Promise<ReceiptResult<T>> {
  try {
    return { data: await operation() };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'receipt-network-failure',
    };
  }
}

async function status({ fileId }: { fileId: string }) {
  return safely(async (): Promise<string[]> => {
    const prefs = getPrefs();
    const server = getServer();
    const token = await asyncStorage.getItem('user-token');
    if (
      !server ||
      !token ||
      prefs?.cloudFileId !== fileId ||
      getPrefs()?.cloudFileId !== fileId
    ) {
      throw new Error('receipt-server-required');
    }
    if (prefs.encryptKeyId) throw new Error('receipt-encrypted-budget');
    const response = await fetch(
      `${server.BASE_SERVER.replace(/\/$/, '')}/receipts/${encodeURIComponent(fileId)}/_status`,
      {
        signal: AbortSignal.timeout(15000),
        headers: { 'x-actual-token': token },
      },
    );
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('application/json')
    ) {
      throw new Error('receipt-network-failure');
    }
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('data' in body) ||
      !Array.isArray(body.data) ||
      !body.data.every(id => typeof id === 'string')
    ) {
      throw new Error('receipt-network-failure');
    }
    return body.data;
  });
}

async function list(target: Target) {
  return safely(
    async (): Promise<Receipt[]> =>
      (await (await request(target, undefined)).json()).data,
  );
}

async function upload(target: Target & { name: string; bytes: ArrayBuffer }) {
  return safely(async (): Promise<Receipt> => {
    if (target.bytes.byteLength > 10 * 1024 * 1024) {
      throw new Error('receipt-too-large');
    }
    const response = await request(target, undefined, {
      method: 'POST',
      body: target.bytes,
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-receipt-name': encodeURIComponent(target.name),
      },
    });
    return (await response.json()).data;
  });
}

async function download(target: Target & { receiptId: string }) {
  return safely(async () =>
    (await request(target, target.receiptId)).arrayBuffer(),
  );
}

async function remove(target: Target & { receiptId: string }) {
  return safely(async () => {
    await request(target, target.receiptId, { method: 'DELETE' });
    return null;
  });
}


import { join, resolve } from 'node:path';

import express from 'express';
import type { ErrorRequestHandler } from 'express';

import { getAccountDb, isAdmin } from './account-db';
import { FileNotFound } from './app-sync/errors';
import { FilesService } from './app-sync/services/files-service';
import { config } from './load-config';
import {
  createReceiptStore,
  ReceiptError,
  validReceiptId,
} from './receipt-store';
import { countUserAccess } from './services/user-service';
import { validateSessionMiddleware } from './util/middlewares';
import { isValidFileId } from './util/paths';

export const handlers = express();
const store = createReceiptStore(
  join(resolve(config.get('serverFiles')), 'receipts'),
);
handlers.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});
handlers.use(validateSessionMiddleware);
handlers.use('/:fileId/:transactionId', (req, res, next) => {
  const { fileId, transactionId } = req.params;
  if (
    !isValidFileId(fileId) ||
    !validReceiptId(fileId) ||
    !validReceiptId(transactionId)
  ) {
    throw new ReceiptError('receipt-invalid-id');
  }
  let file;
  try {
    file = new FilesService(getAccountDb()).get(fileId);
  } catch (error) {
    if (error instanceof FileNotFound) {
      throw new ReceiptError('file-not-found', 404);
    }
    throw error;
  }
  const userId: unknown = res.locals.user_id;
  if (
    typeof userId !== 'string' ||
    !(
      file.owner === userId ||
      isAdmin(userId) ||
      countUserAccess(fileId, userId) > 0
    )
  ) {
    throw new ReceiptError('file-access-not-allowed', 403);
  }
  // Never silently store plaintext attachments for an end-to-end encrypted budget.
  if (file.encryptKeyId) {
    throw new ReceiptError('receipt-encrypted-budget', 409);
  }
  next();
});

handlers.get('/:fileId/_status', async (req, res) => {
  res.json({
    status: 'ok',
    data: await store.transactionIds(req.params.fileId),
  });
});

handlers.get('/:fileId/:transactionId', async (req, res) => {
  res.json({
    status: 'ok',
    data: await store.list(req.params.fileId, req.params.transactionId),
  });
});
handlers.post(
  '/:fileId/:transactionId',
  express.raw({ type: 'application/octet-stream', limit: '10mb' }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      throw new ReceiptError('receipt-invalid-type', 415);
    }
    const header = req.get('x-receipt-name');
    let name = '';
    try {
      name = decodeURIComponent(header || '');
    } catch {
      throw new ReceiptError('receipt-invalid-name');
    }
    const data = await store.add(
      req.params.fileId,
      req.params.transactionId,
      name,
      req.body,
    );
    res.json({ status: 'ok', data });
  },
);
handlers.get('/:fileId/:transactionId/:receiptId', async (req, res) => {
  const { receipt, data } = await store.get(
    req.params.fileId,
    req.params.transactionId,
    req.params.receiptId,
  );
  res.type(receipt.mime);
  res.set(
    'Content-Disposition',
    `attachment; filename="receipt"; filename*=UTF-8''${encodeURIComponent(receipt.name)}`,
  );
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(data);
});
handlers.delete('/:fileId/:transactionId/:receiptId', async (req, res) => {
  await store.remove(
    req.params.fileId,
    req.params.transactionId,
    req.params.receiptId,
  );
  res.json({ status: 'ok', data: null });
});
const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ReceiptError) {
    res.status(error.status).json({ status: 'error', reason: error.reason });
  } else if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    res.status(413).json({ status: 'error', reason: 'receipt-too-large' });
  } else {
    console.error('Receipt storage failed', error);
    res
      .status(500)
      .json({ status: 'error', reason: 'receipt-storage-failure' });
  }
};
handlers.use(errors);


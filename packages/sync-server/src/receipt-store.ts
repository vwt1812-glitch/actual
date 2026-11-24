import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_PER_TRANSACTION = 20;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;

export type Receipt = {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
};

export class ReceiptError extends Error {
  constructor(
    public reason: string,
    public status = 400,
  ) {
    super(reason);
  }
}

export function validReceiptId(value: string) {
  return ID.test(value);
}

export function receiptMime(data: Buffer): string {
  if (data.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png';
  }
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) {
    return 'image/jpeg';
  }
  throw new ReceiptError('receipt-invalid-type', 415);
}

export function createReceiptStore(root: string) {
  // Serialize writes across budgets, including quota checks. Readers only see
  // complete directories after the atomic rename; no partial upload is listed.
  let pending: Promise<unknown> = Promise.resolve();
  function write<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }

  function path(fileId: string, transactionId: string, receiptId?: string) {
    if (
      ![fileId, transactionId, ...(receiptId ? [receiptId] : [])].every(
        validReceiptId,
      )
    ) {
      throw new ReceiptError('receipt-invalid-id');
    }
    return join(root, fileId, transactionId, ...(receiptId ? [receiptId] : []));
  }

  async function directories(directory: string) {
    try {
      return (await fs.readdir(directory, { withFileTypes: true }))
        .filter(
          entry =>
            entry.isDirectory() &&
            validReceiptId(entry.name) &&
            !entry.name.startsWith('pending-'),
        )
        .map(entry => entry.name);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return [];
      }
      throw error;
    }
  }

  async function metadata(directory: string): Promise<Receipt> {
    const value: unknown = JSON.parse(
      await fs.readFile(join(directory, 'meta.json'), 'utf8'),
    );
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      !('name' in value) ||
      typeof value.name !== 'string' ||
      !('mime' in value) ||
      typeof value.mime !== 'string' ||
      !('size' in value) ||
      typeof value.size !== 'number' ||
      !('createdAt' in value) ||
      typeof value.createdAt !== 'string'
    ) {
      throw new Error('Invalid receipt metadata');
    }
    return {
      id: value.id,
      name: value.name,
      mime: value.mime,
      size: value.size,
      createdAt: value.createdAt,
    };
  }

  async function list(fileId: string, transactionId: string) {
    const directory = path(fileId, transactionId);
    const entries = await directories(directory);
    return (
      await Promise.all(entries.map(id => metadata(join(directory, id))))
    ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async function usedBytes() {
    let total = 0;
    for (const budget of await directories(root)) {
      for (const transaction of await directories(join(root, budget))) {
        for (const receipt of await list(budget, transaction)) {
          total += receipt.size;
        }
      }
    }
    return total;
  }

  return {
    list,
    async transactionIds(fileId: string) {
      if (!validReceiptId(fileId)) throw new ReceiptError('receipt-invalid-id');
      const ids = await directories(join(root, fileId));
      const populated = await Promise.all(
        ids.map(async id =>
          (await directories(path(fileId, id))).length > 0 ? id : null,
        ),
      );
      return populated.filter((id): id is string => id !== null);
    },
    add(fileId: string, transactionId: string, name: string, data: Buffer) {
      return write(async () => {
        const directory = path(fileId, transactionId);
        if (
          !name ||
          name.length > 180 ||
          name.includes('/') ||
          name.includes('\\') ||
          [...name].some(
            character =>
              character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          )
        ) {
          throw new ReceiptError('receipt-invalid-name');
        }
        if (data.length === 0 || data.length > MAX_RECEIPT_BYTES) {
          throw new ReceiptError('receipt-too-large', 413);
        }
        const mime = receiptMime(data);
        if ((await list(fileId, transactionId)).length >= MAX_PER_TRANSACTION) {
          throw new ReceiptError('receipt-count-limit', 409);
        }
        if ((await usedBytes()) + data.length > MAX_TOTAL_BYTES) {
          throw new ReceiptError('receipt-storage-limit', 409);
        }
        const id = randomUUID();
        const receipt: Receipt = {
          id,
          name,
          mime,
          size: data.length,
          createdAt: new Date().toISOString(),
        };
        const temporary = join(directory, `pending-${id}`);
        await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
        try {
          await fs.writeFile(join(temporary, 'blob'), data, {
            mode: 0o600,
            flag: 'wx',
          });
          await fs.writeFile(
            join(temporary, 'meta.json'),
            JSON.stringify(receipt),
            { mode: 0o600, flag: 'wx' },
          );
          await fs.rename(temporary, join(directory, id));
        } finally {
          await fs.rm(temporary, { recursive: true, force: true });
        }
        return receipt;
      });
    },
    async get(fileId: string, transactionId: string, id: string) {
      try {
        const directory = path(fileId, transactionId, id);
        return {
          receipt: await metadata(directory),
          data: await fs.readFile(join(directory, 'blob')),
        };
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          throw new ReceiptError('receipt-not-found', 404);
        }
        throw error;
      }
    },
    remove(fileId: string, transactionId: string, id: string) {
      return write(async () => {
        await fs.rm(path(fileId, transactionId, id), {
          recursive: true,
          force: true,
        });
      });
    },
  };
}


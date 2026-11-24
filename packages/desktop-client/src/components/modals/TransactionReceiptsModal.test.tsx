import type { ReactNode } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { TransactionReceiptsModal } from './TransactionReceiptsModal';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('@actual-app/core/platform/client/connection', () => ({
  send: sendMock,
}));
vi.mock('#hooks/useMetadataPref', () => ({
  useMetadataPref: (name: string) => [
    name === 'cloudFileId' ? 'test-budget' : null,
  ],
}));
vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: false }),
}));
vi.mock('#components/common/Modal', () => ({
  Modal: ({
    children,
  }: {
    children: (props: { state: { close: () => void } }) => ReactNode;
  }) => children({ state: { close: () => undefined } }),
  ModalHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  ModalCloseButton: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue || key,
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: [] });
});

async function ready() {
  render(<TransactionReceiptsModal transactionId="test-transaction" />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Beleg hinzuf\u00fcgen' }),
    ).toBeEnabled(),
  );
  return screen.getByRole('region', { name: 'Beleg hochladen' });
}

it('uploads a dropped file and shows its saved filename', async () => {
  const zone = await ready();
  const bytes = new TextEncoder().encode('%PDF-1.7 test');
  const file = new File([bytes], 'Rechnung.pdf', { type: 'application/pdf' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.buffer,
  });
  sendMock.mockResolvedValueOnce({
    data: {
      id: 'receipt',
      name: file.name,
      mime: file.type,
      size: file.size,
      createdAt: '2026-10-06',
    },
  });
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  await screen.findByText(file.name);
  expect(sendMock).toHaveBeenLastCalledWith('receipts-upload', {
    transactionId: 'test-transaction',
    fileId: 'test-budget',
    name: file.name,
    bytes: bytes.buffer,
  });
});

it('does not silently discard extra files in a multi-file drop', async () => {
  const zone = await ready();
  fireEvent.drop(zone, {
    dataTransfer: {
      files: [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')],
    },
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'einen Beleg nach dem anderen',
  );
  expect(sendMock).toHaveBeenCalledTimes(1);
});

it('blocks oversized dropped files before sending them', async () => {
  const zone = await ready();
  const file = new File(['test'], 'large.pdf');
  Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('10 MB'),
  );
  expect(sendMock).toHaveBeenCalledTimes(1);
});

it('explains a missing receipt backend instead of suggesting a generic connection problem', async () => {
  sendMock.mockResolvedValueOnce({ error: 'receipt-server-missing' });
  render(<TransactionReceiptsModal transactionId="test-transaction" />);
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Serverteil der Belegfunktion fehlt',
    ),
  );
});

it('uploads selected draft receipts to the saved parent transaction and retries only failed files', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7 test');
  const files = ['first.pdf', 'second.pdf'].map(name => {
    const file = new File([bytes], name, { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => bytes.buffer,
    });
    return file;
  });
  let failSecond = true;
  sendMock.mockImplementation(
    async (method: string, args: { name: string }) => {
      if (method === 'receipts-list') return { data: [] };
      if (args.name === 'second.pdf' && failSecond) return { error: 'network' };
      return {
        data: {
          id: args.name,
          name: args.name,
          mime: 'application/pdf',
          size: 20,
          createdAt: '2026-10-07',
        },
      };
    },
  );
  render(
    <TransactionReceiptsModal
      transactionId="saved-parent-id"
      initialFiles={files}
    />,
  );
  await screen.findByRole('alert');
  expect(
    sendMock.mock.calls.filter(([method]) => method === 'receipts-upload'),
  ).toHaveLength(2);
  failSecond = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Belege erneut hochladen' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Belege erneut hochladen' }),
    ).not.toBeInTheDocument(),
  );
  const uploads = sendMock.mock.calls.filter(
    ([method]) => method === 'receipts-upload',
  );
  expect(uploads.map(([, args]) => args.name)).toEqual([
    'first.pdf',
    'second.pdf',
    'second.pdf',
  ]);
  expect(
    uploads.every(([, args]) => args.transactionId === 'saved-parent-id'),
  ).toBe(true);
  expect(
    sendMock.mock.calls.some(
      ([method]) => method === 'transactions-batch-update',
    ),
  ).toBe(false);
});


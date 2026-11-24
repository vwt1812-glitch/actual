import type { TransactionEntity } from '@actual-app/core/types/models';
import { act, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import {
  notifyReceiptStatusChanged,
  ReceiptStatusProvider,
  TransactionReceiptStatus,
} from './ReceiptStatus';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('@actual-app/core/platform/client/connection', () => ({
  send: sendMock,
}));
vi.mock('#hooks/useMetadataPref', () => ({
  useMetadataPref: (name: string) => [
    name === 'cloudFileId' ? 'test-budget' : null,
  ],
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue || key,
  }),
}));
const transaction = {
  id: 'expense',
  account: 'account',
  date: '2026-10-06',
  amount: -3000,
} as TransactionEntity;
function row(value = transaction) {
  return (
    <ReceiptStatusProvider>
      <TransactionReceiptStatus transaction={value} />
    </ReceiptStatusProvider>
  );
}
beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: [] });
});
it('marks expenses without receipts as missing after a successful server response', async () => {
  render(row());
  expect(
    await screen.findByRole('img', { name: 'Beleg fehlt' }),
  ).toBeInTheDocument();
  expect(sendMock).toHaveBeenCalledWith('receipts-status', {
    fileId: 'test-budget',
  });
});
it('uses the parent receipt for a split expense', async () => {
  sendMock.mockResolvedValue({ data: ['parent'] });
  render(row({ ...transaction, parent_id: 'parent', is_child: true }));
  expect(
    await screen.findByRole('img', { name: 'Beleg angef\u00fcgt' }),
  ).toBeInTheDocument();
});
it.each([0, 525000])(
  'does not show an indicator for non-expenses (%s)',
  async amount => {
    render(row({ ...transaction, amount } as TransactionEntity));
    await waitFor(() => expect(sendMock).toHaveBeenCalled());
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  },
);
it('does not report a missing receipt when the server is unavailable', async () => {
  sendMock.mockResolvedValue({ error: 'receipt-network-failure' });
  render(row());
  await waitFor(() => expect(sendMock).toHaveBeenCalled());
  expect(
    screen.getByRole('img', { name: 'Belegstatus unbekannt' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('img', { name: 'Beleg fehlt' }),
  ).not.toBeInTheDocument();
});
it('refreshes after uploading and deleting without reloading the page', async () => {
  render(row());
  await screen.findByRole('img', { name: 'Beleg fehlt' });
  sendMock.mockResolvedValue({ data: ['expense'] });
  act(() => notifyReceiptStatusChanged());
  await screen.findByRole('img', { name: 'Beleg angef\u00fcgt' });
  sendMock.mockResolvedValue({ data: [] });
  act(() => notifyReceiptStatusChanged());
  await screen.findByRole('img', { name: 'Beleg fehlt' });
});

it('shows a readable status label on mobile alongside the icon', async () => {
  render(
    <ReceiptStatusProvider>
      <TransactionReceiptStatus transaction={transaction} showLabel />
    </ReceiptStatusProvider>,
  );
  expect(await screen.findByText('Beleg fehlt')).toBeInTheDocument();
});


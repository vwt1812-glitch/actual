import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { MobileNavTabs } from './MobileNavTabs';
const state = vi.hoisted(() => ({ narrow: true, server: 'online' }));
vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: state.narrow }),
}));
vi.mock('#hooks/useSyncServerStatus', () => ({
  useSyncServerStatus: () => state.server,
}));
vi.mock('#hooks/useIsTestEnv', () => ({ useIsTestEnv: () => false }));
vi.mock('react-i18next', () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue || key,
  }),
}));
function setup() {
  render(
    <MemoryRouter initialEntries={['/budget']}>
      <MobileNavTabs />
    </MemoryRouter>,
  );
  return userEvent.setup();
}
beforeEach(() => {
  state.narrow = true;
  state.server = 'online';
});
it('makes all main actions visible and secondary pages reachable by tapping More', async () => {
  const user = setup();
  expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute(
    'href',
    '/budget',
  );
  expect(screen.getByRole('link', { name: 'Buchung' })).toHaveAttribute(
    'href',
    '/transactions/new',
  );
  expect(
    screen.queryByRole('link', { name: 'Reports' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'More' }));
  expect(
    await screen.findByRole('dialog', { name: 'Weitere Men\u00fcpunkte' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute(
    'href',
    '/reports',
  );
  expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/settings',
  );
  await user.click(screen.getByRole('link', { name: 'Schedules' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
});
it('closes the menu with Escape and returns focus to More', async () => {
  const user = setup();
  await user.click(screen.getByRole('button', { name: 'More' }));
  await screen.findByRole('dialog');
  await user.keyboard('{Escape}');
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
});
it('does not offer bank sync without a server', async () => {
  state.server = 'no-server';
  const user = setup();
  await user.click(screen.getByRole('button', { name: 'More' }));
  await screen.findByRole('dialog');
  expect(
    screen.queryByRole('link', { name: 'Bank Sync' }),
  ).not.toBeInTheDocument();
});
it('leaves desktop navigation to the existing desktop UI', () => {
  state.narrow = false;
  setup();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});


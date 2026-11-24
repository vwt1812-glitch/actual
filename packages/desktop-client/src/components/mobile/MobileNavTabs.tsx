import { useRef, useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';
import { Dialog } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import {
  SvgAdd,
  SvgCog,
  SvgCreditCard,
  SvgDotsHorizontalTriple,
  SvgPiggyBank,
  SvgReports,
  SvgStoreFront,
  SvgTuning,
  SvgWallet,
} from '@actual-app/components/icons/v1';
import { SvgCalendar3 } from '@actual-app/components/icons/v2';
import { Popover } from '@actual-app/components/popover';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useIsTestEnv } from '#hooks/useIsTestEnv';
import { useSyncServerStatus } from '#hooks/useSyncServerStatus';

// Leave room for the navigation and the home indicator on content pages.
export const MOBILE_NAV_HEIGHT = 85;

type NavItem = {
  name: string;
  path: string;
  Icon: ComponentType<{ width: number; height: number; style?: CSSProperties }>;
};

export function MobileNavTabs() {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const syncServerStatus = useSyncServerStatus();
  const isTestEnv = useIsTestEnv();
  const { pathname } = useLocation();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const isUsingServer = syncServerStatus !== 'no-server' || isTestEnv;
  const mainItems: NavItem[] = [
    { name: t('Budget'), path: '/budget', Icon: SvgWallet },
    {
      name: t('New booking', { defaultValue: 'Buchung' }),
      path: '/transactions/new',
      Icon: SvgAdd,
    },
    { name: t('Accounts'), path: '/accounts', Icon: SvgPiggyBank },
  ];
  const moreItems: NavItem[] = [
    { name: t('Reports'), path: '/reports', Icon: SvgReports },
    { name: t('Schedules'), path: '/schedules', Icon: SvgCalendar3 },
    { name: t('Payees'), path: '/payees', Icon: SvgStoreFront },
    { name: t('Rules'), path: '/rules', Icon: SvgTuning },
    ...(isUsingServer
      ? [{ name: t('Bank Sync'), path: '/bank-sync', Icon: SvgCreditCard }]
      : []),
    { name: t('Settings'), path: '/settings', Icon: SvgCog },
  ];
  const isMoreActive = moreItems.some(item => pathname.startsWith(item.path));
  if (!isNarrowWidth) {
    return null;
  }
  return (
    <nav
      aria-label={t('Main navigation', { defaultValue: 'Hauptnavigation' })}
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        backgroundColor: theme.mobileNavBackground,
        borderTop: `1px solid ${theme.menuBorder}`,
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        display: 'flex',
        minHeight: 68,
      }}
    >
      {mainItems.map(item => (
        <NavTab
          key={item.path}
          {...item}
          onClick={() => setIsMoreOpen(false)}
        />
      ))}
      <Button
        ref={moreRef}
        variant="bare"
        aria-expanded={isMoreOpen}
        aria-haspopup="dialog"
        onPress={() => setIsMoreOpen(open => !open)}
        style={{
          flex: 1,
          minWidth: 44,
          minHeight: 68,
          borderRadius: 0,
          flexDirection: 'column',
          gap: 5,
          fontSize: 13,
          fontWeight: isMoreActive ? 600 : 400,
          color:
            isMoreActive || isMoreOpen
              ? theme.mobileNavItemSelected
              : theme.pageText,
        }}
      >
        <SvgDotsHorizontalTriple width={22} height={22} aria-hidden="true" />
        <Trans>More</Trans>
      </Button>
      <Popover
        triggerRef={moreRef}
        isOpen={isMoreOpen}
        onOpenChange={setIsMoreOpen}
        placement="top end"
        offset={8}
        style={{
          zIndex: 101,
          width: 'min(360px, calc(100vw - 16px))',
          maxHeight: 'calc(var(--visual-viewport-height) - 110px)',
          overflowY: 'auto',
          padding: 8,
          backgroundColor: theme.mobileNavBackground,
        }}
      >
        <Dialog
          aria-label={t('More navigation options', {
            defaultValue: 'Weitere Men�punkte',
          })}
          style={{ outline: 'none' }}
        >
          <View style={{ gap: 2 }}>
            {moreItems.map(item => (
              <NavTab
                key={item.path}
                {...item}
                expanded
                onClick={() => setIsMoreOpen(false)}
              />
            ))}
          </View>
        </Dialog>
      </Popover>
    </nav>
  );
}

function NavTab({
  name,
  path,
  Icon,
  expanded = false,
  onClick,
}: NavItem & { expanded?: boolean; onClick: () => void }) {
  return (
    <NavLink
      to={path}
      onClick={onClick}
      style={({ isActive }) => ({
        ...styles.noTapHighlight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: expanded ? 'flex-start' : 'center',
        flexDirection: expanded ? 'row' : 'column',
        gap: expanded ? 12 : 5,
        flex: expanded ? undefined : 1,
        minWidth: 44,
        minHeight: expanded ? 48 : 68,
        padding: expanded ? '8px 12px' : '8px 2px',
        color: isActive ? theme.mobileNavItemSelected : theme.pageText,
        backgroundColor:
          expanded && isActive ? theme.tableRowBackgroundHover : undefined,
        textDecoration: 'none',
        textAlign: expanded ? 'left' : 'center',
        fontSize: expanded ? 16 : 13,
        fontWeight: isActive ? 600 : 400,
      })}
    >
      <Icon width={22} height={22} style={{ flexShrink: 0 }} />
      {name}
    </NavLink>
  );
}


import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { SvgCheckmark, SvgClose } from '@actual-app/components/icons/v1';
import { SvgSubtract } from '@actual-app/components/icons/v2';
import { theme } from '@actual-app/components/theme';
import { send } from '@actual-app/core/platform/client/connection';
import {
  isPreviewId,
  isTemporaryId,
} from '@actual-app/core/shared/transactions';
import type { TransactionEntity } from '@actual-app/core/types/models';

import { useMetadataPref } from '#hooks/useMetadataPref';

const changedEvent = 'actual-receipts-changed';
const StatusContext = createContext<ReadonlySet<string> | undefined>(undefined);

export function notifyReceiptStatusChanged() {
  window.dispatchEvent(new Event(changedEvent));
}

export function ReceiptStatusProvider({ children }: { children: ReactNode }) {
  const [fileId] = useMetadataPref('cloudFileId');
  const [encryptKeyId] = useMetadataPref('encryptKeyId');
  const [status, setStatus] = useState<{
    fileId: string;
    ids: ReadonlySet<string>;
  }>();
  useEffect(() => {
    let active = true;
    let generation = 0;
    async function refresh() {
      const current = ++generation;
      if (!fileId || encryptKeyId) return;
      try {
        const result = await send('receipts-status', { fileId });
        if (!active || current !== generation) return;
        setStatus(
          result.data ? { fileId, ids: new Set(result.data) } : undefined,
        );
      } catch {
        if (active && current === generation) setStatus(undefined);
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    const update = () => void refresh();
    window.addEventListener(changedEvent, update);
    window.addEventListener('focus', update);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener(changedEvent, update);
      window.removeEventListener('focus', update);
    };
  }, [fileId, encryptKeyId]);
  return (
    <StatusContext.Provider
      value={
        !encryptKeyId && status?.fileId === fileId ? status?.ids : undefined
      }
    >
      {children}
    </StatusContext.Provider>
  );
}

export function TransactionReceiptStatus({
  transaction,
  showLabel = false,
}: {
  transaction: TransactionEntity;
  showLabel?: boolean;
}) {
  const ids = useContext(StatusContext);
  const { t } = useTranslation();
  if (
    transaction.amount >= 0 ||
    isPreviewId(transaction.id) ||
    isTemporaryId(transaction.id)
  ) {
    return null;
  }
  const attached = ids?.has(transaction.parent_id || transaction.id);
  const label =
    attached === undefined
      ? t('Receipt status unavailable', {
          defaultValue: 'Belegstatus unbekannt',
        })
      : attached
        ? t('Receipt attached', { defaultValue: 'Beleg angef�gt' })
        : t('Receipt missing', { defaultValue: 'Beleg fehlt' });
  const Icon =
    attached === undefined ? SvgSubtract : attached ? SvgCheckmark : SvgClose;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        color:
          attached === undefined
            ? theme.pageTextSubdued
            : attached
              ? showLabel
                ? theme.numberPositive
                : theme.noticeTextLight
              : theme.errorText,
      }}
    >
      <Icon width={16} height={16} aria-hidden="true" />
      {showLabel && <span>{label}</span>}
    </span>
  );
}


Warning: truncated output (original token count: 31332)
Total output lines: 4070

import {
  createElement,
  createRef,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CSSProperties,
  ForwardedRef,
  KeyboardEvent,
  ReactNode,
  Ref,
  RefObject,
} from 'react';
import { DragPreview } from 'react-aria';
import type { DragPreviewRenderer } from 'react-aria';
import { useHotkeys } from 'react-hotkeys-hook';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgSplit } from '@actual-app/components/icons/v0';
import {
  SvgArrowDown,
  SvgArrowUp,
  SvgCheveronDown,
} from '@actual-app/components/icons/v1';
import {
  SvgAlertTriangle,
  SvgArrowsSynchronize,
  SvgCalendar3,
  SvgCheckCircle1,
  SvgCheckCircleHollow,
  SvgEditSkull1,
  SvgHyperlink2,
  SvgLockClosed,
  SvgSubtract,
} from '@actual-app/components/icons/v2';
import { Popover } from '@actual-app/components/popover';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { Tooltip } from '@actual-app/components/tooltip';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { memoizeOne } from '@actual-app/core/shared/memoize';
import * as monthUtils from '@actual-app/core/shared/months';
import { q } from '@actual-app/core/shared/query';
import { DEFAULT_UPCOMING_SCHEDULE_DAYS } from '@actual-app/core/shared/schedules';
import {
  addSplitTransaction,
  deleteTransaction,
  groupTransaction,
  isPreviewId,
  isTemporaryId,
  makeEmptySplitSubtransactions,
  splitTransaction,
  ungroupTransactions,
  updateTransaction,
} from '@actual-app/core/shared/transactions';
import {
  amountToCurrency,
  currencyToAmount,
  integerToCurrency,
  titleFirst,
} from '@actual-app/core/shared/util';
import type { IntegerAmount } from '@actual-app/core/shared/util';
import type {
  AccountEntity,
  CategoryEntity,
  CategoryGroupEntity,
  PayeeEntity,
  RuleEntity,
  ScheduleEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';
import { format as formatDate, parseISO } from 'date-fns';

import { getAccountsById } from '#accounts/accountsSlice';
import { AccountAutocomplete } from '#components/autocomplete/AccountAutocomplete';
import { CategoryAutocomplete } from '#components/autocomplete/CategoryAutocomplete';
import { PayeeAutocomplete } from '#components/autocomplete/PayeeAutocomplete';
import { TagAutocomplete } from '#components/autocomplete/TagAutocomplete';
import { TransferDirectionIcon } from '#components/common/TransferDirectionIcon';
import { getStatusProps } from '#components/schedules/StatusBadge';
import type { StatusTypes } from '#components/schedules/StatusBadge';
import { DateSelect } from '#components/select/DateSelect';
import {
  Cell,
  CellButton,
  CustomCell,
  DeleteCell,
  Field,
  InputCell,
  Row,
  SelectCell,
  Table,
  UnexposedCellContent,
  useTableNavigator,
} from '#components/table';
import type {
  TableHandleRef,
  TableNavigator,
  TableProps,
} from '#components/table';
import {
  SchedulesProvider,
  useCachedSchedules,
} from '#hooks/useCachedSchedules';
import { DisplayPayeeProvider, useDisplayPayee } from '#hooks/useDisplayPayee';
import {
  DropHighlight,
  isValidBoundaryDrop,
  useDrag,
  useDrop,
} from '#hooks/useDragDrop';
import type {
  DropPosition,
  OnDragChangeCallback,
  OnDropCallback,
} from '#hooks/useDragDrop';
import { useLocalPref } from '#hooks/useLocalPref';
import { useMergedRefs } from '#hooks/useMergedRefs';
import { usePrevious } from '#hooks/usePrevious';
import { useProperFocus } from '#hooks/useProperFocus';
import { useResizeObserver } from '#hooks/useResizeObserver';
import { useSelectedDispatch, useSelectedItems } from '#hooks/useSelected';
import { SheetNameProvider } from '#hooks/useSheetName';
import { useSplitsExpanded } from '#hooks/useSplitsExpanded';
import type { SplitsExpandedContextValue } from '#hooks/useSplitsExpanded';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { pushModal } from '#modals/modalsSlice';
import { NotesTagFormatter } from '#notes/NotesTagFormatter';
import { addNotification } from '#notifications/notificationsSlice';
import { getPayeesById } from '#payees';
import { aqlQuery } from '#queries/aqlQuery';
import { useDispatch } from '#redux';
import { getStatusLabel } from '#util/schedule';
import {
  calculateFutureTransactionInfo,
  createSingleTimeScheduleFromTransaction,
  isFutureTransaction,
} from '#util/schedule-actions';

import {
  ReceiptStatusProvider,
  TransactionReceiptStatus,
} from './ReceiptStatus';
import {
  isTransactionTableColumnAvailableInChildRows,
  isTransactionTableColumnDisplayOnly,
  TRANSACTION_TABLE_COLUMN_IDS,
  useTransactionTableColumnLabels,
} from './table/columns';
import type { TransactionTableColumnId } from './table/columns';
import {
  deserializeTransaction,
  isLastChild,
  makeTemporaryTransactions,
  selectAscDesc,
  serializeTransaction,
} from './table/utils';
import type {
  SerializedTransaction,
  TransactionEditFunction,
  TransactionUpdateFunction,
} from './table/utils';
import { useTransactionRowContextActions } from './useTransactionRowContextActions';

type AmountColumnWidths = {
  amount: number; // Applies to both debit and credit columns
  balance: number;
};

export const DEFAULT_AMOUNT_COLUMN_WIDTHS: AmountColumnWidths = {
  amount: 100,
  balance: 103,
};

// Tabular numerals (styles.tnum) make every digit glyph the same width, so a
// per-character estimate is a good enough proxy for the pixel width for a
// formatted amount. This would need to be adjusted with the font size.
const AMOUNT_COLUMN_CHAR_WIDTH = 7;
const AMOUNT_COLUMN_PADDING = 16;

function measureAmountColumnWidth(values: string[], minWidth: number) {
  const maxChars = values.reduce(
    (max, value) => Math.max(max, value.length),
    0,
  );
  return Math.max(
    minWidth,
    maxChars * AMOUNT_COLUMN_CHAR_WIDTH + AMOUNT_COLUMN_PADDING,
  );
}

// Widths are computed from every transaction currently loaded so the
// column doesn't jump width while scrolling.
export function useAmountColumnWidths(
  transactions: TransactionEntity[],
  balances: Record<TransactionEntity['id'], IntegerAmount> | null,
): AmountColumnWidths {
  const debitCreditValues = transactions.map(t =>
    integerToCurrency(Math.abs(t.amount ?? 0)),
  );
  const balanceValues = balances
    ? Object.values(balances).map(balance => integerToCurrency(balance))
    : [];

  return {
    amount: measureAmountColumnWidth(
      debitCreditValues,
      DEFAULT_AMOUNT_COLUMN_WIDTHS.amount,
    ),
    balance: measureAmountColumnWidth(
      balanceValues,
      DEFAULT_AMOUNT_COLUMN_WIDTHS.balance,
    ),
  };
}

type TransactionHeaderProps = {
  hasSelected: boolean;
  columns: TransactionTableColumnId[];
  scrollWidth: number;
  showSelection: boolean;
  onSort: (field: string, ascDesc: 'asc' | 'desc') => void;
  ascDesc: 'asc' | 'desc';
  field: string;
  amountColumnWidths: AmountColumnWidths;
};

const TransactionHeader = memo(
  ({
    hasSelected,
    columns,
    scrollWidth,
    onSort,
    ascDesc,
    field,
    showSelection,
    amountColumnWidths,
  }: TransactionHeaderProps) => {
    const dispatchSelected = useSelectedDispatch();
    const { t } = useTranslation();
    const columnLabels = useTransactionTableColumnLabels();

    useHotkeys(
      'ctrl+a, cmd+a, meta+a',
      () => dispatchSelected({ type: 'select-all' }),
      {
        preventDefault: true,
        scopes: ['app'],
      },
      [dispatchSelected],
    );

    // Per-column header cell config. `sortDirection` is the direction used
    // when the column is first clicked; columns without one aren't sortable.
    const headerConfig: Record<
      TransactionTableColumnId,
      Omit<HeaderCellProps, 'id' | 'icon' | 'onClick'> & {
        sortDirection?: 'asc' | 'desc';
      }
    > = {
      date: {
        value: columnLabels.date,
        width: 110,
        alignItems: 'flex',
        marginLeft: -5,
        sortDirection: 'desc',
      },
      account: {
        value: columnLabels.account,
        width: 'flex',
        alignItems: 'flex',
        marginLeft: -5,
        sortDirection: 'asc',
      },
      payee: {
        value: columnLabels.payee,
        width: 'flex',
        alignItems: 'flex',
        marginLeft: -5,
        sortDirection: 'asc',
      },
      notes: {
        value: columnLabels.notes,
        width: 'flex',
        alignItems: 'flex',
        marginLeft: -5,
        sortDirection: 'asc',
      },
      group: {
        value: t('Group'),
        width: 'flex',
        alignItems: 'flex',
        marginLeft: -5,
      },
      category: {
        value: columnLabels.category,
        width: 'flex',
        alignItems: 'flex',
        marginLeft: -5,
        sortDirection: 'asc',
      },
      payment: {
        value: columnLabels.payment,
        width: amountColumnWidths.amount,
        alignItems: 'flex-end',
        marginRight: -5,
        sortDirection: 'asc',
      },
      deposit: {
        value: columnLabels.deposit,
        width: amountColumnWidths.amount,
        alignItems: 'flex-end',
        marginRight: -5,
        sortDirection: 'desc',
      },
      balance: {
        value: t('Balance'),
        width: amountColumnWidths.balance,
        alignItems: 'flex-end',
        marginRight: -5,
      },
      cleared: {
        value: 'V',
        width: 38,
        alignItems: 'center',
        tooltip: <ClearedColumnLegend />,
        sortDirection: 'asc',
      },
    };

    return (
      <Row
        style={{
          fontWeight: 300,
          zIndex: 200,
          color: theme.tableHeaderText,
          backgroundColor: theme.tableHeaderBackground,
          paddingRight: `${5 + (scrollWidth ?? 0)}px`,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: theme.tableBorder,
        }}
        data-testid="transaction-table-header"
      >
        {showSelection && (
          <SelectCell
            exposed
            focused={false}
            selected={hasSelected}
            width={20}
            style={{
              borderTopWidth: 0,
              borderBottomWidth: 0,
            }}
            icon={<SvgSubtract width={6} height={6} />}
            onSelect={(e: KeyboardEvent<HTMLDivElement>) =>
              dispatchSelected({
                type: 'select-all',
                isRangeSelect: e.shiftKey,
              })
            }
          />
        )}
        {!showSelection && (
          <Field
            style={{
              width: '20px',
              border: 0,
            }}
          />
        )}
        {columns.map(columnId => {
          const { sortDirection, ...cellProps } = headerConfig[columnId];
          return (
            <HeaderCell
              key={columnId}
              id={columnId}
              {...cellProps}
              icon={
                sortDirection
                  ? field === columnId
                    ? ascDesc
                    : 'clickable'
                  : undefined
              }
              onClick={
                sortDirection
                  ? () =>
                      onSort(
                        columnId,
                        selectAscDesc(field, ascDesc, columnId, sortDirection),
                      )
                  : undefined
              }
            />
          );
        })}
        <Field
          style={{
            width: 44,
            flexShrink: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Trans i18nKey="Receipt column">Beleg</Trans>
        </Field>
      </Row>
    );
  },
);

TransactionHeader.displayName = 'TransactionHeader';

function ClearedColumnLegend() {
  const legendItems = [
    {
      Icon: SvgCheckCircleHollow,
      color: theme.pageTextSubdued,
      label: <Trans>Uncleared: not yet verified</Trans>,
    },
    {
      Icon: SvgCheckCircle1,
      color: theme.noticeTextLight,
      label: <Trans>Cleared: verified against your account</Trans>,
    },
    {
      Icon: SvgLockClosed,
      color: theme.noticeTextLight,
      label: <Trans>Reconciled: locked after reconciliation</Trans>,
    },
    {
      Icon: SvgCalendar3,
      color: theme.pageTextSubdued,
      label: <Trans>Upcoming scheduled transaction</Trans>,
    },
    {
      Icon: SvgAlertTriangle,
      color: theme.warningText,
      label: <Trans>Due scheduled transaction</Trans>,
    },
    {
      Icon: SvgEditSkull1,
      color: theme.errorText,
      label: <Trans>Missed scheduled transaction</Trans>,
    },
  ];

  return (
    <View style={{ maxWidth: 260, padding: 4 }}>
      <Text style={{ fontWeight: 600 }}>
        <Trans>Transaction status</Trans>
      </Text>
      {legendItems.map(({ Icon, color, label }, index) => (
        <View
          key={index}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: 6,
          }}
        >
          <Icon style={{ width: 13, height: 13, color, flexShrink: 0 }} />
          <Text>{label}</Text>
        </View>
      ))}
    </View>
  );
}

type StatusCellProps = {
  id: TransactionEntity['id'];
  status?: StatusTypes | null;
  focused?: boolean;
  selected?: boolean;
  isChild?: boolean;
  isPreview?: boolean;
  onEdit: TransactionEditFunction;
  onUpdate: TransactionUpdateFunction;
};

function StatusCell({
  id,
  focused,
  selected,
  status,
  isChild,
  isPreview,
  onEdit,
  onUpdate,
}: StatusCellProps) {
  const isClearedField =
    status === 'cleared' || status === 'reconciled' || status == null;
  const statusProps = getStatusProps(status);

  const statusColor =
    status === 'cleared'
      ? theme.noticeTextLight
      : status === 'reconciled'
        ? theme.noticeTextLight
        : status === 'missed'
          ? theme.errorText
          : status === 'due'
            ? theme.warningText
            : selected
              ? theme.pageTextLinkLight
              : theme.pageTextSubdued;

  function onSelect() {
    if (isClearedField) {
      onUpdate('cleared', !(status === 'cleared'));
    }
  }

  return (
    <Cell
      name="cleared"
      width={38}
      alignItems="center"
      focused={focused}
      style={{ padding: 1 }}
      plain
    >
      <CellButton
        style={{
          padding: 3,
          backgroundColor: 'transparent',
          border: '1px solid transparent',
          borderRadius: 50,
          ':focus': {
            ...(isPreview
              ? {
                  boxShadow: 'none',
                }
              : {
                  border: '1px solid ' + theme.formInputBorderSelected,
                  boxShadow: '0 1px 2px ' + theme.formInputBorderSelected,
                }),
          },
          cursor: isClearedField ? 'pointer' : 'default',
          ...(isChild && { visibility: 'hidden' }),
        }}
        disabled={isPreview || isChild}
        onEdit={() => onEdit(id, 'cleared')}
        onSelect={onSelect}
      >
        {createElement(statusProps.Icon, {
          style: {
            width: 13,
            height: 13,
            color: statusColor,
            marginTop: status === 'due' ? -1 : 0,
          },
        })}
      </CellButton>
    </Cell>
  );
}

type HeaderCellProps = {
  value: string;
  id: string;
  icon?: 'asc' | 'desc' | 'clickable';
  tooltip?: ReactNode;
  onClick?: () => void;
} & Pick<CSSProperties, 'width' | 'alignItems' | 'marginLeft' | 'marginRight'>;

function HeaderCell({
  value,
  id,
  width,
  alignItems,
  marginLeft,
  marginRight,
  icon,
  tooltip,
  onClick,
}: HeaderCellProps) {
  const style = {
    whiteSpace: 'nowrap' as CSSProperties['whiteSpace'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: theme.tableHeaderText,
    fontWeight: 300,
    marginLeft,
    marginRight,
  };

  return (
    <CustomCell
      width={width}
      name={id}
      alignItems={alignItems}
      value={value}
      style={{
        borderTopWidth: 0,
        borderBottomWidth: 0,
      }}
      unexposedContent={({ value: cellValue }) => {
        const content = onClick ? (
          <Button variant="bare" onPress={onClick} style={style}>
            <UnexposedCellContent value={cellValue} />
            {icon === 'asc' && (
              <SvgArrowDown width={10} height={10} style={{ marginLeft: 5 }} />
            )}
            {icon === 'desc' && (
              <SvgArrowUp width={10} height={10} style={{ marginLeft: 5 }} />
            )}
          </Button>
        ) : (
          <Text style={style}>{cellValue}</Text>
        );

        return tooltip ? (
          <Tooltip content={tooltip} placement="bottom end">
            {content}
          </Tooltip>
        ) : (
          content
        );
      }}
    />
  );
}

type PayeeCellProps = {
  id: TransactionEntity['id'];
  payee?: PayeeEntity;
  focused: boolean;
  payees: PayeeEntity[];
  accounts: AccountEntity[];
  transferAccountsByTransaction: {
    [id: TransactionEntity['id']]: AccountEntity | null;
  };
  valueStyle: CSSProperties | null;
  transaction: SerializedTransaction;
  importedPayee?: PayeeEntity['id'];
  isPreview: boolean;
  onEdit: TransactionEditFunction;
  onUpdate: TransactionUpdateFunction;
  onCreatePayee: (name: string) => Promise<null | PayeeEntity['id']>;
  onManagePayees: (id: PayeeEntity['id'] | undefined) => void;
  onNavigateToTransferAccount: (id: AccountEntity['id']) => void;
  onNavigateToSchedule: (id: ScheduleEntity['id']) => void;
};

function PayeeCell({
  id,
  payee,
  focused,
  payees,
  accounts,
  transferAccountsByTransaction,
  valueStyle,
  transaction,
  importedPayee,
  isPreview,
  onEdit,
  onUpdate,
  onCreatePayee,
  onManagePayees,
  onNavigateToTransferAccount,
  onNavigateToSchedule,
}: PayeeCellProps) {
  const isCreatingPayee = useRef(false);
  const { t } = useTranslation();

  const dispatch = useDispatch();

  const transferAccount = transferAccountsByTransaction[transaction.id];

  const displayPayee = useDisplayPayee({ transaction });

  return transaction.is_parent ? (
    <Cell
      name="payee"
      width="flex"
      focused={focused}
      style={{ padding: 0 }}
      plain
    >
      <CellButton
        bare
        style={{
          alignSelf: 'stretch',
          borderRadius: 4,
          border: '1px solid transparent', // so it doesn't shift on hover
          ':hover': isPreview
            ? {}
            : {
                border: '1px solid ' + theme.buttonNormalBorder,
              },
        }}
        disabled={isPreview}
        onSelect={() =>
          dispatch(
            pushModal({
              modal: {
                name: 'payee-autocomplete',
                options: {
                  onSelect: (payeeId: PayeeEntity['id']) => {
                    onUpdate('payee', payeeId);
                  },
                },
              },
            }),
          )
        }
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'stretch',
            borderRadius: 4,
            flex: 1,
            padding: 4,
            color: theme.pageTextSubdued,
          }}
        >
          <PayeeIcons
            transaction={transaction}
            transferAccount={transferAccount}
            onNavigateToTransferAccount={onNavigateToTransferAccount}
            onNavigateToSchedule={onNavigateToSchedule}
          />
          <SvgSplit
            style={{
              color: 'inherit',
              width: 14,
              height: 14,
              marginRight: 5,
              flexShrink: 0,
            }}
          />
          <Text
            style={{
              fontStyle: 'italic',
              fontWeight: 300,
              userSelect: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              borderBottom: importedPayee
                ? `1px dashed ${theme.pageTextSubdued}`
                : 'none',
            }}
          >
            {importedPayee ? (
              <Tooltip
                content={
                  <View style={{ padding: 10 }}>
                    <Text style={{ fontWeight: 'bold' }}>
                      <Trans>Imported Payee</Trans>
                    </Text>
                    <Text style={{ fontWeight: 'normal' }}>
                      {importedPayee}
                    </Text>
                  </View>
                }
                style={{
                  ...styles.tooltip,
                  borderRadius: '0px 5px 5px 0px',
                }}
                placement="bottom"
                triggerProps={{ delay: 750 }}
              >
                {displayPayee}
              </Tooltip>
            ) : (
              displayPayee
            )}
          </Text>
        </View>
      </CellButton>
    </Cell>
  ) : (
    <CustomCell
      width="flex"
      name="payee"
      textAlign="flex"
      value={payee?.id}
      valueStyle={valueStyle}
      exposed={focused}
      onExpose={name => !isPreview && onEdit(id, name)}
      onUpdate={async value => {
        onUpdate('payee', value);

        if (value && value.startsWith('new:') && !isCreatingPayee.current) {
          isCreatingPayee.current = true;
          const id = await onCreatePayee(value.slice('new:'.length));
          onUpdate('payee', id ?? undefined);
          isCreatingPayee.current = false;
        }
      }}
      formatter={() => {
        if (!displayPayee && isPreview) {
          return t('(No payee)');
        }
        return displayPayee;
      }}
      unexposedContent={props => {
        const payeeName = (
          <UnexposedCellContent
            {...props}
            style={
              importedPayee
                ? { borderBottom: `1px dashed ${theme.pageTextSubdued}` }
                : {}
            }
          />
        );

        return (
          <>
            <PayeeIcons
              transaction={transaction}
              transferAccount={transferAccount}
              onNavigateToTransferAccount={onNavigateToTransferAccount}
              onNavigateToSchedule={onNavigateToSchedule}
            />
            <div
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {importedPayee ? (
                <Tooltip
                  content={
                    <View style={{ padding: 10 }}>
                      <Text style={{ fontWeight: 'bold' }}>
                        <Trans>Imported Payee</Trans>
                      </Text>
                      <Text style={{ fontWeight: 'normal' }}>
                        {importedPayee}
                      </Text>
                    </View>
                  }
                  style={{
                    ...styles.tooltip,
                    borderRadius: '0px 5px 5px 0px',
                  }}
                  placement="bottom"
                  triggerProps={{ delay: 750 }}
                >
                  {payeeName}
                </Tooltip>
              ) : (
                payeeName
              )}
            </div>
          </>
        );
      }}
    >
      {({
        onBlur,
        onKeyDown,
        onUpdate,
        onSave,
        shouldSaveFromKey,
        inputStyle,
      }) => (
        <PayeeAutocomplete
          payees={payees}
          accounts={accounts}
          value={payee?.id ?? null}
          shouldSaveFromKey={shouldSaveFromKey}
          inputProps={{
            onBlur,
 …19332 tokens truncated…ctions ?? [],
      getFieldsNewTransaction,
    );

    const tableNavigator = useTableNavigator(
      transactionsWithExpandedSplits,
      getFieldsTableTransaction,
    );
    const shouldSchedule = useRef(false);
    const shouldAdd = useRef(false);
    const shouldAddAndClose = useRef(false);
    const pendingConvertToSchedule = useRef<null | {
      daysUntilTransaction: number;
      upcomingDays: number;
      onConfirm: () => void;
    }>(null);
    const latestState = useRef<TableState>({
      newTransactions: newTransactions ?? [],
      newNavigator,
      tableNavigator,
      transactions: [],
    });
    const savePending = useRef(false);
    const afterSaveFunc = useRef<null | (() => void)>(null);
    const [_, forceRerender] = useState({});
    const selectedItems = useSelectedItems();

    latestState.current = {
      newTransactions: newTransactions ?? [],
      newNavigator,
      tableNavigator,
      transactions: props.transactions,
    };

    // Derive new transactions from the `isAdding` prop
    if (prevIsAdding !== props.isAdding) {
      if (!prevIsAdding && props.isAdding) {
        setNewTransactions(
          makeTemporaryTransactions(
            props.currentAccountId,
            props.currentCategoryId,
          ),
        );
      }
      setPrevIsAdding(props.isAdding);
    }

    if (shouldAdd.current || shouldAddAndClose.current) {
      if (newTransactions?.[0] && newTransactions[0].account == null) {
        dispatch(
          addNotification({
            notification: {
              type: 'error',
              message: t('Account is a required field'),
            },
          }),
        );
        newNavigator.onEdit('temp', 'account');
      } else {
        const transactions = latestState.current.newTransactions;

        if (shouldAddAndClose.current) {
          props.onAdd(transactions);
          props.onCloseAddTransaction();
        } else {
          const lastDate =
            transactions.length > 0 ? transactions[0].date : null;
          setNewTransactions(
            makeTemporaryTransactions(
              props.currentAccountId,
              props.currentCategoryId,
              lastDate,
            ),
          );
          newNavigator.onEdit('temp', 'date');
          props.onAdd(transactions);
        }
      }
      shouldAdd.current = false;
      shouldAddAndClose.current = false;
    }

    if (shouldSchedule.current) {
      const transactions = latestState.current.newTransactions;
      if (transactions[0] == null) {
        shouldSchedule.current = false;
      } else if (transactions[0].account == null) {
        dispatch(
          addNotification({
            notification: {
              type: 'error',
              message: t('Account is a required field'),
            },
          }),
        );
        newNavigator.onEdit('temp', 'account');
      } else if (transactions[0].schedule != null) {
        // Already linked to a schedule; keep it as a transaction.
        shouldSchedule.current = false;
      } else {
        const tx = transactions[0];
        const subs = tx.is_parent
          ? transactions.filter(t => t.parent_id === tx.id)
          : null;
        const transaction = subs ? groupTransaction([tx, ...subs]) : tx;

        const createSchedule = () => {
          afterSave(async () => {
            try {
              await createSingleTimeScheduleFromTransaction(transaction);
              dispatch(
                addNotification({
                  notification: {
                    type: 'message',
                    message: t('Schedule created successfully'),
                  },
                }),
              );
              // Reset form like onAddTemporary does
              setNewTransactions(
                makeTemporaryTransactions(
                  props.currentAccountId,
                  props.currentCategoryId,
                ),
              );
              newNavigator.onEdit('temp', 'date');
            } catch {
              dispatch(
                addNotification({
                  notification: {
                    type: 'error',
                    message: t('Failed to create schedule'),
                  },
                }),
              );
            }
          });
        };

        const { isBeyondWindow, daysUntilTransaction, upcomingDays } =
          calculateFutureTransactionInfo(transaction, upcomingLength);

        if (isBeyondWindow) {
          pendingConvertToSchedule.current = {
            daysUntilTransaction,
            upcomingDays,
            onConfirm: createSchedule,
          };
        } else {
          createSchedule();
        }
      }
      shouldSchedule.current = false;
    }

    useEffect(() => {
      if (pendingConvertToSchedule.current) {
        const options = pendingConvertToSchedule.current;
        pendingConvertToSchedule.current = null;
        dispatch(
          pushModal({
            modal: {
              name: 'convert-to-schedule',
              options,
            },
          }),
        );
      }
    });

    useEffect(() => {
      if (savePending.current && afterSaveFunc.current) {
        const func = afterSaveFunc.current;
        afterSaveFunc.current = null;
        savePending.current = false;
        func();
      } else {
        savePending.current = false;
      }
    }, [newTransactions, props, props.transactions]);

    function columnToField(columnId: TransactionTableColumnId) {
      // The payment/deposit columns map to the debit/credit fields
      return columnId === 'payment'
        ? 'debit'
        : columnId === 'deposit'
          ? 'credit'
          : columnId;
    }

    function getFocusableFields() {
      return visibleColumns
        .filter(columnId => !isTransactionTableColumnDisplayOnly(columnId))
        .map(columnToField);
    }

    function getFieldsNewTransaction(item?: TransactionEntity) {
      const fields = [
        'select',
        ...getFocusableFields(),
        'cancel',
        'schedule',
        'add',
      ];

      return getFields(item, fields).filter(
        f => f !== 'schedule' || (item ? isFutureTransaction(item) : false),
      );
    }

    function getFieldsTableTransaction(item?: TransactionEntity) {
      const fields = ['select', ...getFocusableFields()];

      return getFields(item, fields);
    }

    function getFields(item: TransactionEntity | undefined, fields: string[]) {
      fields = item?.is_child
        ? [
            'select',
            ...visibleColumns
              .filter(
                columnId =>
                  isTransactionTableColumnAvailableInChildRows(columnId) &&
                  !isTransactionTableColumnDisplayOnly(columnId),
              )
              .map(columnToField),
          ]
        : fields;

      if (item?.id && isPreviewId(item.id)) {
        fields = ['select'];
      }
      if (item?.id && isTemporaryId(item.id)) {
        // You can't focus the select/delete button of temporary
        // transactions
        fields = fields.slice(1);
      }

      return fields;
    }

    function afterSave(func: () => void) {
      if (savePending.current) {
        afterSaveFunc.current = func;
      } else {
        func();
      }
    }

    function onCheckNewEnter(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
          const current = latestState.current.newTransactions[0];
          if (!current || !isFutureTransaction(current)) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          afterSave(() => {
            const transaction = latestState.current.newTransactions[0];
            if (transaction && isFutureTransaction(transaction)) {
              shouldSchedule.current = true;
              forceRerender({});
            }
          });
        } else if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          afterSave(() => {
            shouldAddAndClose.current = true;
            forceRerender({});
          });
        } else if (!e.shiftKey) {
          function getLastTransaction(state: RefObject<TableState>) {
            const { newTransactions } = state.current;
            return newTransactions[newTransactions.length - 1];
          }

          // Right now, the table navigator does some funky stuff with
          // focus, so we want to stop it from handling this event. We
          // still want enter to move up/down normally, so we only stop
          // it if we are on the last transaction (where we are about to
          // do some logic). I don't like this.
          if (newNavigator.editingId === getLastTransaction(latestState).id) {
            e.stopPropagation();
          }

          afterSave(() => {
            const lastTransaction = getLastTransaction(latestState);
            const isSplit =
              lastTransaction.parent_id || lastTransaction.is_parent;

            if (
              latestState.current.newTransactions[0].error &&
              newNavigator.editingId === lastTransaction.id
            ) {
              // add split
              onAddSplit(lastTransaction.id);
            } else if (
              newNavigator.editingId === lastTransaction.id &&
              (!isSplit || !lastTransaction.error)
            ) {
              onAddTemporary();
            }
          });
        }
      }
    }

    function onCheckEnter(e: KeyboardEvent) {
      if (e.key === 'Enter' && !e.shiftKey) {
        const { editingId: id, focusedField } = tableNavigator;

        afterSave(() => {
          const transactions = latestState.current.transactions;
          const idx = transactions.findIndex(t => t.id === id);
          const parent = transactions.find(
            t => t.id === transactions[idx]?.parent_id,
          );

          if (
            isLastChild(transactions, idx) &&
            parent &&
            parent.error &&
            focusedField !== 'select'
          ) {
            e.stopPropagation();
            onAddSplit(id);
          }
        });
      }
    }

    const onScheduleTemporary = useCallback(() => {
      afterSave(() => {
        shouldSchedule.current = true;
        forceRerender({});
      });
    }, []);

    const onAddTemporary = useCallback(() => {
      afterSave(() => {
        shouldAdd.current = true;
        // A little hacky - this forces a rerender which will cause the
        // effect we want to run. We have to wait for all updates to be
        // committed (the input could still be saving a value).
        forceRerender({});
      });
    }, []);

    const onAddAndCloseTemporary = useCallback(() => {
      afterSave(() => {
        shouldAddAndClose.current = true;
        forceRerender({});
      });
    }, []);

    const {
      onSave: onSaveProp,
      onApplyRules: onApplyRulesProp,
      onBatchDelete: onBatchDeleteProp,
      onBatchDuplicate: onBatchDuplicateProp,
      onBatchLinkSchedule: onBatchLinkScheduleProp,
      onBatchUnlinkSchedule: onBatchUnlinkScheduleProp,
      onCreateRule: onCreateRuleProp,
      onScheduleAction: onScheduleActionProp,
      onMakeAsNonSplitTransactions: onMakeAsNonSplitTransactionsProp,
      onSplit: onSplitProp,
    } = props;

    const onSave = useCallback(
      async (
        transaction: TransactionEntity,
        subtransactions: TransactionEntity[] | null = null,
        updatedFieldName: keyof TransactionEntity | null = null,
      ) => {
        savePending.current = true;

        let groupedTransaction = subtransactions
          ? groupTransaction([transaction, ...subtransactions])
          : transaction;

        if (isTemporaryId(transaction.id)) {
          if (onApplyRulesProp) {
            groupedTransaction = await onApplyRulesProp(
              groupedTransaction,
              updatedFieldName,
            );
          }

          const newTrans = latestState.current.newTransactions;
          // Future refactor: we shouldn't need to iterate through the entire
          // transaction list to ungroup, just the new transactions.
          setNewTransactions(
            ungroupTransactions(
              updateTransaction(newTrans, groupedTransaction).data,
            ),
          );
        } else {
          onSaveProp(groupedTransaction);
        }
      },
      [onSaveProp, onApplyRulesProp],
    );

    const onDelete = useCallback((id: TransactionEntity['id']) => {
      const temporary = isTemporaryId(id);

      if (temporary) {
        const newTrans = latestState.current.newTransactions;

        if (id === newTrans[0].id) {
          // You can never delete the parent new transaction
          return;
        }

        setNewTransactions(deleteTransaction(newTrans, id).data);
      }
    }, []);

    const onBatchDelete = useCallback(
      (ids: TransactionEntity['id'][]) => {
        onBatchDeleteProp(ids);
      },
      [onBatchDeleteProp],
    );

    const onBatchDuplicate = useCallback(
      (ids: TransactionEntity['id'][]) => {
        onBatchDuplicateProp(ids);
      },
      [onBatchDuplicateProp],
    );

    const onBatchLinkSchedule = useCallback(
      (ids: TransactionEntity['id'][]) => {
        onBatchLinkScheduleProp(ids);
      },
      [onBatchLinkScheduleProp],
    );

    const onBatchUnlinkSchedule = useCallback(
      (ids: TransactionEntity['id'][]) => {
        onBatchUnlinkScheduleProp(ids);
      },
      [onBatchUnlinkScheduleProp],
    );

    const onCreateRule = useCallback(
      (ids: TransactionEntity['id'][]) => {
        onCreateRuleProp(ids);
      },
      [onCreateRuleProp],
    );

    const onScheduleAction = useCallback(
      (
        action:
          | 'skip'
          | 'post-transaction'
          | 'post-transaction-today'
          | 'complete',
        ids: TransactionEntity['id'][],
      ) => {
        onScheduleActionProp(action, ids);
      },
      [onScheduleActionProp],
    );

    const onMakeAsNonSplitTransactions = useCallback(
      (ids: TransactionEntity['id'][]) => {
        onMakeAsNonSplitTransactionsProp(ids);
      },
      [onMakeAsNonSplitTransactionsProp],
    );

    const onSplit = useMemo(() => {
      return (id: TransactionEntity['id']) => {
        if (isTemporaryId(id)) {
          const { newNavigator } = latestState.current;
          const newTrans = latestState.current.newTransactions;
          const { data, diff } = splitTransaction(
            newTrans,
            id,
            makeEmptySplitSubtransactions,
          );
          setNewTransactions(data);

          // Jump next to "debit" field if it is empty
          // Otherwise jump to the same field as before, but downwards
          // to the added split transaction
          if (newTrans[0].amount === null) {
            newNavigator.onEdit(newTrans[0].id, 'debit');
          } else {
            newNavigator.onEdit(
              diff.added[0].id,
              latestState.current.newNavigator.focusedField,
            );
          }
        } else {
          const trans = latestState.current.transactions.find(t => t.id === id);
          const newId = onSplitProp(id);
          if (!trans) {
            return;
          }

          splitsExpandedDispatch({ type: 'open-split', id: trans.id });

          const { tableNavigator } = latestState.current;
          if (trans.amount === null) {
            tableNavigator.onEdit(trans.id, 'debit');
          } else {
            tableNavigator.onEdit(newId, tableNavigator.focusedField);
          }
        }
      };
    }, [onSplitProp, splitsExpandedDispatch]);

    const { onAddSplit: onAddSplitProp } = props;

    const onAddSplit = useCallback(
      (id: TransactionEntity['id']) => {
        const {
          tableNavigator,
          newNavigator,
          newTransactions: newTrans,
        } = latestState.current;

        if (isTemporaryId(id)) {
          const { data, diff } = addSplitTransaction(newTrans, id);
          setNewTransactions(data);
          newNavigator.onEdit(
            diff.added[0].id,
            latestState.current.newNavigator.focusedField,
          );
        } else {
          const newId = onAddSplitProp(id);
          tableNavigator.onEdit(
            newId,
            latestState.current.tableNavigator.focusedField,
          );
        }
      },
      [onAddSplitProp],
    );

    const onDistributeRemainder = useCallback(
      async (id: TransactionEntity['id']) => {
        const { transactions, newNavigator, tableNavigator, newTransactions } =
          latestState.current;

        const targetTransactions = isTemporaryId(id)
          ? newTransactions
          : transactions;
        const transaction = targetTransactions.find(t => t.id === id);

        const parentTransaction = transaction?.is_parent
          ? transaction
          : targetTransactions.find(t => t.id === transaction?.parent_id);

        const siblingTransactions = targetTransactions.filter(
          t =>
            t.parent_id &&
            t.parent_id ===
              (transaction?.is_parent
                ? transaction?.id
                : transaction?.parent_id),
        );

        const emptyTransactions = siblingTransactions.filter(
          t => t.amount === 0,
        );
        if (!parentTransaction) {
          console.error(
            'Parent transaction not found for transaction',
            transaction,
          );
          return;
        }

        const remainingAmount =
          parentTransaction.amount -
          siblingTransactions.reduce((acc, t) => acc + t.amount, 0);

        let amounts: number[] = [];
        if (emptyTransactions.length > 0) {
          const amountPerTransaction = Math.floor(
            remainingAmount / emptyTransactions.length,
          );
          let remainingCents =
            remainingAmount - amountPerTransaction * emptyTransactions.length;

          amounts = new Array(emptyTransactions.length).fill(
            amountPerTransaction,
          );

          for (const [amountIndex] of amounts.entries()) {
            if (remainingCents === 0) break;

            amounts[amountIndex] += 1;
            remainingCents--;
          }

          if (isTemporaryId(id)) {
            newNavigator.onEdit(null);
          } else {
            tableNavigator.onEdit(null);
          }

          for (const [
            transactionIndex,
            transaction,
          ] of emptyTransactions.entries()) {
            await onSave({
              ...transaction,
              amount: amounts[transactionIndex],
            });
          }
        } else if (
          emptyTransactions.length === 0 &&
          siblingTransactions.length > 0
        ) {
          const siblingTotal = siblingTransactions.reduce(
            (acc, t) => acc + t.amount,
            0,
          );
          const siblingProportions = siblingTransactions.map(
            t => t.amount / siblingTotal,
          );

          for (const [
            transactionIndex,
            transaction,
          ] of siblingTransactions.entries()) {
            amounts[transactionIndex] =
              Math.floor(
                siblingProportions[transactionIndex] * remainingAmount,
              ) + transaction.amount;
          }

          let remainingCents =
            parentTransaction.amount - amounts.reduce((acc, a) => acc + a, 0);

          let amountIndex = 0;
          while (remainingCents !== 0) {
            amountIndex = amountIndex % amounts.length;
            if (remainingCents > 0) {
              amounts[amountIndex] += 1;
              remainingCents--;
            } else {
              amounts[amountIndex] -= 1;
              remainingCents++;
            }
            amountIndex++;
          }

          if (isTemporaryId(id)) {
            newNavigator.onEdit(null);
          } else {
            tableNavigator.onEdit(null);
          }

          for (const [
            transactionIndex,
            transaction,
          ] of siblingTransactions.entries()) {
            await onSave({
              ...transaction,
              amount: amounts[transactionIndex],
            });
          }
        }
      },
      [onSave],
    );

    function onCloseAddTransaction() {
      setNewTransactions(
        makeTemporaryTransactions(
          props.currentAccountId,
          props.currentCategoryId,
        ),
      );
      props.onCloseAddTransaction();
    }

    const onToggleSplit = useCallback(
      (id: TransactionEntity['id']) =>
        splitsExpandedDispatch({ type: 'toggle-split', id }),
      [splitsExpandedDispatch],
    );

    const displayPayeeTransactions = useMemo(
      () => [...props.transactions, ...newTransactions],
      [props.transactions, newTransactions],
    );

    const allSchedulesQuery = useMemo(() => q('schedules').select('*'), []);

    return (
      <ReceiptStatusProvider>
        <DisplayPayeeProvider transactions={displayPayeeTransactions}>
          <SchedulesProvider query={allSchedulesQuery}>
            <TransactionTableInner
              tableRef={mergedRef}
              listContainerRef={listContainerRef}
              {...props}
              columns={visibleColumns}
              transactions={transactionsWithExpandedSplits}
              transactionMap={transactionMap}
              transactionsByParent={transactionsByParent}
              transferAccountsByTransaction={transferAccountsByTransaction}
              selectedItems={selectedItems}
              isExpanded={splitsExpanded.isExpanded}
              onSave={onSave}
              onDelete={onDelete}
              onBatchDelete={onBatchDelete}
              onBatchDuplicate={onBatchDuplicate}
              onBatchLinkSchedule={onBatchLinkSchedule}
              onBatchUnlinkSchedule={onBatchUnlinkSchedule}
              onCreateRule={onCreateRule}
              onScheduleAction={onScheduleAction}
              onMakeAsNonSplitTransactions={onMakeAsNonSplitTransactions}
              onSplit={onSplit}
              onCheckNewEnter={onCheckNewEnter}
              onCheckEnter={onCheckEnter}
              onScheduleTemporary={onScheduleTemporary}
              onAddTemporary={onAddTemporary}
              onAddAndCloseTemporary={onAddAndCloseTemporary}
              onAddSplit={onAddSplit}
              onDistributeRemainder={onDistributeRemainder}
              onCloseAddTransaction={onCloseAddTransaction}
              onToggleSplit={onToggleSplit}
              newTransactions={newTransactions ?? []}
              tableNavigator={tableNavigator}
              newNavigator={newNavigator}
              showSelection={props.showSelection}
              allowSplitTransaction={props.allowSplitTransaction}
              showHiddenCategories={showHiddenCategories}
              canDrag={canDrag}
              draggedId={draggedId}
              draggedParentId={draggedParentId}
              draggedDate={draggedDate}
              onDragChange={onDragChange}
              onDrop={onDrop}
            />
          </SchedulesProvider>
        </DisplayPayeeProvider>
      </ReceiptStatusProvider>
    );
  },
);

TransactionTable.displayName = 'TransactionTable';

const getCategoriesById = memoizeOne(
  (categoryGroups: CategoryGroupEntity[] | null | undefined) => {
    const res: { [id: CategoryEntity['id']]: CategoryEntity } = {};
    categoryGroups?.forEach(group => {
      group.categories?.forEach(cat => {
        res[cat.id] = cat;
      });
    });

    return res;
  },
);

const getGroupByCatId = memoizeOne(
  (categoryGroups: CategoryGroupEntity[] | null | undefined) => {
    const res: { [id: CategoryEntity['id']]: CategoryGroupEntity } = {};
    categoryGroups?.forEach(group => {
      group.categories?.forEach(cat => {
        res[cat.id] = group;
      });
    });

    return res;
  },
);


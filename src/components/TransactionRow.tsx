import { useState } from 'react';
import { ArrowLeftRight, Pencil, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ConvertedTransaction } from '../lib/ledger';
import { useApp } from '../state/AppContext';
import { CategoryIcon } from './CategoryIcon';
import { Badge, cn } from './ui';
import { TransactionDialog } from './TransactionDialog';

/**
 * One transaction line. Shows the original amount in its original currency
 * and the reporting-currency value beneath it, with an explicit marker when a
 * carried-forward rate was used or when no rate could be resolved.
 */
export function TransactionRow({
  item,
  compact = false,
  showAccount = true,
}: {
  item: ConvertedTransaction;
  compact?: boolean;
  showAccount?: boolean;
}) {
  const { categoryMap, accountMap, formatIn, formatReporting, settings } = useApp();
  const [editing, setEditing] = useState(false);

  const { transaction, convertedAmount, rate } = item;
  const category = transaction.categoryId ? categoryMap.get(transaction.categoryId) : undefined;
  const account = accountMap.get(transaction.accountId);
  const isTransfer = transaction.type === 'transfer';

  const original = formatIn(BigInt(transaction.amount), transaction.currency);
  const converted =
    convertedAmount === null ? null : formatReporting(convertedAmount);

  const tone = isTransfer ? 'neutral' : transaction.type === 'income' ? 'income' : 'expense';
  const sign = isTransfer ? '' : transaction.type === 'income' ? '+' : '−';

  const title =
    transaction.payee || transaction.description || (isTransfer ? 'Transfer' : 'Transaction');

  return (
    <>
      <li className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            isTransfer
              ? 'bg-surface-3 text-text-soft'
              : transaction.type === 'income'
                ? 'bg-income-soft text-income'
                : 'bg-surface-3 text-text-soft',
          )}
        >
          {isTransfer ? (
            <ArrowLeftRight className="size-4" />
          ) : (
            <CategoryIcon name={category?.icon} className="size-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13px] font-medium text-text">{title}</p>
            {transaction.status === 'pending' ? (
              <Badge tone="warning" className="px-1.5 py-0 text-[10px]">
                Pending
              </Badge>
            ) : null}
            {convertedAmount === null ? (
              <span title="No exchange rate available for this date">
                <Badge tone="warning" className="px-1.5 py-0 text-[10px]" icon={<TriangleAlert className="size-2.5" />}>
                  No rate
                </Badge>
              </span>
            ) : rate?.kind === 'stale' ? (
              <span title={`Rate from ${rate.rateDate} (${rate.daysStale} day${rate.daysStale === 1 ? '' : 's'} earlier)`}>
                <Badge tone="info" className="px-1.5 py-0 text-[10px]" icon={<RefreshCw className="size-2.5" />}>
                  {rate.daysStale}d
                </Badge>
              </span>
            ) : null}
          </div>
          <p className="truncate text-[11.5px] text-muted">
            {formatDate(transaction.date)}
            {!compact && category ? ` · ${category.name}` : ''}
            {!compact && showAccount && account ? ` · ${account.name}` : ''}
            {compact && category ? ` · ${category.name}` : ''}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p
            className={cn(
              'pl-tabular text-[13px] font-semibold',
              tone === 'income' ? 'text-income' : tone === 'expense' ? 'text-text' : 'text-text-soft',
            )}
          >
            {sign}
            {original}
          </p>
          {converted &&
          transaction.currency !== settings.defaultCurrency ? (
            <p className="pl-tabular text-[11px] text-muted">
              {converted}
            </p>
          ) : null}
        </div>

        {!compact ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${title}`}
            className="ml-1 rounded-lg p-1.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-text"
          >
            <Pencil className="size-3.5" />
          </button>
        ) : null}
      </li>

      {!compact ? (
        <TransactionDialog
          open={editing}
          onClose={() => setEditing(false)}
          editing={transaction}
        />
      ) : null}
    </>
  );
}

function formatDate(iso: string): string {
  try {
    const date = new Date(`${iso}T00:00:00`);
    return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

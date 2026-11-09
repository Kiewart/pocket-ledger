/**
 * Transaction validation and normalisation.
 *
 * Validation lives outside React so it can be unit tested and reused by the
 * quick-add flow, the full form and the backup importer.
 */

import type { TransactionRecord, TransactionType } from '../db/schema';
import { isValidISODate } from './dates';
import { tryParseAmountToMinor } from './money';

export interface TransactionInput {
  id?: string;
  type: TransactionType;
  amount: string;
  currency: string;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  date: string;
  payee?: string;
  description?: string;
  notes?: string;
  tags?: string[];
  status?: 'cleared' | 'pending';
}

export interface ValidationContext {
  /** Currency codes the user may pick. */
  availableCurrencies: Set<string>;
  /** Existing account ids. */
  accountIds: Set<string>;
  /** Whether the account list can contain transfers. */
  allowTransfers: boolean;
}

export type TransactionErrors = Partial<Record<keyof TransactionInput, string>>;

export interface ValidationResult {
  valid: boolean;
  errors: TransactionErrors;
  /** Minor units of the amount, present when the amount parsed cleanly. */
  amountMinor: bigint | null;
}

export function validateTransaction(
  input: TransactionInput,
  context: ValidationContext,
): ValidationResult {
  const errors: TransactionErrors = {};

  if (!input.type) errors.type = 'Choose a type.';
  if (!isValidISODate(input.date)) errors.date = 'Enter a valid date.';
  if (!input.currency) errors.currency = 'Choose a currency.';
  else if (!context.availableCurrencies.has(input.currency)) {
    errors.currency = 'That currency is not available.';
  }
  if (!input.accountId) errors.accountId = 'Choose an account.';
  else if (!context.accountIds.has(input.accountId)) {
    errors.accountId = 'That account no longer exists.';
  }

  if (input.type === 'transfer') {
    if (!context.allowTransfers) errors.type = 'Transfers are not enabled.';
    if (!input.toAccountId) errors.toAccountId = 'Choose a destination account.';
    else if (input.toAccountId === input.accountId) {
      errors.toAccountId = 'The destination must differ from the source account.';
    } else if (!context.accountIds.has(input.toAccountId)) {
      errors.toAccountId = 'That account no longer exists.';
    }
    if (input.categoryId) errors.categoryId = 'Transfers cannot have a category.';
  }

  let amountMinor: bigint | null = null;
  const trimmedAmount = (input.amount ?? '').trim();
  if (trimmedAmount === '') {
    errors.amount = 'Enter an amount.';
  } else {
    const exponent = amountExponent(input.currency);
    amountMinor = tryParseAmountToMinor(trimmedAmount, exponent);
    if (amountMinor === null) errors.amount = 'Enter a valid amount.';
    else if (amountMinor <= 0n) errors.amount = 'Amount must be greater than zero.';
  }

  return { valid: Object.keys(errors).length === 0, errors, amountMinor };
}

/** Minor-unit precision for a currency code (defaults to 2). */
let exponentLookup: (code: string) => number = () => 2;
export function registerExponentLookup(lookup: (code: string) => number): void {
  exponentLookup = lookup;
}
function amountExponent(code: string): number {
  return exponentLookup(code);
}

/** Normalise an input into a persistable record. */
export function normaliseTransaction(
  input: TransactionInput,
  amountMinor: bigint,
  existing?: TransactionRecord,
): TransactionRecord {
  const now = Date.now();
  const isTransfer = input.type === 'transfer';
  return {
    id: input.id ?? existing?.id ?? crypto.randomUUID(),
    type: input.type,
    amount: Number(amountMinor),
    currency: input.currency,
    accountId: input.accountId,
    toAccountId: isTransfer ? input.toAccountId : undefined,
    categoryId: isTransfer ? undefined : input.categoryId || undefined,
    date: input.date,
    payee: input.payee?.trim() || undefined,
    description: input.description?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    status: input.status ?? 'cleared',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** Free-text search across the fields a user would expect to search. */
export function matchesSearch(transaction: TransactionRecord, query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  const haystack = [
    transaction.description,
    transaction.payee,
    transaction.notes,
    transaction.currency,
    transaction.type,
    ...(transaction.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

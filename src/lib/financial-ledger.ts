import "server-only";

import { ObjectId, type Db, type WithId } from "mongodb";

export const FINANCIAL_ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type FinancialAccountType = (typeof FINANCIAL_ACCOUNT_TYPES)[number];

export type FinancialAccountRecord = {
  code: string;
  name: string;
  type: FinancialAccountType;
  active: boolean;
  isCashAccount?: boolean;
  system?: boolean;
  parentAccountId?: ObjectId;
  vendorStaffId?: ObjectId;
  taxFormType?: "1099-NEC";
  createdAt: Date;
  updatedAt: Date;
};

export type FinancialAccount = WithId<FinancialAccountRecord>;

export type FinancialJournalLine = {
  accountId: ObjectId;
  accountCode: string;
  accountName: string;
  accountType: FinancialAccountType;
  debitCents: number;
  creditCents: number;
};

export type FinancialJournalEntryRecord = {
  businessDate: string;
  description: string;
  reference?: string;
  transactionType: "deposit" | "withdrawal" | "transfer" | "conversion" | "opening-balance" | "reversal";
  lines: FinancialJournalLine[];
  createdByStaffId: ObjectId;
  createdByName: string;
  reversalOfEntryId?: ObjectId;
  reversedByEntryId?: ObjectId;
  reversedAt?: Date;
  reversalReason?: string;
  conversionYear?: number;
  conversionCutoffDate?: string;
  openingBalanceDate?: string;
  createdAt: Date;
};

export type FinancialJournalEntry = WithId<FinancialJournalEntryRecord>;

const DEFAULT_ACCOUNTS: Array<Omit<FinancialAccountRecord, "createdAt" | "updatedAt">> = [
  { code: "1000", name: "Home Bank - Checking", type: "asset", active: true, isCashAccount: true, system: true },
  { code: "1010", name: "Drawer Cash", type: "asset", active: true, isCashAccount: true, system: true },
  { code: "2000", name: "Accounts Payable", type: "liability", active: true, system: true },
  { code: "2050", name: "Credit Cards Payable", type: "liability", active: true, system: true },
  { code: "2100", name: "Loans Payable", type: "liability", active: true, system: true },
  { code: "3000", name: "Owner Equity", type: "equity", active: true, system: true },
  { code: "3100", name: "Owner Draws", type: "equity", active: true, system: true },
  { code: "3990", name: "Conversion Equity", type: "equity", active: true, system: true },
  { code: "4000", name: "Service Revenue", type: "income", active: true, system: true },
  { code: "4100", name: "Other Income", type: "income", active: true, system: true },
  { code: "5000", name: "Barber Commissions", type: "expense", active: true, system: true },
  { code: "5100", name: "Rent", type: "expense", active: true, system: true },
  { code: "5200", name: "Supplies", type: "expense", active: true, system: true },
  { code: "5300", name: "Utilities", type: "expense", active: true, system: true },
  { code: "5400", name: "Advertising", type: "expense", active: true, system: true },
  { code: "5500", name: "Insurance", type: "expense", active: true, system: true },
  { code: "5600", name: "Bank Fees", type: "expense", active: true, system: true },
  { code: "5700", name: "Repairs & Maintenance", type: "expense", active: true, system: true },
  { code: "5800", name: "Professional Fees", type: "expense", active: true, system: true },
  { code: "5900", name: "Other Expense", type: "expense", active: true, system: true },
];

export async function ensureFinancialAccounts(db: Db) {
  const accounts = db.collection<FinancialAccountRecord>("financialAccounts");
  await Promise.all([
    accounts.createIndex({ code: 1 }, { unique: true, name: "unique_financial_account_code" }),
    accounts.createIndex({ parentAccountId: 1, code: 1 }, { name: "financial_subaccounts_by_parent" }),
    accounts.createIndex(
      { vendorStaffId: 1 },
      { unique: true, partialFilterExpression: { vendorStaffId: { $type: "objectId" } }, name: "one_commission_account_per_barber" },
    ),
  ]);
  const now = new Date();
  await Promise.all(DEFAULT_ACCOUNTS.map((account) => accounts.updateOne(
    { code: account.code },
    { $setOnInsert: { ...account, createdAt: now, updatedAt: now } },
    { upsert: true },
  )));
  return accounts;
}

export async function ensureBarberCommissionSubaccounts(db: Db) {
  const accounts = await ensureFinancialAccounts(db);
  const parent = await accounts.findOne({ code: "5000", type: "expense" });
  if (!parent) throw new Error("Barber Commissions parent account is unavailable.");
  const barbers = await db.collection<{ name: string; role: string }>("staff").find({ role: "barber" }).project({ name: 1 }).toArray();
  const now = new Date();
  await Promise.all(barbers.map((barber) => accounts.updateOne(
    { vendorStaffId: barber._id },
    {
      $set: {
        name: barber.name,
        parentAccountId: parent._id,
        taxFormType: "1099-NEC" as const,
        type: "expense" as const,
        active: true,
        updatedAt: now,
      },
      $setOnInsert: {
        code: `5000-${barber._id.toHexString().slice(-6).toUpperCase()}`,
        vendorStaffId: barber._id,
        system: true,
        createdAt: now,
      },
    },
    { upsert: true },
  )));
  return accounts;
}

export async function ensureFinancialJournalIndexes(db: Db) {
  const entries = db.collection<FinancialJournalEntryRecord>("financialJournalEntries");
  await Promise.all([
    entries.createIndex({ businessDate: -1, createdAt: -1 }, { name: "financial_entries_by_date" }),
    entries.createIndex({ "lines.accountId": 1, businessDate: 1 }, { name: "financial_entries_by_account" }),
    entries.createIndex(
      { reversalOfEntryId: 1 },
      { unique: true, partialFilterExpression: { reversalOfEntryId: { $type: "objectId" } }, name: "one_financial_reversal" },
    ),
  ]);
  return entries;
}

function accountBalance(type: FinancialAccountType, debitCents: number, creditCents: number) {
  return type === "asset" || type === "expense" ? debitCents - creditCents : creditCents - debitCents;
}

function lineAmountForAccount(line: FinancialJournalLine, accountId: ObjectId) {
  if (!line.accountId.equals(accountId)) return 0;
  return accountBalance(line.accountType, line.debitCents, line.creditCents);
}

export type FinancialDashboard = {
  accounts: FinancialAccount[];
  cashAccounts: FinancialAccount[];
  selectedCashAccount: FinancialAccount | null;
  ledger: Array<FinancialJournalEntry & { changeCents: number; balanceCents: number }>;
  ledgerOpeningBalanceCents: number;
  ledgerClosingBalanceCents: number;
  profitAndLoss: {
    income: Array<{ account: FinancialAccount; amountCents: number }>;
    expenses: Array<{ account: FinancialAccount; amountCents: number }>;
    totalIncomeCents: number;
    totalExpenseCents: number;
    netIncomeCents: number;
    contractor1099: Array<{
      account: FinancialAccount;
      ledgerExpenseCents: number;
      recordedPayoutCents: number;
      differenceCents: number;
    }>;
  };
  balanceSheet: {
    assets: Array<{ account: FinancialAccount; amountCents: number }>;
    liabilities: Array<{ account: FinancialAccount; amountCents: number }>;
    equity: Array<{ account: FinancialAccount; amountCents: number }>;
    totalAssetsCents: number;
    totalLiabilitiesCents: number;
    postedEquityCents: number;
    retainedEarningsCents: number;
    totalEquityCents: number;
    totalLiabilitiesAndEquityCents: number;
  };
  ytdImport: {
    year: number;
    start: string;
    cutoff: string;
    rows: Array<{
      account: FinancialAccount;
      currentCents: number;
      suggestedCents?: number;
      suggestionLabel?: string;
    }>;
  };
  openingBalances: {
    date: string;
    rows: Array<{
      account: FinancialAccount;
      currentCents: number;
    }>;
  };
};

export async function getFinancialDashboard({
  db,
  start,
  end,
  asOf,
  cashAccountId,
}: {
  db: Db;
  start: string;
  end: string;
  asOf: string;
  cashAccountId?: string;
}): Promise<FinancialDashboard> {
  const accountsCollection = await ensureBarberCommissionSubaccounts(db);
  const entriesCollection = await ensureFinancialJournalIndexes(db);
  const accounts = await accountsCollection.find({}).sort({ code: 1 }).toArray();
  const cashAccounts = accounts.filter((account) => account.active && account.type === "asset" && account.isCashAccount);
  const selectedCashAccount = cashAccounts.find((account) => account._id.toString() === cashAccountId) ?? cashAccounts[0] ?? null;
  const entries = await entriesCollection.find({ businessDate: { $lte: end > asOf ? end : asOf } }).sort({ businessDate: 1, createdAt: 1 }).toArray();
  const reportEntries = entries.filter((entry) => entry.businessDate >= start && entry.businessDate <= end);
  const entriesThroughAsOf = entries.filter((entry) => entry.businessDate <= asOf);
  const ledgerEntries = selectedCashAccount
    ? entries.filter((entry) => entry.businessDate <= end && entry.lines.some((line) => line.accountId.equals(selectedCashAccount._id)))
    : [];
  let ledgerBalanceCents = 0;
  const ledgerWithBalances = ledgerEntries.map((entry) => {
    const changeCents = entry.lines.reduce((total, line) => total + lineAmountForAccount(line, selectedCashAccount!._id), 0);
    ledgerBalanceCents += changeCents;
    return { ...entry, changeCents, balanceCents: ledgerBalanceCents };
  });
  const ledgerOpeningBalanceCents = ledgerWithBalances
    .filter((entry) => entry.businessDate < start)
    .reduce((_, entry) => entry.balanceCents, 0);
  const ledger = ledgerWithBalances.filter((entry) => entry.businessDate >= start && entry.businessDate <= end).reverse();

  function balancesFor(source: FinancialJournalEntry[]) {
    const balances = new Map<string, number>();
    for (const entry of source) {
      for (const line of entry.lines) {
        const id = line.accountId.toString();
        balances.set(id, (balances.get(id) ?? 0) + accountBalance(line.accountType, line.debitCents, line.creditCents));
      }
    }
    return balances;
  }

  const periodBalances = balancesFor(reportEntries);
  const asOfBalances = balancesFor(entriesThroughAsOf);
  const conversionYear = Number(end.slice(0, 4));
  const conversionStart = `${conversionYear}-01-01`;
  const ytdEntries = entries.filter((entry) => entry.businessDate >= conversionStart && entry.businessDate <= end);
  const ytdBalances = balancesFor(ytdEntries);
  const rows = (type: FinancialAccountType, balances: Map<string, number>) => accounts
    .filter((account) => account.type === type)
    .map((account) => ({ account, amountCents: balances.get(account._id.toString()) ?? 0 }))
    .filter((row) => row.amountCents !== 0);
  const income = rows("income", periodBalances);
  const expenses = rows("expense", periodBalances);
  const assets = rows("asset", asOfBalances);
  const liabilities = rows("liability", asOfBalances);
  const equity = rows("equity", asOfBalances);
  const totalIncomeCents = income.reduce((total, row) => total + row.amountCents, 0);
  const totalExpenseCents = expenses.reduce((total, row) => total + row.amountCents, 0);
  const allIncome = rows("income", asOfBalances).reduce((total, row) => total + row.amountCents, 0);
  const allExpenses = rows("expense", asOfBalances).reduce((total, row) => total + row.amountCents, 0);
  const retainedEarningsCents = allIncome - allExpenses;
  const totalAssetsCents = assets.reduce((total, row) => total + row.amountCents, 0);
  const totalLiabilitiesCents = liabilities.reduce((total, row) => total + row.amountCents, 0);
  const postedEquityCents = equity.reduce((total, row) => total + row.amountCents, 0);
  const payoutCollection = db.collection<{ businessDate: string; barberId: ObjectId; paidAmountCents?: number }>("commissionPayouts");
  const [payouts, ytdPayouts] = await Promise.all([
    payoutCollection.find({ businessDate: { $gte: start, $lte: end } }).toArray(),
    payoutCollection.find({ businessDate: { $gte: conversionStart, $lte: end } }).toArray(),
  ]);
  const payoutByBarber = new Map<string, number>();
  for (const payout of payouts) {
    const id = payout.barberId?.toString();
    if (id) payoutByBarber.set(id, (payoutByBarber.get(id) ?? 0) + Number(payout.paidAmountCents ?? 0));
  }
  const ytdPayoutByBarber = new Map<string, number>();
  for (const payout of ytdPayouts) {
    const id = payout.barberId?.toString();
    if (id) ytdPayoutByBarber.set(id, (ytdPayoutByBarber.get(id) ?? 0) + Number(payout.paidAmountCents ?? 0));
  }
  const contractor1099 = accounts
    .filter((account) => account.taxFormType === "1099-NEC" && account.vendorStaffId)
    .map((account) => {
      const ledgerExpenseCents = periodBalances.get(account._id.toString()) ?? 0;
      const recordedPayoutCents = payoutByBarber.get(account.vendorStaffId!.toString()) ?? 0;
      return { account, ledgerExpenseCents, recordedPayoutCents, differenceCents: ledgerExpenseCents - recordedPayoutCents };
    });
  const posSales = await db.collection<{ checkoutAmountCents?: number }>("appointments").find({
    requestedDate: { $gte: conversionStart, $lte: end },
    status: "completed",
    checkoutMethod: "cash",
    checkoutAmountCents: { $gte: 0 },
  }).project({ checkoutAmountCents: 1 }).toArray();
  const suggestedRevenueCents = posSales.reduce((total, sale) => total + Number(sale.checkoutAmountCents ?? 0), 0);
  const childParentIds = new Set(accounts.flatMap((account) => account.parentAccountId ? [account.parentAccountId.toString()] : []));
  const ytdImportRows = accounts
    .filter((account) => account.active && (account.type === "income" || account.type === "expense") && !childParentIds.has(account._id.toString()))
    .map((account) => {
      const currentCents = ytdBalances.get(account._id.toString()) ?? 0;
      if (account.code === "4000") {
        return { account, currentCents, suggestedCents: suggestedRevenueCents, suggestionLabel: "Completed POS cash sales" };
      }
      if (account.vendorStaffId) {
        return {
          account,
          currentCents,
          suggestedCents: ytdPayoutByBarber.get(account.vendorStaffId.toString()) ?? 0,
          suggestionLabel: "Recorded POS cash payouts",
        };
      }
      return { account, currentCents };
    });
  const openingBalanceRows = accounts
    .filter((account) => account.active && (account.type === "asset" || account.type === "liability") && !childParentIds.has(account._id.toString()))
    .map((account) => ({ account, currentCents: asOfBalances.get(account._id.toString()) ?? 0 }));

  return {
    accounts,
    cashAccounts,
    selectedCashAccount,
    ledger,
    ledgerOpeningBalanceCents,
    ledgerClosingBalanceCents: ledger.length ? ledger[0].balanceCents : ledgerOpeningBalanceCents,
    profitAndLoss: {
      income,
      expenses,
      totalIncomeCents,
      totalExpenseCents,
      netIncomeCents: totalIncomeCents - totalExpenseCents,
      contractor1099,
    },
    balanceSheet: {
      assets,
      liabilities,
      equity,
      totalAssetsCents,
      totalLiabilitiesCents,
      postedEquityCents,
      retainedEarningsCents,
      totalEquityCents: postedEquityCents + retainedEarningsCents,
      totalLiabilitiesAndEquityCents: totalLiabilitiesCents + postedEquityCents + retainedEarningsCents,
    },
    ytdImport: {
      year: conversionYear,
      start: conversionStart,
      cutoff: end,
      rows: ytdImportRows,
    },
    openingBalances: {
      date: asOf,
      rows: openingBalanceRows,
    },
  };
}

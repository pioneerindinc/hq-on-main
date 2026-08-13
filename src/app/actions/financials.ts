"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffRole } from "@/lib/auth";
import {
  ensureBarberCommissionSubaccounts,
  ensureFinancialAccounts,
  ensureFinancialJournalIndexes,
  FINANCIAL_ACCOUNT_TYPES,
  type FinancialAccountType,
  type FinancialJournalLine,
} from "@/lib/financial-ledger";
import { parseMoneyToCents } from "@/lib/money";
import { getMongoClient } from "@/lib/mongodb";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function financialRedirect(type: "error" | "financialNotice", message: string, view = "ledger"): never {
  redirect(`/admin/dashboard?tab=financials&financialView=${encodeURIComponent(view)}&${type}=${encodeURIComponent(message)}`);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).valueOf());
}

function parseYtdMoney(value: unknown) {
  const normalized = String(value ?? "").trim().replace(/[$,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 && amount <= 100_000_000 ? Math.round(amount * 100) : null;
}

export async function createFinancialAccount(formData: FormData) {
  const admin = await requireStaffRole("admin");
  void admin;
  const code = value(formData, "code").toUpperCase();
  const name = value(formData, "name");
  const type = value(formData, "type") as FinancialAccountType;
  const parentAccountId = value(formData, "parentAccountId");
  const isCashAccount = type === "asset" && formData.get("isCashAccount") === "on";
  if (!/^[A-Z0-9-]{3,12}$/.test(code) || name.length < 2 || name.length > 100 || !FINANCIAL_ACCOUNT_TYPES.includes(type)) {
    financialRedirect("error", "Enter a valid account code, name, and type.", "accounts");
  }
  const client = await getMongoClient();
  const accounts = await ensureFinancialAccounts(client.db("hqonmain"));
  if (await accounts.findOne({ $or: [{ code }, { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }] })) {
    financialRedirect("error", "An account already uses that code or name.", "accounts");
  }
  const parent = parentAccountId && ObjectId.isValid(parentAccountId)
    ? await accounts.findOne({ _id: new ObjectId(parentAccountId), type, active: true })
    : null;
  if (parentAccountId && !parent) {
    financialRedirect("error", "The parent account must be active and use the same account type.", "accounts");
  }
  const now = new Date();
  await accounts.insertOne({
    code,
    name,
    type,
    active: true,
    isCashAccount,
    ...(parent ? { parentAccountId: parent._id } : {}),
    createdAt: now,
    updatedAt: now,
  });
  revalidatePath("/admin/dashboard");
  financialRedirect("financialNotice", `${name} was added to the chart of accounts.`, "accounts");
}

export async function createFinancialTransaction(formData: FormData) {
  const admin = await requireStaffRole("admin");
  const businessDate = value(formData, "businessDate");
  const description = value(formData, "description");
  const reference = value(formData, "reference");
  const transactionType = value(formData, "transactionType");
  const cashAccountId = value(formData, "cashAccountId");
  const counterAccountId = value(formData, "counterAccountId");
  const amountCents = parseMoneyToCents(value(formData, "amount"));
  if (
    !validDate(businessDate) ||
    description.length < 2 ||
    description.length > 180 ||
    reference.length > 80 ||
    !["deposit", "withdrawal", "transfer"].includes(transactionType) ||
    !ObjectId.isValid(cashAccountId) ||
    !ObjectId.isValid(counterAccountId) ||
    cashAccountId === counterAccountId ||
    amountCents === null ||
    amountCents <= 0
  ) {
    financialRedirect("error", "Enter a valid date, description, amount, and two different accounts.");
  }

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const accountsCollection = await ensureFinancialAccounts(db);
  const accountIds = [new ObjectId(cashAccountId), new ObjectId(counterAccountId)];
  const accounts = await accountsCollection.find({ _id: { $in: accountIds }, active: true }).toArray();
  const cashAccount = accounts.find((account) => account._id.equals(accountIds[0]));
  const counterAccount = accounts.find((account) => account._id.equals(accountIds[1]));
  if (!cashAccount?.isCashAccount || cashAccount.type !== "asset" || !counterAccount) {
    financialRedirect("error", "Choose an active bank/cash account and an active category account.");
  }
  if (transactionType === "transfer" && (counterAccount.type !== "asset" || !counterAccount.isCashAccount)) {
    financialRedirect("error", "Transfers must move money between two bank or cash accounts.");
  }
  if (transactionType !== "transfer" && counterAccount.isCashAccount) {
    financialRedirect("error", "Use Transfer when the other side is another bank or cash account.");
  }

  const line = (account: typeof cashAccount, debitCents: number, creditCents: number): FinancialJournalLine => ({
    accountId: account._id,
    accountCode: account.code,
    accountName: account.name,
    accountType: account.type,
    debitCents,
    creditCents,
  });
  const moneyIn = transactionType === "deposit";
  const lines = moneyIn
    ? [line(cashAccount, amountCents, 0), line(counterAccount, 0, amountCents)]
    : [line(counterAccount, amountCents, 0), line(cashAccount, 0, amountCents)];
  const entries = await ensureFinancialJournalIndexes(db);
  await entries.insertOne({
    businessDate,
    description,
    ...(reference ? { reference } : {}),
    transactionType: transactionType as "deposit" | "withdrawal" | "transfer",
    lines,
    createdByStaffId: admin._id,
    createdByName: admin.name,
    createdAt: new Date(),
  });
  revalidatePath("/admin/dashboard");
  financialRedirect("financialNotice", "Transaction posted to the ledger.");
}

export async function importFinancialYearToDate(formData: FormData) {
  const admin = await requireStaffRole("admin");
  const cutoffDate = value(formData, "cutoffDate");
  const confirmation = formData.get("confirmConversion") === "on";
  if (!validDate(cutoffDate) || !confirmation) {
    financialRedirect("error", "Choose a valid cutoff date and confirm that these totals do not include bank balances.", "import-ytd");
  }
  const year = Number(cutoffDate.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const accountsCollection = await ensureBarberCommissionSubaccounts(db);
  const accounts = await accountsCollection.find({ active: true }).toArray();
  const conversionEquity = accounts.find((account) => account.code === "3990" && account.type === "equity");
  if (!conversionEquity) financialRedirect("error", "Conversion Equity is unavailable.", "import-ytd");
  const childParentIds = new Set(accounts.flatMap((account) => account.parentAccountId ? [account.parentAccountId.toString()] : []));
  const targetAccounts = accounts.filter((account) =>
    (account.type === "income" || account.type === "expense") && !childParentIds.has(account._id.toString()),
  );
  const targets = new Map<string, number>();
  for (const account of targetAccounts) {
    const raw = formData.get(`target_${account._id.toString()}`);
    const target = parseYtdMoney(raw);
    if (target === null) financialRedirect("error", `Enter a valid year-to-date total for ${account.name}.`, "import-ytd");
    targets.set(account._id.toString(), target);
  }

  const entries = await ensureFinancialJournalIndexes(db);
  const existingEntries = await entries.find({ businessDate: { $gte: yearStart, $lte: cutoffDate } }).toArray();
  const current = new Map<string, number>();
  for (const entry of existingEntries) {
    for (const line of entry.lines) {
      if (line.accountType !== "income" && line.accountType !== "expense") continue;
      const amount = line.accountType === "expense"
        ? line.debitCents - line.creditCents
        : line.creditCents - line.debitCents;
      const id = line.accountId.toString();
      current.set(id, (current.get(id) ?? 0) + amount);
    }
  }
  const lines: FinancialJournalLine[] = [];
  let debitCents = 0;
  let creditCents = 0;
  for (const account of targetAccounts) {
    const delta = (targets.get(account._id.toString()) ?? 0) - (current.get(account._id.toString()) ?? 0);
    if (delta === 0) continue;
    const debit = account.type === "expense" ? Math.max(0, delta) : Math.max(0, -delta);
    const credit = account.type === "income" ? Math.max(0, delta) : Math.max(0, -delta);
    debitCents += debit;
    creditCents += credit;
    lines.push({
      accountId: account._id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      debitCents: debit,
      creditCents: credit,
    });
  }
  if (!lines.length) financialRedirect("financialNotice", "The ledger already matches those year-to-date targets. No entry was needed.", "import-ytd");
  const equityDebit = Math.max(0, creditCents - debitCents);
  const equityCredit = Math.max(0, debitCents - creditCents);
  lines.push({
    accountId: conversionEquity._id,
    accountCode: conversionEquity.code,
    accountName: conversionEquity.name,
    accountType: conversionEquity.type,
    debitCents: equityDebit,
    creditCents: equityCredit,
  });
  const totalDebits = lines.reduce((total, line) => total + line.debitCents, 0);
  const totalCredits = lines.reduce((total, line) => total + line.creditCents, 0);
  if (totalDebits !== totalCredits || lines.some((line) => line.accountType === "asset" || line.accountType === "liability")) {
    financialRedirect("error", "The conversion entry did not balance and was not posted.", "import-ytd");
  }
  await entries.insertOne({
    businessDate: cutoffDate,
    description: `${year} year-to-date conversion through ${cutoffDate}`,
    reference: "Guided YTD import",
    transactionType: "conversion",
    lines,
    createdByStaffId: admin._id,
    createdByName: admin.name,
    conversionYear: year,
    conversionCutoffDate: cutoffDate,
    createdAt: new Date(),
  });
  revalidatePath("/admin/dashboard");
  financialRedirect("financialNotice", "Year-to-date targets were posted through Conversion Equity. Bank and drawer balances were not changed.", "import-ytd");
}

export async function reverseFinancialTransaction(formData: FormData) {
  const admin = await requireStaffRole("admin");
  const entryId = value(formData, "entryId");
  const reason = value(formData, "reason");
  if (!ObjectId.isValid(entryId) || reason.length < 3 || reason.length > 300) {
    financialRedirect("error", "Enter a reason for reversing this transaction.");
  }
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const entries = await ensureFinancialJournalIndexes(db);
  const sourceId = new ObjectId(entryId);
  try {
    await client.withSession(async (session) => session.withTransaction(async () => {
      const source = await entries.findOne({ _id: sourceId }, { session });
      if (!source || source.reversedByEntryId || source.transactionType === "reversal") {
        throw new Error("That transaction cannot be reversed.");
      }
      const now = new Date();
      const result = await entries.insertOne({
        businessDate: source.businessDate,
        description: `Reversal: ${source.description}`,
        reference: source.reference,
        transactionType: "reversal" as const,
        lines: source.lines.map((line) => ({ ...line, debitCents: line.creditCents, creditCents: line.debitCents })),
        createdByStaffId: admin._id,
        createdByName: admin.name,
        reversalOfEntryId: source._id,
        reversalReason: reason,
        createdAt: now,
      }, { session });
      const updated = await entries.updateOne(
        { _id: source._id, reversedByEntryId: { $exists: false } },
        { $set: { reversedByEntryId: result.insertedId, reversedAt: now, reversalReason: reason } },
        { session },
      );
      if (!updated.modifiedCount) throw new Error("That transaction cannot be reversed.");
    }));
  } catch (error) {
    financialRedirect("error", error instanceof Error && error.message === "That transaction cannot be reversed."
      ? error.message
      : "The reversing entry could not be posted. Try again.");
  }
  revalidatePath("/admin/dashboard");
  financialRedirect("financialNotice", "A reversing entry was posted. The original history was preserved.");
}

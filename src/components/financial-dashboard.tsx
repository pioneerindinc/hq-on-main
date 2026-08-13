import Link from "next/link";
import { createFinancialAccount, createFinancialTransaction, reverseFinancialTransaction } from "@/app/actions/financials";
import { formatDisplayDate } from "@/lib/booking";
import type { FinancialAccount, FinancialDashboard, FinancialJournalLine } from "@/lib/financial-ledger";
import { formatMoney } from "@/lib/money";

export type FinancialView = "ledger" | "profit-loss" | "balance-sheet" | "accounts";

const views: Array<{ id: FinancialView; label: string }> = [
  { id: "ledger", label: "Bank ledger" },
  { id: "profit-loss", label: "Profit & loss" },
  { id: "balance-sheet", label: "Balance sheet" },
  { id: "accounts", label: "Chart of accounts" },
];

function financialHref(view: FinancialView, dates: FinancialDates, accountId?: string) {
  const params = new URLSearchParams({
    tab: "financials",
    financialView: view,
    financialStart: dates.start,
    financialEnd: dates.end,
    financialAsOf: dates.asOf,
    ...(accountId ? { financialAccount: accountId } : {}),
  });
  return `/admin/dashboard?${params.toString()}`;
}

function counterparty(lines: FinancialJournalLine[], selectedAccountId: string) {
  return lines.filter((line) => line.accountId.toString() !== selectedAccountId).map((line) => line.accountName).join(", ") || "Journal entry";
}

function activeAccounts(accounts: FinancialAccount[]) {
  return accounts.filter((account) => account.active);
}

export type FinancialDates = { start: string; end: string; asOf: string };

export function FinancialDashboardPanel({
  dashboard,
  view,
  dates,
}: {
  dashboard: FinancialDashboard;
  view: FinancialView;
  dates: FinancialDates;
}) {
  const selectedAccountId = dashboard.selectedCashAccount?._id.toString() ?? "";
  const otherAccounts = activeAccounts(dashboard.accounts).filter((account) => account._id.toString() !== selectedAccountId);

  return (
    <section className="portal-section financial-dashboard">
      <div className="portal-section-heading">
        <div><h2>Financials</h2></div>
      </div>

      <nav className="financial-view-tabs" aria-label="Financial views">
        {views.map((item) => (
          <Link className={view === item.id ? "active" : ""} href={financialHref(item.id, dates, selectedAccountId)} aria-current={view === item.id ? "page" : undefined} key={item.id}>{item.label}</Link>
        ))}
      </nav>

      {view !== "accounts" && (
        <form className="financial-date-controls" method="get" action="/admin/dashboard">
          <input type="hidden" name="tab" value="financials" />
          <input type="hidden" name="financialView" value={view} />
          <input type="hidden" name="financialAccount" value={selectedAccountId} />
          <label>From<input type="date" name="financialStart" defaultValue={dates.start} /></label>
          <label>Through<input type="date" name="financialEnd" defaultValue={dates.end} /></label>
          <label>Balance sheet as of<input type="date" name="financialAsOf" defaultValue={dates.asOf} /></label>
          <button type="submit">Run reports</button>
        </form>
      )}

      {view === "ledger" && (
        <>
          <div className="financial-ledger-summary">
            <div><small>Account</small><strong>{dashboard.selectedCashAccount?.name ?? "No bank account"}</strong></div>
            <div><small>Opening balance</small><strong>{formatMoney(dashboard.ledgerOpeningBalanceCents)}</strong></div>
            <div><small>Closing balance</small><strong>{formatMoney(dashboard.ledgerClosingBalanceCents)}</strong></div>
          </div>

          <form className="financial-account-switcher" method="get" action="/admin/dashboard">
            <input type="hidden" name="tab" value="financials" />
            <input type="hidden" name="financialView" value="ledger" />
            <input type="hidden" name="financialStart" value={dates.start} />
            <input type="hidden" name="financialEnd" value={dates.end} />
            <input type="hidden" name="financialAsOf" value={dates.asOf} />
            <label>Ledger account<select name="financialAccount" defaultValue={selectedAccountId}>{dashboard.cashAccounts.map((account) => <option value={account._id.toString()} key={account._id.toString()}>{account.code} · {account.name}</option>)}</select></label>
            <button type="submit">View account</button>
          </form>

          {dashboard.selectedCashAccount && (
            <details className="financial-entry-composer" open={dashboard.ledger.length === 0}>
              <summary>Post a bank or cash transaction</summary>
              <form className="portal-form financial-entry-form" action={createFinancialTransaction}>
                <label>Date<input name="businessDate" type="date" defaultValue={dates.end} required /></label>
                <label>Movement<select name="transactionType" defaultValue="withdrawal"><option value="deposit">Money in / deposit</option><option value="withdrawal">Money out / withdrawal</option><option value="transfer">Transfer between accounts</option></select></label>
                <label>Bank or cash account<select name="cashAccountId" defaultValue={selectedAccountId}>{dashboard.cashAccounts.map((account) => <option value={account._id.toString()} key={account._id.toString()}>{account.code} · {account.name}</option>)}</select></label>
                <label>Category or destination<select name="counterAccountId" required><option value="" disabled>Select the other account</option>{otherAccounts.map((account) => <option value={account._id.toString()} key={account._id.toString()}>{account.parentAccountId ? "↳ " : ""}{account.code} · {account.name} ({account.type})</option>)}</select></label>
                <label>Description<input name="description" maxLength={180} placeholder="Rent, deposit, bank fee…" required /></label>
                <label>Amount<input name="amount" inputMode="decimal" placeholder="0.00" required /></label>
                <label className="wide">Reference (optional)<input name="reference" maxLength={80} placeholder="Check number, statement memo, or receipt" /></label>
                <p className="financial-form-help wide">For an opening bank balance, choose Money in and Owner Equity. Use Transfer only when both sides are bank or cash accounts.</p>
                <button className="button button-primary wide" type="submit">Post transaction</button>
              </form>
            </details>
          )}

          <div className="financial-ledger-table-wrap">
            <table className="financial-ledger-table">
              <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Balance</th><th>Audit</th></tr></thead>
              <tbody>
                {dashboard.ledger.length === 0 && <tr><td colSpan={6}>No transactions in this period.</td></tr>}
                {dashboard.ledger.map((entry) => (
                  <tr className={entry.transactionType === "reversal" || entry.reversedByEntryId ? "reversed" : ""} key={entry._id.toString()}>
                    <td>{formatDisplayDate(entry.businessDate)}</td>
                    <td><strong>{entry.description}</strong>{entry.reference && <small>{entry.reference}</small>}</td>
                    <td>{counterparty(entry.lines, selectedAccountId)}</td>
                    <td className={entry.changeCents >= 0 ? "money-in" : "money-out"}>{entry.changeCents >= 0 ? "+" : "−"}{formatMoney(Math.abs(entry.changeCents))}</td>
                    <td><strong>{formatMoney(entry.balanceCents)}</strong></td>
                    <td>
                      <small>By {entry.createdByName}</small>
                      {entry.reversedByEntryId ? <span>Reversed</span> : entry.transactionType === "reversal" ? <span>Reversal</span> : (
                        <details><summary>Reverse</summary><form action={reverseFinancialTransaction}><input type="hidden" name="entryId" value={entry._id.toString()} /><input name="reason" minLength={3} maxLength={300} placeholder="Reason required" required /><button type="submit">Post reversal</button></form></details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "profit-loss" && (
        <div className="financial-statement">
          <header><p className="eyebrow">Headquarters on Main</p><h3>Profit &amp; Loss</h3><span>{formatDisplayDate(dates.start)} through {formatDisplayDate(dates.end)}</span></header>
          <StatementSection title="Income" rows={dashboard.profitAndLoss.income} accounts={dashboard.accounts} totalLabel="Total income" total={dashboard.profitAndLoss.totalIncomeCents} />
          <StatementSection title="Expenses" rows={dashboard.profitAndLoss.expenses} accounts={dashboard.accounts} totalLabel="Total expenses" total={dashboard.profitAndLoss.totalExpenseCents} />
          <div className="financial-statement-total net"><strong>Net income</strong><strong>{formatMoney(dashboard.profitAndLoss.netIncomeCents)}</strong></div>
          <section className="financial-contractor-summary">
            <h4>1099 contractor commission detail</h4>
            <p>Selected period: {formatDisplayDate(dates.start)} through {formatDisplayDate(dates.end)}. POS payouts reflect actual recorded cash payouts; ledger expense reflects transactions posted to each barber&apos;s commission subaccount.</p>
            <div className="financial-contractor-table-wrap">
              <table>
                <thead><tr><th>Barber</th><th>Ledger expense</th><th>POS cash paid</th><th>Difference</th></tr></thead>
                <tbody>{dashboard.profitAndLoss.contractor1099.map((row) => <tr key={row.account._id.toString()}><td><strong>{row.account.name}</strong><small>{row.account.code} · 1099-NEC tracking</small></td><td>{formatMoney(row.ledgerExpenseCents)}</td><td>{formatMoney(row.recordedPayoutCents)}</td><td className={row.differenceCents === 0 ? "matched" : "different"}>{formatMoney(row.differenceCents)}</td></tr>)}</tbody>
              </table>
            </div>
            <small className="financial-tax-note">Tracking aid only. Confirm contractor classification and final reportable amounts with your tax professional before filing.</small>
          </section>
        </div>
      )}

      {view === "balance-sheet" && (
        <div className="financial-statement">
          <header><p className="eyebrow">Headquarters on Main</p><h3>Balance Sheet</h3><span>As of {formatDisplayDate(dates.asOf)}</span></header>
          <StatementSection title="Assets" rows={dashboard.balanceSheet.assets} accounts={dashboard.accounts} totalLabel="Total assets" total={dashboard.balanceSheet.totalAssetsCents} />
          <StatementSection title="Liabilities" rows={dashboard.balanceSheet.liabilities} accounts={dashboard.accounts} totalLabel="Total liabilities" total={dashboard.balanceSheet.totalLiabilitiesCents} />
          <section><h4>Equity</h4><StatementRows rows={dashboard.balanceSheet.equity} accounts={dashboard.accounts} /><div className="financial-statement-row"><span>Retained earnings / cumulative net income</span><strong>{formatMoney(dashboard.balanceSheet.retainedEarningsCents)}</strong></div><div className="financial-statement-total"><strong>Total equity</strong><strong>{formatMoney(dashboard.balanceSheet.totalEquityCents)}</strong></div></section>
          <div className="financial-statement-total net"><strong>Total liabilities &amp; equity</strong><strong>{formatMoney(dashboard.balanceSheet.totalLiabilitiesAndEquityCents)}</strong></div>
          <p className={`financial-balance-check${dashboard.balanceSheet.totalAssetsCents === dashboard.balanceSheet.totalLiabilitiesAndEquityCents ? " balanced" : ""}`}>{dashboard.balanceSheet.totalAssetsCents === dashboard.balanceSheet.totalLiabilitiesAndEquityCents ? "Ledger is in balance." : `Out of balance by ${formatMoney(dashboard.balanceSheet.totalAssetsCents - dashboard.balanceSheet.totalLiabilitiesAndEquityCents)}.`}</p>
        </div>
      )}

      {view === "accounts" && (
        <div className="financial-accounts-layout">
          <div className="financial-accounts-list">
            <header><h3>Chart of accounts</h3><span>{dashboard.accounts.length}</span></header>
            {(["asset", "liability", "equity", "income", "expense"] as const).map((type) => (
              <section key={type}><h4>{type}</h4>{dashboard.accounts.filter((account) => account.type === type).map((account) => <div className={account.parentAccountId ? "subaccount" : ""} key={account._id.toString()}><code>{account.code}</code><strong>{account.parentAccountId ? "↳ " : ""}{account.name}</strong>{account.isCashAccount ? <span>Bank / cash</span> : account.taxFormType ? <span>{account.taxFormType}</span> : null}</div>)}</section>
            ))}
          </div>
          <form className="portal-form financial-new-account" action={createFinancialAccount}>
            <div className="wide"><h3>Add an account</h3></div>
            <label>Account code<input name="code" placeholder="6000" minLength={3} maxLength={12} required /></label>
            <label>Account name<input name="name" placeholder="Payroll taxes" maxLength={100} required /></label>
            <label className="wide">Type<select name="type" defaultValue="expense"><option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option><option value="income">Income</option><option value="expense">Expense</option></select></label>
            <label className="wide">Parent account <small>Optional; must use the same type</small><select name="parentAccountId" defaultValue=""><option value="">No parent account</option>{dashboard.accounts.filter((account) => !account.parentAccountId).map((account) => <option value={account._id.toString()} key={account._id.toString()}>{account.code} · {account.name} ({account.type})</option>)}</select></label>
            <label className="account-check wide"><input type="checkbox" name="isCashAccount" /><span>Treat this asset as a bank or cash ledger account</span></label>
            <button className="button button-primary wide" type="submit">Add account</button>
          </form>
        </div>
      )}
    </section>
  );
}

function StatementRows({ rows, accounts }: { rows: Array<{ account: FinancialAccount; amountCents: number }>; accounts: FinancialAccount[] }) {
  const amountById = new Map(rows.map((row) => [row.account._id.toString(), row.amountCents]));
  const rowAccountIds = new Set(rows.map((row) => row.account._id.toString()));
  const roots = accounts.filter((account) => !account.parentAccountId && (
    rowAccountIds.has(account._id.toString()) || accounts.some((child) => child.parentAccountId?.equals(account._id) && rowAccountIds.has(child._id.toString()))
  ));
  return roots.map((account) => {
    const children = accounts.filter((child) => child.parentAccountId?.equals(account._id) && rowAccountIds.has(child._id.toString()));
    const direct = amountById.get(account._id.toString()) ?? 0;
    const grouped = direct + children.reduce((total, child) => total + (amountById.get(child._id.toString()) ?? 0), 0);
    return (
      <div className="financial-statement-account-group" key={account._id.toString()}>
        <div className={children.length ? "financial-statement-row group" : "financial-statement-row"}><span>{account.name}</span><strong>{formatMoney(grouped)}</strong></div>
        {children.map((child) => <div className="financial-statement-row subaccount" key={child._id.toString()}><span>{child.name}</span><strong>{formatMoney(amountById.get(child._id.toString()) ?? 0)}</strong></div>)}
      </div>
    );
  });
}

function StatementSection({ title, rows, accounts, totalLabel, total }: { title: string; rows: Array<{ account: FinancialAccount; amountCents: number }>; accounts: FinancialAccount[]; totalLabel: string; total: number }) {
  return (
    <section>
      <h4>{title}</h4>
      {rows.length ? <StatementRows rows={rows} accounts={accounts} /> : <p>No activity</p>}
      <div className="financial-statement-total"><strong>{totalLabel}</strong><strong>{formatMoney(total)}</strong></div>
    </section>
  );
}

import Link from "next/link";
import { createFinancialAccount, createFinancialTransaction, importFinancialOpeningBalances, importFinancialYearToDate, reverseFinancialTransaction } from "@/app/actions/financials";
import { formatDisplayDate } from "@/lib/booking";
import type { FinancialAccount, FinancialDashboard, FinancialJournalLine } from "@/lib/financial-ledger";
import { formatMoney } from "@/lib/money";

export type FinancialView = "ledger" | "profit-loss" | "balance-sheet" | "opening-balances" | "import-ytd" | "accounts";

const views: Array<{ id: FinancialView; label: string }> = [
  { id: "ledger", label: "Bank ledger" },
  { id: "profit-loss", label: "Profit & loss" },
  { id: "balance-sheet", label: "Balance sheet" },
  { id: "opening-balances", label: "Opening balances" },
  { id: "import-ytd", label: "Import YTD" },
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

function moneyInput(cents: number) {
  return (cents / 100).toFixed(2);
}

export type FinancialDates = { start: string; end: string; asOf: string };

export function FinancialDashboardPanel({
  dashboard,
  view,
  dates,
  notice,
}: {
  dashboard: FinancialDashboard;
  view: FinancialView;
  dates: FinancialDates;
  notice?: string;
}) {
  const selectedAccountId = dashboard.selectedCashAccount?._id.toString() ?? "";
  const otherAccounts = activeAccounts(dashboard.accounts).filter((account) => account._id.toString() !== selectedAccountId);

  return (
    <section className="portal-section financial-dashboard">
      <div className="portal-section-heading">
        <div><h2>Financials</h2></div>
      </div>
      {notice && <p className="portal-alert success" role="status">{notice}</p>}

      <nav className="financial-view-tabs" aria-label="Financial views">
        {views.map((item) => (
          <Link className={view === item.id ? "active" : ""} href={financialHref(item.id, dates, selectedAccountId)} aria-current={view === item.id ? "page" : undefined} key={item.id}>{item.label}</Link>
        ))}
      </nav>

      {view !== "accounts" && view !== "opening-balances" && view !== "import-ytd" && (
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

      {view === "opening-balances" && (
        <div className="financial-ytd-import">
          <header>
            <p className="eyebrow">Conversion setup</p>
            <h3>Set opening balance-sheet balances</h3>
            <p>Enter what each asset and liability account should show at the end of the conversion date. The system posts only the difference already missing from the ledger and balances it through Conversion Equity.</p>
          </header>

          <div className="financial-ytd-steps">
            <article><span>01</span><div><strong>Choose the date</strong><p>Use the day immediately before bookkeeping begins in this system.</p></div></article>
            <article><span>02</span><div><strong>Enter statement balances</strong><p>Use positive amounts for bank balances, credit cards, loans, and other liabilities.</p></div></article>
            <article><span>03</span><div><strong>Post the adjustment</strong><p>Assets become debits, liabilities become credits, and Conversion Equity balances the entry.</p></div></article>
          </div>

          <form className="financial-ytd-cutoff" method="get" action="/admin/dashboard">
            <input type="hidden" name="tab" value="financials" />
            <input type="hidden" name="financialView" value="opening-balances" />
            <input type="hidden" name="financialStart" value={dates.start} />
            <input type="hidden" name="financialEnd" value={dates.end} />
            <label>Opening balances as of<input type="date" name="financialAsOf" defaultValue={dashboard.openingBalances.date} /></label>
            <button type="submit">Change date</button>
          </form>

          <form action={importFinancialOpeningBalances}>
            <input type="hidden" name="openingDate" value={dashboard.openingBalances.date} />
            {(["asset", "liability"] as const).map((type) => (
              <section className="financial-ytd-section" key={type}>
                <div><h4>{type === "asset" ? "Assets" : "Liabilities"}</h4><p>{type === "asset" ? "Bank, cash, and other asset balances." : "Credit cards, loans, and other amounts owed."}</p></div>
                <div className="financial-ytd-table-wrap">
                  <table>
                    <thead><tr><th>Account</th><th>Currently in ledger</th><th>Desired opening balance</th></tr></thead>
                    <tbody>
                      {dashboard.openingBalances.rows.filter((row) => row.account.type === type).map((row) => (
                        <tr key={row.account._id.toString()}>
                          <td><strong>{row.account.parentAccountId ? "↳ " : ""}{row.account.name}</strong><small>{row.account.code}</small></td>
                          <td>{formatMoney(row.currentCents)}</td>
                          <td><label><span>$</span><input name={`opening_${row.account._id.toString()}`} inputMode="decimal" defaultValue={moneyInput(Math.max(0, row.currentCents))} required /></label></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            <div className="financial-ytd-confirmation">
              <h4>Before posting</h4>
              <ul><li>Enter positive balances; the account type determines debit or credit automatically.</li><li>Use balances from the same statement date for every account.</li><li>Enter zero for accounts with no opening balance.</li><li>Reposting later adjusts accounts to the new targets instead of duplicating them.</li></ul>
              <label className="account-check"><input type="checkbox" name="confirmOpeningBalances" required /><span>I reviewed these opening balances and understand the net difference posts to Conversion Equity.</span></label>
              <button className="button button-primary" type="submit">Post opening balances</button>
            </div>
          </form>
        </div>
      )}

      {view === "import-ytd" && (
        <div className="financial-ytd-import">
          <header>
            <p className="eyebrow">Conversion setup</p>
            <h3>Import {dashboard.ytdImport.year} year-to-date totals</h3>
            <p>Bring the current year up to date without changing the bank or drawer. This posts only the difference between the ledger&apos;s current total and the desired total for each income or expense account.</p>
          </header>

          <div className="financial-ytd-steps">
            <article><span>01</span><div><strong>Choose the cutoff</strong><p>Use the last date included in the totals you are entering.</p></div></article>
            <article><span>02</span><div><strong>Review suggested totals</strong><p>POS sales and recorded barber payouts are suggestions. Verify them against your records.</p></div></article>
            <article><span>03</span><div><strong>Post the adjustment</strong><p>Conversion Equity balances the entry. No asset, bank, drawer, or liability account is touched.</p></div></article>
          </div>

          <form className="financial-ytd-cutoff" method="get" action="/admin/dashboard">
            <input type="hidden" name="tab" value="financials" />
            <input type="hidden" name="financialView" value="import-ytd" />
            <input type="hidden" name="financialStart" value={`${dashboard.ytdImport.year}-01-01`} />
            <input type="hidden" name="financialAsOf" value={dashboard.ytdImport.cutoff} />
            <label>Import totals through<input type="date" name="financialEnd" min={`${dashboard.ytdImport.year}-01-01`} max={`${dashboard.ytdImport.year}-12-31`} defaultValue={dashboard.ytdImport.cutoff} /></label>
            <button type="submit">Change cutoff</button>
          </form>

          <form action={importFinancialYearToDate}>
            <input type="hidden" name="cutoffDate" value={dashboard.ytdImport.cutoff} />
            {(["income", "expense"] as const).map((type) => (
              <section className="financial-ytd-section" key={type}>
                <div><h4>{type === "income" ? "Income" : "Expenses"}</h4><p>Target totals from {formatDisplayDate(dashboard.ytdImport.start)} through {formatDisplayDate(dashboard.ytdImport.cutoff)}.</p></div>
                <div className="financial-ytd-table-wrap">
                  <table>
                    <thead><tr><th>Account</th><th>Already in ledger</th><th>POS suggestion</th><th>Desired YTD total</th></tr></thead>
                    <tbody>
                      {dashboard.ytdImport.rows.filter((row) => row.account.type === type).map((row) => {
                        const target = row.suggestedCents ?? row.currentCents;
                        return (
                          <tr key={row.account._id.toString()}>
                            <td><strong>{row.account.parentAccountId ? "↳ " : ""}{row.account.name}</strong><small>{row.account.code}{row.account.taxFormType ? ` · ${row.account.taxFormType}` : ""}</small></td>
                            <td>{formatMoney(row.currentCents)}</td>
                            <td>{row.suggestedCents === undefined ? <span>Manual</span> : <><strong>{formatMoney(row.suggestedCents)}</strong><small>{row.suggestionLabel}</small></>}</td>
                            <td><label><span>$</span><input name={`target_${row.account._id.toString()}`} inputMode="decimal" defaultValue={moneyInput(target)} required /></label></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            <div className="financial-ytd-confirmation">
              <h4>Before posting</h4>
              <ul><li>Do not include bank or drawer balances in these fields.</li><li>Use amounts covering January 1 through the cutoff date only.</li><li>Confirm POS suggestions against receipts, payout records, and prior books.</li><li>A later correction creates another immutable adjustment; it does not overwrite this import.</li></ul>
              <label className="account-check"><input type="checkbox" name="confirmConversion" required /><span>I reviewed these targets and understand this import uses Conversion Equity without changing any bank or cash balance.</span></label>
              <button className="button button-primary" type="submit">Post year-to-date conversion</button>
            </div>
          </form>
        </div>
      )}

      {view === "ledger" && (
        <>
          <nav className="financial-account-tabs" aria-label="Ledger accounts">
            {dashboard.cashAccounts.map((account) => {
              const accountId = account._id.toString();
              const isSelected = accountId === selectedAccountId;
              return (
                <Link
                  className={isSelected ? "active" : ""}
                  href={financialHref("ledger", dates, accountId)}
                  aria-current={isSelected ? "page" : undefined}
                  key={accountId}
                >
                  <small>{account.code}</small>
                  <span>{account.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="financial-ledger-summary">
            <div><small>Account</small><strong>{dashboard.selectedCashAccount?.name ?? "No bank account"}</strong></div>
            <div><small>Opening balance</small><strong>{formatMoney(dashboard.ledgerOpeningBalanceCents)}</strong></div>
            <div><small>Closing balance</small><strong>{formatMoney(dashboard.ledgerClosingBalanceCents)}</strong></div>
          </div>

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
                <p className="financial-form-help wide">Use Opening balances for initial bank, credit-card, and loan balances. Use Transfer only when both sides are bank or cash accounts.</p>
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
                <tbody>{dashboard.profitAndLoss.contractor1099.map((row) => <tr key={row.account._id.toString()}><td><strong>{row.account.name}</strong><small>{row.account.code} · 1099 tracking</small></td><td>{formatMoney(row.ledgerExpenseCents)}</td><td>{formatMoney(row.recordedPayoutCents)}</td><td className={row.differenceCents === 0 ? "matched" : "different"}>{formatMoney(row.differenceCents)}</td></tr>)}</tbody>
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

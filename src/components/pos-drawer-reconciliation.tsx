"use client";

import { useMemo, useState } from "react";
import { reconcileCashDrawer } from "@/app/actions/pos";
import { formatMoney } from "@/lib/money";

type PriorCloseout = {
  expectedPhysicalDrawerCents: number;
  countedDrawerCents: number;
  varianceCents: number;
  reconciledByName: string;
  reconciledAt: string;
};

export function PosDrawerReconciliation({
  targetCents,
  payoutsDueCount,
  priorCloseout,
}: {
  targetCents: number;
  payoutsDueCount: number;
  priorCloseout?: PriorCloseout;
}) {
  const [countedAmount, setCountedAmount] = useState(
    priorCloseout ? (priorCloseout.countedDrawerCents / 100).toFixed(2) : "",
  );
  const countedCents = useMemo(() => {
    if (!/^\d+(?:\.\d{0,2})?$/.test(countedAmount)) return null;
    const amount = Number(countedAmount);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
  }, [countedAmount]);
  const effectiveTargetCents = priorCloseout?.expectedPhysicalDrawerCents ?? targetCents;
  const varianceCents = countedCents === null ? null : countedCents - effectiveTargetCents;
  const resultClass = varianceCents === null ? "pending" : varianceCents === 0 ? "balanced" : varianceCents > 0 ? "over" : "short";
  const resultText = varianceCents === null
    ? "Enter the final cash count"
    : varianceCents === 0
      ? "Drawer is balanced"
      : varianceCents > 0
        ? `${formatMoney(varianceCents)} over`
        : `${formatMoney(Math.abs(varianceCents))} short`;

  return (
    <section className="pos-drawer-reconciliation" aria-labelledby="drawer-close-heading">
      <div className="pos-drawer-copy">
        <p className="eyebrow">Final drawer count</p>
        <h2 id="drawer-close-heading">Balance the drawer.</h2>
        <p>The drawer starts with $200. After barber payouts, count the drawer before removing HQ&apos;s retained cash; once that cash is removed, $200 remains for the next day.</p>
        {payoutsDueCount > 0 && (
          <p className="pos-drawer-warning" role="status">
            Finish {payoutsDueCount} remaining barber {payoutsDueCount === 1 ? "payout" : "payouts"} before saving the final count.
          </p>
        )}
        {priorCloseout && (
          <p className="pos-drawer-prior">
            Last saved by {priorCloseout.reconciledByName} at {priorCloseout.reconciledAt}: {formatMoney(priorCloseout.countedDrawerCents)} ({priorCloseout.varianceCents === 0 ? "balanced" : priorCloseout.varianceCents > 0 ? `${formatMoney(priorCloseout.varianceCents)} over` : `${formatMoney(Math.abs(priorCloseout.varianceCents))} short`}).
          </p>
        )}
      </div>

      <form className="pos-drawer-form" action={reconcileCashDrawer}>
        <div className="pos-drawer-target">
          <small>Final drawer target</small>
          <strong>{formatMoney(effectiveTargetCents)}</strong>
        </div>
        <label>
          Cash counted in drawer
          <span><b>$</b><input name="countedAmount" type="number" min="0" max="100000" step="0.01" inputMode="decimal" value={countedAmount} onChange={(event) => setCountedAmount(event.target.value)} placeholder="200.00" required disabled={Boolean(priorCloseout)} /></span>
        </label>
        <div className={`pos-drawer-result ${resultClass}`} aria-live="polite">
          <small>Closeout result</small>
          <strong>{resultText}</strong>
        </div>
        <button type="submit" disabled={Boolean(priorCloseout) || payoutsDueCount > 0 || countedCents === null}>
          {priorCloseout ? "Closeout already saved" : "Save drawer closeout"}
        </button>
      </form>
    </section>
  );
}

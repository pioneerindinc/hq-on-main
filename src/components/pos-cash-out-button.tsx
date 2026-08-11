"use client";

import { cashOutBarberCommission } from "@/app/actions/pos";

export function PosCashOutButton({
  barberId,
  barberName,
  amount,
  requiresAuditReason = false,
}: {
  barberId: string;
  barberName: string;
  amount: string;
  requiresAuditReason?: boolean;
}) {
  return (
    <form
      action={cashOutBarberCommission}
      onSubmit={(event) => {
        if (!window.confirm(`Confirm ${barberName} received ${amount} in cash?`)) {
          event.preventDefault();
        }
      }}
    >
      <input name="barberId" type="hidden" value={barberId} />
      {requiresAuditReason && <input className="pos-payout-audit-reason" name="auditReason" minLength={3} maxLength={300} placeholder="Reason after closeout" aria-label="Reason for payout after closeout" required />}
      <button type="submit">Cash out {amount}</button>
    </form>
  );
}

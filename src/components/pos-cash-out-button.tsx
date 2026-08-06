"use client";

import { cashOutBarberCommission } from "@/app/actions/pos";

export function PosCashOutButton({
  barberId,
  barberName,
  amount,
}: {
  barberId: string;
  barberName: string;
  amount: string;
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
      <button type="submit">Cash out {amount}</button>
    </form>
  );
}

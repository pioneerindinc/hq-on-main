"use client";

import { useState } from "react";
import { loginPos } from "@/app/actions/pos";

type PosBarber = {
  id: string;
  name: string;
  specialty: string;
  hasPin: boolean;
  onBreak: boolean;
};

export function PosBarberSelector({ barbers }: { barbers: PosBarber[] }) {
  const [selected, setSelected] = useState<PosBarber | null>(null);

  return (
    <>
      <div className="pos-barber-grid">
        {barbers.map((barber) => (
          <button
            className="pos-barber-card"
            disabled={!barber.hasPin}
            key={barber.id}
            onClick={() => setSelected(barber)}
            type="button"
          >
            <span>{barber.name.slice(0, 1)}</span>
            <strong>{barber.name}</strong>
            <small>{barber.hasPin ? (barber.onBreak ? "On break" : barber.specialty) : "Admin must set POS PIN"}</small>
          </button>
        ))}
      </div>

      {selected && (
        <div className="pos-pin-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <section className="pos-pin-panel" role="dialog" aria-modal="true" aria-labelledby="pos-pin-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="pos-pin-close" onClick={() => setSelected(null)} type="button" aria-label="Close PIN entry">×</button>
            <p className="eyebrow">Register access</p>
            <h2 id="pos-pin-title">Hi, {selected.name}.</h2>
            <p>Enter your personal 4–6 digit PIN.</p>
            <form action={loginPos}>
              <input name="barberId" type="hidden" value={selected.id} />
              <input
                aria-label="POS PIN"
                autoComplete="off"
                autoFocus
                inputMode="numeric"
                maxLength={6}
                minLength={4}
                name="pin"
                pattern="[0-9]{4,6}"
                placeholder="••••"
                required
                type="password"
              />
              <button className="button button-primary" type="submit">Open register</button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

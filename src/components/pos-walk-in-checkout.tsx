"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { checkoutPosWalkIn } from "@/app/actions/pos";
import { priceLabelToCents } from "@/lib/money";

type WalkInService = {
  id: string;
  name: string;
  price: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} type="submit">
      {pending ? "Recording checkout…" : "Complete walk-in · Cash paid"}
    </button>
  );
}

export function PosWalkInCheckout({ services }: { services: WalkInService[] }) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const selectedService = services.find((service) => service.id === serviceId);
  const selectedPrice = priceLabelToCents(selectedService?.price);

  return (
    <section className="pos-walk-in-section" aria-labelledby="walk-in-heading">
      <div className="pos-walk-in-heading">
        <div><p className="eyebrow">No appointment needed</p><h2 id="walk-in-heading">Walk-in checkout</h2></div>
        <p>Record a completed cash service directly in today&apos;s register.</p>
      </div>
      {services.length > 0 ? (
        <form
          className="pos-walk-in-form"
          action={checkoutPosWalkIn}
          onSubmit={(event) => {
            const data = new FormData(event.currentTarget);
            const guest = String(data.get("name") ?? "this guest");
            const amount = Number(data.get("amount") ?? 0).toFixed(2);
            if (!window.confirm(`Record a $${amount} cash walk-in checkout for ${guest}?`)) {
              event.preventDefault();
            }
          }}
        >
          <label>Guest name<input name="name" minLength={2} defaultValue="Walk-In" required /></label>
          <label>Phone <small>Optional</small><input name="phone" type="tel" placeholder="Phone number" /></label>
          <label>Service
            <select name="serviceId" value={serviceId} onChange={(event) => setServiceId(event.target.value)} required>
              {services.map((service) => (
                <option value={service.id} key={service.id}>{service.name} · {service.price}</option>
              ))}
            </select>
          </label>
          <label>Cash total
            <span className="pos-walk-in-amount"><b>$</b><input key={serviceId} name="amount" type="number" min="0.01" max="100000" step="0.01" defaultValue={selectedPrice === null ? "" : (selectedPrice / 100).toFixed(2)} placeholder="Enter total" required /></span>
          </label>
          <SubmitButton />
        </form>
      ) : (
        <p className="pos-empty">No services are assigned to this barber.</p>
      )}
    </section>
  );
}

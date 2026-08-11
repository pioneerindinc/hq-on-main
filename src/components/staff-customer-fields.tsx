"use client";

import { useState } from "react";

export function StaffCustomerFields({
  initialName = "",
  initialPhone = "",
  initialEmail = "",
}: {
  initialName?: string;
  initialPhone?: string;
  initialEmail?: string;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function lookup() {
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch(`/api/staff/customers/lookup?phone=${encodeURIComponent(phone)}`);
      const body = await response.json() as { found?: boolean; message?: string; normalizedPhone?: string; customer?: { name: string; phone: string; email: string; phoneVerified: boolean } };
      if (!response.ok) throw new Error(body.message || "Customer lookup failed.");
      if (body.found && body.customer) {
        setName(body.customer.name);
        setPhone(body.customer.phone);
        setEmail(body.customer.email);
        setStatus(`Existing customer found${body.customer.phoneVerified ? " · verified phone" : " · phone not yet verified"}.`);
      } else {
        setPhone(body.normalizedPhone ?? phone);
        setStatus("No customer found. Saving creates one without marking the phone verified.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Customer lookup failed.");
    } finally {
      setLoading(false);
    }
  }

  return <>
    <label>Phone
      <span className="staff-phone-lookup"><input name="phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required /><button className="button button-secondary" type="button" disabled={loading || !phone.trim()} onClick={lookup}>{loading ? "Finding…" : "Find customer"}</button></span>
      {status && <small role="status">{status}</small>}
    </label>
    <label>Guest name<input name="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} /></label>
    <label>Email <small>Optional</small><input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
  </>;
}

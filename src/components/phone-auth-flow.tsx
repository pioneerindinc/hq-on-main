"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export type PhoneCustomer = {
  name: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  dependents: Array<{
    id: string;
    firstName: string;
    lastName?: string;
    relationship: "child" | "dependent";
  }>;
};

export function PhoneAuthFlow({
  onAuthenticated,
  redirectTo,
}: {
  onAuthenticated?: (customer: PhoneCustomer) => void | Promise<void>;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"phone" | "code" | "profile">("phone");
  const [challengeId, setChallengeId] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function finish(customer: PhoneCustomer) {
    await onAuthenticated?.(customer);
    if (redirectTo) router.push(redirectTo);
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/customer/phone/request", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setChallengeId(data.challengeId); setStage("code"); setMessage(data.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to send a code."); }
    finally { setLoading(false); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/customer/phone/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code: form.get("code") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      if (data.needsProfile) setStage("profile");
      else await finish(data.customer);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to verify that code."); }
    finally { setLoading(false); }
  }

  async function completeProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/customer/phone/complete-profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, firstName: form.get("firstName"), lastName: form.get("lastName"), email: form.get("email") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      await finish(data.customer);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save your details."); }
    finally { setLoading(false); }
  }

  return (
    <div className="phone-auth-flow">
      {message && <p className={stage === "code" ? "phone-auth-message" : "portal-alert error"} role="status">{message}</p>}
      {stage === "phone" && <form className="portal-form phone-auth-form" onSubmit={requestCode}>
        <label>Mobile phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="(317) 555-0123" required /></label>
        <button className="button button-primary" disabled={loading} type="submit">{loading ? "Sending…" : "Continue with phone →"}</button>
      </form>}
      {stage === "code" && <form className="portal-form phone-auth-form" onSubmit={verifyCode}>
        <label>6-digit verification code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
        <button className="button button-primary" disabled={loading} type="submit">{loading ? "Verifying…" : "Verify your number →"}</button>
        <button className="phone-auth-back" type="button" onClick={() => { setStage("phone"); setMessage(""); }}>Use a different number</button>
      </form>}
      {stage === "profile" && <form className="portal-form phone-auth-form phone-profile-form" onSubmit={completeProfile}>
        <p>Your number is verified. Tell us who&apos;s booking.</p>
        <label>First name<input name="firstName" autoComplete="given-name" required /></label>
        <label>Last name <small>Optional</small><input name="lastName" autoComplete="family-name" /></label>
        <label>Email <small>Optional</small><input name="email" type="email" autoComplete="email" /></label>
        <button className="button button-primary" disabled={loading} type="submit">{loading ? "Saving…" : "Continue →"}</button>
      </form>}
    </div>
  );
}

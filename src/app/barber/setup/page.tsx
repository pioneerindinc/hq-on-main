import type { Metadata } from "next";
import Link from "next/link";
import { completeBarberSetup } from "@/app/actions/barber-account";
import { getBarberSetupInvitation } from "@/lib/barber-setup";

export const metadata: Metadata = { title: "Set Up Barber Access | HQ on Main", robots: { index: false, follow: false } };

export default async function BarberSetupPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token = "", error } = await searchParams;
  const invitation = await getBarberSetupInvitation(token);
  return <main className="auth-page barber-setup-page">
    <div className="auth-accent" aria-hidden="true">B</div>
    <section className="auth-panel barber-setup-panel">
      <Link className="auth-back" href="/">← Back to HQ on Main</Link>
      <p className="eyebrow">Team access</p>
      <h1>{invitation?.purpose === "reset" ? "Reset access." : "Set up access."}</h1>
      {!invitation ? <><p className="portal-alert error">This setup link is invalid, expired, or has already been used.</p><p className="auth-switch">Ask an administrator to create a new setup link.</p></> : <>
        <p className="auth-intro">Hi {invitation.name}. Choose credentials only you will know, then add your notification number.</p>
        {error && <p className="portal-alert error" role="alert">{error}</p>}
        <form className="portal-form auth-form barber-setup-form" action={completeBarberSetup}>
          <input name="token" type="hidden" value={token} />
          <label>Password<input name="password" type="password" minLength={10} autoComplete="new-password" required /><small>At least 10 characters.</small></label>
          <label>Confirm password<input name="passwordConfirm" type="password" minLength={10} autoComplete="new-password" required /></label>
          <label>POS PIN<input name="posPin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6} autoComplete="new-password" required /><small>Choose 4–6 digits that other barbers cannot guess.</small></label>
          <label>Confirm POS PIN<input name="posPinConfirm" type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6} autoComplete="new-password" required /></label>
          <label>Mobile phone <small>Optional</small><input name="phone" type="tel" autoComplete="tel" placeholder="(317) 555-0123" /></label>
          <label className="account-check">
            <input name="smsNotificationsEnabled" type="checkbox" />
            <span>I agree to receive automated HQ on Main texts for new and cancelled appointments. Frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.</span>
          </label>
          <button className="button button-primary" type="submit">Save my password and PIN →</button>
        </form>
      </>}
    </section>
  </main>;
}

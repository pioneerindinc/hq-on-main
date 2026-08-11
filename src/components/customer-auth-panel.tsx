import Link from "next/link";
import { PhoneAuthFlow } from "@/components/phone-auth-flow";

export function CustomerAuthPanel({ error, success }: { mode?: "login" | "register"; error?: string; success?: string }) {
  return (
    <main className="customer-auth-page">
      <section className="customer-auth-panel">
        <Link className="auth-back" href="/">← Back to HQ on Main</Link>
        <p className="eyebrow">Welcome back</p>
        <h1>Continue with phone.</h1>
        <p className="auth-intro">We&apos;ll text you a one-time code. No password or separate account setup is needed.</p>
        {error && <p className="portal-alert error" role="alert">{error}</p>}
        {success && <p className="customer-alert-success" role="status">{success}</p>}
        <PhoneAuthFlow redirectTo="/customer/dashboard" />
        <p className="auth-switch">You can browse <Link href="/book">services and availability</Link> before signing in.</p>
      </section>
    </main>
  );
}

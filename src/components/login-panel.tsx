import Link from "next/link";
import { login } from "@/app/actions/auth";
import type { StaffRole } from "@/lib/auth";

export function LoginPanel({
  role,
  error,
}: {
  role: StaffRole;
  error?: string;
}) {
  const isAdmin = role === "admin";

  return (
    <main className="auth-page">
      <div className="auth-accent" aria-hidden="true">{isAdmin ? "A" : "B"}</div>
      <section className="auth-panel">
        <Link className="auth-back" href="/">← Back to HQ on Main</Link>
        <p className="eyebrow">{isAdmin ? "Management access" : "Team access"}</p>
        <h1>{isAdmin ? "Admin login." : "Barber login."}</h1>
        <p className="auth-intro">
          {isAdmin
            ? "Manage the team and keep shop access current."
            : "Manage your schedule, availability, and appointments."}
        </p>
        {error && <p className="portal-alert error" role="alert">{error}</p>}
        <form className="portal-form auth-form" action={login}>
          <input type="hidden" name="role" value={role} />
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="button button-primary" type="submit">Log in →</button>
        </form>
        <p className="auth-switch">
          {isAdmin ? (
            <><Link href="/barber/login">Barber login</Link></>
          ) : (
            <><Link href="/admin/login">Admin login</Link></>
          )}
        </p>
      </section>
    </main>
  );
}

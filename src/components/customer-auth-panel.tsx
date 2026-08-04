import Link from "next/link";
import { loginCustomer, registerCustomer } from "@/app/actions/customer";

export function CustomerAuthPanel({
  mode,
  error,
  success,
}: {
  mode: "login" | "register";
  error?: string;
  success?: string;
}) {
  const registering = mode === "register";

  return (
    <main className="customer-auth-page">
      <section className="customer-auth-panel">
        <Link className="auth-back" href="/">← Back to HQ on Main</Link>
        <p className="eyebrow">{registering ? "Join the shop" : "Welcome back"}</p>
        <h1>{registering ? "Create an account." : "Customer login."}</h1>
        <p className="auth-intro">
          {registering
            ? "Save your details, manage appointments, and book faster next time."
            : "View upcoming appointments and manage your account."}
        </p>
        {error && <p className="portal-alert error" role="alert">{error}</p>}
        {success && <p className="customer-alert-success" role="status">{success}</p>}
        <form className="portal-form customer-auth-form" action={registering ? registerCustomer : loginCustomer}>
          {registering && (
            <>
              <label>Full name<input name="name" required minLength={2} autoComplete="name" /></label>
              <label>Phone number<input name="phone" type="tel" required autoComplete="tel" /></label>
            </>
          )}
          <label>Email address<input name="email" type="email" required autoComplete="email" /></label>
          <label>Password<input name="password" type="password" required minLength={registering ? 10 : undefined} autoComplete={registering ? "new-password" : "current-password"} /></label>
          {registering && <small>Use at least 10 characters.</small>}
          <button className="button button-primary" type="submit">
            {registering ? "Create account →" : "Log in →"}
          </button>
        </form>
        <p className="auth-switch">
          {registering ? (
            <>Already have an account? <Link href="/customer/login">Log in</Link></>
          ) : (
            <>New to HQ? <Link href="/customer/register">Create an account</Link></>
          )}
        </p>
      </section>
    </main>
  );
}

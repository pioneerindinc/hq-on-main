import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { setupFirstAdmin } from "@/app/actions/auth";
import { adminSetupRequired } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Admin Setup | HQ on Main",
  robots: { index: false, follow: false },
};

export default async function AdminSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  if (!(await adminSetupRequired())) redirect("/admin/login");
  const { error } = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="auth-back" href="/">← Back to HQ on Main</Link>
        <p className="eyebrow">One-time setup</p>
        <h1>First admin.</h1>
        <p className="auth-intro">
          Create the owner account. Once created, this setup page automatically closes.
        </p>
        {error && <p className="portal-alert error" role="alert">{error}</p>}
        <form className="portal-form auth-form" action={setupFirstAdmin}>
          <label>Full name<input name="name" required minLength={2} autoComplete="name" /></label>
          <label>Email address<input name="email" type="email" required autoComplete="email" /></label>
          <label>Password<input name="password" type="password" required minLength={10} autoComplete="new-password" /></label>
          <small>Use at least 10 characters. A password manager is recommended.</small>
          <button className="button button-primary" type="submit">Create admin account →</button>
        </form>
      </section>
    </main>
  );
}

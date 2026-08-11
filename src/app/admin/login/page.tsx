import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginPanel } from "@/components/login-panel";
import { adminSetupRequired, getCurrentStaff } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Admin Login | HQ on Main",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (staff && (staff.role === "admin" || staff.adminAccess === true)) redirect("/admin/dashboard");
  const needsSetup = await adminSetupRequired();
  const { error } = await searchParams;

  if (needsSetup) {
    return (
      <main className="auth-page">
        <section className="auth-panel auth-notice">
          <p className="eyebrow">One-time setup</p>
          <h1>Create the first admin.</h1>
          <p className="auth-intro">
            No admin account exists yet. Complete the protected first-run setup
            before using the management portal.
          </p>
          <Link className="button button-primary" href="/admin/setup">Start admin setup →</Link>
        </section>
      </main>
    );
  }

  return <LoginPanel role="admin" error={error} />;
}

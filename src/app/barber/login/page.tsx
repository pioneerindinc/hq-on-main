import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginPanel } from "@/components/login-panel";
import { getCurrentStaff } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Barber Login | HQ on Main",
  robots: { index: false, follow: false },
};

export default async function BarberLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (staff?.role === "barber") redirect("/barber/dashboard");
  const { error } = await searchParams;
  return <LoginPanel role="barber" error={error} />;
}

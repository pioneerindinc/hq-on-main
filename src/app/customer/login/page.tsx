import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CustomerAuthPanel } from "@/components/customer-auth-panel";
import { getCurrentCustomer } from "@/lib/customer-auth";

export const metadata: Metadata = {
  title: "Continue with Phone | HQ on Main",
  robots: { index: false, follow: false },
};

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  if (await getCurrentCustomer()) redirect("/customer/dashboard");
  const { error, success } = await searchParams;
  return <CustomerAuthPanel mode="login" error={error} success={success} />;
}

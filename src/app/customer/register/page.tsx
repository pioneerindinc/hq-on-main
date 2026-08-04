import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CustomerAuthPanel } from "@/components/customer-auth-panel";
import { getCurrentCustomer } from "@/lib/customer-auth";

export const metadata: Metadata = {
  title: "Create Customer Account | HQ on Main",
  robots: { index: false, follow: false },
};

export default async function CustomerRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getCurrentCustomer()) redirect("/customer/dashboard");
  const { error } = await searchParams;
  return <CustomerAuthPanel mode="register" error={error} />;
}

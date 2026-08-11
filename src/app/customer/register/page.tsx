import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Continue with Phone | HQ on Main",
  robots: { index: false, follow: false },
};

export default function CustomerRegisterPage() {
  redirect("/customer/login");
}

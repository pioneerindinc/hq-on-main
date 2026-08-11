import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking-flow";
import { getServiceCatalog } from "@/lib/services";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book an Appointment | HQ on Main",
  description: "Choose your service, barber, and appointment time at HQ on Main.",
};

export default async function BookPage() {
  const services = await getServiceCatalog();
  return <BookingFlow services={services} />;
}

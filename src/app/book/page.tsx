import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking-flow";

export const metadata: Metadata = {
  title: "Book an Appointment | HQ on Main",
  description: "Choose your service, barber, and appointment time at HQ on Main.",
};

export default function BookPage() {
  return <BookingFlow />;
}

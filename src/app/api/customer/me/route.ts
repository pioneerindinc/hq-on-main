import { getCurrentCustomer } from "@/lib/customer-auth";

export async function GET() {
  const customer = await getCurrentCustomer();
  return Response.json({
    customer: customer
      ? { name: customer.name, email: customer.email, phone: customer.phone }
      : null,
  });
}

import { getCurrentCustomer } from "@/lib/customer-auth";
import { customerDisplayName, splitCustomerName } from "@/lib/phone";

export async function GET() {
  const customer = await getCurrentCustomer();
  return Response.json({
    customer: customer
      ? {
          name: customerDisplayName(customer),
          firstName: customer.firstName || splitCustomerName(customer.name).firstName,
          lastName: customer.lastName || splitCustomerName(customer.name).lastName,
          email: customer.email || "",
          phone: customer.phone,
        }
      : null,
  });
}

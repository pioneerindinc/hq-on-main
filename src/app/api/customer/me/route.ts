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
          dependents: (customer.dependents ?? [])
            .filter((dependent) => dependent.active !== false)
            .map((dependent) => ({
              id: dependent.id,
              firstName: dependent.firstName,
              lastName: dependent.lastName || "",
              relationship: dependent.relationship === "dependent" ? "dependent" : "child",
            })),
        }
      : null,
  });
}

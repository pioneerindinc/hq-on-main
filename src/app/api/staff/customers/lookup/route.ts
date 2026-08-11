import { getCurrentStaff } from "@/lib/auth";
import { findCustomersByPhone } from "@/lib/customer-identity";
import { getMongoClient } from "@/lib/mongodb";
import { customerDisplayName, formatPhone } from "@/lib/phone";

export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff || (staff.role !== "admin" && staff.role !== "barber")) {
    return Response.json({ message: "Unauthorized." }, { status: 401 });
  }

  const phone = new URL(request.url).searchParams.get("phone");
  const client = await getMongoClient();
  const match = await findCustomersByPhone(client.db("hqonmain"), phone);
  if (!match.normalizedPhone) {
    return Response.json({ message: "Enter a valid mobile number." }, { status: 400 });
  }
  const customer = match.customers[0];
  if (!customer) return Response.json({ found: false, normalizedPhone: match.normalizedPhone });

  return Response.json({
    found: true,
    customer: {
      id: customer._id.toString(),
      name: customerDisplayName(customer),
      phone: formatPhone(customer.phone),
      email: customer.email ?? "",
      phoneVerified: Boolean(customer.phoneVerifiedAt),
    },
  });
}

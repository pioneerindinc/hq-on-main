import { createCustomerSession, getCustomerCollection } from "@/lib/customer-auth";
import { verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const customers = await getCustomerCollection();
  const customer = await customers.findOne({ email });

  if (!customer || !(await verifyPassword(password, customer.passwordHash))) {
    return Response.json({ message: "Email or password is incorrect." }, { status: 401 });
  }

  await createCustomerSession(customer);
  return Response.json({
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    },
  });
}

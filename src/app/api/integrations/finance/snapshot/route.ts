import { getMongoClient } from "@/lib/mongodb";
import { buildFinanceSnapshot, financeSnapshotAuthorization } from "@/lib/finance-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
};

export async function GET(request: Request) {
  const authorization = financeSnapshotAuthorization(
    process.env.FINANCE_INTEGRATION_KEY?.trim(),
    request.headers.get("x-finance-integration-key")?.trim() ?? null,
  );
  if (authorization === "unconfigured") {
    return Response.json(
      { ok: false, error: "Finance integration is not configured." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  if (authorization === "unauthorized") {
    return Response.json(
      { ok: false, error: "Unauthorized." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const [contractors, sales, payouts, closeouts] = await Promise.all([
    db.collection("staff").find(
      { role: "barber" },
      { projection: { name: 1, email: 1, phone: 1, active: 1, commissionPercentage: 1, updatedAt: 1 } },
    ).toArray(),
    db.collection("appointments").find(
      {
        status: "completed",
        checkoutMethod: "cash",
        checkoutAmountCents: { $type: "number" },
      },
      { projection: { status: 1, checkoutMethod: 1, checkoutAmountCents: 1, requestedDate: 1, barberId: 1, barber: 1, updatedAt: 1 } },
    ).toArray(),
    db.collection("commissionPayouts").find(
      {
        paidAmountCents: { $gt: 0 },
        $or: [
          { status: "paid" },
          { paidAt: { $type: "date" } },
          { "history.paidAt": { $type: "date" } },
        ],
      },
      { projection: { status: 1, paidAt: 1, paidAmountCents: 1, businessDate: 1, barberId: 1, barberName: 1, reference: 1, "history.paidAt": 1, updatedAt: 1 } },
    ).toArray(),
    db.collection("drawerCloseouts").find(
      { status: "closed" },
      { projection: { businessDate: 1, hqRetainedCents: 1, varianceCents: 1, status: 1, updatedAt: 1 } },
    ).toArray(),
  ]);

  return Response.json(
    buildFinanceSnapshot({ generatedAt: new Date(), contractors, sales, payouts, closeouts }),
    { headers: NO_STORE_HEADERS },
  );
}

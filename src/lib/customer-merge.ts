import "server-only";

import { ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";

export async function mergeCustomerRecords({
  primaryCustomerId,
  duplicateCustomerId,
  mergedByUserId,
  reason,
}: {
  primaryCustomerId: ObjectId;
  duplicateCustomerId: ObjectId;
  mergedByUserId: ObjectId;
  reason: string;
}) {
  if (primaryCustomerId.equals(duplicateCustomerId)) throw new Error("Choose two different customer records.");
  if (reason.trim().length < 3) throw new Error("A merge reason is required.");
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const [primary, duplicate] = await Promise.all([
        db.collection("customers").findOne({ _id: primaryCustomerId }, { session }),
        db.collection("customers").findOne({ _id: duplicateCustomerId }, { session }),
      ]);
      if (!primary || !duplicate || duplicate.status === "merged") throw new Error("Customer record is unavailable.");
      const now = new Date();
      await db.collection("appointments").updateMany({ customerId: duplicateCustomerId }, { $set: { customerId: primaryCustomerId, customerMergedAt: now, updatedAt: now } }, { session });
      await db.collection("customers").updateOne(
        { _id: duplicateCustomerId },
        { $set: { status: "merged", mergedIntoCustomerId: primaryCustomerId, mergedAt: now, mergedByUserId, updatedAt: now }, $unset: { normalizedPhone: "" } },
        { session },
      );
      await db.collection("customerMergeAudits").insertOne({ primaryCustomerId, duplicateCustomerId, mergedByUserId, reason: reason.trim(), mergedAt: now }, { session });
    });
  } finally {
    await session.endSession();
  }
}

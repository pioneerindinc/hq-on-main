import "server-only";

import type { Db, ObjectId } from "mongodb";

export type FinancialAuditChange = {
  field: string;
  before: string;
  after: string;
};

export async function hasDrawerCloseout(db: Db, businessDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return false;
  return Boolean(await db.collection("drawerCloseouts").findOne(
    { businessDate },
    { projection: { _id: 1 } },
  ));
}

export async function recordPostCloseoutChange({
  db,
  businessDate,
  actor,
  entityType,
  entityId,
  summary,
  reason,
  changes,
}: {
  db: Db;
  businessDate: string;
  actor: { _id: ObjectId; name: string };
  entityType: "appointment" | "barber-payout" | "drawer-closeout";
  entityId?: ObjectId;
  summary: string;
  reason: string;
  changes: FinancialAuditChange[];
}) {
  if (!changes.length || !await hasDrawerCloseout(db, businessDate)) return false;
  await db.collection("financialAuditEvents").insertOne({
    businessDate,
    entityType,
    entityId,
    summary,
    reason,
    changes,
    changedByStaffId: actor._id,
    changedByName: actor.name,
    changedAt: new Date(),
  });
  return true;
}

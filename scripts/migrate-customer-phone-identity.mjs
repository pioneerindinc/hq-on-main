import { MongoClient } from "mongodb";

const apply = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required.");

function normalizePhone(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function splitName(value) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "Customer", lastName: parts.slice(1).join(" ") };
}

function bookingSource(value) {
  const source = String(value ?? "").toLowerCase();
  if (source.includes("voice") || source.includes("vapi")) return "vapi";
  if (source.includes("walk")) return "walk_in";
  if (source.includes("phone")) return "phone";
  if (source.includes("admin") || source.includes("barber") || source.includes("staff")) return "staff";
  if (source.includes("rebook")) return "rebook";
  return "online";
}

const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db("hqonmain");
  const customers = await db.collection("customers").find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  const groups = new Map();
  for (const customer of customers) {
    const normalized = normalizePhone(customer.normalizedPhone || customer.phone);
    if (normalized) groups.set(normalized, [...(groups.get(normalized) || []), customer]);
  }

  const canonicalByPhone = new Map();
  const customerOps = [];
  let invalidPhones = 0;
  let duplicateRecords = 0;
  for (const customer of customers) {
    const normalized = normalizePhone(customer.normalizedPhone || customer.phone);
    const names = splitName(customer.name);
    const duplicates = normalized ? groups.get(normalized) || [] : [];
    const canonical = duplicates[0]?._id.equals(customer._id);
    if (normalized && canonical) canonicalByPhone.set(normalized, customer._id);
    if (!normalized) invalidPhones += 1;
    if (duplicates.length > 1) duplicateRecords += 1;
    customerOps.push({
      updateOne: {
        filter: { _id: customer._id },
        update: {
          $set: {
            firstName: customer.firstName || names.firstName,
            lastName: customer.lastName ?? names.lastName,
            createdBySource: customer.createdBySource || "migration",
            status: normalized ? (customer.status || "active") : "needs_phone",
            ...(duplicates.length > 1 ? { possibleDuplicate: true, duplicateReviewKey: normalized } : {}),
            ...(normalized && canonical ? { normalizedPhone: normalized, phone: normalized } : {}),
            updatedAt: customer.updatedAt || new Date(),
          },
          ...(!normalized || (normalized && !canonical) ? { $unset: { normalizedPhone: "" } } : {}),
        },
      },
    });
  }

  const appointments = await db.collection("appointments").find({}).toArray();
  const appointmentOps = appointments.map((appointment) => {
    const normalized = normalizePhone(appointment.phone);
    const customerId = appointment.customerId || (normalized ? canonicalByPhone.get(normalized) : undefined);
    return {
      updateOne: {
        filter: { _id: appointment._id },
        update: { $set: {
          bookingSource: appointment.bookingSource || bookingSource(appointment.source),
          ...(normalized ? { phone: normalized } : {}),
          ...(customerId ? { customerId } : {}),
          recipientName: appointment.recipientName || appointment.name || "Customer",
          recipientType: appointment.recipientType || "self",
        } },
      },
    };
  });

  const summary = {
    mode: apply ? "apply" : "dry-run",
    customers: customers.length,
    appointments: appointments.length,
    invalidPhones,
    duplicatePhoneGroups: [...groups.values()].filter((items) => items.length > 1).length,
    duplicateRecords,
  };
  if (apply) {
    if (customerOps.length) await db.collection("customers").bulkWrite(customerOps, { ordered: false });
    if (appointmentOps.length) await db.collection("appointments").bulkWrite(appointmentOps, { ordered: false });
    await db.collection("customers").createIndex(
      { normalizedPhone: 1 },
      { unique: true, partialFilterExpression: { normalizedPhone: { $type: "string" } }, name: "unique_customer_normalized_phone" },
    );
    await db.collection("appointments").createIndex({ customerId: 1, requestedDate: -1 }, { name: "customer_appointment_history" });
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) console.log("No data changed. Run npm run migrate:customer-phone -- --apply after reviewing this summary and taking a backup.");
} finally {
  await client.close();
}

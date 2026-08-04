import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.warn("MONGODB_URI is not configured. Appointment writes will be unavailable.");
}

const globalForMongo = globalThis as typeof globalThis & {
  mongoClientPromise?: Promise<MongoClient>;
};

export function getMongoClient() {
  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  if (!globalForMongo.mongoClientPromise) {
    globalForMongo.mongoClientPromise = new MongoClient(uri).connect();
  }

  return globalForMongo.mongoClientPromise;
}

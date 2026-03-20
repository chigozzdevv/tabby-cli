import { MongoClient, type Db } from "mongodb";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  db = client.db(env.MONGODB_DB);
  await Promise.all([
    db.collection("activity-events").createIndex({ dedupeKey: 1 }, { unique: true }),
    db.collection("activity-events").createIndex({ owner: 1, createdAt: -1 }),
    db.collection("activity-events").createIndex({ account: 1, createdAt: -1 }),
    db.collection("activity-events").createIndex({ vaultId: 1, createdAt: -1 }),
    db.collection("activity-events").createIndex({ type: 1, createdAt: -1 }),
    db.collection("activity-events").createIndex({ createdAt: -1 }),
    db.collection("activity-cursors").createIndex({ key: 1 }, { unique: true }),
    db.collection("assistant-sessions").createIndex({ sessionId: 1 }, { unique: true }),
    db.collection("assistant-sessions").createIndex({ ownerAddress: 1, updatedAt: -1 }),
    db.collection("assistant-sessions").createIndex({ operatorAddress: 1, updatedAt: -1 }),
    db.collection("agent-bindings").createIndex({ bindingId: 1 }, { unique: true }),
    db.collection("agent-bindings").createIndex({ vaultId: 1, operator: 1 }, { unique: true }),
    db.collection("agent-bindings").createIndex({ owner: 1, updatedAt: -1 }),
  ]);
  logger.info({ db: env.MONGODB_DB }, "mongodb-connected");
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error("mongodb-not-connected");
  return db;
}

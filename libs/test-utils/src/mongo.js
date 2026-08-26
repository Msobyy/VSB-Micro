// Spins up a real (in-memory) single-node Mongo replica set for integration
// tests. A plain standalone in-memory Mongo can't run the transactions or
// change streams that @vsb/event-bus's outbox pattern depends on, so tests
// that exercise the outbox need this rather than a plain MongoMemoryServer.
// Used by services'/libs' tests/integration/*.test.js files.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

export async function startInMemoryReplicaSet() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  return {
    uri,
    stop: () => replSet.stop(),
  };
}

export async function connectMongoose(uri, dbName) {
  // dbName passed via options (not string-concatenated onto the URI) since
  // MongoMemoryReplSet's getUri() format isn't guaranteed to end cleanly
  // splice-able with a bare db name.
  const connection = mongoose.createConnection(uri, { dbName });
  await connection.asPromise();
  return connection;
}

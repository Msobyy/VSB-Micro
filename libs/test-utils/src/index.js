// Public surface of @vsb/test-utils — shared integration-test helpers so
// every service's tests/integration suite sets up its fixtures the same way
// instead of re-implementing in-memory Mongo/Kafka bootstrapping per service.
export { startInMemoryReplicaSet, connectMongoose } from "./mongo.js";

// Docker healthcheck for the mongo service (run with mongosh as the root user).
// Initializes the single-node replica set on first run and reports healthy only once this node is PRIMARY,
// so dependents never connect while the replica set is still electing.
try {
  rs.status();
} catch (error) {
  if (error.codeName !== "NotYetInitialized") throw error;
  rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
}

if (!db.hello().isWritablePrimary) {
  quit(1);
}

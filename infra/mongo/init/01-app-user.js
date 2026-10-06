// Runs once, on the first start with an empty data volume (official image's /docker-entrypoint-initdb.d).
// Creates the least-privilege user the api and workers connect with.
const dbName = process.env.MONGO_DB;
const user = process.env.MONGO_APP_USER;
const password = process.env.MONGO_APP_PASSWORD;

if (!dbName || !user || !password) {
  throw new Error("MONGO_DB, MONGO_APP_USER and MONGO_APP_PASSWORD are required to create the app user");
}

db.getSiblingDB(dbName).createUser({
  user,
  pwd: password,
  roles: [{ role: "readWrite", db: dbName }],
});

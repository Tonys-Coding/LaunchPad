const databaseName = process.env.MONGO_DATABASE || "launchpad";
const database = db.getSiblingDB(databaseName);

database.createUser({
  user: process.env.MONGO_APP_USERNAME,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: "readWrite", db: databaseName }],
});

// A config with an env read inside a nested object.
export default {
  db: { url: process.env.FIXTURE_DB_URL, pool: 5 },
};

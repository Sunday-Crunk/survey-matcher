import crypto from "node:crypto";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${key}`;
}

const databaseUrl = requireEnv("DATABASE_URL");
const username = requireEnv("APP_USERNAME");
const password = requireEnv("APP_PASSWORD");
const displayName = process.env.APP_DISPLAY_NAME?.trim() || username;

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === "disable" ? false : undefined
});

try {
  await pool.query(
    `INSERT INTO app_users (username, display_name, password_hash, created_at, disabled_at)
     VALUES ($1, $2, $3, now(), NULL)
     ON CONFLICT (username)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       password_hash = EXCLUDED.password_hash,
       disabled_at = NULL`,
    [username, displayName, hashPassword(password)]
  );
  console.log(`User ${username} is active.`);
} finally {
  await pool.end();
}

import dotenv from "dotenv";
import { createClient } from "@libsql/client";

dotenv.config();

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error("Missing TURSO_DATABASE_URL environment variable");
}

export const db = createClient({
  url,
  authToken: authToken || undefined
});
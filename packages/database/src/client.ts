import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://pos_app:pos_secret@localhost:5432/pos_saas";

const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });
export { client };
export * from "./schema/index.js";

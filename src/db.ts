import { createClient } from "@libsql/client";
// import { env } from "./env.js";

export const db = createClient({
    url: "file:sqlite.db",
    // encryptionKey: env.ENCRYPTION_KEY,
});


import { DatabaseSync } from "node:sqlite";

export const db = new DatabaseSync("file:sqlite.db");

export const sqlTagStore = db.createTagStore();

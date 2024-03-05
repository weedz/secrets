import * as crypto from "node:crypto";

import { nanoid } from "nanoid";

import { db } from "./db.js";

function hashId(id: string) {
    return crypto.createHash("sha256").update(id).digest().toString("base64");
}

function encryptDataWithId(id: string, data: string) {
    const cipher = crypto.createCipheriv("aes-256-cbc", id.slice(0, 32), id.slice(32));
    cipher.update(data);

    return cipher.final("base64");
}
function decryptDataWithId(id: string, encryptedData: Buffer) {
    const decipher = crypto.createDecipheriv("aes-256-cbc", id.slice(0, 32), id.slice(32));
    decipher.update(encryptedData);

    return decipher.final("utf8");
}

async function deleteSecret(hashedId: string) {
    await db.execute({
        sql: "delete from secrets where id = ?",
        args: [hashedId],
    });
}

export async function getSecret(id: string) {
    const hashedId = hashId(id);
    const secretRows = await db.execute({
        sql: "select data, views_remaining, expiration_date from secrets where id = ?",
        args: [hashedId],
    });

    if (secretRows.rows.length === 0) {
        return null;
    }

    const secret = secretRows.rows[0] as unknown as {
        data: string;
        views_remaining: number;
        expiration_date: string;
    };
    if (secret.views_remaining <= 0) {
        deleteSecret(hashedId);
        return null;
    }

    const expirationDate = Date.parse(secret.expiration_date);
    if (Number.isNaN(expirationDate) || expirationDate < Date.now()) {
        deleteSecret(hashedId);
        return null;
    }

    // To account for _this_ viewing of the secret
    secret.views_remaining -= 1;

    await db.execute({
        sql: "update secrets set views_remaining = views_remaining - 1 where id = ?",
        args: [hashedId],
    });

    secret.data = decryptDataWithId(id, Buffer.from(secret.data, "base64"));

    return secret;
}

export async function createSecret(data: string, views: number, expirationDate: number) {
    const id = nanoid(48);
    const hashedId = hashId(id);

    const encryptedData = encryptDataWithId(id, data);

    await db.execute({
        sql: "insert into secrets(id, views_remaining, data, expiration_date) values (?, ?, ?, datetime(?, 'unixepoch'))",
        args: [hashedId, views, encryptedData, Math.floor(expirationDate / 1000)]
    });

    return id;
}

import * as crypto from "node:crypto";

import { sqlTagStore } from "./db.js";

function hashId(id: Buffer) {
  return crypto.createHash("sha256").update(id).digest().toString("base64url");
}

function encryptDataWithId(id: Buffer, data: string) {
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    id.subarray(0, 32),
    id.subarray(-16),
    { authTagLength: 16 },
  );

  const encryptedData = Buffer.concat([
    cipher.update(data),
    cipher.final(),
  ]).toString("base64");
  const authTag = cipher.getAuthTag();

  return { data: encryptedData, authTag };
}
function decryptDataWithId(id: Buffer, authTag: Buffer, encryptedData: Buffer) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    id.subarray(0, 32),
    id.subarray(-16),
    { authTagLength: 16 },
  );
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]).toString("utf-8");
}

function deleteSecret(hashedId: string) {
  void sqlTagStore.run`delete from secrets where id = ${hashedId}`;
}

export function getSecret(idBase64: string, authTag: string) {
  const id = Buffer.from(idBase64, "base64");
  const hashedId = hashId(id);
  const secretRows = sqlTagStore.get`select data, views_remaining, expiration_date from secrets where id = ${hashedId}`;

  if (!secretRows) {
    return null;
  }

  const secret = secretRows as {
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

  if (secret.views_remaining <= 0) {
    deleteSecret(hashedId);
  } else {
    void sqlTagStore.run`update secrets set views_remaining = views_remaining - 1 where id = ${hashedId}`;
  }

  secret.data = decryptDataWithId(
    id,
    Buffer.from(authTag, "base64url"),
    Buffer.from(secret.data, "base64"),
  );

  return secret;
}

export function createSecret(
  data: string,
  views: number,
  expirationDate: number,
) {
  const id = crypto.randomBytes(48);
  const hashedId = hashId(id);
  const { data: encryptedData, authTag } = encryptDataWithId(id, data);

  void sqlTagStore.run`insert into secrets(id, views_remaining, data, expiration_date) values (${hashedId}, ${views}, ${encryptedData}, datetime(${Math.floor(expirationDate / 1000)}, 'unixepoch'))`;

  return { id: id.toString("base64url"), authTag };
}

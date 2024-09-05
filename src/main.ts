import { readFileSync } from "node:fs";
import * as http from "node:http";

import { db } from "./db.js";
import { env } from "./env.js";
import { createSecret, getSecret } from "./secrets.js";

const REQUESTS_RATE_LIMIT = 100;
const IP_RATE_LIMIT_TIME = 30000;
const DATA_SIZE_LIMIT = 128 * 1024; // 128 KiB

let rateLimitPost = 0;
const rateLimitIPs = new Map<string, number>();
setInterval(() => {
    const now = Date.now();
    if (rateLimitPost > 0) {
        rateLimitPost -= 1;
    }
    for (const item of rateLimitIPs) {
        if (item[1] > now) {
            // Maps are guaranteed to be ordered by insertions
            break;
        }
        rateLimitIPs.delete(item[0]);
    }
}, 5000);

setInterval(async () => {
    await db.execute({
        sql: "delete from secrets where expiration_date < datetime(?, 'unixepoch')",
        args: [Date.now() / 1000],
    })
}, 3600000);


const staticFiles = {
    "index.html": {
        content: readFileSync("./public/index.html"),
        headers: { "content-type": "text/html" },
    },
    "style.css": {
        content: readFileSync("./public/style.css"),
        headers: { "content-type": "text/css" },
    },
    "secret.html": {
        content: readFileSync("./public/secret.html"),
        headers: { "content-type": "text/html" },
    },
} as const;
function sendStaticFile(reply: http.ServerResponse, fileName: keyof typeof staticFiles) {
    reply.writeHead(200, undefined, staticFiles[fileName].headers);
    reply.write(staticFiles[fileName].content);
    return reply.end();
}

async function readBody(req: http.IncomingMessage, reply: http.ServerResponse) {
    // TODO: Better error handling
    if (req.headers["content-type"] !== "application/json") {
        reply.writeHead(400).end();
        return null;
    }
    const buffer: Buffer[] = [];
    let readBytes = 0;
    for await (const chunk of req) {
        if (!(chunk instanceof Buffer)) {
            reply.writeHead(400).end();
            return null;
        }
        readBytes += chunk.length;
        if (readBytes > DATA_SIZE_LIMIT) {
            reply.writeHead(413).end();
            return null;
        }
        buffer.push(chunk);
    }

    const data = Buffer.concat(buffer).toString("utf8");

    try {
        const json = JSON.parse(data) as unknown;
        if (json === null) {
            reply.writeHead(400).end();
            return null;
        }
        return json;
    } catch (err) {
        reply.writeHead(400).end();
        return null;
    }
}

async function handler(req: http.IncomingMessage, reply: http.ServerResponse) {
    if (!req.url) {
        reply.statusCode = 404;
        return reply.end();
    }

    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET") {
        if (url.pathname === "/") {
            return sendStaticFile(reply, "index.html");
        }
        else if (url.pathname === "/style.css") {
            return sendStaticFile(reply, "style.css");
        }
        else if (url.pathname === "/secret") {
            return sendStaticFile(reply, "secret.html");
        }
    }
    else if (req.method === "POST") {
        if (url.pathname === "/api/create-secret") {
            if (rateLimitPost >= REQUESTS_RATE_LIMIT) {
                return reply.writeHead(429).end();
            }
            if (!req.socket.remoteAddress || rateLimitIPs.has(req.socket.remoteAddress)) {
                return reply.writeHead(429).end();
            }
            rateLimitIPs.set(req.socket.remoteAddress, Date.now() + IP_RATE_LIMIT_TIME);
            rateLimitPost++;


            // TODO: Validation
            const json: any = await readBody(req, reply);
            if (!json || typeof json !== "object") {
                return;
            }

            // Validate json
            if (typeof json.data !== "string") {
                return reply.writeHead(400).end();
            }

            const maxViews = Number.parseInt(json.maxViews, 10);
            if (Number.isNaN(maxViews) || maxViews <= 0 || maxViews > 100) {
                return reply.writeHead(400).end();
            }

            const expirationLimitInDays = Number.parseInt(json.timeLimit, 10);
            if (Number.isNaN(expirationLimitInDays) || expirationLimitInDays <= 0 || expirationLimitInDays > 30) {
                return reply.writeHead(400).end();
            }

            try {
                const secret = await createSecret(json.data, maxViews, Date.now() + (86400000 * expirationLimitInDays));
                reply.writeHead(200, undefined, { "content-type": "application/json" }).write(JSON.stringify({ id: secret.id, auth: secret.authTag.toString("base64url") }));
                return reply.end();
            } catch (err) {
                // console.log("[POST api/create-secret] Error:", err);
                return reply.writeHead(500).end();
            }
        } else if (url.pathname === "/api/secret") {
            // TODO: Validation
            const json: any = await readBody(req, reply);
            if (!json || typeof json !== "object") {
                return;
            }

            const id = json.id;
            const authTag = json.auth;
            if (!id || !authTag || typeof id !== "string" || id.length !== 64 || typeof authTag !== "string" || authTag.length !== 22) {
                return reply.writeHead(400).end();
            }

            try {
                const secret = await getSecret(id, authTag);
                if (!secret) {
                    return reply.writeHead(404).end();
                }

                reply.writeHead(200, undefined, { "content-type": "application/json" }).write(JSON.stringify(secret));
                return reply.end();
            } catch (err) {
                // console.error("[GET api/secret] Error:", err);
                return reply.writeHead(400).end();
            }
        }
    }

    return reply.writeHead(404).end();
}


const server = http.createServer(async (req, reply) => {
    handler(req, reply).catch(err => {
        console.log("Error:", err);
        reply.statusCode = 500;
        return reply.end();
    });
});

server.listen(env.PORT, env.HOST, () => {
    console.log(`Listening on ${env.HOST || ""}:${env.PORT}`);
});


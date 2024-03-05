import * as http from "node:http";
import { createReadStream } from "node:fs";
import { finished } from "node:stream/promises";
import { createSecret, getSecret } from "./secrets.js";
import { env } from "./env.js";
import { db } from "./db.js";

const REQUESTS_RATE_LIMIT = 100;
const IP_RATE_LIMIT_TIME = 30000;

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



async function sendStaticFile(reply: http.ServerResponse, filePath: string, status?: number, headers?: http.OutgoingHttpHeaders) {
    const index = createReadStream(filePath);
    if (status) {
        reply.writeHead(status, undefined, headers);
    }
    await finished(index.pipe(reply));
    return reply.end();
}

async function handler(req: http.IncomingMessage, reply: http.ServerResponse) {
    if (!req.url) {
        reply.statusCode = 404;
        return reply.end();
    }

    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET") {
        if (url.pathname === "/") {
            return await sendStaticFile(reply, "./public/index.html", 200, { "content-type": "text/html" });
        }
        else if (url.pathname === "/client.js") {
            return await sendStaticFile(reply, "./public/client.js", 200, { "content-type": "application/javascript" });
        }
        else if (url.pathname === "/style.css") {
            return await sendStaticFile(reply, "./public/style.css", 200, { "content-type": "text/css" });
        }
        else if (url.pathname === "/secret") {
            const id = url.searchParams.get("id");
            if (!id) {
                return reply.writeHead(400).end();
            }

            return await sendStaticFile(reply, "./public/token.html", 200, { "content-type": "text/html" });
        }
        else if (url.pathname === "/token") {
            const id = url.searchParams.get("id");
            if (!id) {
                return reply.writeHead(400).end();
            }

            const secret = await getSecret(id);
            if (!secret) {
                return reply.writeHead(404).end();
            }

            reply.writeHead(200, undefined, { "content-type": "application/json" }).write(JSON.stringify(secret));
            return reply.end();
        }
    }
    else if (req.method === "POST") {
        if (url.pathname === "/create-secret") {
            if (rateLimitPost >= REQUESTS_RATE_LIMIT) {
                reply.writeHead(429);
                return reply.end();
            }
            if (!req.socket.remoteAddress || rateLimitIPs.has(req.socket.remoteAddress)) {
                reply.writeHead(429);
                return reply.end();
            }
            rateLimitIPs.set(req.socket.remoteAddress, Date.now() + IP_RATE_LIMIT_TIME);
            rateLimitPost++;

            const DATA_SIZE_LIMIT = 128 * 1024; // 128 KiB
            if (req.headers["content-type"] !== "application/json") {
                reply.writeHead(400);
                return reply.end();
            }
            const buffer: Buffer[] = [];
            let readBytes = 0;
            for await (const chunk of req) {
                if (!(chunk instanceof Buffer)) {
                    reply.writeHead(400);
                    return reply.end();
                }
                readBytes += chunk.length;
                if (readBytes > DATA_SIZE_LIMIT) {
                    reply.writeHead(413);
                    return reply.end();
                }
                buffer.push(chunk);
            }

            const data = Buffer.concat(buffer).toString("utf8");

            try {
                const json = JSON.parse(data);

                // Validate json
                if (!json.data || typeof json.data !== "string") {
                    // INVALID
                    reply.writeHead(400);
                    return reply.end();
                }

                const maxViews = Number.parseInt(json.maxViews, 10);
                if (Number.isNaN(maxViews) || maxViews <= 0 || maxViews > 100) {
                    // INVALID
                    reply.writeHead(400);
                    return reply.end();
                }

                const timeLimit = Number.parseInt(json.timeLimit, 10);
                if (Number.isNaN(timeLimit) || timeLimit <= 0 || timeLimit > 30) {
                    // INVALID
                    reply.writeHead(400);
                    return reply.end();
                }

                const secret = await createSecret(json.data, maxViews, Date.now() + (86400000 * timeLimit));
                reply.writeHead(200, undefined, { "content-type": "application/json" }).write(JSON.stringify({ secret }));
                return reply.end();
            } catch (err) {
                console.log("Error:", err);
                reply.writeHead(500);
                return reply.end();
            }
        }
        else if (url.pathname === "/post") {
            const result = await createSecret("Hello, world!", 5, Date.now() + 600000);

            reply.writeHead(200, undefined, { "content-type": "application/json" }).write(JSON.stringify({ id: result }));
            return reply.end();
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


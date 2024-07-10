import * as fs from "node:fs";
import { setTimeout } from "node:timers/promises";
import { Cmds } from "@weedzcokie/concurrent-cmd";

fs.rmSync("./dist", { recursive: true });

const newProcessEnv = { ...process.env, FORCE_COLOR: "true" };
const ccmds = new Cmds(undefined, newProcessEnv);
ccmds.spawnCommand("./node_modules/.bin/tsc", ["--watch", "--preserveWatchOutput"]);

// Wait for TSC to produce code
while (!fs.existsSync("./dist")) {
    await setTimeout(100);
}

ccmds.spawnCommand("node", ["--watch", "dist/main.js"]);

process.on("SIGINT", async (code) => {
    console.log("Recieved SIGINT signal.");
    await Promise.allSettled(ccmds.killChildren(code));
    process.exit(0);
});


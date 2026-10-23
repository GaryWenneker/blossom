import { Store } from "../src/storage.mjs";
import { MusicDnaWorker } from "../src/music-dna-worker.mjs";
import { setTimeout as wait } from "node:timers/promises";

const store = new Store(process.env.BLOSSOM_DB || ".data/blossom.db");
const worker = new MusicDnaWorker(store);
const mode = process.argv.includes("--loop") ? "loop" : "drain";
let running = true;
const shutdown = () => { running = false; };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  do {
    const result = await worker.drain({ maxJobs: 250 });
    console.log(JSON.stringify({ event: "music_dna_worker", ...result, timestamp: new Date().toISOString() }));
    if (mode !== "loop" || !running) break;
    await wait(5000);
  } while (running);
} catch (error) {
  console.error("Music DNA worker failed:", error.message);
  process.exitCode = 1;
} finally {
  store.close();
}

import fs from "node:fs/promises";
import path from "node:path";

const limits = [
  { dir: "server/http/routes", maxLines: 140 },
  { dir: "server/ws/handlers", maxLines: 220 },
  { dir: "server/game", maxLines: 260 },
  { dir: "server/bot", maxLines: 120 },
  { dir: "server/common", maxLines: 120 },
];

const root = process.cwd();
let failed = false;

for (const limit of limits) {
  const absoluteDir = path.join(root, limit.dir);
  let entries = [];
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    continue;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const full = path.join(absoluteDir, entry.name);
    const source = await fs.readFile(full, "utf8");
    const lines = source.split("\n").length;
    if (lines > limit.maxLines) {
      failed = true;
      console.error(`${path.relative(root, full)}: ${lines} lines > ${limit.maxLines}`);
    }
  }
}

if (failed) process.exit(1);
console.log("Module size checks passed.");

import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const serverDir = path.join(root, "server");

const walk = async (dir) => {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
};

const fileExists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const resolveImport = async (fromFile, specifier) => {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const attempts = [base, `${base}.js`, path.join(base, "index.js")];
  for (const candidate of attempts) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
};

const importRe = /(?:import\s+[^"']*?from\s+["']([^"']+)["'])|(?:import\(["']([^"']+)["']\))/g;

const files = await walk(serverDir);
const graph = new Map();
for (const file of files) {
  const src = await fs.readFile(file, "utf8");
  const deps = new Set();
  for (const m of src.matchAll(importRe)) {
    const specifier = m[1] || m[2];
    const resolved = await resolveImport(file, specifier);
    if (resolved && resolved.startsWith(serverDir)) deps.add(resolved);
  }
  graph.set(file, [...deps]);
}

const temp = new Set();
const perm = new Set();
const stack = [];
const cycles = [];

const visit = (node) => {
  if (perm.has(node)) return;
  if (temp.has(node)) {
    const idx = stack.indexOf(node);
    cycles.push([...stack.slice(idx), node]);
    return;
  }
  temp.add(node);
  stack.push(node);
  for (const dep of graph.get(node) || []) visit(dep);
  stack.pop();
  temp.delete(node);
  perm.add(node);
};

for (const node of graph.keys()) visit(node);

if (cycles.length) {
  console.error("Import cycles found:");
  for (const cycle of cycles) {
    console.error(` - ${cycle.map((f) => path.relative(root, f)).join(" -> ")}`);
  }
  process.exit(1);
}

console.log(`No import cycles in server/ (${files.length} modules checked).`);

import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, "src", "db", "migrations");
const to = join(root, "dist", "db", "migrations");

if (!existsSync(from)) {
  console.error(`missing migrations directory: ${from}`);
  process.exit(1);
}

mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`copied migrations -> ${to}`);

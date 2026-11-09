/**
 * Run the Python pipeline tests with the same interpreter resolution as the
 * main PDF → EPUB command (`tools/pdf2epub/.venv`, then `python3`).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const tools = join(root, "tools/pdf2epub");
const python =
  process.env.PDF2EPUB_PYTHON ??
  (existsSync(join(tools, ".venv/bin/python")) ? join(tools, ".venv/bin/python") : "python3");

const result = spawnSync(python, ["-m", "pytest", "tools/pdf2epub"], {
  cwd: root,
  stdio: "inherit",
});

if (result.error) {
  console.error(`error running ${python}: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 1);

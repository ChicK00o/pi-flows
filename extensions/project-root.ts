// ---------------------------------------------------------------------------
// Project Root Resolution
//
// Finds the root of the current project by walking up from process.cwd()
// looking for a .git directory. Falls back to ~/.pi if no git repo is found,
// so flows/agents are stored globally when pi is used outside a project.
// ---------------------------------------------------------------------------

import { existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const LOG = join(homedir(), ".pi", "pi-flows-debug.log");
function log(msg: string) { try { appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch {} }

/**
 * Resolve the project root for storing flows and agents.
 *
 * - If process.cwd() (or any ancestor) contains a .git directory, that is
 *   the project root and flows live in <project>/.pi/flows/.
 * - If no git repo is found, fall back to ~/.pi so flows are stored globally.
 */
export function resolveProjectRoot(): string {
  let dir = process.cwd();
  const start = dir;

  while (true) {
    if (existsSync(join(dir, ".git"))) {
      log(`[projectRoot] ${dir} (git root, cwd was ${start})`);
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached filesystem root — no git repo found
      break;
    }
    dir = parent;
  }

  // No git repo found: store flows in ~/.pi
  const fallback = join(homedir(), ".pi");
  log(`[projectRoot] ${fallback} (no git root found, cwd was ${start})`);
  return fallback;
}

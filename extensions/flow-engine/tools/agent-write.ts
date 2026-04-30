// ---------------------------------------------------------------------------
// Agent Write Tool
//
// Validates agent .md content via agent-validate, then writes to disk if valid.
// Emits "flow:rediscover" event after successful write to trigger re-discovery.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { validateAgentContent } from "./agent-validate.js";
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";

const LOG = join(homedir(), ".pi", "pi-flows-debug.log");
function log(msg: string) { try { appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch {} }

export function registerAgentWriteTool(pi: ExtensionAPI, projectRoot?: string): void {
  log(`[agent_write] registerAgentWriteTool called, projectRoot=${projectRoot}`);
  pi.registerTool({
    name: "agent_write",
    description:
      "Validate and write an agent .md file. Use the 'path' parameter for the full file path (e.g. '.pi/flows/.staging/agents/my-agent.md') or 'name' for a bare agent name (e.g. 'my-agent'). Validates content first; if valid, writes the file and triggers re-discovery.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Absolute or relative path to write the agent .md file" })),
      name: Type.Optional(Type.String({ description: "Filename or path for the agent .md file (alias for path)" })),
      content: Type.String({ description: "The agent .md content to validate and write" }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      log(`[agent_write] EXECUTE CALLED raw params=${JSON.stringify(params)}`);
      // Accept 'name' as an alias for 'path' (model sometimes uses 'name').
      // If the value has no directory component and no extension, treat it as
      // a bare agent name and expand to the staging path.
      let rawPath = (params as any).path || (params as any).name || "";
      if (rawPath && !rawPath.includes("/") && !rawPath.includes("\\")) {
        // Bare name like "dtc-requirements" → staging agents path
        const stem = rawPath.endsWith(".md") ? rawPath : `${rawPath}.md`;
        rawPath = `.pi/flows/.staging/agents/${stem}`;
      }
      (params as any).path = rawPath;
      log(`[agent_write] rawPath resolved: ${rawPath} (from path=${(params as any).path} name=${(params as any).name})`);
      // Run validation first (with dynamically discovered tools)
      const dynamicTools = new Set(pi.getAllTools().map(t => t.name));
      const validation = validateAgentContent(params.content, dynamicTools);

      log(`[agent_write] called: path=${params.path} projectRoot=${projectRoot} valid=${validation.valid}`);
      if (!validation.valid) {
        log(`[agent_write] VALIDATION FAILED: ${JSON.stringify(validation.diagnostics)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                written: false,
                path: params.path,
                diagnostics: validation.diagnostics,
              }, null, 2),
            },
          ],
          details: {},
        };
      }

      // Ensure directory exists and write the file
      // Resolve relative paths against projectRoot to avoid resolving against pi's process cwd
      const absPath = projectRoot ? resolve(projectRoot, params.path) : params.path;
      log(`[agent_write] writing to absPath=${absPath}`);
      try {
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, params.content, "utf-8");
        log(`[agent_write] SUCCESS: ${absPath}`);
      } catch (err) {
        log(`[agent_write] WRITE ERROR: ${err}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                written: false,
                path: absPath,
                error: err instanceof Error ? err.message : String(err),
              }, null, 2),
            },
          ],
          details: {},
        };
      }

      // Trigger re-discovery so the new agent is available immediately
      pi.events.emit("flow:rediscover", {});

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              written: true,
              path: absPath,
              diagnostics: validation.diagnostics,
            }, null, 2),
          },
        ],
        details: {},
      };
    },
  });
}

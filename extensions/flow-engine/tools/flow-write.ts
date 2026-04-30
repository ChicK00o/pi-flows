// ---------------------------------------------------------------------------
// Flow Write Tool
//
// Validates flow YAML content via flow-validate, then writes to disk if valid.
// Emits "flow:rediscover" event after successful write to trigger re-discovery.
// Returns validation errors if the content is invalid.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "../types.js";
import { validateFlowContent } from "./flow-validate.js";
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";

const LOG = join(homedir(), ".pi", "pi-flows-debug.log");
function log(msg: string) { try { appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch {} }

export function registerFlowWriteTool(
  pi: ExtensionAPI,
  getDiscoveredAgents: () => Map<string, AgentConfig>,
  projectRoot?: string,
): void {
  pi.registerTool({
    name: "flow_write",
    description:
      "Validate and write a flow YAML file. Use the 'path' parameter for the full file path (e.g. '.pi/flows/.staging/flows/my-flow.yaml') or 'name' for a bare flow name (e.g. 'my-flow'). Validates content first; if valid, writes the file.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Absolute or relative path to write the flow .yaml file" })),
      name: Type.Optional(Type.String({ description: "Filename or path for the flow .yaml file (alias for path)" })),
      content: Type.String({ description: "The flow YAML content to validate and write" }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      // Accept 'name' as an alias for 'path' (model sometimes uses 'name').
      // If the value has no directory component, treat it as a bare flow name
      // and expand to the staging path.
      let rawPath = (params as any).path || (params as any).name || "";
      if (rawPath && !rawPath.includes("/") && !rawPath.includes("\\")) {
        const stem = rawPath.endsWith(".yaml") || rawPath.endsWith(".yml") ? rawPath : `${rawPath}.yaml`;
        rawPath = `.pi/flows/.staging/flows/${stem}`;
      }
      (params as any).path = rawPath;
      log(`[flow_write] rawPath resolved: ${rawPath} (from path=${(params as any).path} name=${(params as any).name})`);
      // Run validation first
      const validation = validateFlowContent(params.content, getDiscoveredAgents);

      log(`[flow_write] called: path=${params.path} projectRoot=${projectRoot} valid=${validation.valid}`);
      if (!validation.valid) {
        log(`[flow_write] VALIDATION FAILED: ${JSON.stringify(validation.diagnostics)}`);
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
      log(`[flow_write] writing to absPath=${absPath}`);
      try {
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, params.content, "utf-8");
        log(`[flow_write] SUCCESS: ${absPath}`);
      } catch (err) {
        log(`[flow_write] WRITE ERROR: ${err}`);
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

      // Trigger re-discovery so the new flow is available immediately
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

/**
 * Auto-discover workflows from the `workflows/` directory.
 *
 * Convention: each `workflows/{name}/index.ts` must export at least one
 * function (the Render task). The folder name becomes the route name and
 * the Render slug is derived as `{serviceName}/{folderName}`.
 *
 * Returns both the WorkflowMapping (for remote dispatch) and localTasks
 * (for in-process dispatch), eliminating the need for a hardcoded registry.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface DiscoveredWorkflows {
  /** Maps route name → Render task slug (for production dispatch). */
  mapping: Record<string, string>;
  /** Maps route name → callable task function (for local dev dispatch). */
  localTasks: Record<string, (input: unknown) => unknown | Promise<unknown>>;
}

export async function loadWorkflows(dir: string): Promise<DiscoveredWorkflows> {
  const entries = await readdir(dir, { withFileTypes: true });
  const mapping: Record<string, string> = {};
  const localTasks: Record<string, (input: unknown) => unknown | Promise<unknown>> = {};
  const workflowSlug = process.env.RENDER_WORKFLOW_SLUG?.trim();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const indexPath = join(dir, name, "index.ts");

    const mod = await import(pathToFileURL(indexPath).href);

    const taskFn = findTaskExport(mod);
    if (!taskFn) continue;

    mapping[name] = workflowSlug ? `${workflowSlug}/${name}` : name;
    localTasks[name] = taskFn;
  }

  return { mapping, localTasks };
}

/**
 * Find the first exported function that looks like a Render task.
 * Skips type-only exports and non-function values.
 */
function findTaskExport(
  mod: Record<string, unknown>,
): ((input: unknown) => unknown) | undefined {
  for (const key of Object.keys(mod)) {
    if (typeof mod[key] === "function") {
      return mod[key] as (input: unknown) => unknown;
    }
  }
  return undefined;
}

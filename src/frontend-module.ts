import path from "node:path";
import type { AddFrontendModuleOptions } from "@antelopejs/interface-dms/page";

/**
 * This module's frontend, from its configuration alone: the backend registers
 * it with `AddFrontendModule`, and `@antelopejs/dms-frontend` calls this same
 * function (declared as `dmsFrontend` in package.json) to build and start the
 * frontend without a backend. It reads nothing but its arguments.
 */
export function frontendModule(): AddFrontendModuleOptions {
  return {
    name: "@antelopejs/dms-database-frontend-vue",
    sourcePath: path.join(__dirname, "../frontend-vue"),
    renderer: { name: "vue", version: "3" },
    configKey: "dmsDatabase",
    priority: 0,
  };
}

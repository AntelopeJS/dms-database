import {
  RegisterTriggerType,
  UnregisterTriggerType,
} from "@antelopejs/interface-dms-automation";
import { tableWatchTrigger } from "./tableWatch";

/**
 * Registrations are inert no-ops when no module implements the automation
 * interface (it sits in optionalDependencies), so this is always safe to call.
 */
export function registerAutomationNodes(): void {
  RegisterTriggerType(tableWatchTrigger);
}

export function unregisterAutomationNodes(): void {
  UnregisterTriggerType(tableWatchTrigger.id);
}

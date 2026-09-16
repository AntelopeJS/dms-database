import {
  RegisterTriggerType,
  type TriggerType,
  UnregisterTriggerType,
} from "@antelopejs/interface-dms-automation";
import { tableWatchTrigger } from "./tableWatch";

// Registrations are inert no-ops when no module implements the automation
// interface (it sits in optionalDependencies), so this is always safe to call.
export function registerAutomationNodes(): void {
  RegisterTriggerType(tableWatchTrigger as TriggerType);
}

export function unregisterAutomationNodes(): void {
  UnregisterTriggerType(tableWatchTrigger.id);
}

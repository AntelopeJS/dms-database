import type {
  ActionType,
  DataNodeType,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import { connectionStatusTrigger } from "./connectionStatus";
import { healthAction } from "./health";
import { procedureWrites } from "./origin";
import { automationLoopGuard } from "./loopGuard";
import { countRowsAction, getRowAction } from "./rowActions";
import { fieldChangedNode, rowDiffNode } from "./rowDiff";
import { runSavedQueryAction } from "./savedQuery";
import { tableWatchTrigger } from "./tableWatch";

const AUTOMATION_INTERFACE_PACKAGE = "@antelopejs/interface-dms-automation";

type AutomationInterface =
  typeof import("@antelopejs/interface-dms-automation");

interface ModuleLoadError extends Error {
  code?: string;
}

export const TRIGGERS: TriggerType[] = [
  tableWatchTrigger,
  connectionStatusTrigger,
];
export const ACTIONS: ActionType[] = [
  getRowAction,
  countRowsAction,
  runSavedQueryAction,
  healthAction,
];
export const DATA_NODES: DataNodeType[] = [rowDiffNode, fieldChangedNode];

let automationInterfacePromise:
  | Promise<AutomationInterface | undefined>
  | undefined;
let registered = false;

function isMissingAutomationInterface(error: ModuleLoadError): boolean {
  const firstLine = error.message.split("\n", 1)[0] ?? "";
  return (
    ["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(error.code ?? "") &&
    (firstLine === `Cannot find module '${AUTOMATION_INTERFACE_PACKAGE}'` ||
      firstLine.startsWith(
        `Cannot find package '${AUTOMATION_INTERFACE_PACKAGE}' imported from `,
      ))
  );
}

async function loadAutomationInterface(): Promise<
  AutomationInterface | undefined
> {
  try {
    return await import("@antelopejs/interface-dms-automation");
  } catch (error) {
    if (error instanceof Error && isMissingAutomationInterface(error)) {
      return undefined;
    }
    throw error;
  }
}

function getAutomationInterface(): Promise<AutomationInterface | undefined> {
  automationInterfacePromise ??= loadAutomationInterface();
  return automationInterfacePromise;
}

function unregisterAll(automation: AutomationInterface): unknown[] {
  const errors: unknown[] = [];
  const operations = [
    ...TRIGGERS.map(
      ({ id }) =>
        () =>
          automation.UnregisterTriggerType(id),
    ),
    ...ACTIONS.map(
      ({ id }) =>
        () =>
          automation.UnregisterActionType(id),
    ),
    ...DATA_NODES.map(
      ({ id }) =>
        () =>
          automation.UnregisterDataNodeType(id),
    ),
  ];
  for (const operation of operations) {
    try {
      operation();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

/**
 * Declares the database automation node types when the optional automation
 * interface package is installed. Without a module implementing it, the
 * registrations are inert.
 */
export async function registerAutomationNodes(): Promise<void> {
  const automation = await getAutomationInterface();
  if (!automation || registered) return;
  registered = true;
  try {
    for (const trigger of TRIGGERS) automation.RegisterTriggerType(trigger);
    for (const action of ACTIONS) automation.RegisterActionType(action);
    for (const node of DATA_NODES) automation.RegisterDataNodeType(node);
  } catch (error) {
    unregisterAll(automation);
    registered = false;
    throw error;
  }
}

/**
 * Withdraws the node types and forgets the procedure writes and the loop
 * guard's counts.
 */
export async function unregisterAutomationNodes(): Promise<void> {
  procedureWrites.reset();
  automationLoopGuard.reset();
  const automation = await getAutomationInterface();
  if (!automation || !registered) return;
  const errors = unregisterAll(automation);
  registered = errors.length > 0;
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "Failed to unregister database automation nodes",
    );
  }
}

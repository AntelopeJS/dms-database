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

/** The registration calls of the automation interface. */
export type NodeRegistry = Pick<
  AutomationInterface,
  | "RegisterTriggerType"
  | "UnregisterTriggerType"
  | "RegisterActionType"
  | "UnregisterActionType"
  | "RegisterDataNodeType"
  | "UnregisterDataNodeType"
>;

/**
 * Declares and withdraws the module's node types on a registry, once each: a
 * second declaration before a withdrawal does nothing, and a withdrawal that
 * fails keeps the next one pending.
 */
export class AutomationNodeRegistration {
  private registered = false;

  /**
   * Declares every node type; withdraws the declared ones when one fails.
   *
   * @param registry The automation interface's registration calls
   */
  register(registry: NodeRegistry): void {
    if (this.registered) return;
    this.registered = true;
    try {
      for (const trigger of TRIGGERS) registry.RegisterTriggerType(trigger);
      for (const action of ACTIONS) registry.RegisterActionType(action);
      for (const node of DATA_NODES) registry.RegisterDataNodeType(node);
    } catch (error) {
      unregisterAll(registry);
      this.registered = false;
      throw error;
    }
  }

  /**
   * Withdraws every node type.
   *
   * @param registry The automation interface's registration calls
   * @throws AggregateError with each withdrawal that failed
   */
  unregister(registry: NodeRegistry): void {
    if (!this.registered) return;
    const errors = unregisterAll(registry);
    this.registered = errors.length > 0;
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "Failed to unregister database automation nodes",
      );
    }
  }
}

const registration = new AutomationNodeRegistration();

function unregisterAll(automation: NodeRegistry): unknown[] {
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
  if (automation) registration.register(automation);
}

/**
 * Withdraws the node types and forgets the procedure writes and the loop
 * guard's counts.
 */
export async function unregisterAutomationNodes(): Promise<void> {
  procedureWrites.reset();
  automationLoopGuard.reset();
  const automation = await getAutomationInterface();
  if (automation) registration.unregister(automation);
}

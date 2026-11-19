import type { SchemaLabelOverrides } from "../service/schemaLabels";

/**
 * The harness's `schemaLabels` option, in the order a project would write it. Every key ends in a token only the
 * schemas of `config.journeys.test.ts` carry, so no other suite's schema takes one of these labels.
 */
export const SCHEMA_LABELS: SchemaLabelOverrides = {
  "tenant-acme-cfgj7": { label: "Acme", color: "error" },
  "tenant-*cfgj7": { label: "Tenant data", color: "warning" },
  "*-acme-cfgj7": { label: "Late", color: "info" },
  "billing-cfgj7": { label: "Billing", color: "success" },
  "core-cfgj7": { label: "Kernel", color: "neutral" },
  "app-*cfgj7": { label: "Apps", color: "secondary" },
  "*-acme-cfgj7o": { label: "Late", color: "info" },
  "tenant-*cfgj7o": { label: "Tenant data", color: "warning" },
  "app-cfgj8p-*i": { label: "Cut", color: "error" },
  "*-cfgj8p-ac": { label: "Cut", color: "error" },
  "pp-cfgj8p-*": { label: "Cut", color: "error" },
  "app-cfgj8w-*e": { label: "Whole", color: "error" },
  "*-cfgj8w-acme": { label: "Whole", color: "warning" },
};

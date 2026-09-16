import type { SchemaLabel, SchemaLabelColor } from "./types";

export interface SchemaLabelOverride {
  label: string;
  color?: SchemaLabelColor;
}

export type SchemaLabelOverrides = Record<string, SchemaLabelOverride>;

const DEFAULT_PATTERNS: ReadonlyArray<readonly [RegExp, SchemaLabel]> = [
  [/^app(lication)?([_-]|$)/i, { text: "Application", color: "info" }],
  [/^core([_-]|$)/i, { text: "Core", color: "primary" }],
  [/^global([_-]|$)/i, { text: "Global", color: "neutral" }],
  [/^staging([_-]|$)/i, { text: "Staging", color: "warning" }],
  [/^reviews?([_-]|$)/i, { text: "Reviews", color: "secondary" }],
  [/^prod(uction)?([_-]|$)/i, { text: "Production", color: "success" }],
];

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function resolveSchemaLabel(
  id: string,
  overrides?: SchemaLabelOverrides,
): SchemaLabel | undefined {
  if (overrides) {
    const exact = overrides[id];
    if (exact) return { text: exact.label, color: exact.color };

    for (const [pattern, override] of Object.entries(overrides)) {
      if (pattern === id) continue;
      if (!pattern.includes("*")) continue;
      if (patternToRegex(pattern).test(id)) {
        return { text: override.label, color: override.color };
      }
    }
  }

  for (const [regex, label] of DEFAULT_PATTERNS) {
    if (regex.test(id)) return label;
  }

  return undefined;
}

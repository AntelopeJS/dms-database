// How a typed draft becomes a cell value: the stored type is kept, and a
// column whose cell is empty falls back to the type sampled for it, so filling
// an empty cell of a number column stores a number.

export type DraftResult =
	| { ok: true; value: unknown; unchanged: boolean }
	| { ok: false; reason: "number" | "boolean" };

type Parser = (text: string) => DraftResult;

const BOOLEANS: Record<string, boolean> = { true: true, false: false };

function parsed(value: unknown): DraftResult {
	return { ok: true, value, unchanged: false };
}

const PARSERS: Record<string, Parser> = {
	number: (text) => {
		const trimmed = text.trim();
		const value = Number(trimmed);
		return trimmed === "" || !Number.isFinite(value) ? { ok: false, reason: "number" } : parsed(value);
	},
	boolean: (text) => {
		const value = BOOLEANS[text.trim().toLowerCase()];
		return value === undefined ? { ok: false, reason: "boolean" } : parsed(value);
	},
};

function isEmpty(value: unknown): boolean {
	return value === null || value === undefined;
}

/** The value a draft stands for, given the cell's current value and column type. */
export function parseDraft(draft: string | boolean, before: unknown, columnType: string): DraftResult {
	if (typeof draft === "boolean") return { ok: true, value: draft, unchanged: draft === before };
	const type = isEmpty(before) ? columnType : typeof before;
	// Leaving an empty cell empty is not an edit.
	if (isEmpty(before) && draft === "") return { ok: true, value: before, unchanged: true };
	const result = (PARSERS[type] ?? parsed)(draft);
	if (!result.ok) return result;
	return { ...result, unchanged: !isEmpty(before) && String(before) === String(result.value) };
}

/** A cell as one line of text: JSON for objects and lists. */
export function cellText(value: unknown): string {
	if (isEmpty(value)) return "";
	if (typeof value !== "object") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function isStructured(value: unknown): boolean {
	return value !== null && typeof value === "object";
}

// Where the module's pages live. Module pages resolve under
// /modules/<module id>; a link without that prefix 404s.
const MODULE_ROOT = "/modules/database";

export const DATABASE_PAGES = {
	overview: `${MODULE_ROOT}/overview`,
	schemas: `${MODULE_ROOT}/schemas`,
	diagram: `${MODULE_ROOT}/diagram`,
	data: `${MODULE_ROOT}/data`,
	query: `${MODULE_ROOT}/query`,
} as const;

export type DatabasePage = keyof typeof DATABASE_PAGES;

export interface TableAddress {
	schema: string;
	table: string;
	instance?: string;
}

/** A page of the module opened on one table, e.g. the data browser on it. */
export function tableLink(page: DatabasePage, address: TableAddress): string {
	const query = new URLSearchParams({ schema: address.schema, table: address.table });
	if (address.instance) query.set("instance", address.instance);
	return `${DATABASE_PAGES[page]}?${query.toString()}`;
}

const IDENTIFIER = /^[A-Z_$][\w$]*$/i;

/** `schemas.shop` or `schemas["dms-core"]`, as the query DSL reaches a schema. */
export function schemaAccess(schemaId: string): string {
	return IDENTIFIER.test(schemaId)
		? `schemas.${schemaId}`
		: `schemas[${JSON.stringify(schemaId)}]`;
}

/** The DSL reaching a table, for the query console's prefilled snippets. */
export function tableAccess(address: TableAddress): string {
	const instance = address.instance ? JSON.stringify(address.instance) : "";
	return `${schemaAccess(address.schema)}.instance(${instance}).table(${JSON.stringify(address.table)})`;
}

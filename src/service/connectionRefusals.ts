/**
 * The translation keys the database switcher and the access switch answer a refusal with. The
 * dashboard's error presenter shows a refusal only through a key its locales hold.
 */
export const CONNECTION_REFUSALS = {
  unknownConnection: "$dms_database.connections.unknown",
  notDevelopment: "$dms_database.connections.access.not_development",
  readOnlyAccount: "$dms_database.connections.access.account_read_only",
  unverifiedAccount: "$dms_database.connections.access.account_unverified",
  noModuleEntry: "$dms_database.connections.access.no_module_entry",
  noBuilder: "$dms_database.connections.access.no_builder",
  builderRefused: "$dms_database.connections.access.refused",
} as const;

// Texts the server writes where the dashboard composes none: the catalog
// tile's readout (plain strings) and the Schemas table's modifier tags. These
// few lines are composed here, in the reader's language. Blocks compose their
// own texts (`ComposedText`), and everything a Vue component draws lives in
// the layer's locales.

export type ServerLocale = "en" | "fr";

const DEFAULT_LOCALE: ServerLocale = "en";

const MESSAGES = {
  en: {
    tables: "{count} tables",
    table: "1 table",
    rows: "{count} rows",
    row: "1 row",
    schemas: "{count} schemas",
    schema: "1 schema",
    connectionDown: "Connection unavailable",
    latency: "probe {value} ms",
    HashModifier: "Hashed",
    LocalizationModifier: "Localized",
    EncryptionModifier: "Encrypted",
  },
  fr: {
    tables: "{count} tables",
    table: "1 table",
    rows: "{count} lignes",
    row: "1 ligne",
    schemas: "{count} schémas",
    schema: "1 schéma",
    connectionDown: "Connexion indisponible",
    latency: "sonde {value} ms",
    HashModifier: "Haché",
    LocalizationModifier: "Traduit",
    EncryptionModifier: "Chiffré",
  },
} as const;

type MessageKey = keyof (typeof MESSAGES)["en"];

/** A countable noun and the key of its singular form. */
const SINGULAR: Partial<Record<MessageKey, MessageKey>> = {
  tables: "table",
  rows: "row",
  schemas: "schema",
};

export interface LocaleCarrier {
  language?: string;
}

export function localeOf(user: LocaleCarrier | undefined): ServerLocale {
  const language = user?.language?.toLowerCase() ?? "";
  return language.startsWith("fr") ? "fr" : DEFAULT_LOCALE;
}

/** `501.6k` in English, `501,6 k` in French: the short form cards read best. */
export function formatCompact(locale: ServerLocale, value: number): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatMessage(
  locale: ServerLocale,
  key: MessageKey,
  params: Record<string, string> = {},
): string {
  return MESSAGES[locale][key].replace(
    /\{(\w+)\}/g,
    (match, name: string) => params[name] ?? match,
  );
}

/** The name of a column modifier, or its id when it has none. */
export function formatModifier(locale: ServerLocale, id: string): string {
  return id in MESSAGES[locale] ? MESSAGES[locale][id as MessageKey] : id;
}

/** "1 table" or "9 tables", the number in the reader's short form. */
export function formatCount(
  locale: ServerLocale,
  key: MessageKey,
  count: number,
): string {
  const singular = SINGULAR[key];
  if (count === 1 && singular) return formatMessage(locale, singular);
  return formatMessage(locale, key, { count: formatCompact(locale, count) });
}

import { Schema } from "@antelopejs/interface-database";
import { Field, Index, RegisterTable, Table } from "@antelopejs/interface-database-decorators";

/** Tables that are large (1,250 rows) or empty. */
export const METRICS_SCHEMA = "metrics";
export const READING_COUNT = 1250;

@RegisterTable("readings", METRICS_SCHEMA)
export class Reading extends Table {
  @Field("string") declare _id: string;
  @Index() @Field("number") declare seq: number;
  @Field("string") declare band: string;
  @Field("number") declare value: number;
}

@RegisterTable("empty_log", METRICS_SCHEMA)
export class EmptyLog extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare message: string;
}

interface MetricsTables {
  readings: Reading;
  empty_log: EmptyLog;
}

/** Fills `readings` once with rows numbered 1 to {@link READING_COUNT}. */
export async function seedMetrics(): Promise<void> {
  const schema = Schema.get<MetricsTables>(METRICS_SCHEMA);
  if (!schema) return;
  const readings = schema.instance().table("readings");
  if ((await readings.count()) > 0) return;
  const rows = Array.from({ length: READING_COUNT }, (_, index) => ({
    _id: `r_${String(index + 1).padStart(4, "0")}`,
    seq: index + 1,
    band: `band-${(index % 5) + 1}`,
    value: (index * 7) % 101,
  }));
  await readings.insert(rows).run();
}

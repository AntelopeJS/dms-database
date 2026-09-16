import {
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { SCHEMA_NAME } from "../../types/constants";

export const queryHistoryTableName = "query_history";

@RegisterTable(queryHistoryTableName, SCHEMA_NAME)
export class QueryHistoryRow extends Table {
  @Index()
  @Field("string")
  @Relation({ to: () => User })
  declare userId: string;

  @Index()
  @Field("date")
  declare executedAt: Date;

  @Field("any")
  declare query: Record<string, unknown>;

  @Field("string")
  declare source: string;

  @Field("string")
  declare language: "aql";

  @Field("number")
  declare durationMs: number;

  @Field("number")
  declare rowCount: number;
}

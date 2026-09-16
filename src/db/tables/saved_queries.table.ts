import {
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { SCHEMA_NAME } from "../../types/constants";

export const savedQueriesTableName = "saved_queries";

@RegisterTable(savedQueriesTableName, SCHEMA_NAME)
export class SavedQueryRow extends Table {
  @Index()
  @Field("string")
  @Relation({ to: () => User })
  declare userId: string;

  @Index()
  @Field("boolean")
  declare shared: boolean;

  @Field("string")
  declare name: string;

  @Field("string")
  declare description: string;

  @Field("any")
  declare query: Record<string, unknown>;

  @Field("string")
  declare source: string;

  @Field("string")
  declare language: "aql";

  @Field("date")
  declare createdAt: Date;
}

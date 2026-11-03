import { Field, RegisterTable, Table } from "@antelopejs/interface-database-decorators";

/** One tiny table in each schema whose label the configuration page documents. */

@RegisterTable("entries", "app-site")
export class AppSiteEntry extends Table {
  @Field("string") declare _id: string;
}

@RegisterTable("entries", "core")
export class CoreEntry extends Table {
  @Field("string") declare _id: string;
}

@RegisterTable("entries", "global")
export class GlobalEntry extends Table {
  @Field("string") declare _id: string;
}

@RegisterTable("entries", "staging-eu")
export class StagingEuEntry extends Table {
  @Field("string") declare _id: string;
}

@RegisterTable("entries", "reviews")
export class ReviewsEntry extends Table {
  @Field("string") declare _id: string;
}

@RegisterTable("entries", "production")
export class ProductionEntry extends Table {
  @Field("string") declare _id: string;
}

@RegisterTable("entries", "billing")
export class BillingEntry extends Table {
  @Field("string") declare _id: string;
}

@RegisterTable("entries", "tenant-acme")
export class TenantAcmeEntry extends Table {
  @Field("string") declare _id: string;
}

export const LABEL_SCHEMAS = ["app-site", "core", "global", "staging-eu", "reviews", "production", "billing", "tenant-acme"] as const;

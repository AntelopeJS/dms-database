import { strict as assert } from "node:assert";
import type {
  RelationDescription,
  RelationSummary,
} from "@antelopejs/interface-database-catalog";
import { referencesByTable } from "../service/catalogReferences";

function summary(schema: string, name: string): RelationSummary {
  return {
    schema,
    name,
    kind: "table",
    estimatedRows: null,
    estimate: null,
    key: null,
    writes: { insert: false, update: false, delete: false },
    comment: null,
  };
}

function described(
  schema: string,
  name: string,
  references: RelationDescription["references"],
): RelationDescription {
  return {
    ...summary(schema, name),
    columns: [],
    indexes: [],
    references,
    referencedBy: [],
  };
}

const LISTED = [
  summary("shop", "orders"),
  summary("shop", "order_lines"),
  summary("shop", "customers"),
  summary("billing.eu", "accounts"),
];

describe("the references a catalog reports, as the diagram's relations", () => {
  it("declares each column of a key, its target named by the schema and table the catalog lists", () => {
    const tables = referencesByTable(
      [
        described("shop", "order_lines", [
          {
            name: "order_lines_order_fk",
            from: {
              relation: "shop.order_lines",
              columns: ["order_id", "order_region"],
            },
            to: { relation: "shop.orders", columns: ["id", "region"] },
          },
          {
            name: "order_lines_account_fk",
            from: { relation: "shop.order_lines", columns: ["account_id"] },
            to: { relation: "billing.eu.accounts", columns: ["id"] },
          },
        ]),
        described("shop", "customers", []),
      ],
      LISTED,
    );
    assert.deepEqual(tables, {
      order_lines: [
        {
          fromField: "order_id",
          toSchema: "shop",
          toTable: "orders",
          toField: "id",
          many: false,
        },
        {
          fromField: "order_region",
          toSchema: "shop",
          toTable: "orders",
          toField: "region",
          many: false,
        },
        {
          fromField: "account_id",
          toSchema: "billing.eu",
          toTable: "accounts",
          toField: "id",
          many: false,
        },
      ],
      customers: [],
    });
  });

  it("leaves out a key to a relation the catalog does not list", () => {
    const tables = referencesByTable(
      [
        described("shop", "orders", [
          {
            name: "orders_hidden_fk",
            from: { relation: "shop.orders", columns: ["secret_id"] },
            to: { relation: "vault.secrets", columns: ["id"] },
          },
        ]),
      ],
      LISTED,
    );
    assert.deepEqual(tables, { orders: [] });
  });
});

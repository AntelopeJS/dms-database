"use strict";

const { Schema } = require("@antelopejs/interface-database");

/** `POST /verify-database-erp/seed` writes the `customers` collection of the external `erp` database before the provider starts. */
new Schema("erp", {
  customers: {
    fields: { _id: "string", name: "string", segment: "string" },
    indexes: {},
  },
});

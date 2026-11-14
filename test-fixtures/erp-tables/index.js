"use strict";

const { Schema } = require("@antelopejs/interface-database");

/** The harness seeds the `customers` collection of the external `erp` database before startup. */
new Schema("erp", {
  customers: {
    fields: { _id: "string", name: "string", segment: "string" },
    indexes: {},
  },
});

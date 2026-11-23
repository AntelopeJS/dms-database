"use strict";

const { Schema } = require("@antelopejs/interface-database");

new Schema("erp", {
  customers: {
    fields: { _id: "string", name: "string", segment: "string" },
    indexes: {},
  },
});

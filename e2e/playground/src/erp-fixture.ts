import { Controller, Post } from "@antelopejs/interface-api";
import { MongoClient } from "mongodb";

const CUSTOMERS = [
  { _id: "c1", name: "Ada", segment: "retail" },
  { _id: "c2", name: "Grace", segment: "wholesale" },
  { _id: "c3", name: "Linus", segment: "retail" },
];

/**
 * The trusted call that makes the external `erp` database: its `customers` collection must hold rows before the
 * provider in external mode starts, since it registers only collections the database already has. Only the
 * verification playground serves it.
 */
export class VerifyErpFixtureController extends Controller("/verify-database-erp") {
  @Post("/seed")
  async seed() {
    const client = await MongoClient.connect(process.env.MONGO_URL ?? "mongodb://localhost:27017");
    try {
      const customers = client.db("erp").collection<{ _id: string; name: string; segment: string }>("customers");
      await customers.deleteMany({});
      await customers.insertMany(CUSTOMERS);
    } finally {
      await client.close();
    }
    return { customers: CUSTOMERS.length };
  }
}

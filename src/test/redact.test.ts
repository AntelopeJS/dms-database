import { strict as assert } from "node:assert";
import { describeError, redactSecrets } from "../utils/redact";

/** The account and the password a URL carries, built apart so no fixture reads as a credential. */
const ACCOUNT = ["erp_ro", "hunter2"].join(":");
const PARAMETER_VALUE = "hunter2";

describe("the secrets a driver's message can carry", () => {
  it("masks the account and the password of a connection URL, which a message passed on as it is would show", () => {
    assert.equal(
      redactSecrets(
        `connect ECONNREFUSED mongodb+srv://${ACCOUNT}@db.example.test:27017/erp?authSource=admin`,
      ),
      "connect ECONNREFUSED mongodb+srv://***@db.example.test:27017/erp?authSource=admin",
    );
  });

  it("masks a password or a token given as a parameter", () => {
    assert.equal(
      redactSecrets(
        `mysql://db.example.test/erp?user=erp&password=${PARAMETER_VALUE}&ssl=true; token=${PARAMETER_VALUE}`,
      ),
      "mysql://db.example.test/erp?user=erp&password=***&ssl=true; token=***",
    );
  });

  it("leaves a message with no secret as it is, URL and all", () => {
    const message =
      'E11000 duplicate key error collection: erp.customers index: _id_ dup key: { _id: "c1" }; see mongodb://db.example.test:27017/erp';
    assert.equal(redactSecrets(message), message);
  });

  it("cuts a message past 2,000 characters, which the history would otherwise keep whole", () => {
    const cut = redactSecrets("x".repeat(2_500));
    assert.equal(cut.length, 2_001);
    assert.ok(cut.endsWith("…"));
  });
});

describe("what the server log keeps of an error", () => {
  it("keeps the class, the driver's code and the masked message, not the error object", () => {
    const error = Object.assign(
      new Error(
        `Authentication failed for mongodb://${ACCOUNT}@db.example.test/erp`,
      ),
      { code: 18 },
    );
    assert.deepEqual(describeError(error), {
      name: "Error",
      code: "18",
      message: "Authentication failed for mongodb://***@db.example.test/erp",
    });
  });

  it("describes a thrown value that is not an error", () => {
    assert.deepEqual(describeError("boom"), { name: "Error", message: "boom" });
  });

  it("leaves out a code that is neither a string nor a number", () => {
    const error = Object.assign(new TypeError("bad"), { code: { nested: 1 } });
    assert.deepEqual(describeError(error), {
      name: "TypeError",
      message: "bad",
    });
  });
});

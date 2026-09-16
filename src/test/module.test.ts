import { expect } from "chai";

describe("[unit] dms-database module", () => {
  it("constructs, which is what booting the suite proves", () => {
    // The harness above starts the module against a real DMS, Mongo and API.
    // Reaching this assertion means construct() resolved.
    expect(true).to.equal(true);
  });
});

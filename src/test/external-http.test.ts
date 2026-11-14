import { strict as assert } from "node:assert";
import {
  createMemberSession,
  createOwnerSession,
  type OwnerSession,
} from "./ownerSession";

const API = "http://127.0.0.1:5023/api/database";
const EDIT_C1 =
  "/browse/edit?filter_schema=is:erp&filter_table=is:customers&id=c1&connection=erp";

interface Answer {
  status: number;
  text: string;
}

async function send(
  session: OwnerSession,
  method: string,
  path: string,
  body?: { connection: string } | { name: string },
): Promise<Answer> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      "x-antelopejs-namespace": "default",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

describe("[integration] external databases over HTTP: who may call", () => {
  let member: OwnerSession;
  let owner: OwnerSession;

  before(async () => {
    member = await createMemberSession("external-http-member@example.test");
    owner = await createOwnerSession("external-http-owner@example.test");
  });

  after(async () => {
    await member.remove();
    await owner.remove();
  });

  it("refuses a member who is not the owner on the connections list, the selection and an edit, which a route without the owner gate would answer", async () => {
    const answers = await Promise.all([
      send(member, "GET", "/connections"),
      send(member, "PUT", "/connections/selected", { connection: "erp" }),
      send(member, "PUT", EDIT_C1, { name: "Member edit" }),
    ]);
    assert.deepEqual(
      answers.map(({ status }) => status),
      [403, 403, 403],
      answers.map(({ text }) => text).join(" | "),
    );
  });

  it("refuses the owner's edit of a read-only external database over HTTP, which a check left to the controller tests alone would not show", async () => {
    const selected = await send(owner, "PUT", "/connections/selected", {
      connection: "erp",
    });
    assert.equal(selected.status, 200, selected.text);
    const edit = await send(owner, "PUT", EDIT_C1, { name: "Owner edit" });
    assert.deepEqual(edit, {
      status: 403,
      text: "Access to erp is read only",
    });
    const row = await send(
      owner,
      "GET",
      "/browse/get?filter_schema=is:erp&filter_table=is:customers&id=c1",
    );
    assert.equal(row.status, 200, row.text);
    assert.match(row.text, /"name":"Ada"/);
  });
});

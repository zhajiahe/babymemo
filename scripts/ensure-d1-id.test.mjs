import { test } from "node:test";
import assert from "node:assert/strict";
import { parseD1List, withResolvedDatabase } from "./ensure-d1-id.mjs";

const uuid = "12345678-1234-1234-1234-123456789abc";
const fresh = () => ({ d1_databases: [{ binding: "DB", database_name: "babymemo" }] });

test("resolves existing D1 by exact name without creating another", () => {
  const out = withResolvedDatabase(fresh(), [{ name: "other", uuid }, { name: "babymemo", uuid }]);
  assert.equal(out.updated, true);
  assert.equal(out.config.d1_databases[0].database_id, uuid);
});
test("keeps a pinned database ID even if listing is not available", () => {
  const config = fresh();
  config.d1_databases[0].database_id = uuid;
  assert.equal(withResolvedDatabase(config, null).updated, false);
});
test("fails closed on missing or invalid database IDs", () => {
  assert.throws(() => withResolvedDatabase(fresh(), []), /exactly one/);
  assert.throws(() => withResolvedDatabase(fresh(), [{ name: "babymemo", uuid: "bad" }]), /Invalid D1/);
});
test("parses supported JSON list formats", () => {
  assert.equal(parseD1List(JSON.stringify([{ name: "babymemo" }])).length, 1);
  assert.equal(parseD1List(JSON.stringify({ result: [{ name: "babymemo" }] })).length, 1);
});

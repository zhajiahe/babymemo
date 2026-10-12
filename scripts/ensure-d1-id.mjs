#!/usr/bin/env node
/**
 * Wrangler can auto-create a D1 binding during deploy without persisting its ID.
 * Remote migration commands require database_id in some Wrangler versions.
 * Resolve the exact database name from the current account and patch only the
 * local deployment configuration; never create or delete an existing database.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function withResolvedDatabase(config, databases) {
  if (!Array.isArray(config?.d1_databases)) throw Error("Missing d1_databases configuration");
  const target = config.d1_databases.find((db) => db.binding === "DB");
  if (!target?.database_name) throw Error("Missing named DB binding");
  if (target.database_id && UUID.test(target.database_id)) return { config, updated: false };
  if (!Array.isArray(databases)) throw Error("Invalid wrangler d1 list response");
  const matches = databases.filter((db) => db.name === target.database_name);
  if (matches.length !== 1) {
    throw Error(`Expected exactly one D1 database named "${target.database_name}", got ${matches.length}. Refusing to guess.`);
  }
  const id = matches[0].uuid ?? matches[0].id;
  if (typeof id !== "string" || !UUID.test(id)) throw Error("Invalid D1 database UUID");
  target.database_id = id;
  return { config, updated: true };
}

export function parseD1List(output) {
  const parsed = JSON.parse(output);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.result)) return parsed.result;
  if (Array.isArray(parsed?.databases)) return parsed.databases;
  throw Error("Unexpected wrangler d1 list JSON structure");
}

function main() {
  const file = resolve(process.cwd(), "wrangler.jsonc");
  const config = JSON.parse(readFileSync(file, "utf8"));
  const database = config.d1_databases?.find((db) => db.binding === "DB");
  if (database?.database_id && UUID.test(database.database_id)) {
    console.log("[D1] Database ID already configured; no changes");
    return;
  }
  const output = execFileSync("npx", ["--no-install", "wrangler", "d1", "list", "--json"], {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  });
  const result = withResolvedDatabase(config, parseD1List(output));
  if (result.updated) {
    writeFileSync(file, JSON.stringify(result.config, null, 2) + "\n", "utf8");
    console.log("[D1] Bound auto-provisioned database ID for remote migrations");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); } catch (error) {
    console.error("[D1] " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

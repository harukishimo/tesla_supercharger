#!/usr/bin/env node

/**
 * Validate the checked-in Japan facility snapshot and, optionally, apply the
 * migration + seed to an empty local PostgreSQL database.
 *
 * The optional database path is deliberately opt-in and local-only. This
 * keeps a typo in an environment variable from sending seed data to Supabase
 * Cloud (or another remote database).
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const csvPath = resolve(root, "data/tesla-japan-superchargers-2026-07-22.csv");
const migrationPaths = readdirSync(resolve(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => resolve(root, "supabase/migrations", name));
const seedPath = resolve(root, "supabase/seed/20260722_japan_superchargers.sql");

function fail(message) {
  console.error(`[db:validate] FAIL: ${message}`);
  process.exitCode = 1;
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value);
  return values;
}

function runPsql(databaseUrl, args) {
  const result = spawnSync("psql", [databaseUrl, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PGCONNECT_TIMEOUT: "5" },
    maxBuffer: 2 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `psql exited with status ${result.status}`);
  }
  return result.stdout.trim();
}

function assertLocalDatabaseUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL URL");
  }

  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// scheme");
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0";
  if (!isLocal) {
    throw new Error(
      "Refusing a non-local database host. Use a localhost PostgreSQL instance for this check.",
    );
  }
}

function validateStaticSnapshot() {
  const csvLines = readFileSync(csvPath, "utf8")
    .trim()
    .split(/\r?\n/);
  const header = parseCsvLine(csvLines.shift());
  const rows = csvLines.map(parseCsvLine);
  const stallIndex = header.indexOf("stall_count");
  const sourceIndex = header.indexOf("official_source_url");

  if (stallIndex < 0 || sourceIndex < 0) {
    throw new Error("CSV is missing stall_count or official_source_url");
  }

  const csvSites = rows.length;
  const csvStalls = rows.reduce((sum, row) => sum + Number(row[stallIndex]), 0);
  const sourceUrls = new Set(rows.map((row) => row[sourceIndex]));
  if (csvSites !== 152 || csvStalls !== 752 || sourceUrls.size !== csvSites) {
    throw new Error(
      `CSV expected 152 unique sites / 752 stalls, got ${csvSites} / ${csvStalls}`,
    );
  }

  const seed = readFileSync(seedPath, "utf8");
  const seedRows = seed.match(/^\s{2}\s*\('/gm) ?? [];
  const seedUrls = seed.match(
    /https:\/\/www\.tesla\.com\/ja_JP\/findus\/location\/supercharger\/[^']+/g,
  ) ?? [];
  if (seedRows.length !== 152 || seedUrls.length !== 152) {
    throw new Error(
      `Seed expected 152 rows / 152 official URLs, got ${seedRows.length} / ${seedUrls.length}`,
    );
  }

  if (!migrationPaths.some((path) => readFileSync(path, "utf8").includes("create extension if not exists pgcrypto"))) {
    throw new Error("Migration must enable pgcrypto for gen_random_uuid()");
  }

  console.log(
    `[db:validate] Static snapshot PASS: ${csvSites} sites, ${csvStalls} stalls, ${seedRows.length} seed rows.`,
  );
}

function validateDatabase(databaseUrl) {
  assertLocalDatabaseUrl(databaseUrl);
  console.log("[db:validate] Applying migration and seed to the requested local database...");
  runPsql(databaseUrl, ["-v", "ON_ERROR_STOP=1", ...migrationPaths.flatMap((path) => ["-f", path]), "-f", seedPath]);

  const result = runPsql(databaseUrl, [
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `select
       (select count(*) from public.charging_sites)::text || '|' ||
       (select coalesce(sum(stall_count), 0) from public.charging_sites)::text || '|' ||
       (select count(*) from public.site_slots)::text || '|' ||
       (select count(*) from public.site_slots s join public.charging_sites c on c.id = s.charging_site_id and s.slot_number <= c.stall_count)::text;`,
  ]);

  const [sites, stalls, slots, validSlots] = result.split("|").map(Number);
  if (sites !== 152 || stalls !== 752 || slots !== 752 || validSlots !== 752) {
    throw new Error(
      `Database expected 152 sites / 752 stalls / 752 slots, got ${sites} / ${stalls} / ${slots} (valid slots: ${validSlots})`,
    );
  }

  console.log(
    `[db:validate] Database PASS: ${sites} sites, ${stalls} stalls, ${slots} virtual site_slots.`,
  );
}

try {
  const apply = process.argv.includes("--apply");
  validateStaticSnapshot();

  if (!apply) {
    console.log(
      "[db:validate] Database apply skipped. Set DATABASE_URL (localhost only) and pass --apply to run SQL checks.",
    );
  } else {
    const databaseUrl =
      process.env.DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!databaseUrl) {
      throw new Error(
        "--apply requires DATABASE_URL, SUPABASE_DATABASE_URL, or POSTGRES_URL (localhost only)",
      );
    }
    validateDatabase(databaseUrl);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

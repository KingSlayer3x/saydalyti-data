#!/usr/bin/env bun
/**
 * extract.ts — صيدليتي monthly schedule extractor
 *
 * Reads a duty-schedule image, extracts the table with a local Ollama vision
 * model, lets YOU review/fix every entry, then writes the JSON into the data
 * repo and (optionally) commits + pushes.
 *
 * Usage:
 *   bun extract.ts --image ./september.jpg --city dreikish --month 2026-09
 *
 * Options:
 *   --repo   path to your local clone of saydalyti-data (default: ../data-repo)
 *   --model  Ollama model (default: qwen2.5vl:3b)
 *   --push   commit & push automatically after review
 *
 * Requirements: Bun, Ollama running locally (`ollama serve`), git.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import * as readline from "node:readline/promises";

// ---------- CLI args ----------
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const IMAGE = arg("image");
const CITY = arg("city");
const MONTH = arg("month"); // YYYY-MM
const REPO = arg("repo", join(import.meta.dir, "..", "data-repo"))!;
const MODEL = arg("model", "qwen2.5vl:3b")!;
const PUSH = process.argv.includes("--push");

if (!IMAGE || !CITY || !MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error("Usage: bun extract.ts --image <file> --city <cityId> --month YYYY-MM [--repo <path>] [--model <name>] [--push]");
  process.exit(1);
}
if (!existsSync(IMAGE)) {
  console.error(`Image not found: ${IMAGE}`);
  process.exit(1);
}

type Entry = { nameAr: string; district: string; address: string; phone: string };
type Days = Record<string, Entry[]>;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// ---------- 1. Ask Ollama ----------
console.log(`\n🔍 Sending image to ${MODEL} (this can take a few minutes on CPU)...\n`);

const prompt = `You are reading a monthly on-duty pharmacy schedule (جدول المناوبة الشهري للصيدليات) written in Arabic.
Extract EVERY row of the table. For each row output: the day of month (number), pharmacy name in Arabic, district/area in Arabic if present, address in Arabic if present, phone number if present.

Respond with ONLY valid JSON, no markdown, in exactly this shape:
{"rows":[{"day":1,"nameAr":"صيدلية ...","district":"","address":"","phone":""}]}

Rules:
- Keep Arabic text EXACTLY as written in the image.
- Use empty string "" for missing fields.
- day must be a number from 1 to 31.
- One object per pharmacy per day (a day can appear multiple times).`;

const imageB64 = readFileSync(IMAGE).toString("base64");

const res = await fetch("http://localhost:11434/api/generate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    prompt,
    images: [imageB64],
    stream: false,
    format: "json",
    options: { temperature: 0 },
  }),
}).catch((e) => {
  console.error("❌ Could not reach Ollama at http://localhost:11434 — is `ollama serve` running?");
  console.error(String(e));
  process.exit(1);
});

if (!res.ok) {
  console.error(`❌ Ollama error ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const raw = (await res.json()) as { response: string };
let rows: { day: number; nameAr: string; district: string; address: string; phone: string }[] = [];
try {
  const parsed = JSON.parse(raw.response);
  rows = Array.isArray(parsed.rows) ? parsed.rows : [];
} catch {
  console.error("❌ Model did not return valid JSON. Raw output saved to /tmp/ollama-raw.txt");
  writeFileSync("/tmp/ollama-raw.txt", raw.response);
  process.exit(1);
}

// Normalize Arabic-Indic digits in phone numbers (٠١٢٣٤٥٦٧٨٩ → 0123456789)
const fixDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
rows = rows
  .filter((r) => r && r.day >= 1 && r.day <= 31 && (r.nameAr ?? "").trim() !== "")
  .map((r) => ({
    day: Number(r.day),
    nameAr: (r.nameAr ?? "").trim(),
    district: (r.district ?? "").trim(),
    address: (r.address ?? "").trim(),
    phone: fixDigits((r.phone ?? "").trim()),
  }))
  .sort((a, b) => a.day - b.day);

if (rows.length === 0) {
  console.error("❌ No rows extracted. Try a clearer/higher-resolution image, or crop it to just the table.");
  process.exit(1);
}

// ---------- 2. Human review loop ----------
function printTable() {
  console.log("\n#   Day  Pharmacy — District — Address — Phone");
  console.log("─".repeat(70));
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padEnd(4)}${String(r.day).padEnd(5)}${r.nameAr}` +
        (r.district ? ` — ${r.district}` : "") +
        (r.address ? ` — ${r.address}` : "") +
        (r.phone ? ` — ${r.phone}` : "")
    );
  });
  console.log("─".repeat(70));
  console.log(`${rows.length} rows total\n`);
}

console.log("✅ Extraction done. REVIEW CAREFULLY — compare with the original image!");
printTable();

loop: while (true) {
  const cmd = (await rl.question("Command [ok / edit N / del N / add / show]: ")).trim();
  const [op, nStr] = cmd.split(/\s+/);
  const n = Number(nStr) - 1;
  switch (op) {
    case "ok":
      break loop;
    case "show":
      printTable();
      break;
    case "del":
      if (rows[n]) { rows.splice(n, 1); printTable(); } else console.log("Bad row number.");
      break;
    case "edit": {
      const r = rows[n];
      if (!r) { console.log("Bad row number."); break; }
      const ask = async (label: string, cur: string) =>
        (await rl.question(`${label} [${cur}]: `)).trim() || cur;
      r.day = Number(await ask("day", String(r.day))) || r.day;
      r.nameAr = await ask("nameAr", r.nameAr);
      r.district = await ask("district", r.district);
      r.address = await ask("address", r.address);
      r.phone = fixDigits(await ask("phone", r.phone));
      printTable();
      break;
    }
    case "add": {
      const ask = async (label: string) => (await rl.question(`${label}: `)).trim();
      const day = Number(await ask("day"));
      const nameAr = await ask("nameAr");
      if (!day || !nameAr) { console.log("day and nameAr are required."); break; }
      rows.push({ day, nameAr, district: await ask("district"), address: await ask("address"), phone: fixDigits(await ask("phone")) });
      rows.sort((a, b) => a.day - b.day);
      printTable();
      break;
    }
    default:
      console.log("Commands: ok (accept), edit N, del N, add, show");
  }
}

// ---------- 3. Write file ----------
const days: Days = {};
for (const r of rows) {
  const key = String(r.day).padStart(2, "0");
  (days[key] ??= []).push({ nameAr: r.nameAr, district: r.district, address: r.address, phone: r.phone });
}

const outPath = join(REPO, "schedules", CITY, `${MONTH}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({ city: CITY, month: MONTH, updatedAt: new Date().toISOString(), days }, null, 2) + "\n"
);
console.log(`\n💾 Saved ${outPath}`);

// Warn about missing days in the month
const [y, m] = MONTH.split("-").map(Number);
const daysInMonth = new Date(y, m, 0).getDate();
const missing = Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, "0")).filter((d) => !days[d]);
if (missing.length) console.log(`⚠️  Days with NO pharmacy: ${missing.join(", ")} — is that correct?`);

// ---------- 4. Optional git push ----------
if (PUSH) {
  const git = (args: string[]) => Bun.spawnSync(["git", "-C", REPO, ...args], { stdout: "inherit", stderr: "inherit" });
  git(["add", "-A"]);
  git(["commit", "-m", `schedule: ${CITY} ${MONTH}`]);
  git(["push"]);
  console.log("🚀 Pushed to GitHub. The app will pick it up within minutes.");
} else {
  console.log(`\nNext: cd ${REPO} && git add -A && git commit -m "schedule: ${CITY} ${MONTH}" && git push`);
}
rl.close();

#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { classifyCodexSparkCapacityObservation } from "./codex-spark-capacity-observation-core.mjs";

const [sourceInput] = process.argv.slice(2);
if (!sourceInput) {
  console.error("Usage: node scripts/compile-codex-spark-capacity-observation.mjs <codex-result-or-classification.json>");
  process.exit(2);
}

try {
  const sourcePath = fs.realpathSync.native(path.resolve(sourceInput));
  const stat = fs.lstatSync(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Capacity source must be a regular non-symlink file.");
  const bytes = fs.readFileSync(sourcePath);
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) throw new Error("Capacity source has an invalid byte length.");
  let source;
  try {
    source = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Capacity source is not valid UTF-8 JSON: ${error?.message ?? error}`);
  }
  const result = classifyCodexSparkCapacityObservation({
    source,
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "evavo-codex-spark-capacity-observation-error-v1",
        ok: false,
        errorType: error?.constructor?.name ?? "Error",
        errorMessage: String(error?.message ?? error).slice(0, 4096),
        paidFallbackUsed: false,
        modelTurnPerformedByClassifier: false,
        accountUsageScraped: false,
        repositoryMutationPerformed: false,
        publicationPerformed: false,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

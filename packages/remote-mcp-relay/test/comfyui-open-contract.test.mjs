import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("remote relay admits one typed ComfyUI open action", () => {
  assert.match(source, /const COMFYUI_ACTIONS = new Set\(\["comfyui\.open"\]\)/);
  assert.match(source, /\.\.\.COMFYUI_ACTIONS/);
  assert.match(source, /comfyui-actions-require-empty-arguments/);
  assert.match(source, /COMFYUI_ACTIONS\.has\(action\)/);
  assert.match(readme, /comfyui\.open/);
});

test("ComfyUI relay remains typed and rejects generic execution", () => {
  assert.doesNotMatch(source, /powershell\.command|shell\.command|execution\.run_request/i);
  assert.match(source, /const longRunning = STORAGE_ACTIONS\.has\(action\) \|\| COMFYUI_ACTIONS\.has\(action\) \|\| VERCEL_ACTIONS\.has\(action\)/);
});

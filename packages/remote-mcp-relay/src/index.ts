// Compatibility entrypoint only. Wrangler deploys src/worker.ts, which is the
// single authoritative relay implementation. Keeping this re-export prevents
// imports from silently reviving a divergent control-plane implementation.
export { WorkstationRelay } from "./worker";
export { default } from "./worker";

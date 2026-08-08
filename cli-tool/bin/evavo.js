#!/usr/bin/env node
/**
 * EVAVO CLI Entry Point
 */

import('../dist/index.js').catch(err => {
  console.error('Failed to load EVAVO CLI:', err);
  process.exit(1);
});

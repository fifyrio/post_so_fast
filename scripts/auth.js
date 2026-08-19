#!/usr/bin/env node
// Standalone OAuth helper: `npm run auth -- <label>`
// Opens the browser (macOS) and waits for the redirect, then saves the token.
import { exec } from 'node:child_process';
import { authorizeAccount } from '../src/tiktok/oauth.js';

const label = process.argv[2];
if (!label) {
  console.error('Usage: npm run auth -- <label>');
  process.exit(1);
}

const { authorizeUrl, done } = authorizeAccount(label);
console.log(`\nAuthorizing account "${label}".`);
console.log(`If the browser does not open, visit:\n${authorizeUrl}\n`);
exec(`open "${authorizeUrl}"`);

try {
  const account = await done;
  console.log(`Done. Saved account "${label}" (open_id ${account.openId}).`);
  process.exit(0);
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
}

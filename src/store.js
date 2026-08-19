import { readFile, writeFile, chmod } from 'node:fs/promises';
import { config } from './config.js';

// Token store shape: { [accountLabel]: { openId, accessToken, refreshToken,
//   accessExpiresAt, refreshExpiresAt, scope } }

async function readStore() {
  try {
    const raw = await readFile(config.tokensFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Failed to read token store: ${error.message}`);
  }
}

async function writeStore(store) {
  const next = JSON.stringify(store, null, 2);
  await writeFile(config.tokensFile, next, 'utf8');
  await chmod(config.tokensFile, 0o600).catch(() => {});
}

export async function listAccounts() {
  const store = await readStore();
  return Object.entries(store).map(([label, account]) => ({
    label,
    openId: account.openId,
    scope: account.scope,
    accessExpiresAt: account.accessExpiresAt,
    refreshExpiresAt: account.refreshExpiresAt,
  }));
}

export async function getAccount(label) {
  const store = await readStore();
  return store[label] ?? null;
}

export async function saveAccount(label, account) {
  const store = await readStore();
  const next = { ...store, [label]: { ...store[label], ...account } };
  await writeStore(next);
  return next[label];
}

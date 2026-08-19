import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { config, assertTikTokConfig } from '../config.js';
import { getAccount, saveAccount } from '../store.js';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const ACCESS_TOKEN_SKEW_MS = 60_000;

function buildAuthorizeUrl(state) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_key', config.tiktok.clientKey);
  url.searchParams.set('scope', config.tiktok.scopes);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.tiktok.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeToken(params) {
  const body = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    ...params,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const message = data.error_description ?? data.error ?? `HTTP ${res.status}`;
    throw new Error(`TikTok token exchange failed: ${message}`);
  }
  return data;
}

function toAccountRecord(data) {
  const now = Date.now();
  return {
    openId: data.open_id,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiresAt: now + data.expires_in * 1000,
    refreshExpiresAt: now + data.refresh_expires_in * 1000,
    scope: data.scope,
  };
}

// Starts a one-shot localhost server and returns { authorizeUrl, done }.
// The caller opens authorizeUrl, then awaits `done` which resolves once the
// redirect arrives, the code is exchanged, and the token is persisted.
export function authorizeAccount(label, { timeoutMs = 300_000 } = {}) {
  assertTikTokConfig();
  const redirect = new URL(config.tiktok.redirectUri);
  const state = randomBytes(16).toString('hex');
  const authorizeUrl = buildAuthorizeUrl(state);

  const done = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      if (reqUrl.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const error = reqUrl.searchParams.get('error');
      const code = reqUrl.searchParams.get('code');
      const returnedState = reqUrl.searchParams.get('state');
      const finish = (status, message) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body><p>${message}</p></body></html>`);
        server.close();
      };
      if (error) {
        finish(400, `Authorization failed: ${error}`);
        reject(new Error(`Authorization failed: ${error}`));
        return;
      }
      if (returnedState !== state) {
        finish(400, 'State mismatch.');
        reject(new Error('OAuth state mismatch'));
        return;
      }
      try {
        const data = await exchangeToken({
          code,
          grant_type: 'authorization_code',
          redirect_uri: config.tiktok.redirectUri,
        });
        const account = await saveAccount(label, toAccountRecord(data));
        finish(200, `Account "${label}" authorized. You can close this tab.`);
        resolve(account);
      } catch (err) {
        finish(500, err.message);
        reject(err);
      }
    });

    server.on('error', reject);
    const port = Number(redirect.port) || 80;
    server.listen(port, () => {
      const timer = setTimeout(() => {
        server.close();
        reject(new Error('Authorization timed out'));
      }, timeoutMs);
      timer.unref?.();
    });
  });

  return { authorizeUrl, done };
}

// Returns a valid access token for `label`, refreshing silently if needed.
export async function getValidAccessToken(label) {
  const account = await getAccount(label);
  if (!account) throw new Error(`No authorized account named "${label}". Run auth first.`);

  if (Date.now() < account.accessExpiresAt - ACCESS_TOKEN_SKEW_MS) {
    return account.accessToken;
  }
  if (Date.now() >= account.refreshExpiresAt) {
    throw new Error(`Refresh token for "${label}" has expired. Re-authorize the account.`);
  }
  const data = await exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
  });
  const refreshed = await saveAccount(label, toAccountRecord(data));
  return refreshed.accessToken;
}

export { buildAuthorizeUrl };

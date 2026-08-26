import 'dotenv/config';
import path from 'node:path';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY ?? '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET ?? '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI ?? 'http://localhost:4477/callback',
    // Local port the callback server listens on. May differ from the redirect
    // URI's port when a tunnel (ngrok/cloudflared) forwards an https URL here.
    callbackPort: Number(process.env.TIKTOK_CALLBACK_PORT) || 4477,
    scopes: process.env.TIKTOK_SCOPES ?? 'video.upload',
    source: (process.env.TIKTOK_SOURCE ?? 'FILE_UPLOAD').toUpperCase(),
  },
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucket: process.env.R2_BUCKET ?? '',
    publicEndpoint: (process.env.R2_PUBLIC_ENDPOINT ?? '').replace(/\/$/, ''),
  },
  tokensFile: process.env.TOKENS_FILE
    ? path.resolve(process.env.TOKENS_FILE)
    : path.resolve(process.cwd(), 'tokens.json'),
};

export function assertTikTokConfig() {
  required('TIKTOK_CLIENT_KEY');
  required('TIKTOK_CLIENT_SECRET');
}

export function assertR2Config() {
  required('R2_ACCOUNT_ID');
  required('R2_ACCESS_KEY_ID');
  required('R2_SECRET_ACCESS_KEY');
  required('R2_BUCKET');
  required('R2_PUBLIC_ENDPOINT');
}

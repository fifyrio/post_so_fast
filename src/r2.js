import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import { config, assertR2Config } from './config.js';

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function r2Client() {
  return new AwsClient({
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
}

// Uploads a local file to R2 and returns { key, url, size, contentType }.
export async function uploadToR2(filePath, { keyPrefix = 'tiktok' } = {}) {
  assertR2Config();
  const body = await readFile(filePath);
  const contentType = contentTypeFor(filePath);
  const key = `${keyPrefix}/${Date.now()}-${path.basename(filePath)}`;
  const endpoint = `https://${config.r2.accountId}.r2.cloudflarestorage.com/${config.r2.bucket}/${encodeURI(key)}`;

  const res = await r2Client().fetch(endpoint, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType, 'Content-Length': String(body.length) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`R2 upload failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  return {
    key,
    url: `${config.r2.publicEndpoint}/${encodeURI(key)}`,
    size: body.length,
    contentType,
  };
}

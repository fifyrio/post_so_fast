#!/usr/bin/env node
// CLI bridge for scripted callers (the tiktok slideshow/video pipeline).
//
// The MCP server (src/index.js) can only be driven from a Claude session. This
// exposes the SAME publish logic — reusing store/oauth/r2/publish verbatim — as
// a plain command line, so a Python pipeline can shell out to it and route its
// output through the official TikTok Content Posting API (inbox/draft flow).
//
// Every subcommand prints one JSON object to stdout and exits 0 on success, or
// prints {"error": "..."} to stderr and exits 1 on failure — easy to parse.
//
// Usage:
//   node scripts/post-cli.js accounts
//   node scripts/post-cli.js video  --account main --file /path/v.mp4 [--source FILE_UPLOAD|PULL_FROM_URL]
//   node scripts/post-cli.js photo  --account main --title "t" --desc "d" --cover 0 --images a.jpg b.jpg
//   node scripts/post-cli.js status --account main --publish-id <id>
import { config } from '../src/config.js';
import { listAccounts } from '../src/store.js';
import { getValidAccessToken } from '../src/tiktok/oauth.js';
import { uploadToR2 } from '../src/r2.js';
import {
  publishFromUrl,
  publishFromFile,
  publishPhotosFromUrls,
  fetchStatus,
} from '../src/tiktok/publish.js';

// Parse `--key value` and `--key val1 val2 ...` (repeated / trailing list) args.
function parseArgs(argv) {
  const args = {};
  let key = null;
  for (const token of argv) {
    if (token.startsWith('--')) {
      key = token.slice(2);
      args[key] = args[key] ?? true;
    } else if (key) {
      const prev = args[key];
      if (prev === true) args[key] = token;
      else if (Array.isArray(prev)) prev.push(token);
      else args[key] = [prev, token];
    }
  }
  return args;
}

function asList(value) {
  if (value === undefined || value === true) return [];
  return Array.isArray(value) ? value : [value];
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function die(message) {
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exit(1);
}

async function cmdAccounts() {
  emit(await listAccounts());
}

async function cmdVideo(args) {
  const account = args.account;
  const file = args.file;
  if (!account || typeof account !== 'string') die('--account is required');
  if (!file || typeof file !== 'string') die('--file is required');
  const mode = (args.source || config.tiktok.source).toUpperCase();

  const accessToken = await getValidAccessToken(account);
  const uploaded = await uploadToR2(file, { keyPrefix: `tiktok/${account}` });
  const result =
    mode === 'PULL_FROM_URL'
      ? await publishFromUrl(accessToken, uploaded.url)
      : await publishFromFile(accessToken, file, uploaded.contentType);

  emit({ account, mediaType: 'VIDEO', mode, r2Url: uploaded.url, publishId: result.publishId });
}

async function cmdPhoto(args) {
  const account = args.account;
  const images = asList(args.images);
  if (!account || typeof account !== 'string') die('--account is required');
  if (images.length === 0) die('--images requires at least one path');
  if (images.length > 35) die('TikTok allows at most 35 images');
  const coverIndex = Number.isInteger(Number(args.cover)) ? Number(args.cover) : 0;

  const accessToken = await getValidAccessToken(account);
  const uploaded = [];
  for (const imagePath of images) {
    uploaded.push(await uploadToR2(imagePath, { keyPrefix: `tiktok/${account}/photos` }));
  }
  const result = await publishPhotosFromUrls(
    accessToken,
    uploaded.map((u) => u.url),
    { title: args.title || '', description: args.desc || '', coverIndex },
  );
  emit({
    account,
    mediaType: 'PHOTO',
    imageCount: uploaded.length,
    r2Urls: uploaded.map((u) => u.url),
    publishId: result.publishId,
  });
}

async function cmdStatus(args) {
  const account = args.account;
  const publishId = args['publish-id'];
  if (!account || typeof account !== 'string') die('--account is required');
  if (!publishId || typeof publishId !== 'string') die('--publish-id is required');
  const accessToken = await getValidAccessToken(account);
  emit(await fetchStatus(accessToken, publishId));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (command) {
    case 'accounts':
      return cmdAccounts();
    case 'video':
      return cmdVideo(args);
    case 'photo':
      return cmdPhoto(args);
    case 'status':
      return cmdStatus(args);
    default:
      die(`Unknown command "${command ?? ''}". Use: accounts | video | photo | status`);
  }
}

main().catch((err) => die(err.message));

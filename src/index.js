#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from './config.js';
import { listAccounts } from './store.js';
import { authorizeAccount, getValidAccessToken } from './tiktok/oauth.js';
import { publishFromUrl, publishFromFile, fetchStatus } from './tiktok/publish.js';
import { uploadToR2 } from './r2.js';

const server = new McpServer({ name: 'post-so-fast', version: '0.1.0' });

const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});
const fail = (message) => ({ content: [{ type: 'text', text: `Error: ${message}` }], isError: true });

server.registerTool(
  'list_accounts',
  {
    title: 'List authorized TikTok accounts',
    description: 'Show which TikTok accounts have been authorized and their token expiry.',
    inputSchema: {},
  },
  async () => text(await listAccounts()),
);

server.registerTool(
  'auth_account',
  {
    title: 'Authorize a TikTok account',
    description:
      'Begin OAuth for one TikTok account. Returns a URL to open in a browser; the local ' +
      'callback server captures the code and saves the token under `label`. Then call list_accounts to confirm.',
    inputSchema: { label: z.string().describe('A name to store this account under, e.g. "main" or "brandA"') },
  },
  async ({ label }) => {
    try {
      const { authorizeUrl, done } = authorizeAccount(label);
      done
        .then(() => console.error(`[auth] account "${label}" authorized`))
        .catch((err) => console.error(`[auth] account "${label}" failed: ${err.message}`));
      return text(
        `Open this URL in a browser and approve access for account "${label}":\n\n${authorizeUrl}\n\n` +
          `Waiting for the redirect to ${config.tiktok.redirectUri}. After approving, run list_accounts to confirm.`,
      );
    } catch (err) {
      return fail(err.message);
    }
  },
);

server.registerTool(
  'post_draft',
  {
    title: 'Upload a video to a TikTok account inbox (draft)',
    description:
      'Upload a local video to R2, then push it to the TikTok inbox for the chosen account. ' +
      'The video appears in the TikTok app notifications for final review and manual publish.',
    inputSchema: {
      account: z.string().describe('Account label previously authorized via auth_account'),
      videoPath: z.string().describe('Absolute path to a local .mp4/.mov/.webm file'),
      source: z
        .enum(['PULL_FROM_URL', 'FILE_UPLOAD'])
        .optional()
        .describe('How TikTok receives the bytes; defaults to TIKTOK_SOURCE env'),
    },
  },
  async ({ account, videoPath, source }) => {
    try {
      const mode = (source ?? config.tiktok.source).toUpperCase();
      const accessToken = await getValidAccessToken(account);
      const uploaded = await uploadToR2(videoPath, { keyPrefix: `tiktok/${account}` });

      const result =
        mode === 'PULL_FROM_URL'
          ? await publishFromUrl(accessToken, uploaded.url)
          : await publishFromFile(accessToken, videoPath, uploaded.contentType);

      return text({
        account,
        mode,
        r2Url: uploaded.url,
        publishId: result.publishId,
        note: 'Open the TikTok app notifications to finish editing and publish.',
      });
    } catch (err) {
      return fail(err.message);
    }
  },
);

server.registerTool(
  'check_status',
  {
    title: 'Check TikTok upload status',
    description: 'Fetch the processing status of a previously started upload by publish_id.',
    inputSchema: {
      account: z.string().describe('Account label used for the upload'),
      publishId: z.string().describe('The publish_id returned by post_draft'),
    },
  },
  async ({ account, publishId }) => {
    try {
      const accessToken = await getValidAccessToken(account);
      return text(await fetchStatus(accessToken, publishId));
    } catch (err) {
      return fail(err.message);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('post-so-fast MCP server running on stdio');
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

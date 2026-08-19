# post-so-fast

An MCP server for pushing local videos to your own TikTok accounts' inbox (the
"draft" flow). It uploads the file to Cloudflare R2, then calls the TikTok
Content Posting API. The video lands in the TikTok app notifications, where you
do the final edit and publish manually — the only path TikTok allows without a
fully audited app.

Built for **personal use across a few of your own accounts** (TikTok sandbox
test users), so no app review is required.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in:
   - TikTok app: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`
     (from developers.tiktok.com — add your accounts as **Target Users** in the
     sandbox, scope `video.upload`).
   - R2 S3 credentials: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
     `R2_BUCKET`, `R2_PUBLIC_ENDPOINT` (R2 → Manage R2 API Tokens → create S3 creds).
3. Authorize each account (opens a browser):
   ```bash
   npm run auth -- main
   npm run auth -- brandA
   ```

## Source modes (`TIKTOK_SOURCE`)

- `FILE_UPLOAD` (default): bytes are PUT straight to TikTok. Always works.
- `PULL_FROM_URL`: TikTok fetches the R2 URL. Faster, but the R2 domain must be
  verified under **URL properties** in the TikTok dev portal (needs a custom
  domain — the shared `*.r2.dev` host generally cannot be verified).

Either way the file is also stored in R2, so you keep a hosted copy.

## Wire into Claude Code

```bash
claude mcp add post-so-fast -- node /Users/shenhongmei/Documents/post_so_fast/src/index.js
```

Then in Claude Code:
- "list my tiktok accounts" → `list_accounts`
- "authorize account main" → `auth_account`
- "post /path/video.mp4 to account main as a draft" → `post_draft`
- "check status <publish_id> for main" → `check_status`

## Tools

| Tool | Purpose |
|------|---------|
| `list_accounts` | Show authorized accounts and token expiry |
| `auth_account` | Start OAuth for one account (returns a URL) |
| `post_draft` | Upload to R2 + push to a TikTok account inbox |
| `check_status` | Poll upload processing status by `publish_id` |

## Notes

- Tokens are stored in `tokens.json` (chmod 600, gitignored). Access tokens
  refresh silently; refresh tokens last ~1 year, then re-run `npm run auth`.
- TikTok sandbox test users only see private uploads — fine for the inbox flow.

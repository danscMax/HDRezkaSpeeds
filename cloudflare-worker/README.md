# Speeds Feedback Worker

Cloudflare Worker that receives feedback POSTs from HDRezkaSpeeds /
VideoSpeeds browser extensions and forwards them to a Telegram bot
(developer's personal inbox).

- Stack: Cloudflare Workers + KV (rate limiter) + Telegram Bot API
- Free tier covers 100 000 requests/day — far above any realistic
  feedback volume
- No domain required, no email-provider verification, no GDPR/regional
  blocks: Telegram works in Russia, Cloudflare Workers work everywhere
  the user runs the extension

## One-time setup (~10 min)

### 1. Create the Telegram bot

1. Open Telegram, search for [`@BotFather`](https://t.me/BotFather).
2. Send `/newbot`, follow the prompts. Pick a name like
   `Speeds Feedback Bot` and a username like `speeds_feedback_bot`.
3. **Save the HTTP API token** (long string starting with digits + `:`).
4. Find your **chat ID**:
   - Open a chat with your new bot, send `/start`.
   - In a browser, open
     `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
     (replace `<YOUR_TOKEN>`).
   - In the JSON response, look for `"chat":{"id":<your-id>}`. Copy the
     numeric id (positive for personal chats, negative for groups).

### 2. Install Wrangler

```bash
cd cloudflare-worker
npm install
npx wrangler login   # opens browser, authorise Cloudflare
```

### 3. Create the rate-limit KV namespace

```bash
npx wrangler kv namespace create RATE_LIMIT
```

It prints an `id`, e.g.

```
🌀 Creating namespace with title "speeds-feedback-RATE_LIMIT"
✨ Success!
Add the following to your wrangler.toml:
[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "abcd1234ef5678"
```

Open `wrangler.toml`, replace `REPLACE_WITH_KV_ID` with that id.

### 4. Set secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# paste the token, press Enter

npx wrangler secret put TELEGRAM_CHAT_ID
# paste the chat id, press Enter
```

### 5. Deploy

```bash
npm run deploy
```

Output ends with the public URL, e.g.

```
https://speeds-feedback.<your-subdomain>.workers.dev
```

**Save this URL** — both extensions will POST to `<URL>/feedback`.

### 6. Smoke test

```bash
curl -X POST https://speeds-feedback.<sub>.workers.dev/feedback \
  -H "Content-Type: application/json" \
  -d '{"app":"hdrezka","message":"hello from curl","rating":"positive"}'
```

You should:
- get `{"ok":true}` from curl
- receive a Telegram message in your bot's chat within ~1 second

## Endpoints

### `POST /feedback`

Body (JSON):

| Field | Type | Required | Description |
|---|---|---|---|
| `app` | `"hdrezka"` \| `"videospeeds"` | yes | Which extension is sending |
| `version` | string | no | Extension version, e.g. `"0.2.0"` |
| `rating` | `"positive"` \| `"neutral"` \| `"negative"` | no | User's mood |
| `message` | string | yes | The feedback text (max 4 KB) |
| `email` | string | no | Reply-to address (validated) |
| `diagnostics` | string | no | JSON-stringified diagnostic report (max 16 KB) |
| `userAgent` | string | no | UA string for context |
| `url` | string | no | Page URL (origin only — content scripts strip the rest) |

Response:
- `200 {"ok": true}` on success
- `400 {"error": "validation_failed", "fields": [...]}` on bad input
- `429 {"error": "rate_limited", "retry_after_minutes": 60}` after 5/hour per IP
- `502 {"error": "send_failed"}` if Telegram returns 4xx/5xx
- `404` for any other path / method

### `GET /health`

Returns plain `ok` for liveness probes.

## Development

```bash
npm run dev          # local server on http://localhost:8787
npm run typecheck    # tsc --noEmit
npm run logs         # tail production logs (wrangler tail)
```

Local dev needs the same secrets — put them in `.dev.vars` (gitignored):

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Operations

- **Rotate bot token**: `npx wrangler secret put TELEGRAM_BOT_TOKEN` and
  re-deploy. KV state survives.
- **Tail logs in real time**: `npm run logs`. The Worker logs Telegram
  errors with HTTP status + body so you can debug delivery problems.
- **Bump rate limit**: change `RATE_LIMIT_PER_HOUR` in `src/index.ts`
  and re-deploy. Existing limits in KV expire on their own.
- **Block an abusive IP**: `npx wrangler kv key put --binding=RATE_LIMIT
  "rl:<ip>" "999"` (sets used to 999 → all further requests get 429).

## License

GPL-3.0-or-later — same as the extensions it serves.

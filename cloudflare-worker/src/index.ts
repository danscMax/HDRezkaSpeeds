/**
 * Speeds Feedback Worker
 *
 * Cloudflare Worker that accepts feedback POSTs from the HDRezkaSpeeds
 * and VideoSpeeds browser extensions and forwards them to a Telegram
 * bot (the developer's personal inbox).
 *
 * Endpoints:
 *   POST /feedback  — submit feedback (rate-limited, payload validated)
 *   GET  /health    — liveness probe ("ok")
 *
 * Secrets (set via `wrangler secret put`):
 *   TELEGRAM_BOT_TOKEN   — token from @BotFather
 *   TELEGRAM_CHAT_ID     — your personal chat ID (get from getUpdates)
 *   IP_HASH_SECRET       — random 32+ byte secret used to HMAC raw IPs
 *                          before they're written to KV as rate-limit
 *                          keys. The Worker never stores or forwards
 *                          plaintext IPs.
 *
 * KV bindings (declared in wrangler.toml):
 *   RATE_LIMIT           — per-IP-hash submission counter, 1-hour TTL
 *
 * Hard limits:
 *   - 5 submissions per IP per hour
 *   - Message body up to 4 KB
 *   - Diagnostics blob up to 16 KB
 *   - Total request body up to 64 KB (Worker hard cap)
 */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  IP_HASH_SECRET: string;
  RATE_LIMIT: KVNamespace;
  ALLOWED_APPS: string; // comma-separated, e.g. "hdrezka,videospeeds"
}

interface FeedbackPayload {
  app: string;
  version?: string;
  rating?: 'positive' | 'neutral' | 'negative';
  message: string;
  /** Free-form contact info (email, @telegram, Discord tag, etc.). */
  contact?: string;
  /** Legacy field name kept for backwards compatibility with older
   *  extension builds; treated identically to `contact` if present. */
  email?: string;
  diagnostics?: string;
  userAgent?: string;
  url?: string;
}

const MAX_MESSAGE = 4_000;
const MAX_DIAGNOSTICS = 16_000;
const RATE_LIMIT_PER_HOUR = 5;
const TELEGRAM_TEXT_LIMIT = 4096;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// Browsers send Origin: chrome-extension://<id> from extension HTML pages
// (popup, options, opened tabs) and content-script fetches in MV3. Firefox
// uses moz-extension://. Anything else is either a non-browser client or
// a malicious page running in a normal web origin — both should be blocked
// at this endpoint.
//
// This check is best-effort: a determined attacker can spoof Origin via
// non-browser tooling. It does, however, kill drive-by abuse from random
// pages on the open web (where browsers will not send a forged Origin).
const ALLOWED_ORIGIN_PROTOCOLS = new Set(['chrome-extension:', 'moz-extension:']);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    return ALLOWED_ORIGIN_PROTOCOLS.has(new URL(origin).protocol);
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return text('ok', 200);
    }

    if (request.method !== 'POST' || url.pathname !== '/feedback') {
      return json({ error: 'not_found' }, 404);
    }

    // Origin allowlist: only accept POSTs from the two extensions that ship
    // this Worker as a dependency. Real users hit the endpoint from the
    // extension's feedback HTML page; everyone else (open-web pages, random
    // bots) gets a hard 403 here before consuming any KV writes or Telegram
    // quota.
    const origin = request.headers.get('Origin');
    if (!isAllowedOrigin(origin)) {
      console.warn('Rejected origin:', origin ?? '<missing>');
      return json({ error: 'forbidden_origin' }, 403);
    }

    // Rate limit by client IP. Cloudflare puts the real visitor IP in
    // CF-Connecting-IP; in worker.dev preview it falls back to a debug
    // value, which is fine for local testing. The IP itself is never
    // persisted — we HMAC it with IP_HASH_SECRET and use the hash as the
    // KV key, so the rate-limit table is unlinkable to a real address.
    const rawIp = (request.headers.get('CF-Connecting-IP') ?? '').trim() || 'unknown-ip';
    const ipHash = await hmacSha256Hex(rawIp, env.IP_HASH_SECRET);
    const rateKey = `rl:${ipHash}`;
    const used = Number((await env.RATE_LIMIT.get(rateKey)) ?? '0');
    if (used >= RATE_LIMIT_PER_HOUR) {
      return json({ error: 'rate_limited', retry_after_minutes: 60 }, 429);
    }

    let payload: FeedbackPayload;
    try {
      payload = (await request.json()) as FeedbackPayload;
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    // Validate fields. Errors return granular keys so the client can map
    // them to localised UI labels.
    const errors = validate(payload, env);
    if (errors.length) {
      return json({ error: 'validation_failed', fields: errors }, 400);
    }

    // Build a Telegram-friendly Markdown message. Keep it under 4096 chars
    // (Telegram's hard limit) by truncating diagnostics first, then message.
    const formatted = formatTelegramMessage(payload);

    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const tgBody = JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: formatted,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    const tgRes = await sendToTelegram(tgUrl, tgBody);

    if (!tgRes.ok) {
      // Don't leak the bot's error verbatim to the extension. Log the
      // detail to the Worker's tail and return a generic failure.
      console.error('Telegram error:', tgRes.status, await tgRes.text().catch(() => ''));
      return json({ error: 'send_failed' }, 502);
    }

    // Bump the rate limit AFTER a successful send so a temporary
    // Telegram outage doesn't burn the user's quota. KV outages here
    // must NOT mask the successful Telegram delivery — if they did, the
    // user would re-submit and Telegram would receive duplicates. The
    // rate-limit counter is best-effort; a missed bump only buys the
    // user one extra submission this hour.
    try {
      await env.RATE_LIMIT.put(rateKey, String(used + 1), { expirationTtl: 3600 });
    } catch (e) {
      console.error('Rate-limit increment failed (Telegram already delivered):', e);
    }

    return json({ ok: true }, 200);
  },
};

// Test seam — helpers and the input-validation pipeline are exposed
// here so unit tests can exercise them without spinning up the worker
// runtime. The shape is `_internals.<name>` to make the boundary
// explicit; production callers never reach in.
export const _internals = {
  isAllowedOrigin,
  validate,
  formatTelegramMessage,
  escapeHtml,
  safeTruncateHtml,
  hmacSha256Hex,
};

// Telegram delivery with bounded wait + 1 retry on transient failure.
//
// Per-call timeout: 6s. With one retry + 500ms backoff the worst case is
// ~12.5s, comfortably inside both Cloudflare's 30s wall-clock and the
// extension's 15s submit-form timeout — that ordering matters: we want the
// Worker to fail FAST so the user gets a real error toast instead of the
// extension's own AbortError fallback.
//
// Retry only on 5xx (Telegram itself errored, transient) or
// network/timeout. 4xx is never retried — the payload was rejected and
// retrying just burns the user's rate-limit quota.
async function sendToTelegram(url: string, body: string, attempt = 0): Promise<Response> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok || res.status < 500 || attempt >= 1) return res;
    // 5xx with retry budget remaining.
    await sleep(500);
    return sendToTelegram(url, body, attempt + 1);
  } catch (e) {
    // AbortError (timeout) or network error.
    if (attempt >= 1) throw e;
    await sleep(500);
    return sendToTelegram(url, body, attempt + 1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validate(p: FeedbackPayload, env: Env): string[] {
  const errors: string[] = [];

  const allowed = (env.ALLOWED_APPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!p.app || !allowed.includes(p.app)) errors.push('app');

  if (typeof p.message !== 'string' || p.message.trim().length === 0) {
    errors.push('message');
  } else if (p.message.length > MAX_MESSAGE) {
    errors.push('message_too_long');
  }

  // Optional string fields. Bound lengths so a payload that slips past
  // the global 64 KB body cap can't smuggle 60 KB of slack through the
  // Telegram-truncate path. Wrong-typed values (number, array, object)
  // would crash `formatTelegramMessage` with a TypeError; reject with
  // a clean 400 instead.
  for (const [field, max] of [
    ['version', 32],
    ['url', 2048],
    ['userAgent', 500],
  ] as const) {
    const v = p[field];
    if (v !== undefined) {
      if (typeof v !== 'string') errors.push(field);
      else if (v.length > max) errors.push(`${field}_too_long`);
    }
  }

  // Contact is free-form text up to 200 chars (email, @telegram-handle,
  // Discord tag, anything the user wants to be reached at). Skip strict
  // email validation — it would reject perfectly valid Telegram/Discord
  // handles. Just bound the length so a Worker request can't be abused.
  // Both `contact` and the legacy `email` field are accepted; reject if
  // either one is wrong-typed.
  for (const field of ['contact', 'email'] as const) {
    const v = p[field];
    if (v !== undefined && typeof v !== 'string') {
      errors.push(field);
    }
  }
  const contactRaw = (p.contact ?? p.email ?? '').toString();
  if (contactRaw.length > 200) {
    errors.push('contact_too_long');
  }

  if (p.rating !== undefined && !['positive', 'neutral', 'negative'].includes(p.rating)) {
    errors.push('rating');
  }

  if (p.diagnostics !== undefined) {
    if (typeof p.diagnostics !== 'string') errors.push('diagnostics');
    else if (p.diagnostics.length > MAX_DIAGNOSTICS) errors.push('diagnostics_too_long');
  }

  return errors;
}

function formatTelegramMessage(p: FeedbackPayload): string {
  const ratingEmoji =
    p.rating === 'positive'
      ? '😊'
      : p.rating === 'negative'
        ? '😞'
        : p.rating === 'neutral'
          ? '😐'
          : '';

  const appLabel = p.app === 'videospeeds' ? 'VideoSpeeds' : 'HDRezkaSpeeds';
  const headerLine = `🔔 <b>${escapeHtml(appLabel)}</b>${p.version ? ` v${escapeHtml(p.version)}` : ''} ${ratingEmoji}`;

  const lines: string[] = [headerLine, ''];

  lines.push(`<b>Message:</b>`);
  lines.push(escapeHtml(p.message.trim()));

  const contactValue = (p.contact ?? p.email ?? '').toString().trim();
  if (contactValue) {
    lines.push('');
    lines.push(`<b>Contact:</b> ${escapeHtml(contactValue)}`);
  }

  if (p.url) {
    lines.push('');
    lines.push(`<b>From:</b> ${escapeHtml(p.url)}`);
  }

  if (p.userAgent) {
    lines.push(`<b>UA:</b> <code>${escapeHtml(p.userAgent.slice(0, 200))}</code>`);
  }

  let body = lines.join('\n');

  if (p.diagnostics) {
    const diagBlock = `\n\n<b>Diagnostics:</b>\n<pre>${escapeHtml(p.diagnostics)}</pre>`;
    if ((body + diagBlock).length <= TELEGRAM_TEXT_LIMIT) {
      body += diagBlock;
    } else {
      // Try truncating diagnostics to fit; leave 200 chars headroom for the
      // truncation marker and any later additions.
      const headroom = TELEGRAM_TEXT_LIMIT - body.length - 200;
      if (headroom > 0) {
        const trunc = p.diagnostics.slice(0, headroom);
        body += `\n\n<b>Diagnostics (truncated):</b>\n<pre>${escapeHtml(trunc)}</pre>\n<i>… diagnostics truncated, full report ${p.diagnostics.length} chars</i>`;
      } else {
        body += `\n\n<i>(Diagnostics omitted: total payload would exceed Telegram's 4 KB limit. ${p.diagnostics.length} chars not sent.)</i>`;
      }
    }
  }

  // Final hard cap — defense in depth in case someone smuggled HTML
  // entities that expanded length unexpectedly.
  return safeTruncateHtml(body, TELEGRAM_TEXT_LIMIT);
}

// Truncate HTML content to `limit` chars without slicing through an entity
// (`&amp;` etc.) or a tag (`<b>` etc.) — Telegram's `parse_mode=HTML`
// rejects the whole message on malformed markup, which would silently drop
// the user's feedback. Walk forward and remember the latest position that
// is NOT inside an unclosed `<…` or `&…;` sequence, then cut there.
function safeTruncateHtml(s: string, limit: number): string {
  if (s.length <= limit) return s;
  let inTag = false;
  let inEntity = false;
  let safeAt = 0;
  // Reserve one char for the ellipsis we append.
  const max = Math.min(s.length, limit - 1);
  for (let i = 0; i < max; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x3c /* < */) {
      inTag = true;
      continue;
    }
    if (c === 0x3e /* > */ && inTag) {
      inTag = false;
      safeAt = i + 1;
      continue;
    }
    if (c === 0x26 /* & */) {
      inEntity = true;
      continue;
    }
    if (c === 0x3b /* ; */ && inEntity) {
      inEntity = false;
      safeAt = i + 1;
      continue;
    }
    if (!inTag && !inEntity) safeAt = i + 1;
  }
  return `${s.slice(0, safeAt)}…`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// HMAC-SHA256 over `input` keyed by `secret`, returned as lowercase hex.
// Used to make rate-limit KV keys unlinkable to plaintext IPs.
async function hmacSha256Hex(input: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(input));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

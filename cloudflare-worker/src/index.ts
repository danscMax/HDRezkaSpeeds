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
 *
 * KV bindings (declared in wrangler.toml):
 *   RATE_LIMIT           — per-IP submission counter, 1-hour TTL
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
  RATE_LIMIT: KVNamespace;
  ALLOWED_APPS: string; // comma-separated, e.g. "hdrezka,videospeeds"
}

interface FeedbackPayload {
  app: string;
  version?: string;
  rating?: 'positive' | 'neutral' | 'negative';
  message: string;
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

    // Rate limit by client IP. Cloudflare puts the real visitor IP in
    // CF-Connecting-IP; in worker.dev preview it falls back to a debug
    // value, which is fine for local testing.
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const rateKey = `rl:${ip}`;
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
    const formatted = formatTelegramMessage(payload, ip);

    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const tgRes = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: formatted,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!tgRes.ok) {
      // Don't leak the bot's error verbatim to the extension. Log the
      // detail to the Worker's tail and return a generic failure.
      console.error('Telegram error:', tgRes.status, await tgRes.text().catch(() => ''));
      return json({ error: 'send_failed' }, 502);
    }

    // Bump the rate limit AFTER a successful send so a temporary
    // Telegram outage doesn't burn the user's quota.
    await env.RATE_LIMIT.put(rateKey, String(used + 1), { expirationTtl: 3600 });

    return json({ ok: true }, 200);
  },
};

function validate(p: FeedbackPayload, env: Env): string[] {
  const errors: string[] = [];

  const allowed = (env.ALLOWED_APPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!p.app || !allowed.includes(p.app)) errors.push('app');

  if (typeof p.message !== 'string' || p.message.trim().length === 0) {
    errors.push('message');
  } else if (p.message.length > MAX_MESSAGE) {
    errors.push('message_too_long');
  }

  if (p.email !== undefined && p.email !== '') {
    if (typeof p.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
      errors.push('email');
    }
  }

  if (p.rating !== undefined && !['positive', 'neutral', 'negative'].includes(p.rating)) {
    errors.push('rating');
  }

  if (p.diagnostics !== undefined && typeof p.diagnostics === 'string' &&
      p.diagnostics.length > MAX_DIAGNOSTICS) {
    errors.push('diagnostics_too_long');
  }

  return errors;
}

function formatTelegramMessage(p: FeedbackPayload, ip: string): string {
  const ratingEmoji =
    p.rating === 'positive' ? '😊' :
    p.rating === 'negative' ? '😞' :
    p.rating === 'neutral'  ? '😐' : '';

  const appLabel = p.app === 'videospeeds' ? 'VideoSpeeds' : 'HDRezkaSpeeds';
  const headerLine = `🔔 <b>${escapeHtml(appLabel)}</b>${p.version ? ` v${escapeHtml(p.version)}` : ''} ${ratingEmoji}`;

  const lines: string[] = [headerLine, ''];

  lines.push(`<b>Message:</b>`);
  lines.push(escapeHtml(p.message.trim()));

  if (p.email) {
    lines.push('');
    lines.push(`<b>Reply to:</b> ${escapeHtml(p.email)}`);
  }

  if (p.url) {
    lines.push('');
    lines.push(`<b>From:</b> ${escapeHtml(p.url)}`);
  }

  if (p.userAgent) {
    lines.push(`<b>UA:</b> <code>${escapeHtml(p.userAgent.slice(0, 200))}</code>`);
  }

  // IP at the bottom for moderation; don't escape HTML — IPs are safe.
  lines.push('');
  lines.push(`<i>IP: ${ip}</i>`);

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
  return body.length > TELEGRAM_TEXT_LIMIT ? body.slice(0, TELEGRAM_TEXT_LIMIT - 3) + '...' : body;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

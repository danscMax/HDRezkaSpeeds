import { describe, expect, it } from 'vitest';
import { _internals } from '../src/index';

const {
  isAllowedOrigin,
  validate,
  formatTelegramMessage,
  escapeHtml,
  safeTruncateHtml,
  hmacSha256Hex,
} = _internals;

const ENV = {
  TELEGRAM_BOT_TOKEN: 'unused-in-pure-tests',
  TELEGRAM_CHAT_ID: 'unused',
  IP_HASH_SECRET: 'test-secret',
  RATE_LIMIT: {} as KVNamespace,
  ALLOWED_APPS: 'hdrezka,videospeeds',
};

describe('isAllowedOrigin', () => {
  it('accepts chrome-extension origins', () => {
    expect(isAllowedOrigin('chrome-extension://abc123def456')).toBe(true);
  });

  it('accepts moz-extension origins', () => {
    expect(isAllowedOrigin('moz-extension://abc-123')).toBe(true);
  });

  it('rejects http and https origins', () => {
    expect(isAllowedOrigin('https://attacker.example')).toBe(false);
    expect(isAllowedOrigin('http://localhost:3000')).toBe(false);
  });

  it('rejects null / empty origin', () => {
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin('')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isAllowedOrigin('not a url')).toBe(false);
  });
});

describe('validate', () => {
  it('passes a minimal valid payload', () => {
    const errors = validate({ app: 'hdrezka', message: 'hello' }, ENV);
    expect(errors).toEqual([]);
  });

  it('rejects unknown app', () => {
    const errors = validate({ app: 'evil-app', message: 'hi' }, ENV);
    expect(errors).toContain('app');
  });

  it('rejects empty / missing message', () => {
    expect(validate({ app: 'hdrezka', message: '' }, ENV)).toContain('message');
    expect(validate({ app: 'hdrezka', message: '   ' }, ENV)).toContain('message');
    // Missing message field entirely
    expect(validate({ app: 'hdrezka' } as never, ENV)).toContain('message');
  });

  it('rejects message over 4000 chars', () => {
    const errors = validate({ app: 'hdrezka', message: 'x'.repeat(4001) }, ENV);
    expect(errors).toContain('message_too_long');
  });

  it('accepts optional fields when valid', () => {
    const errors = validate(
      {
        app: 'hdrezka',
        message: 'hi',
        version: '0.3.6',
        rating: 'positive',
        url: 'https://example.com',
        userAgent: 'Mozilla/5.0',
        contact: 'me@example.com',
        diagnostics: 'log line',
      },
      ENV,
    );
    expect(errors).toEqual([]);
  });

  it('rejects optional string fields when wrong-typed', () => {
    const errors = validate({ app: 'hdrezka', message: 'hi', version: 42 as never }, ENV);
    expect(errors).toContain('version');
  });

  it('rejects unknown rating', () => {
    const errors = validate({ app: 'hdrezka', message: 'hi', rating: 'amazing' as never }, ENV);
    expect(errors).toContain('rating');
  });

  it('caps version length at 32', () => {
    expect(validate({ app: 'hdrezka', message: 'hi', version: 'x'.repeat(33) }, ENV)).toContain(
      'version_too_long',
    );
  });

  it('caps url at 2048', () => {
    expect(
      validate({ app: 'hdrezka', message: 'hi', url: `https://${'x'.repeat(2049)}` }, ENV),
    ).toContain('url_too_long');
  });

  it('caps contact at 200', () => {
    expect(validate({ app: 'hdrezka', message: 'hi', contact: 'x'.repeat(201) }, ENV)).toContain(
      'contact_too_long',
    );
  });

  it('caps diagnostics at 16000', () => {
    expect(
      validate({ app: 'hdrezka', message: 'hi', diagnostics: 'x'.repeat(16001) }, ENV),
    ).toContain('diagnostics_too_long');
  });
});

describe('escapeHtml', () => {
  it('escapes the three HTML special characters', () => {
    expect(escapeHtml('a < b > c & d')).toBe('a &lt; b &gt; c &amp; d');
  });

  it('escapes & first to avoid double-escape', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('passes plain text through', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('safeTruncateHtml', () => {
  it('returns input unchanged when under limit', () => {
    expect(safeTruncateHtml('short', 100)).toBe('short');
  });

  it('truncates plain text on word boundary', () => {
    const out = safeTruncateHtml('a'.repeat(200), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('…')).toBe(true);
  });

  it('does NOT cut mid-tag (<b...)', () => {
    const s = `${'a'.repeat(20)}<b>bold</b>`;
    // Limit ~22 — would land inside `<b>` if naive. safeTruncateHtml
    // walks back to a safe boundary (before <).
    const out = safeTruncateHtml(s, 22);
    expect(out).not.toContain('<b…');
    expect(out).not.toContain('<b>…');
    expect(out.endsWith('…')).toBe(true);
  });

  it('does NOT cut mid-entity (&amp;...)', () => {
    const s = `${'a'.repeat(20)}&amp;rest`;
    const out = safeTruncateHtml(s, 22);
    // Whatever we cut, must not end with a partial &-entity like "&am" or "&amp"
    expect(out).not.toMatch(/&[a-z]+$/i);
    expect(out).not.toMatch(/&[a-z]*…$/i);
  });

  it('does not leave a partially-written tag at the cut point', () => {
    // safeTruncateHtml guarantees no UNCLOSED `<...` is left at the end —
    // it does NOT guarantee balanced pairs (cutting between <b> and </b>
    // is fine, Telegram tolerates it). Test the actual contract.
    const s = '<b>hello</b> '.repeat(20);
    const out = safeTruncateHtml(s, 100);
    // No partial-tag tail ("<b…" or "<…")
    expect(out).not.toMatch(/<[a-z]*…$/i);
    expect(out.endsWith('…')).toBe(true);
  });

  it('keeps complete entities intact', () => {
    const s = '&lt;a&gt; '.repeat(20);
    const out = safeTruncateHtml(s, 50);
    // Every & in output must have a matching ; after it before the cut.
    const lastAmp = out.lastIndexOf('&');
    const lastSemi = out.lastIndexOf(';');
    expect(lastAmp).toBeLessThan(lastSemi);
  });
});

describe('formatTelegramMessage', () => {
  it('renders the basic shape with header + message', () => {
    const out = formatTelegramMessage({
      app: 'hdrezka',
      message: 'hello world',
      version: '0.3.6',
      rating: 'positive',
    });
    expect(out).toContain('HDRezkaSpeeds');
    expect(out).toContain('v0.3.6');
    expect(out).toContain('😊');
    expect(out).toContain('<b>Message:</b>');
    expect(out).toContain('hello world');
  });

  it('escapes HTML in user-supplied fields', () => {
    const out = formatTelegramMessage({
      app: 'hdrezka',
      message: '<script>alert(1)</script>',
    });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('renders contact when present, omits when missing', () => {
    expect(formatTelegramMessage({ app: 'hdrezka', message: 'hi', contact: '@me' })).toContain(
      '<b>Contact:</b> @me',
    );
    expect(formatTelegramMessage({ app: 'hdrezka', message: 'hi' })).not.toContain(
      '<b>Contact:</b>',
    );
  });

  it('truncates oversized diagnostics with explicit notice', () => {
    const big = 'x'.repeat(8000);
    const out = formatTelegramMessage({
      app: 'hdrezka',
      message: 'hi',
      diagnostics: big,
    });
    expect(out).toContain('truncated');
    expect(out.length).toBeLessThanOrEqual(4096);
  });

  it('omits diagnostics entirely when no headroom exists', () => {
    // Headroom = TELEGRAM_TEXT_LIMIT(4096) - body.length - 200. To force
    // headroom <= 0 we need body to consume ≥ 3896 chars before
    // diagnostics are considered. Pump the message to ~3950 so the post-
    // header body crosses the threshold.
    const big = 'x'.repeat(64_000);
    const out = formatTelegramMessage({
      app: 'hdrezka',
      message: 'a'.repeat(3950),
      diagnostics: big,
    });
    expect(out).toContain('Diagnostics omitted');
  });

  it('respects Telegram 4096-char hard cap', () => {
    const out = formatTelegramMessage({
      app: 'hdrezka',
      message: 'x'.repeat(3500),
      diagnostics: 'y'.repeat(20_000),
    });
    expect(out.length).toBeLessThanOrEqual(4096);
  });

  it('renames app for display', () => {
    expect(formatTelegramMessage({ app: 'videospeeds', message: 'hi' })).toContain('VideoSpeeds');
    expect(formatTelegramMessage({ app: 'hdrezka', message: 'hi' })).toContain('HDRezkaSpeeds');
  });

  it('falls back to email field for legacy clients', () => {
    const out = formatTelegramMessage({
      app: 'hdrezka',
      message: 'hi',
      email: 'old@example.com',
    });
    expect(out).toContain('<b>Contact:</b> old@example.com');
  });
});

describe('hmacSha256Hex', () => {
  it('produces a 64-char lowercase hex string', async () => {
    const out = await hmacSha256Hex('input', 'secret');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const a = await hmacSha256Hex('input', 'secret');
    const b = await hmacSha256Hex('input', 'secret');
    expect(a).toBe(b);
  });

  it('changes on different input', async () => {
    const a = await hmacSha256Hex('a', 'secret');
    const b = await hmacSha256Hex('b', 'secret');
    expect(a).not.toBe(b);
  });

  it('changes on different secret', async () => {
    const a = await hmacSha256Hex('input', 'secret-1');
    const b = await hmacSha256Hex('input', 'secret-2');
    expect(a).not.toBe(b);
  });
});

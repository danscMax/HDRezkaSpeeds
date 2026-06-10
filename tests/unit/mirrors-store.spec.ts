import { describe, expect, it } from 'vitest';
import { createMemoryStorageAdapter } from '../../src/storage/adapter';
import {
  addUserMirror,
  MAX_USER_MIRRORS,
  MIRRORS_STORAGE_KEY,
  normalizeMirrorInput,
  readUserMirrors,
  removeUserMirror,
  replaceUserMirrors,
  sanitizeMirrorList,
} from '../../src/storage/mirrors-store';

describe('normalizeMirrorInput', () => {
  it('accepts a bare host', () => {
    expect(normalizeMirrorInput('new-rezka.tv')).toEqual({ ok: true, host: 'new-rezka.tv' });
  });

  it('accepts full URLs with scheme, port, path, query and userinfo', () => {
    expect(normalizeMirrorInput('https://new-rezka.tv/films/1-x.html?y=1')).toEqual({
      ok: true,
      host: 'new-rezka.tv',
    });
    expect(normalizeMirrorInput('http://new-rezka.tv:8080/x')).toEqual({
      ok: true,
      host: 'new-rezka.tv',
    });
    expect(normalizeMirrorInput('https://user:pass@new-rezka.tv/')).toEqual({
      ok: true,
      host: 'new-rezka.tv',
    });
  });

  it('lowercases, strips a leading www. and a trailing FQDN dot', () => {
    expect(normalizeMirrorInput('  WWW.New-Rezka.TV  ')).toEqual({
      ok: true,
      host: 'new-rezka.tv',
    });
    expect(normalizeMirrorInput('new-rezka.tv.')).toEqual({ ok: true, host: 'new-rezka.tv' });
  });

  it('punycodes IDN input (stored/matched as punycode only)', () => {
    const res = normalizeMirrorInput('зеркало.рф');
    expect(res).toEqual({ ok: true, host: 'xn--80ajfngsk.xn--p1ai' });
  });

  it('rejects empty input', () => {
    expect(normalizeMirrorInput('')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeMirrorInput('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects non-web schemes', () => {
    expect(normalizeMirrorInput('chrome://settings')).toEqual({ ok: false, reason: 'scheme' });
    expect(normalizeMirrorInput('moz-extension://abc/x.html')).toEqual({
      ok: false,
      reason: 'scheme',
    });
    expect(normalizeMirrorInput('ftp://mirror.tv')).toEqual({ ok: false, reason: 'scheme' });
  });

  it('rejects IP literals (invalid as *.host match patterns)', () => {
    expect(normalizeMirrorInput('1.2.3.4')).toEqual({ ok: false, reason: 'ip' });
    expect(normalizeMirrorInput('http://192.168.0.1/x')).toEqual({ ok: false, reason: 'ip' });
    expect(normalizeMirrorInput('https://[::1]/')).toEqual({ ok: false, reason: 'ip' });
  });

  it('rejects single-label hosts', () => {
    expect(normalizeMirrorInput('localhost')).toEqual({ ok: false, reason: 'no_dot' });
  });

  it('rejects unparseable or illegal hostnames', () => {
    expect(normalizeMirrorInput('not a domain')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizeMirrorInput('*.mirror.tv')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizeMirrorInput('mirror_underscore.tv')).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(normalizeMirrorInput(`${'a'.repeat(260)}.com`)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('sanitizeMirrorList', () => {
  it('returns [] for non-list shapes', () => {
    expect(sanitizeMirrorList(null)).toEqual([]);
    expect(sanitizeMirrorList('mirror.tv')).toEqual([]);
    expect(sanitizeMirrorList(42)).toEqual([]);
    expect(sanitizeMirrorList({ hosts: 'mirror.tv' })).toEqual([]);
  });

  it('unwraps the storage bag shape', () => {
    expect(sanitizeMirrorList({ hosts: ['new-rezka.tv'] })).toEqual(['new-rezka.tv']);
  });

  it('drops junk entries, builtin-covered hosts, duplicates and covered subdomains', () => {
    expect(
      sanitizeMirrorList([
        123,
        null,
        'hdrezka.ag', // built-in
        'static.hdrezka.ag', // covered by built-in
        'ok-mirror.tv',
        'OK-Mirror.tv', // dup after normalization
        'sub.ok-mirror.tv', // covered by previous entry
        'second.tv',
        'bad host',
      ]),
    ).toEqual(['ok-mirror.tv', 'second.tv']);
  });

  it('caps the list at MAX_USER_MIRRORS', () => {
    const many = Array.from({ length: MAX_USER_MIRRORS + 5 }, (_, i) => `m${i}.example`);
    expect(sanitizeMirrorList(many)).toHaveLength(MAX_USER_MIRRORS);
  });
});

describe('mirrors store CRUD (memory adapter)', () => {
  it('adds, reads and removes a mirror', async () => {
    const adapter = createMemoryStorageAdapter();
    const res = await addUserMirror(adapter, 'https://new-rezka.tv/x');
    expect(res).toEqual({ ok: true, host: 'new-rezka.tv' });
    expect(await readUserMirrors(adapter)).toEqual(['new-rezka.tv']);

    await removeUserMirror(adapter, 'new-rezka.tv');
    expect(await readUserMirrors(adapter)).toEqual([]);
  });

  it('rejects built-in hosts and duplicates with distinct reasons', async () => {
    const adapter = createMemoryStorageAdapter();
    expect(await addUserMirror(adapter, 'standby-rezka.tv')).toEqual({
      ok: false,
      reason: 'builtin',
    });
    expect(await addUserMirror(adapter, 'www.hdrezka.ag')).toEqual({
      ok: false,
      reason: 'builtin',
    });
    await addUserMirror(adapter, 'new-rezka.tv');
    expect(await addUserMirror(adapter, 'new-rezka.tv')).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    expect(await addUserMirror(adapter, 'sub.new-rezka.tv')).toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('enforces the cap', async () => {
    const adapter = createMemoryStorageAdapter({
      [MIRRORS_STORAGE_KEY]: {
        hosts: Array.from({ length: MAX_USER_MIRRORS }, (_, i) => `m${i}.example`),
      },
    });
    expect(await addUserMirror(adapter, 'one-more.example')).toEqual({
      ok: false,
      reason: 'limit',
    });
  });

  it('sanitizes corrupt stored shapes on read', async () => {
    const adapter = createMemoryStorageAdapter({
      [MIRRORS_STORAGE_KEY]: { hosts: ['ok.example', 42, 'hdrezka.ag'] },
    });
    expect(await readUserMirrors(adapter)).toEqual(['ok.example']);
  });

  it('replaceUserMirrors sanitizes and persists', async () => {
    const adapter = createMemoryStorageAdapter();
    const next = await replaceUserMirrors(adapter, ['a.example', 'rezka.ag', 'a.example']);
    expect(next).toEqual(['a.example']);
    expect(await readUserMirrors(adapter)).toEqual(['a.example']);
  });

  it('removing an unknown host is a no-op', async () => {
    const adapter = createMemoryStorageAdapter({
      [MIRRORS_STORAGE_KEY]: { hosts: ['keep.example'] },
    });
    await removeUserMirror(adapter, 'other.example');
    expect(await readUserMirrors(adapter)).toEqual(['keep.example']);
  });
});

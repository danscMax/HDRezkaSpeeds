import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/utils/logger';

describe('createLogger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('routes each level to the correct console method', () => {
    const log = createLogger({ minLevel: 'debug' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(logSpy).toHaveBeenCalledTimes(2); // debug + info
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('drops messages below minLevel', () => {
    const log = createLogger({ minLevel: 'warn' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('setLevel() switches the floor at runtime', () => {
    const log = createLogger({ minLevel: 'error' });
    log.warn('hidden');
    expect(warnSpy).not.toHaveBeenCalled();

    log.setLevel('debug');
    log.warn('shown');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('history() captures recent entries with level + message', () => {
    const log = createLogger({ minLevel: 'debug' });
    log.info('hello');
    log.warn('careful', { extra: 1 });

    const h = log.history();
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ level: 'info', message: 'hello' });
    expect(h[1]).toMatchObject({ level: 'warn', message: 'careful' });
  });

  it('history is bounded by historySize ring', () => {
    const log = createLogger({ minLevel: 'debug', historySize: 3 });
    log.info('1');
    log.info('2');
    log.info('3');
    log.info('4');

    const messages = log.history().map((e) => e.message);
    expect(messages).toEqual(['2', '3', '4']);
  });

  it('history skips dropped messages', () => {
    const log = createLogger({ minLevel: 'warn', historySize: 5 });
    log.debug('hidden');
    log.warn('shown');

    expect(log.history().map((e) => e.message)).toEqual(['shown']);
  });

  it('forwards extra args as console "details"', () => {
    const log = createLogger({ minLevel: 'debug' });
    log.error('boom', { code: 42 }, 'extra');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const callArgs = errorSpy.mock.calls[0]!;
    // call shape: (`%c... boom`, css, { code: 42 }, 'extra')
    expect(callArgs.length).toBeGreaterThanOrEqual(4);
    expect(callArgs[2]).toEqual({ code: 42 });
    expect(callArgs[3]).toBe('extra');
  });
});

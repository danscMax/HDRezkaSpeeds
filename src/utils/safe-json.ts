/**
 * Forgiving JSON.parse. Returns the fallback on null/empty input or any
 * parse error, never throws. Used everywhere we deserialize untrusted
 * page-localStorage / browser.storage values.
 */
export function safeJsonParse<T>(input: string | null | undefined, fallback: T): T {
  if (input == null || input === '') return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

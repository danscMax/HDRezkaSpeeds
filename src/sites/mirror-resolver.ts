/**
 * Order candidate mirror hosts for the popup's "Open HDRezka" action, from
 * freshest to most-generic: the last-known-good host (where the user last
 * watched) first, then their own mirrors, then the shipped built-ins.
 * De-duplicated, host-shape only (no scheme/path). Pure — unit-tested.
 *
 * The caller opens candidates[0] (and, when it holds broad host permission,
 * may probe the list for the first reachable one); a stale entry is harmless
 * because HDRezka's own domains redirect to the live mirror.
 */
export function orderMirrorCandidates(input: {
  lastHost?: string | null;
  userHosts?: readonly string[];
  builtinHosts?: readonly string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (h: string | null | undefined): void => {
    if (!h) return;
    const host = h.trim().toLowerCase();
    if (!host || seen.has(host)) return;
    seen.add(host);
    out.push(host);
  };
  push(input.lastHost);
  for (const h of input.userHosts ?? []) push(h);
  for (const h of input.builtinHosts ?? []) push(h);
  return out;
}

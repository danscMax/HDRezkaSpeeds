/**
 * Tiny programmatic DOM builder. Replaces all string-based HTML construction
 * in the UI layer (audit follow-up to 0.1.34, eliminating the last
 * `Range.createContextualFragment` warnings on AMO).
 *
 * Why this module exists:
 *   - Mozilla's static analyzer (used by AMO automated review) flags every
 *     HTML-parsing API (`innerHTML`, `outerHTML`, `Range.createContextualFragment`,
 *     `document.write`, ...) regardless of whether the input is user-supplied
 *     or a compile-time template.
 *   - Programmatic DOM construction (`createElement` + `appendChild` +
 *     property assignment) is invisible to the analyzer because it never
 *     parses an HTML string.
 *   - Programmatic construction is also faster (no parser pass) and inherently
 *     XSS-safe (no path from user input to innerHTML).
 *
 * The `h()` helper deliberately mirrors the popular hyperscript / preact
 * shape (`h(tag, attrs?, ...children)`) so any future component refactor
 * can switch to a JSX runtime with minimal churn.
 *
 * Usage:
 *   h('div', { class: 'speed-buttons-row' },
 *     h('button', { class: 'speed-button', 'data-vs-speed': 2 }, '2x'),
 *     h('button', { class: 'speed-button', 'data-vs-speed': 3 }, '3x'),
 *   );
 *
 * For SVG, use `svgEl()` (separate function so the namespace gets baked
 * in — `createElementNS('http://www.w3.org/2000/svg', 'circle')` is
 * required for the browser to treat the element as SVG, not HTML).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export type HChild = Node | string | number | boolean | null | undefined;
export type HAttrs = Record<string, string | number | boolean | undefined | null>;

function applyAttrs(el: Element, attrs: HAttrs | undefined): void {
  if (!attrs) return;
  for (const [key, raw] of Object.entries(attrs)) {
    if (raw === false || raw == null) continue;
    const val = raw === true ? '' : String(raw);
    // `class` is the canonical attribute name; `className` is the IDL
    // property. Accept either form so the call sites can match the
    // surrounding HTML literal style without fuss.
    if (key === 'class' || key === 'className') {
      el.setAttribute('class', val);
      continue;
    }
    // Use property setters for IDL-aliased keys where it matters
    // (`textContent`, `value`, `checked`, `disabled`). For everything
    // else (data-*, aria-*, role, and standard HTML attributes), the
    // attribute path is correct.
    if (key === 'textContent') {
      (el as Element & { textContent: string }).textContent = val;
      continue;
    }
    el.setAttribute(key, val);
  }
}

function appendChildren(el: Element, children: readonly HChild[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (c === true) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      el.appendChild(document.createTextNode(String(c)));
    } else {
      el.appendChild(c);
    }
  }
}

/**
 * Build an HTML element with attributes and children.
 *
 * `attrs` may be omitted (first child sits in its place) — `h('div', text)`
 * works the same as `h('div', null, text)`.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  ...args: [HAttrs | HChild, ...HChild[]] | HChild[]
): HTMLElementTagNameMap[K];
export function h(tag: string, ...args: [HAttrs | HChild, ...HChild[]] | HChild[]): HTMLElement;
export function h(tag: string, ...args: unknown[]): HTMLElement {
  const el = document.createElement(tag);
  let attrs: HAttrs | undefined;
  let childArgs: readonly HChild[];
  const first = args[0];
  // Discriminate: a plain object that's not a Node is the attrs map; anything
  // else is a child.
  if (
    first !== null &&
    typeof first === 'object' &&
    !(first instanceof Node) &&
    !Array.isArray(first)
  ) {
    attrs = first as HAttrs;
    childArgs = args.slice(1) as readonly HChild[];
  } else {
    childArgs = args as readonly HChild[];
  }
  applyAttrs(el, attrs);
  appendChildren(el, childArgs);
  return el;
}

/**
 * Build an SVG element. Same shape as `h()`, but elements live in the SVG
 * namespace so attributes like `viewBox` and `stroke-width` paint correctly.
 */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  ...args: [HAttrs | HChild, ...HChild[]] | HChild[]
): SVGElementTagNameMap[K];
export function svgEl(tag: string, ...args: [HAttrs | HChild, ...HChild[]] | HChild[]): SVGElement;
export function svgEl(tag: string, ...args: unknown[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  let attrs: HAttrs | undefined;
  let childArgs: readonly HChild[];
  const first = args[0];
  if (
    first !== null &&
    typeof first === 'object' &&
    !(first instanceof Node) &&
    !Array.isArray(first)
  ) {
    attrs = first as HAttrs;
    childArgs = args.slice(1) as readonly HChild[];
  } else {
    childArgs = args as readonly HChild[];
  }
  applyAttrs(el, attrs);
  appendChildren(el, childArgs);
  return el;
}

/**
 * Build a DocumentFragment from a list of children. Useful when a callsite
 * needs to return "a list of nodes to insert" without an enclosing element.
 */
export function fragment(...children: readonly HChild[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      frag.appendChild(document.createTextNode(String(c)));
    } else {
      frag.appendChild(c);
    }
  }
  return frag;
}

/**
 * Extract Compass's two inline-script state globals from a rendered HTML page.
 *
 * Compass is a fully SSR React app with no canonical `__NEXT_DATA__`
 * blob. Instead, the bootstrap script writes:
 *
 *   - `global.uc = {...}` — the "user context" / app-wide bootstrap
 *     object. On search-results pages this carries
 *     `sharedReactAppProps.initialResults` with the listings array.
 *
 *   - `global.__INITIAL_DATA__ = {props: {...}}` — used by the
 *     homedetails / property-page route. The listing record lives at
 *     `props.listingRelation.listing`.
 *
 * Both are JSON values written into an inline script via JS-literal
 * syntax (i.e. `global.uc = {"key":"value",...};`). We extract them
 * by anchoring on the assignment prefix and walking a balanced brace.
 *
 * Verified live 2026-05-24 against:
 *   - https://www.compass.com/homes-for-sale/new-york-ny/
 *   - https://www.compass.com/homedetails/.../<listingIdSHA>_lid/
 */

/**
 * Walk a balanced `{}` object starting at `start` (which must point to
 * a `{`). Returns the parsed value, or null on imbalance / parse error.
 *
 * Handles strings (with `\"` and `\\` escapes) so that braces inside
 * string literals don't throw off the counter.
 */
export function extractBalancedObject(
  text: string,
  start: number,
): unknown | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++; // skip escaped char
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const blob = text.slice(start, i + 1);
        try {
          return JSON.parse(blob);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Find the first global assignment matching the given name and return
 * the parsed object. Looks for `global.<name> = {…}` and
 * `window.<name> = {…}` (both are common — Compass uses `global.` but
 * client code can rewrite to `window.`).
 *
 * Returns null when the assignment is missing or the object can't be
 * parsed.
 */
export function extractGlobalAssign(
  html: string,
  name: string,
): Record<string, unknown> | null {
  // Match `global.`, `window.`, or `self.` <name> = followed by a `{`.
  // `self.` was added because Compass's homedetails build started writing
  // `self.__INITIAL_DATA__ = …` in some sessions, which the old
  // `global|window`-only anchor missed. Kept to an assignment prefix (not a
  // bare quoted key) so it can't false-match a nested `"uc":{…}` and regress
  // the search path.
  const escaped = name.replace(/[$]/g, "\\$&");
  const re = new RegExp(`(?:global|window|self)\\.${escaped}\\s*=\\s*`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    let after = match.index + match[0].length;
    // Tolerate whitespace between the `=` and the opening brace.
    while (after < html.length && /\s/.test(html[after])) after++;
    if (html[after] !== "{") continue;
    const obj = extractBalancedObject(html, after);
    if (obj && typeof obj === "object") {
      return obj as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * Extract the `uc` global from a Compass page. This is the bootstrap
 * object set on every page (search, homedetails, account, etc.); the
 * useful payload on search pages lives at
 * `uc.sharedReactAppProps.initialResults`.
 */
export function extractUc(html: string): Record<string, unknown> | null {
  return extractGlobalAssign(html, "uc");
}

/**
 * Extract `__INITIAL_DATA__` from a Compass page. Used by the homedetails
 * route. The shape is `{props: {…, listingRelation: {listing: …}}}`.
 */
export function extractInitialData(
  html: string,
): Record<string, unknown> | null {
  return extractGlobalAssign(html, "__INITIAL_DATA__");
}

/**
 * Build a short, safe diagnostic string describing why a homedetails page
 * failed to yield `__INITIAL_DATA__`. Surfaced in the thrown error so a
 * future page-structure change is self-describing instead of opaque —
 * tells us whether the token is present at all (prefix/shape drift) vs.
 * absent entirely (bot challenge / auth wall / different page build).
 */
export function diagnoseDetailHtml(html: string): string {
  const len = html.length;
  const hasToken = html.includes("__INITIAL_DATA__");
  const hasListingRelation = html.includes("listingRelation");
  const titleMatch = /<title[^>]*>([^<]{0,120})<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1].trim() : "(no <title>)";
  const looksBlocked =
    /captcha|unusual activity|access denied|are you a human|verify you are|cf-browser-verification/i.test(
      html,
    );
  let tokenContext = "";
  if (hasToken) {
    const idx = html.indexOf("__INITIAL_DATA__");
    tokenContext = ` nearToken=${JSON.stringify(
      html.slice(Math.max(0, idx - 16), idx + 24),
    )}`;
  }
  return (
    `len=${len} token=${hasToken} listingRelation=${hasListingRelation} ` +
    `challengeLike=${looksBlocked} title=${JSON.stringify(title)}${tokenContext}`
  );
}

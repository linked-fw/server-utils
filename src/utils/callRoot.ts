/**
 * The root URL server calls go to.
 *
 * On the backend (and in a native app, whose page is not served over http) that is `SITE_ROOT`.
 * In a browser showing a page this server rendered, it is the page's own origin, even when
 * `SITE_ROOT` names the same server under another host name (`http://my-machine.local:4000`
 * while the browser is on `http://localhost:4000`). Calls to another host are cross-site: the
 * browser drops the SameSite auth cookies their responses set and never sends them back, so the
 * session lives only in the tab's memory and every page load signs the user out.
 *
 * A page this server rendered carries its request data as `<script id="request-json">` (see
 * components/Html.tsx); a page without it (a frontend served from elsewhere) keeps `SITE_ROOT`.
 */
export const SERVER_RENDERED_MARKER_ID = 'request-json';

export function resolveCallRoot(
  siteRoot: string,
  page: {
    location?: { protocol: string; origin: string };
    document?: { getElementById(id: string): unknown };
  } | null = typeof window !== 'undefined' ? window : null
): string {
  const location = page?.location;
  if (!location || !/^https?:$/.test(location.protocol)) return siteRoot;
  if (!page?.document?.getElementById(SERVER_RENDERED_MARKER_ID)) return siteRoot;
  return location.origin;
}

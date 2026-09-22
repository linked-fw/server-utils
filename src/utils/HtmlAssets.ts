/**
 * Helpers for rendering asset <link> tags in Html.tsx.
 *
 * Release assets can be published under a versioned prefix on a CDN, in which
 * case the hrefs Vite bakes into the manifest are cross-origin relative to the
 * page. Cross-origin subresources need `crossorigin` to behave; same-origin
 * ones must NOT get it, because that would force CORS mode on requests that
 * carry no Access-Control-Allow-Origin.
 */

/**
 * The origin the page itself is served from, as the browser sees it.
 *
 * The express request is the authority (it is the URL the browser asked for),
 * with SITE_ROOT as the fallback for renders that carry no request.
 * Returns undefined when neither is available; callers then assume
 * same-origin, which is the behaviour from before cross-origin releases.
 */
export function getPageOrigin(expressRequest?: any): string | undefined {
  const host =
    expressRequest &&
    (typeof expressRequest.get === 'function'
      ? expressRequest.get('host')
      : expressRequest.headers?.host);
  if (host) {
    const protocol = expressRequest.protocol || 'https';
    return `${protocol}://${host}`;
  }
  return originOf(process.env.SITE_ROOT);
}

function originOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * True only when `href` resolves to an origin other than the page's.
 * Relative hrefs, unparseable hrefs and an unknown page origin all count as
 * same-origin, so nothing changes for apps that serve their own assets.
 */
export function isCrossOrigin(href?: string, pageOrigin?: string): boolean {
  if (!href || !pageOrigin) return false;
  const base = originOf(pageOrigin);
  if (!base) return false;
  let resolved: string | undefined;
  try {
    resolved = new URL(href, base).origin;
  } catch {
    return false;
  }
  return resolved !== base;
}

/**
 * Props to spread onto a <link> for `href`. The preload and the resource it
 * preloads must make the same decision, or the browser fetches twice, so every
 * tag for one href goes through this single helper.
 */
export function crossOriginProps(
  href?: string,
  pageOrigin?: string
): { crossOrigin?: 'anonymous' } {
  return isCrossOrigin(href, pageOrigin) ? { crossOrigin: 'anonymous' } : {};
}

/**
 * The pre-hydration script that reveals the app once its CSS has landed.
 * Kept here (rather than inline in Html.tsx) so its behaviour is testable.
 */
export function cssReadinessScript(routeStylesheets: string[] = []): string {
  return `
                (function() {
                  var routeStylesheets = ${JSON.stringify(routeStylesheets)};

                  function checkMainCssLoaded() {
                    var style = getComputedStyle(document.documentElement);
                    var primaryColor = style.getPropertyValue('--color-primary-600');
                    return primaryColor && primaryColor.trim() !== '';
                  }

                  function checkAllStylesheetsLoaded() {
                    // Check main CSS
                    if (!checkMainCssLoaded()) {
                      return false;
                    }

                    // Check if all route-specific stylesheets are loaded
                    // Extract just the filename from full URLs for comparison
                    var styleSheets = Array.from(document.styleSheets);
                    for (var i = 0; i < routeStylesheets.length; i++) {
                      var routeHref = routeStylesheets[i];
                      // Extract filename (e.g., "signin.css" from full URL)
                      var filename = routeHref.split('/').pop();

                      var found = styleSheets.some(function(sheet) {
                        try {
                          // Check if stylesheet href contains the filename
                          if (sheet.href && sheet.href.indexOf(filename) !== -1) {
                            // Try to access cssRules to verify it's loaded and accessible
                            return sheet.cssRules && sheet.cssRules.length > 0;
                          }
                          return false;
                        } catch (e) {
                          // A cross-origin sheet without CORS locks its CSSOM:
                          // cssRules throws SecurityError. That can never start
                          // succeeding, so waiting on it only stalls the page
                          // until the 2s fallback. Treat it as ready instead.
                          if (e && (e.name === 'SecurityError' || e.code === 18)) {
                            return true;
                          }
                          // Anything else: not loaded yet.
                          return false;
                        }
                      });

                      if (!found) {
                        return false;
                      }
                    }
                    return true;
                  }

                  function showContent() {
                    document.documentElement.classList.add('css-ready');
                  }

                  // Poll until all CSS is loaded
                  var checkInterval = setInterval(function() {
                    if (checkAllStylesheetsLoaded()) {
                      showContent();
                      clearInterval(checkInterval);
                    }
                  }, 16); // ~60fps

                  // Fallback after 2 seconds
                  setTimeout(function() {
                    showContent();
                    clearInterval(checkInterval);
                  }, 2000);
                })();
              `;
}

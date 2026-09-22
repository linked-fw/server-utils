import React from 'react';
import { useAppContext } from './AppContext.js';
import { asset } from '@_linked/core/utils/LinkedFileStorage';
import {
  crossOriginProps,
  cssReadinessScript,
  getPageOrigin,
} from '../utils/HtmlAssets.js';

interface HtmlProps extends React.PropsWithChildren {
  title: string;
  customHead: any;
  style?: React.CSSProperties;
}
export const Html = React.memo<HtmlProps>(
  ({
    //on the frontend data will not be set yet, but it will be present in the initial HTML as a script tag with JSON-LD inside, with the ID: request-ld
    //so here we read that back to the data variable, so that the rendering (of that same <script> tag) will be identical as the backend
    title = process.env.APP_NAME,
    children,
    customHead,
    style,
  }) => {
    let {
      assets,
      requestObject,
      requestLD,
      preloadScripts,
      preloadStyles,
      expressRequest,
    } = useAppContext();

    if (typeof window !== 'undefined') {
      // On the client, do not render <html> or <head>
      return <>{children}</>;
    }

    // Get the matched route key from the request for preloading
    const matchedRouteKey = expressRequest?.['matchedRouteKey'];

    // Release assets can live on another origin (a CDN-hosted release). Those
    // links need crossorigin; same-origin links must not have it.
    const pageOrigin = getPageOrigin(expressRequest);

    // On the server, render the full HTML document
    return (
      <html lang="en">
        <head>
          <title>{title}</title>
          <meta charSet="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
          />
          {/* Preload JavaScript chunks for matched route */}
          {preloadScripts?.map((href) => (
            <link
              key={href}
              rel="modulepreload"
              href={href}
              as="script"
              {...crossOriginProps(href, pageOrigin)}
            />
          ))}
          {/* Preload CSS chunks for matched route */}
          {preloadStyles?.map((href) => (
            <link
              key={href}
              rel="preload"
              href={href}
              as="style"
              {...crossOriginProps(href, pageOrigin)}
            />
          ))}
          {/* Inject route key for client-side preloading */}
          {matchedRouteKey && (
            <script
              dangerouslySetInnerHTML={{
                __html: `window.__PRELOAD_ROUTES__ = ${JSON.stringify([
                  matchedRouteKey,
                ])};`,
              }}
            />
          )}
          <link rel="shortcut icon" href={asset('/favicon.ico')} />
          {/*<!-- Favicon - Browser -- />*/}
          <link
            rel="icon"
            href={asset('/favicon-144x144.png')}
            sizes="144x144"
          />
          <link rel="icon" href={asset('/favicon-72x72.png')} sizes="72x72" />
          <link rel="icon" href={asset('/favicon-57x57.png')} sizes="57x57" />
          {/*<!-- Favicon - Android -- />*/}
          <link
            rel="shortcut icon"
            href={asset('/favicon-144x144.png')}
            sizes="144x144"
          />
          {/*<!-- Favicon - iOS -- >*/}
          <link
            rel="apple-touch-icon"
            href={asset('/favicon-144x144.png')}
            sizes="144x144"
          />
          <link
            rel="apple-touch-icon"
            href={asset('/favicon-72x72.png')}
            sizes="72x72"
          />
          <link
            rel="apple-touch-icon"
            href={asset('/favicon-57x57.png')}
            sizes="57x57"
          />

          <link rel="stylesheet" href={assets['main.css']} />
          {/* Load route-specific CSS stylesheets */}
          {preloadStyles?.map((href) => (
            <link
              key={href}
              rel="stylesheet"
              href={href}
              {...crossOriginProps(href, pageOrigin)}
            />
          ))}

          {/* Inline the SSR-collected CSS so the page is fully styled at
              first paint. In Vite dev mode `main.css` is not a real build
              artifact and theme/component CSS is otherwise injected by
              Vite's runtime only after hydration, which caused a flash of
              partially-styled content on hard refresh. This inline block
              closes that gap (and makes the css-ready gate lift instantly).
              In production this is empty — the static main.css handles it. */}
          {assets['__viteSsrCss'] ? (
            <style
              id="ssr-css"
              dangerouslySetInnerHTML={{ __html: assets['__viteSsrCss'] }}
            />
          ) : null}

          {/* Inline styles for FOUC prevention - show loader until CSS loads */}
          <style
            dangerouslySetInnerHTML={{
              __html: `
                .app-loading {
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                }
                .app-root {
                  display: none;
                  animation: fadeIn 0.15s ease-in;
                }
                html.css-ready .app-root {
                  display: block;
                }
                html.css-ready .app-loading {
                  display: none;
                }
                @keyframes fadeIn {
                  from { opacity: 0; }
                  to { opacity: 1; }
                }
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `,
            }}
          />

          {/* Pre-hydration CSS detection script - runs before React loads */}
          <script
            dangerouslySetInnerHTML={{
              __html: cssReadinessScript(preloadStyles || []),
            }}
          />

          {/*App specific headers*/}
          {customHead}

          {/*Linked data insertion on first page request*/}
          <script
            id="request-ld"
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: requestLD }}
          />
          <script
            id="request-json"
            type="application/json"
            dangerouslySetInnerHTML={{ __html: requestObject }}
          />
        </head>
        <body style={{ margin: 0, padding: 0, ...style }}>
          <noscript
            dangerouslySetInnerHTML={{
              __html: `<b>Enable JavaScript to run this app.</b>`,
            }}
          />
          <div id="root">{children}</div>
          <script
            dangerouslySetInnerHTML={{
              __html: `assetManifest = ${JSON.stringify(assets)};`,
            }}
          />
        </body>
      </html>
    );
  }
);

Html.displayName = 'Html';

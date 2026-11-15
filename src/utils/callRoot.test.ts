import { resolveCallRoot } from './callRoot';

const rendered = { getElementById: (id: string) => (id === 'request-json' ? {} : null) };
const notRendered = { getElementById: () => null };

describe('resolveCallRoot', () => {
  it('is SITE_ROOT outside a browser', () => {
    expect(resolveCallRoot('http://my-machine.local:4000', null)).toBe('http://my-machine.local:4000');
  });

  it("is the page's origin on a page this server rendered under another host name", () => {
    const page = {
      location: { protocol: 'http:', origin: 'http://localhost:4000' },
      document: rendered,
    };
    expect(resolveCallRoot('http://my-machine.local:4000', page)).toBe('http://localhost:4000');
  });

  it('is SITE_ROOT on a page served from elsewhere', () => {
    const page = {
      location: { protocol: 'https:', origin: 'https://frontend.example.org' },
      document: notRendered,
    };
    expect(resolveCallRoot('https://api.example.org', page)).toBe('https://api.example.org');
  });

  it('is SITE_ROOT in a native app', () => {
    const page = {
      location: { protocol: 'capacitor:', origin: 'capacitor://localhost' },
      document: rendered,
    };
    expect(resolveCallRoot('https://api.example.org', page)).toBe('https://api.example.org');
  });
});

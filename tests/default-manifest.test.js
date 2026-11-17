'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Exercise the real index.js routing without network access or npm packages.
function fixture(savedConfigs, legacy = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyfin-default-manifest-'));
  const configFile = path.join(base, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ ...legacy, savedConfigs }));
  const routes = { get: new Map(), delete: new Map(), use: [] };
  const app = {
    get(p, fn) { routes.get.set(p, fn); },
    post() {}, put() {},
    delete(p, ...handlers) { routes.delete.set(p, handlers); },
    use(...args) { routes.use.push(args); },
    listen() {},
  };
  class FakeBuilder {
    constructor(manifest) { this.manifest = manifest; }
    defineCatalogHandler() {}
    defineMetaHandler() {}
    defineStreamHandler() {}
    getInterface() { return this; }
  }
  class FakeJellyfinClient {
    constructor({ baseUrl, apiKey }) { this.baseUrl = baseUrl; this.apiKey = apiKey; }
    resolveUser() { return Promise.resolve({}); }
    ping() { return Promise.resolve('test'); }
  }
  const filename = path.join(__dirname, '..', 'index.js');
  const originalRequire = createRequire(filename);
  const requireMock = (name) => {
    if (name === 'express') return Object.assign(() => app, { json: () => () => {} });
    if (name === 'stremio-addon-sdk') return {
      addonBuilder: FakeBuilder,
      getRouter: (addon) => (req, res) => res.json({ routedTo: addon.manifest.name, path: req.path }),
    };
    if (name === './src/jellyfin') return { JellyfinClient: FakeJellyfinClient };
    return originalRequire(name);
  };
  const context = {
    require: requireMock,
    module: { exports: {} },
    __dirname: path.dirname(filename),
    process: { env: { CONFIG_PATH: configFile, MANAGE_KEY: '' } },
    Buffer, URLSearchParams, console,
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  function response() {
    return {
      headers: {}, statusCode: 200,
      setHeader(name, value) { this.headers[name] = value; },
      getHeader(name) { return this.headers[name]; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
  }
  const manifest = () => {
    const res = response();
    routes.get.get('/manifest.json')({ path: '/manifest.json' }, res);
    return res;
  };
  // Call only the root Stremio resource middleware, identified by forwarding.
  const resource = (requestPath) => {
    const res = response();
    const req = { path: requestPath };
    for (const args of routes.use) {
      if (args.length !== 1 || typeof args[0] !== 'function') continue;
      args[0](req, res, () => {});
      if (res.payload !== undefined) break;
    }
    return res;
  };
  const remove = (token) => {
    const handlers = routes.delete.get('/api/configs/:token');
    const res = response();
    handlers[handlers.length - 1]({ params: { token } }, res);
    return res;
  };
  return {
    manifest, resource, remove,
    readConfig() { return JSON.parse(fs.readFileSync(configFile, 'utf8')); },
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

const alpha = { name: 'Alpha', jellyfinUrl: 'https://jellyfin-alpha.example', jellyfinApiKey: 'private-alpha-key' };
const beta = { name: 'Beta', jellyfinUrl: 'https://jellyfin-beta.example', jellyfinApiKey: 'private-beta-key' };

const tokenFor = (config) => Buffer.from(JSON.stringify({ jellyfinUrl: config.jellyfinUrl, jellyfinApiKey: config.jellyfinApiKey })).toString('base64url');

test('root manifest always uses the first saved config, not a configure prompt', (t) => {
  const f = fixture([alpha, beta]);
  t.after(f.cleanup);
  const res = f.manifest();
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.name, 'Jellyfin: Alpha');
  assert.equal(res.payload.behaviorHints.configurable, false);
  assert.equal(res.payload.config.length, 0);
  assert.doesNotMatch(JSON.stringify(res.payload), /private-alpha-key/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('default catalog/meta/stream routes forward to the same first saved config', (t) => {
  const f = fixture([alpha, beta]);
  t.after(f.cleanup);
  for (const p of ['/catalog/movie/jfmovies.json', '/meta/movie/tt123.json', '/stream/movie/tt123.json']) {
    const res = f.resource(p);
    assert.equal(res.payload.routedTo, 'Jellyfin: Alpha', p);
    assert.equal(res.payload.path, p);
  }
});

test('removing first config switches root manifest and resources to next saved config', (t) => {
  const f = fixture([alpha, beta]);
  t.after(f.cleanup);
  assert.equal(f.remove(tokenFor(alpha)).payload.ok, true);
  assert.equal(f.manifest().payload.name, 'Jellyfin: Beta');
  assert.equal(f.resource('/catalog/movie/jfmovies.json').payload.routedTo, 'Jellyfin: Beta');
});

test('no saved config returns helpful JSON error instead of an HTML page', (t) => {
  const f = fixture([]);
  t.after(f.cleanup);
  const manifest = f.manifest();
  assert.equal(manifest.statusCode, 503);
  assert.match(manifest.payload.error, /Add one at \/manage/);
  const stream = f.resource('/stream/movie/tt123.json');
  assert.equal(stream.statusCode, 503);
  assert.match(stream.payload.error, /No default Jellyfin setup/);
});

test('legacy fields do not override savedConfigs, and deleted default stays deleted after saving', (t) => {
  const legacy = {
    jellyfinUrl: 'https://old-jellyfin.example', jellyfinApiKey: 'old-key',
    instances: [{ id: 'old', name: 'Old server', jellyfinUrl: 'https://old-jellyfin.example', jellyfinApiKey: 'old-key' }],
  };
  const f = fixture([alpha, beta], legacy);
  t.after(f.cleanup);
  assert.equal(f.manifest().payload.name, 'Jellyfin: Alpha');
  f.remove(tokenFor(alpha));
  const next = f.readConfig();
  assert.equal(next.savedConfigs.length, 1);
  assert.equal(next.savedConfigs[0].name, 'Beta');
  assert.equal(next.jellyfinUrl, undefined);
  assert.equal(next.jellyfinApiKey, undefined);
  const restarted = fixture(next.savedConfigs, { instances: next.instances });
  t.after(restarted.cleanup);
  assert.equal(restarted.manifest().payload.name, 'Jellyfin: Beta');
});

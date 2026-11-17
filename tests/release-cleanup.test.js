'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run the real application routing and persistence code with isolated stubs.
function fixture(savedConfigs = [], extraEnv = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-jellyfin-release-'));
  const configPath = path.join(folder, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ savedConfigs }));
  const routes = { get: new Map(), put: new Map(), post: new Map(), delete: new Map(), use: [] };
  const app = {
    get(p, ...handlers) { routes.get.set(p, handlers); },
    put(p, ...handlers) { routes.put.set(p, handlers); },
    post(p, ...handlers) { routes.post.set(p, handlers); },
    delete(p, ...handlers) { routes.delete.set(p, handlers); },
    use(...args) { routes.use.push(args); },
    listen() {},
  };
  class Builder {
    constructor(manifest) { this.manifest = manifest; }
    defineCatalogHandler() {}
    defineMetaHandler() {}
    defineStreamHandler() {}
    getInterface() { return this; }
  }
  class FakeJellyfinClient {
    constructor({ baseUrl, apiKey }) { this.baseUrl = baseUrl; this.apiKey = apiKey; }
    resolveUser() { return Promise.resolve(null); }
    ping() { return Promise.resolve('test'); }
  }
  const filename = path.join(__dirname, '..', 'index.js');
  const originalRequire = createRequire(filename);
  const customRequire = (name) => {
    if (name === 'express') return Object.assign(() => app, { json: () => () => {} });
    if (name === 'stremio-addon-sdk') return { addonBuilder: Builder, getRouter: () => () => {} };
    if (name === './src/jellyfin') return { JellyfinClient: FakeJellyfinClient };
    return originalRequire(name);
  };
  const context = {
    require: customRequire, module: { exports: {} }, __dirname: path.dirname(filename),
    process: { env: { CONFIG_PATH: configPath, MANAGE_KEY: '', ...extraEnv } },
    Buffer, URLSearchParams, console,
  };
  try {
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  } catch (error) {
    fs.rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  function response() {
    return {
      code: 200, headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      getHeader(key) { return this.headers[key]; },
      status(code) { this.code = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
  }
  async function invoke(method, route, req = {}) {
    const handlers = routes[method].get(route);
    assert.ok(handlers, `Route not registered: ${method} ${route}`);
    const res = response();
    await handlers.at(-1)({ headers: {}, path: route, params: {}, ...req }, res);
    return res;
  }
  return {
    invoke, routes, response,
    readConfig() { return JSON.parse(fs.readFileSync(configPath, 'utf8')); },
    cleanup() { fs.rmSync(folder, { recursive: true, force: true }); },
  };
}

const alpha = { name: 'Alpha', jellyfinUrl: 'https://alpha.example.com', jellyfinApiKey: 'test-alpha-key' };
const tokenFor = ({ jellyfinUrl, jellyfinApiKey }) => Buffer.from(JSON.stringify({ jellyfinUrl, jellyfinApiKey })).toString('base64url');

test('public manifest does not leak the upstream server URL or API key', async (t) => {
  const f = fixture([alpha]); t.after(f.cleanup);
  const res = await f.invoke('get', '/manifest.json');
  const serialized = JSON.stringify(res.payload);
  assert.equal(res.code, 200);
  assert.doesNotMatch(serialized, /alpha\.example\.com|test-alpha-key/);
  assert.match(res.payload.id, /^community\.stremio-jellyfin\./);
  assert.equal(res.payload.behaviorHints.configurable, false);
  assert.equal(res.payload.config.length, 0);
  assert.deepEqual(Array.from(res.payload.catalogs[0].extra).map((x) => x.name), ['search', 'skip', 'genre']);
});

test('editing a saved setup retains a blank API key and persists the change', async (t) => {
  const f = fixture([alpha]); t.after(f.cleanup);
  const req = { params: { token: tokenFor(alpha) }, body: { name: 'Renamed', jellyfinUrl: alpha.jellyfinUrl, jellyfinApiKey: '' } };
  const res = await f.invoke('put', '/api/configs/:token', req);
  assert.equal(res.code, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(f.readConfig().savedConfigs[0].name, 'Renamed');
  assert.equal(f.readConfig().savedConfigs[0].jellyfinApiKey, alpha.jellyfinApiKey);
  const manifest = await f.invoke('get', '/manifest.json');
  assert.equal(manifest.payload.name, 'Jellyfin: Renamed');
});

test('environment setup becomes default and is not written to saved config', async (t) => {
  const f = fixture([alpha], { JELLYFIN_URL: 'https://bootstrap.example.com/', JELLYFIN_API_KEY: 'test-bootstrap-key' });
  t.after(f.cleanup);
  const manifest = await f.invoke('get', '/manifest.json');
  assert.equal(manifest.payload.name, 'Jellyfin: Environment setup');
  const status = await f.invoke('get', '/api/status');
  assert.equal(status.payload.configs.length, 2);
  assert.equal(status.payload.configs[0].envManaged, true);
  const rejected = await f.invoke('delete', '/api/configs/:token', { params: { token: status.payload.configs[0].token } });
  assert.equal(rejected.code, 409);
  const res = await f.invoke('post', '/api/configs', { body: { name: 'Another', jellyfinUrl: 'https://new.example.com', jellyfinApiKey: 'test-new-key' } });
  assert.equal(res.code, 200);
  const persisted = JSON.stringify(f.readConfig());
  assert.match(persisted, /Another/);
  assert.doesNotMatch(persisted, /bootstrap\.example\.com|test-bootstrap-key/);
});

test('visitors are not registered in manage or health status', async (t) => {
  const f = fixture([alpha]); t.after(f.cleanup);
  const visitor = { jellyfinUrl: 'https://visitor.example.com', jellyfinApiKey: 'test-visitor-key' };
  const handler = f.routes.use.find((args) => args.length === 2 && args[0] === '/:token')[1];
  handler({ params: { token: tokenFor(visitor) } }, f.response(), () => {});
  const list = await f.invoke('get', '/api/status');
  assert.equal(list.payload.configs.length, 1);
  const health = await f.invoke('get', '/health');
  assert.equal(health.payload.configured, 1);
  assert.doesNotMatch(JSON.stringify(health.payload), /visitor|test-visitor|eyJ/);
});

test('manage session cookie is marked Secure behind HTTPS reverse proxy', async (t) => {
  const f = fixture([alpha], { MANAGE_KEY: 'test-strong-manage-key' }); t.after(f.cleanup);
  const res = await f.invoke('post', '/api/login', {
    body: { key: 'test-strong-manage-key' }, headers: { 'x-forwarded-proto': 'https' },
  });
  assert.equal(res.code, 200);
  assert.match(res.headers['Set-Cookie'], /; Secure/);
  assert.match(res.headers['Set-Cookie'], /; HttpOnly/);
});

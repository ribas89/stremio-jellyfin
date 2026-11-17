'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { JellyfinClient } = require('../src/jellyfin');

// Exercise the real stream handler with lightweight Express/SDK stand-ins,
// so this test does not require npm modules or an actual Jellyfin server.
function buildTestAddon(streamMode) {
  const file = path.join(__dirname, '..', 'index.js');
  const originalRequire = createRequire(file);
  const router = { get() {}, post() {}, put() {}, delete() {}, use() {}, listen() {} };
  const addons = [];
  class Builder {
    constructor(manifest) { this.manifest = manifest; this.handlers = {}; addons.push(this); }
    defineCatalogHandler(fn) { this.handlers.catalog = fn; }
    defineMetaHandler(fn) { this.handlers.meta = fn; }
    defineStreamHandler(fn) { this.handlers.stream = fn; }
    getInterface() { return this; }
  }
  const customRequire = (name) => {
    if (name === 'express') return Object.assign(() => router, { json: () => () => {} });
    if (name === 'stremio-addon-sdk') return { addonBuilder: Builder, getRouter: () => () => {} };
    if (name === './src/jellyfin') return { JellyfinClient };
    return originalRequire(name);
  };
  const source = fs.readFileSync(file, 'utf8').replace(
    "const STREAM_MODE = fileConfig.streamMode || 'direct';",
    `const STREAM_MODE = '${streamMode}';`,
  );
  const context = {
    require: customRequire,
    module: { exports: {} },
    __dirname: path.dirname(file),
    process: { env: {} },
    Buffer, URLSearchParams, console,
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(source + '\nmodule.exports.buildAddon = buildAddon;', context, { filename: file });
  context.module.exports.buildAddon({ jellyfinUrl: 'https://jellyfin.example', jellyfinApiKey: 'a-key', name: 'Library', token: 'abc', stubId: 'stub' });
  return addons[0];
}

const originalResolve = JellyfinClient.prototype.resolveItem;
test.after(() => { JellyfinClient.prototype.resolveItem = originalResolve; });
const item = {
  Id: 'abc', Name: 'Example', Type: 'Movie', RunTimeTicks: 9000000000,
  MediaSources: [{ Id: 'ms-1', Container: 'mkv', Size: 1000000,
    Path: '/media/files/Example.mkv', MediaStreams: [{ Type: 'Video', Height: 1080, Codec: 'h264' }] }],
};

test('Stremio addon advertises a seekable original file and metadata', async () => {
  JellyfinClient.prototype.resolveItem = async () => item;
  const addon = buildTestAddon('direct');
  const result = await addon.handlers.stream({ id: item.Id, type: 'movie' });
  assert.equal(result.streams.length, 2);
  const stream = result.streams[0];
  assert.match(stream.url, /\/Videos\/abc\/stream\.mkv\?/);
  assert.equal(new URL(stream.url).searchParams.get('Static'), 'true');
  assert.equal(stream.behaviorHints.videoSize, 1000000);
  assert.equal(stream.behaviorHints.filename, 'Example.mkv');
  assert.equal(stream.behaviorHints.notWebReady, true);
  const compat = result.streams[1];
  assert.equal(compat.name, 'Jellyfin desktop compatibility');
  assert.match(compat.url, /\/Videos\/abc\/stream\?/);
  assert.equal(new URL(compat.url).searchParams.get('Static'), 'true');
  assert.equal(compat.behaviorHints.notWebReady, undefined);
  assert.equal(compat.behaviorHints.filename, 'Example.mkv');
});

test('Auto mode keeps seekable original first, with optional transcoding second', async () => {
  JellyfinClient.prototype.resolveItem = async () => item;
  const addon = buildTestAddon('auto');
  const result = await addon.handlers.stream({ id: item.Id, type: 'movie' });
  assert.equal(result.streams.length, 3);
  assert.equal(new URL(result.streams[0].url).searchParams.get('Static'), 'true');
  assert.equal(new URL(result.streams[1].url).searchParams.get('Static'), 'true');
  assert.equal(new URL(result.streams[2].url).searchParams.get('Static'), 'false');
  assert.equal(result.streams[2].name, 'Jellyfin fallback');
});

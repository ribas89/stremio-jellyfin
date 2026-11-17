'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JellyfinClient } = require('../src/jellyfin');

const client = (streamMode = 'direct') => new JellyfinClient({
  baseUrl: 'https://media.example.org/',
  apiKey: 'private-token',
  streamMode,
});

test('MP4 direct playback identifies source and is static / seekable', () => {
  const url = new URL(client().streamUrl('abc123', { Id: 'media-version', Container: 'mp4' }));
  assert.equal(url.pathname, '/Videos/abc123/stream.mp4');
  assert.equal(url.searchParams.get('Static'), 'true');
  assert.equal(url.searchParams.get('MediaSourceId'), 'media-version');
  assert.equal(url.searchParams.get('ApiKey'), 'private-token');
});

test('Matroska direct playback preserves original container instead of inventing MP4', () => {
  const url = new URL(client().streamUrl('abc123', { Id: 'media-version', Container: 'mkv' }));
  assert.equal(url.pathname, '/Videos/abc123/stream.mkv');
  assert.equal(url.searchParams.get('Static'), 'true');
});

test('Aliases and unknown containers fall back safely', () => {
  const c = client();
  assert.match(c.streamUrl('abc', { Container: 'matroska' }), /\/stream\.mkv\?/);
  assert.match(c.streamUrl('abc', { Container: '../bad' }), /\/stream\?/);
  assert.match(c.streamUrl('abc', {}), /\/stream\?/);
});

test('Auto mode still produces a seekable original first', () => {
  const c = client('auto');
  const direct = new URL(c.streamUrl('abc', { Container: 'mp4' }));
  const fallback = new URL(c.streamUrl('abc', { Container: 'mp4' }, { transcode: true }));
  assert.equal(direct.pathname, '/Videos/abc/stream.mp4');
  assert.equal(direct.searchParams.get('Static'), 'true');
  assert.equal(fallback.pathname, '/Videos/abc/stream');
  assert.equal(fallback.searchParams.get('Static'), 'false');
});

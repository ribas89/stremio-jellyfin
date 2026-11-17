'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JellyfinClient } = require('../src/jellyfin');
const { Response } = globalThis;
const realFetch = globalThis.fetch;
const client = () => new JellyfinClient({ baseUrl: 'https://jf.example.com', apiKey: 'secret' });

test('Jellyfin get returns valid JSON', async () => {
  globalThis.fetch = async () => new Response('{"Items":[]}', { headers: {'Content-Type':'application/json'} });
  try { assert.deepEqual(await client().get('/Items'), { Items: [] }); }
  finally { globalThis.fetch = realFetch; }
});

test('HTML with HTTP 200 produces actionable diagnostic instead of Unexpected token', async () => {
  globalThis.fetch = async () => new Response('<!DOCTYPE html><html><head><title>Login</title></head></html>', {
    status: 200, headers: {'Content-Type':'text/html'}
  });
  try {
    await assert.rejects(client().get('/Items'), err => {
      assert.match(err.message, /HTML instead of JSON/);
      assert.match(err.message, /Login/);
      assert.doesNotMatch(err.message, /secret/);
      return true;
    });
  } finally { globalThis.fetch = realFetch; }
});

test('401 errors identify authorization issue without leaking token', async () => {
  globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
  try { await assert.rejects(client().get('/Items'), /HTTP 401/); }
  finally { globalThis.fetch = realFetch; }
});

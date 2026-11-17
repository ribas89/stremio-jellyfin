'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the browser's actual public link generator without launching a browser.
test('public configure page emits the same base64url credential token as the server', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'configure.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const inputs = {
    url: { value: 'https://example.com/jellyfin/' },
    key: { value: 'sample-api-key' },
  };
  let onSubmit;
  const btn = { disabled: false, textContent: '' };
  const result = {
    className: '', innerHTML: '', style: {},
    querySelector: () => ({ addEventListener() {} }),
  };
  const elements = {
    ...inputs, result,
    form: { addEventListener(name, callback) { if (name === 'submit') onSubmit = callback; } },
  };
  const context = {
    document: { getElementById: (id) => elements[id] },
    fetch: async () => ({ json: async () => ({ ok: true, version: 'test' }) }),
    location: { origin: 'https://addon.example.com' },
    navigator: { clipboard: { writeText() {} } },
    TextEncoder,
    btoa: (binary) => Buffer.from(binary, 'binary').toString('base64'),
    setTimeout,
  };
  vm.runInNewContext(scripts[0][1], context);
  assert.equal(typeof onSubmit, 'function');
  await onSubmit({ preventDefault() {}, target: { querySelector: () => btn } });
  const link = result.innerHTML.match(/https:\/\/addon\.example\.com\/([a-zA-Z0-9_-]+)\/manifest\.json/);
  assert.ok(link, result.innerHTML);
  const token = link[1];
  assert.deepEqual(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')), {
    jellyfinUrl: 'https://example.com/jellyfin', jellyfinApiKey: 'sample-api-key',
  });
  assert.ok(!result.innerHTML.includes('sample-api-key'));
});

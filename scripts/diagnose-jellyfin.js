'use strict';
// Run inside the same container/network as the addon. Does not print API keys.
const fs = require('fs');
const path = require('path');
const { JellyfinClient } = require('../src/jellyfin');
const configPath = process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.json');
let conf = {};
try { conf = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
catch (err) { console.log('Config file not readable:', err.message); }
const saved = Array.isArray(conf.savedConfigs) ? conf.savedConfigs : [];
const instances = Array.isArray(conf.instances) ? conf.instances : [];
const chosen = saved[0] || instances[0] || conf;
const baseUrl = process.env.JELLYFIN_URL || chosen.jellyfinUrl;
const apiKey = process.env.JELLYFIN_API_KEY || chosen.jellyfinApiKey;
if (!baseUrl || !apiKey) {
  console.error('No Jellyfin configuration found. Set CONFIG_PATH or JELLYFIN_URL and JELLYFIN_API_KEY.');
  process.exitCode = 2;
} else {
  const jf = new JellyfinClient({ baseUrl, apiKey });
  console.log('Testing Jellyfin connectivity from the addon container (no secrets shown).');
  console.log('Server host:', new URL(jf.baseUrl).host);
  const checks = [
    ['/System/Info/Public', () => jf.get('/System/Info/Public')],
    ['/System/Info', () => jf.get('/System/Info')],
    ['/Users', () => jf.get('/Users')],
    ['/Items (library lookup)', async () => {
      await jf.ensureUser();
      return jf.get(jf.itemsPath(), {
        Recursive: 'true', IncludeItemTypes: 'Movie,Series', Fields: 'ProviderIds',
        StartIndex: '0', Limit: '1'
      });
    }],
  ];
  (async () => {
    for (const [label, fn] of checks) {
      try {
        const data = await fn();
        console.log(`PASS ${label}: JSON received${data?.Version ? `; Jellyfin version ${data.Version}` : ''}`);
      } catch (err) {
        console.log(`FAIL ${label}: ${err.message}`);
        process.exitCode = 1;
      }
    }
  })().catch(err => { console.error(err.message); process.exitCode = 1; });
}

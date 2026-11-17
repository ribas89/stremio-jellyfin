# GitHub repositories are now mirror only

Due to recent changes in GitHub's direction, development has migrated to: https://git.ribas89.co.uk/

Have a issue/question? https://link.ribas89.co.uk/ask


Thank you for your support ❤️!


# Stremio Jellyfin

A self-hosted [Stremio](https://stremio.com) addon for browsing and playing movies and shows from a [Jellyfin](https://jellyfin.org) library. It includes catalog endpoints, search, genre filtering, and direct links to files on your Jellyfin server.

You can save several Jellyfin setups in the protected management page or create standalone install links from a public configuration page. Each link is tied to one set of Jellyfin credentials.

## Features

- **Per-setup installation links.** A URL-safe token contains the Jellyfin URL and API key. The same credentials produce the same token.
- **Public setup page** at `/configure`. Visitors can test their own Jellyfin connection and generate an install URL without creating an account or saving their setup to the management list.
- **Management page** at `/manage`. Supports adding, editing, and removing saved setups. Login uses `MANAGE_KEY` and an HttpOnly cookie when a key is configured.
- **Default installation** at `/manifest.json`. Uses the first configured setup, with matching catalog, metadata, and stream routes.
- **Movies, shows, search, and genre queries.** The addon uses Jellyfin's item and genre APIs. The movie and series catalogs advertise optional Stremio search, pagination, and genre parameters. Client support for displaying genre choices may vary.
- **Stream details.** When supplied by Jellyfin, stream cards include resolution, codecs, container, size, bitrate, audio tracks, subtitles, filename, and episode numbers.
- **Original-file playback first.** Static Jellyfin stream links include the source extension and `MediaSourceId` when available. Non-MP4 files also offer an extensionless desktop compatibility link. Optional `auto` mode adds a transcoding fallback.
- **Image proxy.** Poster and backdrop requests go through the addon. The API key is not added as a separate `ApiKey` query parameter on these image links, but the encoded installation token in the image path is still sensitive.
- **Docker deployment.** The image uses Node.js 22 on Alpine and runs as a non-root user. Saved configuration can be kept in a named Docker volume.

## Security and privacy

**Installation links are credentials.** Tokens are Base64URL-encoded JSON containing `jellyfinUrl` and `jellyfinApiKey`. Base64URL is not encryption. Anyone with a token can decode the Jellyfin URL and API key. Treat install URLs, image URLs, direct video URLs, browser histories, and proxy logs as sensitive. If a credential-bearing URL was exposed, rotate the key in Jellyfin and generate a new link.

- The public `/configure` page sends submitted details to this addon host's `/api/check` endpoint to test Jellyfin connectivity. This check does not add a saved setup. An installation link created by a visitor can be used without registering it in the host's managed list.
- The protected `/manage` page and its setup APIs **are public when `MANAGE_KEY` is not set**. Always configure a strong key before exposing the addon beyond a trusted local machine.
- The `/manifest.json` default addon, its catalog/stream routes, and token-specific routes do not require login. Anyone who can reach these endpoints may access media using the configured credentials. The management password does not protect playback.
- Public `/api/check` accepts arbitrary Jellyfin endpoints and causes server-side connection attempts. Do not expose this service to untrusted users without appropriate network restrictions and rate limiting. Restrict outbound access from the container where necessary.
- API requests use Jellyfin's `Authorization: MediaBrowser Token="..."` header. Direct file links use Jellyfin's `ApiKey` URL parameter, which the client must be able to reach. The addon does not proxy video playback.
- `/health` only exposes a summary of saved setups and does not return installation tokens or keys. Addon request logging redacts long tokens, but external reverse proxies may log full request paths unless configured otherwise.

## Requirements

- Docker with Docker Compose, or Node.js 18 or later
- A working Jellyfin server accessible from the addon host
- A Jellyfin API key, generated under **Jellyfin Dashboard > Advanced > API Keys**
- A network route from the Stremio playback device to Jellyfin for direct streams
- HTTPS and network access controls for use outside a trusted LAN

## Quick start with Docker Compose (prebuilt image)

The release workflow publishes the image as `ghcr.io/ribas89/stremio-jellyfin:latest`. Once that package has been published, you can deploy it without cloning the repository or building locally.

1. Create a directory for the deployment and save the following as `docker-compose.yml`:

   ```yaml
   services:
     stremio-jellyfin:
       image: ghcr.io/ribas89/stremio-jellyfin:latest
       container_name: stremio-jellyfin
       restart: unless-stopped
       ports:
         - "7000:7000"
       environment:
         PORT: "7000"
         CONFIG_PATH: /app/config/config.json
         MANAGE_KEY: ${MANAGE_KEY:?Set MANAGE_KEY in .env}
         # Optional: enable both variables to bootstrap a default setup.
         # JELLYFIN_URL: ${JELLYFIN_URL}
         # JELLYFIN_API_KEY: ${JELLYFIN_API_KEY}
       volumes:
         - config_data:/app/config

   volumes:
     config_data:
   ```

2. Create a `.env` file beside `docker-compose.yml` with a strong management password:

   ```bash
   printf 'MANAGE_KEY=%s\n' "$(openssl rand -hex 32)" > .env
   ```

   Keep `.env` private and out of version control. The Compose file refuses to start if `MANAGE_KEY` is missing or empty.

3. Pull the published image and start the container:

   ```bash
   docker pull ghcr.io/ribas89/stremio-jellyfin:latest
   docker compose up -d
   ```

   For future updates, run `docker compose pull && docker compose up -d`. This image must be accessible from your Docker host; if the GitHub Container Registry package is private, authenticate before pulling it.

4. Open `http://localhost:7000/manage` on the Docker host, or use a hostname accessible from your browser. Log in with the `MANAGE_KEY` value in `.env`, then add your Jellyfin server URL and API key. The first setup becomes the default.

5. Install `http://YOUR_HOST:7000/manifest.json` in **Stremio > Addons > Install from URL** for the default setup. The management page provides token-specific links for other setups. Replace `YOUR_HOST` with an address your Stremio device can reach, and use HTTPS for remote access.

The container listens on port `7000`. Saved configurations persist in the `config_data` Docker volume at `/app/config/config.json`, so updating the image does not normally erase them. Back up the volume before upgrades. If using a reverse proxy, consider changing the port mapping to `127.0.0.1:7000:7000` to avoid bypassing the proxy.

### Build locally from source (alternative)

To build the image yourself instead of pulling the published package:

```bash
git clone https://github.com/ribas89/stremio-jellyfin.git
cd stremio-jellyfin
cp .env.example .env
```

Set a strong `MANAGE_KEY` in `.env`, then run `docker compose up -d --build`. The repository's Compose file uses a local `build:` context. Continue with steps 4 and 5 above to configure and install the addon.

### Optional: bootstrap from environment variables

Set both `JELLYFIN_URL` and `JELLYFIN_API_KEY` in `.env`, and uncomment their two entries in `docker-compose.yml` (in either example). At startup, this environment-managed setup becomes the default before any saved setups. Its credentials are not automatically copied into the persistent configuration file. To edit or remove it, change or unset the environment variables and restart the service.

The saved configurations remain available at their token-specific URLs. If only one of these two environment variables is set, startup fails with an explanatory error.

## Quick start with Node.js

```bash
npm ci
MANAGE_KEY="$(openssl rand -hex 32)" npm start
```

The default port is `7000`. Open `http://localhost:7000/manage` and follow the Docker setup steps. With this command the generated password is temporary; set a persistent `MANAGE_KEY` in your shell or service manager for regular use. Node.js must have filesystem write access to `CONFIG_PATH`.

## How installation links work

1. A standalone token represents `base64url(JSON({ jellyfinUrl, jellyfinApiKey }))`.
2. Stremio loads `https://addon.example.com/TOKEN/manifest.json` and requests that setup's catalogs, metadata, and streams from the same URL prefix.
3. Saved setups also have a token-specific URL. The first configured setup can be installed at `https://addon.example.com/manifest.json` without a token.
4. The default changes if the first saved setup is removed, or if environment-managed credentials are changed. Token-specific URLs are tied to their credentials, not to the current default.

A saved setup is stored in `config.json` so Manage can list and edit it. A public visitor's standalone token does not need a saved account or persistent registration. The app also supports older `/i/:legacyId/...` links imported from legacy configuration files.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7000` | HTTP listening port |
| `CONFIG_PATH` | `./config.json` | File used for saved configurations; Docker sets `/app/config/config.json` |
| `MANAGE_KEY` | Unset | Password for `/manage` and saved-setup APIs |
| `JELLYFIN_URL` | Unset | Optional default setup provided at startup |
| `JELLYFIN_API_KEY` | Unset | Required with `JELLYFIN_URL` |

The JSON config also supports the following settings. They are read when the process starts:

```json
{
  "streamMode": "direct",
  "pageSize": 20,
  "cacheTtl": 300
}
```

- `streamMode`: `direct` (default) or `auto`. Both return the original stream first; `auto` also offers the separate Jellyfin transcoding fallback.
- `pageSize`: default number of items returned by the catalog handler.
- `cacheTtl`: default HTTP cache duration in seconds for general non-API responses. Individual Stremio handlers also return their own cache hints.

The first save creates or updates `config.json`, including a `savedConfigs` array. Older formats with top-level `jellyfinUrl`/`jellyfinApiKey` or an `instances` array are imported if `savedConfigs` does not already exist. Treat the configuration file and Docker volume as secrets.

## HTTP endpoints

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `/` | Public redirect | Sends the visitor to `/manage` |
| `/configure` | Public | Generate a standalone token-specific install link |
| `/api/check` | Public | Check Jellyfin credentials without saving them |
| `/manage` | Protected if configured | Manage saved setups |
| `/api/login`, `/api/logout` | Public | Manage cookie login and logout |
| `/api/status/:token` | Public with token | Connectivity details for the supplied setup |
| `/api/status`, `/api/configs` | Protected if configured | List, add, edit, and remove saved setups |
| `/manifest.json` | Public | Default Jellyfin setup's Stremio manifest |
| `/catalog/...`, `/meta/...`, `/stream/...` | Public | Default setup's Stremio resources |
| `/:token/manifest.json` | Public | Manifest for a particular Jellyfin setup |
| `/:token/catalog/...`, `/:token/meta/...`, `/:token/stream/...` | Public | Resources for that setup |
| `/:token/` | Public | Page for a particular setup |
| `/img/:token/:itemId/:type` | Public | Jellyfin image proxy |
| `/health` | Public | Summary connectivity check (`ok`, `configured`) |

`/manifest.json` returns HTTP 503 with JSON if no default setup exists. `GET /health` returns HTTP 503 when there is no configured setup or when a configured Jellyfin server cannot be reached.

## Reverse proxy with nginx

The example configuration at [`deploy/nginx.conf`](deploy/nginx.conf) contains:

- An HTTP to HTTPS redirect and TLS virtual host for the placeholder `addon.example.com`
- Proxying to `http://127.0.0.1:7000`
- Larger request-header buffers for long token-specific URLs
- Longer read and send timeouts for slow addon responses (actual media is served directly by Jellyfin)
- Disabled HTTP access logs on these virtual hosts, since token-bearing URL paths contain recoverable credentials

Replace `addon.example.com` and the certificate paths with your own domain and provision the TLS certificate before enabling the HTTPS virtual host. Ensure your reverse proxy does not log or forward full token-bearing URLs to third-party analytics.

Generated links honor `X-Forwarded-Proto` when set by a trusted reverse proxy. For certificate provisioning with Certbot, create a working HTTP-only virtual host first or use your existing certificate-management setup. The supplied HTTPS block expects certificate files to exist. When using a reverse proxy, consider binding the Docker port to `127.0.0.1:7000:7000` to prevent bypassing your proxy's access controls.

## Playback compatibility and troubleshooting

**Original playback and seeking**

The first source uses Jellyfin's original static file URL (`Static=true`), preserves a recognized container extension such as `.mkv` or `.mp4`, and includes `MediaSourceId` if available. It sends `videoSize`, `filename`, and `notWebReady` hints when appropriate. These hints can help clients identify a finite media file but do not guarantee playback or seeking support for every container and codec.

For non-MP4 media, **Jellyfin desktop compatibility** provides the older extensionless static URL without a `notWebReady` hint. In `streamMode: auto`, **Jellyfin fallback** is a separate progressive stream request with `Static=false`. Progressive transcoding may display an unknown total duration or limit seeking.

To check HTTP byte-range support, use an actual private stream URL on your own server:

```bash
node scripts/check-seeking.js 'https://media.example.com/Videos/ITEM_ID/stream.mkv?Static=true&MediaSourceId=SOURCE_ID&ApiKey=YOUR_API_KEY'
```

This sends `Range: bytes=0-1`. A compatible static file endpoint should return HTTP `206 Partial Content` with a matching `Content-Range`. The script does not print the URL. Avoid putting real API keys in shared terminal logs, screenshots, or shell history. Files with invalid timestamps or indexes may still need remuxing, and actual client support varies.

**Jellyfin returns HTML instead of JSON**

The client reports the failing Jellyfin API route and response type when an upstream proxy returns a login page, challenge, or other HTML instead of JSON. This helps distinguish invalid API credentials from a bad base URL or reverse proxy rule.

For a local connectivity check run:

```bash
node scripts/diagnose-jellyfin.js
```

In Docker:

```bash
docker compose exec stremio-jellyfin node scripts/diagnose-jellyfin.js
```

It tests `/System/Info/Public`, `/System/Info`, `/Users`, and a small item lookup. It reports whether each request returned valid JSON, without printing the API key. If Jellyfin is hosted under a subpath, use its API base URL, such as `https://media.example.com/jellyfin`, not the `/web` UI URL. Check HTTP 401/403, proxy redirects, and access gateway rules if the API fails.

**Other checks**

- Catalog works but playback fails: confirm the Stremio device can reach Jellyfin directly, and check the original file's format and client codec support.
- API data is missing: check addon-to-Jellyfin network access, API key permissions, and `/health`.
- A proxy rejects installation URLs: check request-line limits and `large_client_header_buffers`, not just response `proxy_buffer_size`.
- Old Stremio installation behaves differently: the generic addon ID differs from earlier branded builds. Reinstalling the addon may be required.

## Tests and verification

```bash
npm test
node --check index.js
node --check src/jellyfin.js
```

The tests cover basic request handling, manifest routing, JSON diagnostics, and stream URL generation. They are local tests and do **not** verify playback against a live Jellyfin server or confirm compatibility with every version of Stremio.

## License

MIT. See [`LICENSE`](LICENSE).

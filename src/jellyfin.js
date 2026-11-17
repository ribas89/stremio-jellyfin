'use strict';

const STREAM_MODES = ['direct', 'auto'];

class JellyfinClient {
  constructor({ baseUrl, apiKey, streamMode = 'direct' }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.streamMode = STREAM_MODES.includes(streamMode) ? streamMode : 'direct';
    this.userId = null;
    this.externalIdIndex = null;
    this.externalIdIndexAt = 0;
    this.headers = {
      // Modern Jellyfin (10.11+/12+) requires the token in Authorization.
      // The legacy X-Emby-Token header is rejected by newer servers.
      Authorization:
        `MediaBrowser Token="${apiKey}", Client="stremio-jellyfin", Device="stremio", DeviceId="stremio-jellyfin", Version="1.0.0"`,
      Accept: 'application/json',
    };
  }

  async get(path, params = {}) {
    const qs = new URLSearchParams(params);
    const url = `${this.baseUrl}${path}${qs.size ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers: this.headers });
    const contentType = res.headers.get('content-type') || 'unknown';
    // Do not include the request query or Authorization header in logs.
    // Login pages and proxy challenge pages may still return HTTP 200.
    const upstreamPath = (() => {
      try { return new URL(res.url).pathname; } catch { return '(unknown)'; }
    })();
    const redirectedTo = res.redirected ? `; redirected to ${upstreamPath}` : '';
    if (!res.ok) {
      throw new Error(`Jellyfin ${path} -> HTTP ${res.status} ${res.statusText} (content-type: ${contentType}${redirectedTo})`);
    }
    const body = await res.text();
    try {
      return JSON.parse(body);
    } catch {
      const htmlTitle = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim().slice(0, 100);
      const html = /^\s*(?:<!doctype html|<html|<head|<body)/i.test(body);
      const kind = html ? 'HTML instead of JSON' : 'invalid JSON';
      const details = htmlTitle ? `; page title: ${JSON.stringify(htmlTitle)}` : '';
      throw new Error(`Jellyfin ${path} returned ${kind} (HTTP ${res.status}; content-type: ${contentType}; path: ${upstreamPath}${redirectedTo}${details}). Check the Jellyfin base URL, reverse proxy, login redirects, and Cloudflare/access rules.`);
    }
  }

  async ping() {
    const info = await this.get('/System/Info');
    return info.Version;
  }

  // Resolve the first user so we can use /Users/{id}/Items paths, which
  // are the most reliably authorized across Jellyfin versions. Called lazily
  // (on demand) so entries created at request time work too, and retried
  // after a short cooldown if it fails.
  async resolveUser() {
    try {
      const users = await this.get('/Users');
      if (Array.isArray(users) && users.length > 0) {
        this.userId = users[0].Id;
      }
    } catch {
      this.userId = null;
    }
    return this.userId;
  }

  async ensureUser() {
    if (this.userId) return this.userId;
    const now = Date.now();
    if (this.userIdFailedAt && now - this.userIdFailedAt < 60000) return null;
    await this.resolveUser();
    if (!this.userId) this.userIdFailedAt = now;
    return this.userId;
  }

  async getItems({ type, startIndex = 0, limit = 20, genre, search }) {
    await this.ensureUser();
    const params = {
      Recursive: 'true',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      IncludeItemTypes: type,
      EnableImageTypes: 'Primary,Backdrop',
      Fields: 'Overview,Genres,ProductionYear,RuntimeTicks',
      StartIndex: String(startIndex),
      Limit: String(limit),
    };
    if (genre) params.Genres = genre;
    if (search) params.SearchTerm = search;
    const data = await this.get(this.itemsPath(), params);
    return data.Items || [];
  }

  async genres() {
    const data = await this.get('/Genres', { SortBy: 'SortName', Limit: '200' });
    return data.Items || [];
  }

  async getItem(id) {
    await this.ensureUser();
    const path = this.userId ? `/Users/${this.userId}/Items/${id}` : `/Items/${id}`;
    return this.get(path, {
      Fields: 'Overview,Genres,ProductionYear,RuntimeTicks,OfficialRating,MediaSources',
    });
  }

  // Resolve a Stremio id to a Jellyfin item. Stremio ids may be Jellyfin
  // GUIDs (from our catalogs) or IMDb ids (from Cinemeta-style catalogs,
  // e.g. "tt0000001" or "tt0000002:1:1" for episodes).
  async resolveItem(id, type) {
    if (/^[0-9a-f]{32}$/i.test(id)) {
      return this.getItem(id);
    }
    return this.findByExternalId(id, type);
  }

  // Build (and cache) an IMDb id -> Jellyfin GUID index for the library.
  // Jellyfin's AnyProviderIdEquals filter is unreliable, so we scan the
  // library directly (paged) and remember the mapping for a few minutes.
  async indexExternalIds(force = false) {
    const MAX_AGE = 10 * 60 * 1000;
    if (!force && this.externalIdIndex && Date.now() - this.externalIdIndexAt < MAX_AGE) return;
    await this.ensureUser();

    const map = new Map();
    const PAGE = 1000;
    let start = 0;
    while (true) {
      const data = await this.get(this.itemsPath(), {
        Recursive: 'true',
        IncludeItemTypes: 'Movie,Series',
        Fields: 'ProviderIds',
        StartIndex: String(start),
        Limit: String(PAGE),
      });
      const items = data.Items || [];
      for (const item of items) {
        const imdb = item.ProviderIds && item.ProviderIds.Imdb;
        if (imdb) map.set(String(imdb).toLowerCase(), item.Id);
      }
      const total = Number(data.TotalRecordCount || 0);
      start += items.length;
      if (items.length < PAGE || start >= total) break;
    }

    this.externalIdIndex = map;
    this.externalIdIndexAt = Date.now();
  }

  async findByExternalId(id, type) {
    const key = String(id).toLowerCase();
    await this.indexExternalIds();
    let guid = this.externalIdIndex.get(key);
    if (!guid) {
      await this.indexExternalIds(true);
      guid = this.externalIdIndex.get(key);
    }
    if (guid) {
      return this.getItem(guid);
    }
    // Fallback: Jellyfin might still resolve an arbitrary id directly.
    try {
      const item = await this.getItem(id);
      if (item && item.Id) return item;
    } catch {
      // fall through
    }
    throw new Error(`No Jellyfin item for external id ${id}`);
  }

  async episodes(seriesId, season) {
    await this.ensureUser();
    const params = { Fields: 'Overview,PremiereDate,MediaSources', EnableImageTypes: 'Primary' };
    if (this.userId) params.userId = this.userId;
    if (season) params.Season = String(season);
    const data = await this.get(`/Shows/${seriesId}/Episodes`, params);
    return data.Items || [];
  }

  itemsPath() {
    return this.userId ? `/Users/${this.userId}/Items` : '/Items';
  }

  // A bare /Videos/{id}/stream URL gives some third-party players too little
  // information about the media file. Preserve the source container and media
  // source ID so a player can identify finite VOD and request byte ranges.
  // IMPORTANT: A *static* stream is required for byte-accurate seeking. A
  // progressive (Static=false) FFmpeg stream may not have a known total size.
  streamUrl(itemId, source = null, { transcode = false } = {}) {
    const qs = new URLSearchParams({ ApiKey: this.apiKey });
    let extension = '';
    if (transcode) {
      qs.set('Static', 'false');
      qs.set('TranscodeReasons', 'ContainerNotSupported,VideoCodecNotSupported,AudioCodecNotSupported');
    } else {
      qs.set('Static', 'true');
      // Jellyfin documents that the original container or no extension is
      // valid for Static=true. Never invent a format if Jellyfin lacks it.
      const aliases = { matroska: 'mkv', mpegts: 'ts', quicktime: 'mov' };
      const raw = String((source && source.Container) || '').toLowerCase();
      const normalized = aliases[raw] || raw;
      const formats = new Set(['mp4', 'm4v', 'mkv', 'webm', 'ts', 'avi', 'mov', 'mpeg', 'mpg', 'wmv', 'asf', 'ogv', 'flv', 'm2ts', '3gp', 'wtv', 'iso']);
      if (formats.has(normalized)) extension = `.${normalized}`;
    }
    if (source && source.Id) qs.set('MediaSourceId', String(source.Id));
    return `${this.baseUrl}/Videos/${encodeURIComponent(itemId)}/stream${extension}?${qs.toString()}`;
  }

  imageUrl(itemId, type = 'Primary') {
    return `${this.baseUrl}/Items/${itemId}/Images/${type}?ApiKey=${encodeURIComponent(this.apiKey)}`;
  }

  image(itemId, type = 'Primary') {
    return fetch(this.imageUrl(itemId, type), { headers: this.headers });
  }
}

module.exports = { JellyfinClient };
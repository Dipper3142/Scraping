/*
 * TT downloader
 *
 * Author: Dippy (https://github.com/Dipper3142)
 * Base: https://vidgap.com/
 * Source: https://whatsapp.com/channel/0029Vb93wNfD8SE6mgz31526
 *
 * Note1: Jangan di hapus we em nya, hargai dev-scraper kecil :) (BANYAK PAKE TOKEN BJIR)
 */

/**
 * VidGap — TikTok / Douyin / Lemon8 Downloader Scraper
 * =====================================================
 * Single-file, dependency-free Node.js library.
 *
 * Reverse engineered from https://vidgap.com (Next.js App Router).
 *
 * How the site works
 * -----------------
 * 1. The client POSTs a Next.js *server action* to `/` with the header
 *      next-action: 406bbd177da8218a30000e605e45b45eacc10597a0   (findContentActionsQueue)
 *    and a body of `[{ vLink, agent, tab, amplified, platform }]`.
 *    `vLink` is the input URL, URL-encoded.
 *
 * 2. The RSC response is a newline-delimited "flight" payload. Row `1:` holds
 *    the action result: the extracted content document.
 *
 * 3. Video/music thumbnails are plain TikTok CDN links, but the actual video
 *    bytes are served through a token-gated proxy:
 *      /api/video/redirect/<uuid>   ->  { "error": "Unauthorized" } without auth
 *    This library therefore prefers the raw CDN URLs that the action result
 *    also returns (`videoURL` / `hdVideoURL` / `wmURL` / `musicURL`), which
 *    serve without authentication.
 *
 * Author: Dippy
 */

'use strict';

const BASE = 'https://vidgap.com';
const STREAM_HOST = 'https://io1.vidgap.com';

/** Server action ids discovered in the client bundle. */
const ACTIONS = {
  findContentActionsQueue: '406bbd177da8218a30000e605e45b45eacc10597a0',
  updateSessionToken: '40878c9e180bc1d4a4cfb0828295c543a58dbdac6b',
  updateDownloadToken: '40e076b53f52f069f2b21c1028fb3c33ef1a981dc4',
  findUserHighlight: '4039e71f69a5cfff9c62882c3b69f753a19606f2a8',
  findHighlightContents: '40c84d7f76df4942939b8d17f7809f85cb1c5e17f0',
};

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ROUTER_STATE =
  '%5B%22%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C16%5D';

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

class VidGapError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'VidGapError';
    this.code = code || 'VIDGAP_ERROR';
    if (details) this.details = details;
  }
}

/* ------------------------------------------------------------------ *
 * Link parsing / normalisation
 * ------------------------------------------------------------------ */

/**
 * Platform inference from a TikTok-family URL.
 * @returns {'tiktok'|'douyin'|'lemon8'}
 */
function detectPlatform(input) {
  const s = String(input || '').toLowerCase();
  if (/(^|\/\/|\.)douyin\.com/.test(s)) return 'douyin';
  if (/lemon8/.test(s)) return 'lemon8';
  return 'tiktok';
}

/**
 * Extract the content id(s) a URL points at.
 * Handles video, photo/slideshow, user profile and highlight links.
 */
function parseLink(input) {
  if (!input || typeof input !== 'string') {
    throw new VidGapError('A link is required', 'INVALID_INPUT');
  }
  const raw = input.trim();
  if (!raw) throw new VidGapError('A link is required', 'INVALID_INPUT');

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new VidGapError(`Not a valid URL: ${raw}`, 'INVALID_INPUT');
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const platform = detectPlatform(url.toString());
  const seg = url.pathname.split('/').filter(Boolean);

  let id = null;
  let kind = null;
  let username = null;

  if (platform === 'tiktok' || platform === 'douyin' || platform === 'lemon8') {
    // Segment 0 may be an @handle; the content keyword then sits at 1.
    // @user/video/<id> still points at a video, so keywords are matched first.
    let i = seg[0] && /^@/.test(seg[0]) ? 1 : 0;
    if (seg[0] && /^@/.test(seg[0])) username = seg[0];

    const kw = seg[i];
    const val = seg[i + 1];

    if ((kw === 'video' || kw === 't' || kw === 'v') && val) {
      id = val;
      kind = 'video';
    } else if ((kw === 'photo' || kw === 'note') && val) {
      id = val;
      kind = 'slideshow';
    } else if ((kw === 'user' || kw === 'u') && val) {
      username = val;
      kind = 'profile';
    } else if (username) {
      kind = 'profile';
    } else if (seg.length) {
      id = seg[seg.length - 1];
      kind = 'video';
    }
  }

  return { raw, normalized: url.toString(), host, platform, id, kind, username };
}

/* ------------------------------------------------------------------ *
 * HTTP session (cookie jar + RSC server-action transport)
 * ------------------------------------------------------------------ */

class Session {
  constructor(options = {}) {
    this.userAgent = options.userAgent || DEFAULT_UA;
    this.cookies = new Map();
    this.timeout = options.timeout || 45000;
    this.proxy = options.proxy;
  }

  _absorb(res) {
    const list =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : res.headers.get('set-cookie')
          ? [res.headers.get('set-cookie')]
          : [];
    for (const c of list) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  _cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async _fetch(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeout || this.timeout);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'user-agent': this.userAgent,
          'accept-language': 'en-US,en;q=0.9',
          ...(this._cookieHeader() ? { cookie: this._cookieHeader() } : {}),
          ...(init.headers || {}),
        },
      });
      this._absorb(res);
      return res;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new VidGapError(`Request timed out after ${init.timeout || this.timeout}ms`, 'TIMEOUT');
      }
      throw new VidGapError(`Network error: ${err.message}`, 'NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Warm up the session so Cloudflare issues us a clearance cookie. */
  async warmup() {
    try {
      const res = await this._fetch(`${BASE}/`, { headers: { accept: 'text/html' } });
      await res.text();
    } catch {
      /* warmup is best-effort */
    }
    return this;
  }

  /**
   * Invoke a Next.js server action and return its decoded RSC result row.
   * The origin intermittently answers 502 under load, so retry with backoff.
   * @param {string} actionId
   * @param {any} payload single argument, JSON-stringified
   */
  async callAction(actionId, payload, options = {}) {
    const attempts = options.retries ?? 3;
    let lastErr = null;

    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(1500 * i);

      const res = await this._fetch(`${BASE}/`, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain;charset=UTF-8',
          accept: 'text/x-component',
          'next-action': actionId,
          'next-router-state-tree': ROUTER_STATE,
          referer: `${BASE}/`,
        },
        body: JSON.stringify([payload]),
      });

      const text = await res.text();
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastErr = new VidGapError(`Upstream returned HTTP ${res.status}`, 'UPSTREAM_UNAVAILABLE');
        continue;
      }
      if (!res.ok) {
        throw new VidGapError(`Server action failed (HTTP ${res.status})`, 'HTTP_ERROR', text.slice(0, 400));
      }

      const row = this._extractResultRow(text);
      if (row !== undefined) return row;
      lastErr = new VidGapError(
        'Server action returned no result (content unavailable or rate limited)',
        'NO_RESULT'
      );
    }
    throw lastErr;
  }

  /**
   * Pull row `1:` (the action result) out of a flight payload.
   * Next.js emits rows as `<hexId>:<value>`; the action result is row 1.
   */
  _extractResultRow(text) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('1:')) continue;
      const body = line.slice(2);
      try {
        return JSON.parse(body);
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Socket.IO engine (v4) — used to wait on a queue session
 * ------------------------------------------------------------------ */

/**
 * Minimal Socket.IO v4 client over the WebSocket transport.
 * Implements the parts of the protocol VidGap's stream server uses:
 * handshake (`40`/`40<sid>`), `42["authenticate", sid]` and
 * `42["retrieve-data", json]`.
 */
class StreamClient {
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.userAgent = options.userAgent || DEFAULT_UA;
    this.timeout = options.timeout || 120000;
    this.ws = null;
    this.result = null;
    this.error = null;
  }

  _buildUrl() {
    return `${STREAM_HOST.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
  }

  /** @returns {Promise<object>} the `retrieve-data` payload */
  listen() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._buildUrl());
      this.ws = ws;
      let handshakeDone = false;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch {}
        reject(new VidGapError('Timed out waiting for queue result', 'TIMEOUT'));
      }, this.timeout);

      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        fn(arg);
      };

      ws.addEventListener('open', () => {
        // Socket.IO v4 client sends a probe, then "40" to open the namespace.
        ws.send('40');
      });

      ws.addEventListener('message', ev => {
        let str = typeof ev.data === 'string' ? ev.data : String(ev.data);
        if (typeof str !== 'string') return;

        if (!handshakeDone) {
          if (str.startsWith('0{')) {
            handshakeDone = true;               // server handshake packet
            ws.send('40');                      // join default namespace
            return;
          }
          if (str.startsWith('40')) {
            handshakeDone = true;
            ws.send(JSON.stringify(['authenticate', this.sessionId]));
            return;
          }
          return;
        }

        if (str === '2') { ws.send('3'); return; }   // ping -> pong
        if (str.startsWith('2')) { ws.send('3'); return; }

        if (!str.startsWith('42')) return;
        let frame;
        try { frame = JSON.parse(str.slice(2)); } catch { return; }
        const [event, payload] = frame;
        if (event === 'authenticate') {
          if (!payload || payload.status !== 'success') {
            finish(reject, new VidGapError('Stream authentication failed', 'AUTH_FAILED', payload));
          }
          return;
        }
        if (event === 'retrieve-data') {
          let parsed = payload;
          if (typeof payload === 'string') {
            try { parsed = JSON.parse(payload); } catch { /* keep raw */ }
          }
          finish(resolve, parsed);
          return;
        }
        if (event === 'error' || event === 'queue-limit-exceeded') {
          finish(reject, new VidGapError(`Stream error: ${event}`, 'STREAM_ERROR', payload));
        }
      });

      ws.addEventListener('error', () => {
        finish(reject, new VidGapError('Stream socket error', 'STREAM_ERROR'));
      });

      ws.addEventListener('close', ev => {
        if (!settled) {
          finish(reject, new VidGapError(`Stream closed (${ev && ev.code})`, 'STREAM_CLOSED'));
        }
      });
    });
  }

  close() {
    try { this.ws && this.ws.close(); } catch { /* noop */ }
  }
}

/* ------------------------------------------------------------------ *
 * Result normalisation
 * ------------------------------------------------------------------ */

/** Turn an action result into a stable, friendly shape. */
function normalise(raw, meta = {}) {
  if (!raw || typeof raw !== 'object') return null;

  // The site nests the document under `data` for some queue responses.
  const d = raw.data && typeof raw.data === 'object' ? { ...raw.data, ...stripMeta(raw) } : raw;

  const cv = d.clientVideoURL || {};

  return {
    id: d._id || d.contentId || d.video_id || null,
    videoId: d.video_id || d.contentId || d._id || null,
    type: d.data_type || meta.kind || null,
    platform: d.platform || meta.platform || 'tiktok',
    status: d.processed === false ? 'failed' : 'ok',
    username: d.username || null,
    title: d.title || d.desc || null,
    description: d.desc || d.title || null,
    views: num(d.views),
    likes: num(d.likes ?? d.diggCount),
    comments: num(d.comments ?? d.commentCount),
    shares: num(d.shares ?? d.shareCount),
    saves: num(d.collects ?? d.collectCount),
    duration: num(d.duration),
    musicDuration: num(d.musicDuration),

    // Media URLs. `clientVideoURL` holds token-gated `/api/*/redirect/*`
    // paths; the raw `*URL` fields are plain TikTok CDN links that download
    // without auth, so they win when present.
    video: {
      noWatermark: toAbs(d.videoURL) || toAbs(cv.nonwm) || null,
      hd: toAbs(d.hdVideoURL) || toAbs(cv.hd) || null,
      watermark: toAbs(d.wmURL) || toAbs(cv.wm) || null,
      proxied: {
        noWatermark: toAbs(cv.nonwm),
        hd: toAbs(cv.hd),
        watermark: toAbs(cv.wm),
      },
      size: num(d.infSize),
      hdSize: num(d.hdInfSize),
    },

    music: {
      url: d.musicURL || null,
      title: d.musicTitle || null,
      author: d.musicAuthor || d.musicUserName || null,
    },

    images: Array.isArray(d.images) ? d.images.filter(Boolean).map(toAbs) : [],

    thumbnail: d.thumbnail || null,
    thumbnailOrigin: d.thumbnailOrigin || d.dynamicCover || null,
    dynamicCover: d.dynamicCover || null,

    profile: {
      username: d.username || null,
      pic: d.profilePic || null,
      hdPic: d.hdProfilePic || null,
    },

    subtitle: d.subtitle || null,
    subtitleData: d.subtitleData || null,
    tracks: d.tracks || null,
    highlights: Array.isArray(d.highlights) ? d.highlights : null,
    contents: Array.isArray(d.contents) ? d.contents : null,

    raw: d,
  };
}

function stripMeta(d) {
  const { processed, failureKind, errorMessage, ...rest } = d;
  return rest;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toAbs(p) {
  if (!p) return null;
  if (/^https?:/i.test(p)) return p;
  return `${BASE}${p.startsWith('/') ? '' : '/'}${p}`;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Scrape any TikTok-family link and return the extracted content document.
 *
 * @param {string} link   TikTok / Douyin / Lemon8 URL
 * @param {object} [options]
 * @param {string} [options.tab]        'all' | 'video' | 'audio' | 'slideshow' | ...
 * @param {string} [options.platform]   override platform detection
 * @param {number} [options.timeout]
 * @param {boolean} [options.warmup]    prime cookies first (default true)
 * @returns {Promise<object>} normalised result
 */
async function scrape(link, options = {}) {
  const meta = parseLink(link);
  const platform = options.platform || meta.platform;
  const session = new Session({ userAgent: options.userAgent, timeout: options.timeout });

  if (options.warmup !== false) await session.warmup();

  const payload = {
    vLink: encodeURIComponent(meta.normalized),
    agent: 'Web',
    tab: options.tab || 'all',
    amplified: false,
    platform,
  };

  const raw = await session.callAction(ACTIONS.findContentActionsQueue, payload);
  return normalise(raw, { platform, kind: meta.kind });
}

/**
 * Scrape and follow a queue session over the socket stream server.
 * Use when the action returns a sessionId but no inline document.
 *
 * @param {string} sessionId
 * @param {object} [options]
 */
async function awaitQueue(sessionId, options = {}) {
  const client = new StreamClient(sessionId, {
    userAgent: options.userAgent,
    timeout: options.timeout,
  });
  return client.listen();
}

/* ---- Convenience wrappers -------------------------------------- */

const video = (link, options = {}) => scrape(link, { ...options, tab: 'video' });
const audio = (link, options = {}) => scrape(link, { ...options, tab: 'audio' });
const slideshow = (link, options = {}) => scrape(link, { ...options, tab: 'slideshow' });
const story = (link, options = {}) => scrape(link, { ...options, tab: 'story' });
const thumbnail = (link, options = {}) => scrape(link, { ...options, tab: 'thumbnail' });
const profile = (link, options = {}) => scrape(link, { ...options, tab: 'profile' });
const subtitle = (link, options = {}) => scrape(link, { ...options, tab: 'subtitle' });
const highlight = (link, options = {}) => scrape(link, { ...options, tab: 'highlight' });

/* ---- Downloads -------------------------------------------------- */

/**
 * Download media to disk, trying each candidate URL until one succeeds.
 * VidGap's token-gated redirect paths under /api answer 403 without a
 * fresh session, so the raw CDN links are tried first.
 *
 * @param {string|string[]} url one URL, or candidates in preference order
 * @param {string} outPath
 * @param {object} [options]
 */
async function download(url, outPath, options = {}) {
  const candidates = (Array.isArray(url) ? url : [url]).filter(Boolean);
  if (!candidates.length) throw new VidGapError('No URL to download', 'INVALID_INPUT');

  const session = new Session({ userAgent: options.userAgent, timeout: options.timeout });
  let lastError = null;

  for (const candidate of candidates) {
    let res;
    try {
      res = await session._fetch(candidate, {
        headers: { referer: `${BASE}/`, accept: '*/*' },
      });
    } catch (err) {
      lastError = err;
      continue;
    }
    if (!res.ok) {
      lastError = new VidGapError(`Download failed (HTTP ${res.status})`, 'DOWNLOAD_FAILED', candidate);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (outPath) {
      const fs = require('fs');
      const path = require('path');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);
    }
    return { url: candidate, outPath: outPath || null, bytes: buf.length, buffer: buf };
  }
  throw lastError || new VidGapError('Download failed', 'DOWNLOAD_FAILED');
}

/**
 * Pick the best video URL from a result, CDN first, proxy last.
 * @returns {string[]}
 */
function videoCandidates(data) {
  return [data.video.hd, data.video.noWatermark, data.video.watermark, data.video.proxied.hd, data.video.proxied.noWatermark]
    .filter(Boolean);
}

/** Download the video for a link (HD, no watermark where possible). */
async function downloadVideo(link, outPath, options = {}) {
  const data = await video(link, options);
  const candidates = videoCandidates(data);
  if (!candidates.length) throw new VidGapError('No video URL in result', 'NO_MEDIA');
  return download(candidates, outPath, options);
}

/** Download the MP3 for a link. */
async function downloadAudio(link, outPath, options = {}) {
  const data = await audio(link, options);
  if (!data.music.url) throw new VidGapError('No audio URL in result', 'NO_MEDIA');
  return download(data.music.url, outPath, options);
}

/** Download the cover image. */
async function downloadThumbnail(link, outPath, options = {}) {
  const data = await thumbnail(link, options);
  const url = data.thumbnailOrigin || data.thumbnail;
  if (!url) throw new VidGapError('No thumbnail in result', 'NO_MEDIA');
  return download(url, outPath, options);
}

/** Download a profile avatar. */
async function downloadProfilePic(link, outPath, options = {}) {
  const data = await profile(link, options);
  const url = data.profile.hdPic || data.profile.pic;
  if (!url) throw new VidGapError('No profile picture in result', 'NO_MEDIA');
  return download(url, outPath, options);
}

/** Download every image of a photo slideshow. */
async function downloadSlideshowImages(link, options = {}) {
  const data = await slideshow(link, options);
  if (!data.images.length) throw new VidGapError('No slideshow images in result', 'NO_MEDIA');
  const out = [];
  for (let i = 0; i < data.images.length; i++) {
    out.push(await download(data.images[i], options.outDir ? `${options.outDir}/image_${i + 1}.jpg` : null, options));
  }
  return out;
}

/* ---- Exports ---------------------------------------------------- */

module.exports = {
  scrape,
  awaitQueue,
  video,
  audio,
  slideshow,
  story,
  thumbnail,
  profile,
  subtitle,
  highlight,
  download,
  downloadVideo,
  downloadAudio,
  downloadThumbnail,
  downloadProfilePic,
  downloadSlideshowImages,
  // internals, useful for extension
  Session,
  StreamClient,
  parseLink,
  detectPlatform,
  normalise,
  ACTIONS,
  BASE,
  STREAM_HOST,
  VidGapError,
};

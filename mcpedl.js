/*
 * MCPEDL - All-in-One Instagram Media, Stories, Profile & Intelligence Scraper
 *
 * Author: Dippy (https://github.com/Dipper3142)
 * Base: https://mcpedl.com/
 * Source: https://whatsapp.com/channel/0029Vb93wNfD8SE6mgz31526
 *
 * Note1: Jangan di hapus we em nya, hargai dev-scraper kecil :) (BANYAK PAKE TOKEN BJIR)
 */

/**
 * @fileoverview MCPEDL.com Scraper & API Client
 * Standalone, zero-dependency Node.js client and parser for Minecraft Bedrock (MCPE) mods,
 * addons, texture packs, maps, skins, servers, and scripts from https://mcpedl.com
 *
 * @author Dipper Pines
 * @version 1.0.0
 * @license MIT
 */

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Base API and Website URLs
const BASE_API_URL = 'https://api.mcpedl.com/api';
const BASE_WEB_URL = 'https://mcpedl.com';
const EDGE_CDN_URL = 'https://edge.mcpedl.com';
const FORGE_CDN_URL = 'https://media.forgecdn.net';

/**
 * Standard Sort Options for Submissions
 */
const SORTS = Object.freeze({
  POPULAR: 'popular',
  UPDATED: 'update_date',
  DOWNLOADS: 'downloads',
  NEW: 'created_at'
});

/**
 * Common Categories on MCPEDL
 */
const CATEGORIES = Object.freeze({
  ALL: 'all',
  MODS: 'mods',
  ADDONS: 'addons',
  TEXTURE_PACKS: 'texture-packs',
  MAPS: 'maps',
  SKINS: 'skins',
  SCRIPTS: 'scripts',
  SERVERS: 'servers',
  SEEDS: 'seeds'
});

/**
 * Default HTTP Request Headers
 */
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, application/xhtml+xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

/**
 * Perform an HTTP/HTTPS GET request with redirect following, timeout, and buffer decoding
 * @param {string} targetUrl - Target URL to fetch
 * @param {object} [options={}] - Request options
 * @returns {Promise<{statusCode: number, headers: object, body: string, isJson: boolean, json: any}>}
 */
function httpRequest(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      return reject(new Error(`Invalid URL provided: "${targetUrl}"`));
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const timeoutMs = options.timeout || 15000;

    const reqOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        ...DEFAULT_HEADERS,
        ...(options.headers || {})
      },
      timeout: timeoutMs
    };

    const req = client.request(reqOptions, (res) => {
      // Follow HTTP redirects (301, 302, 303, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        const redirectCount = (options._redirectCount || 0) + 1;
        if (redirectCount > 5) {
          return reject(new Error(`Too many redirects encountered for URL: ${targetUrl}`));
        }
        return httpRequest(redirectUrl, { ...options, _redirectCount: redirectCount })
          .then(resolve)
          .catch(reject);
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        let isJson = false;
        let json = null;

        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('application/json') || (body.startsWith('{') && body.endsWith('}')) || (body.startsWith('[') && body.endsWith(']'))) {
          try {
            json = JSON.parse(body);
            isJson = true;
          } catch (_) {
            isJson = false;
          }
        }

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          isJson,
          json
        });
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Network error requesting "${targetUrl}": ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to "${targetUrl}" timed out after ${timeoutMs}ms`));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Unescape unicode escape sequences (\uXXXX)
 * @param {string} str - Raw string
 * @returns {string}
 */
function unescapeUnicode(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

/**
 * Decode HTML entities and sanitize text
 * @param {string} str - String with HTML entities
 * @returns {string}
 */
function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\\u002F/g, '/')
    .replace(/\\u003C/g, '<')
    .replace(/\\u003E/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\u0022/g, '"');
}

/**
 * Strip HTML tags and normalize whitespace
 * @param {string} html - HTML string
 * @returns {string}
 */
function stripTags(html) {
  if (!html || typeof html !== 'string') return '';
  const clean = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(clean).replace(/\s+/g, ' ').trim();
}

/**
 * Format bytes into human readable string (KB, MB, GB)
 * @param {number} bytes - Size in bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return 'Unknown Size';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Extract clean slug from URL or string
 * @param {string} input - Slug or URL
 * @returns {string}
 */
function extractSlug(input) {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const segments = parsed.pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] || '';
    } catch (_) {
      return trimmed.replace(/^https?:\/\/[^\/]+\//, '').replace(/\/+$/, '');
    }
  }
  return trimmed.replace(/^\/+|\/+$/g, '');
}

/**
 * Normalize a single submission item from REST API into standard format
 * @param {object} item - Raw API item
 * @returns {object}
 */
function normalizeApiSubmission(item) {
  if (!item || typeof item !== 'object') return null;

  const downloads = (Array.isArray(item.downloads) ? item.downloads : []).map(dl => ({
    name: dl.name || dl.filename || 'Download File',
    filename: dl.filename || dl.name || '',
    url: dl.downloadUrl || dl.url || '',
    sizeBytes: dl.fileLength || 0,
    sizeFormatted: formatBytes(dl.fileLength || 0),
    date: dl.fileDate || null
  }));

  const revisions = (Array.isArray(item.revisions) ? item.revisions : []).map(rev => ({
    id: rev.id || null,
    version: rev.version || '',
    changelogHtml: rev.changelog || '',
    changelogText: stripTags(rev.changelog || ''),
    date: rev.created_at || rev.updated_at || null
  }));

  const categories = (Array.isArray(item.categories) ? item.categories : []).map(cat => ({
    id: cat.id || null,
    name: decodeHtmlEntities(cat.name || ''),
    slug: cat.slug || '',
    parentId: cat.parent_id || null
  }));

  const tags = (Array.isArray(item.tags) ? item.tags : []).map(t => ({
    id: t.id || null,
    name: t.name || '',
    slug: t.slug || ''
  }));

  const cfTags = (Array.isArray(item.cf_tags) ? item.cf_tags : []).map(cf => ({
    id: cf.id || null,
    name: cf.name || '',
    slug: cf.slug || '',
    iconUrl: cf.iconUrl || '',
    url: cf.url || ''
  }));

  return {
    id: item.id || item.submission_id || null,
    title: decodeHtmlEntities(item.title || ''),
    slug: item.slug || '',
    url: item.slug ? `${BASE_WEB_URL}/${item.slug}/` : (item.url || ''),
    summary: decodeHtmlEntities(item.summary || item.introduction || item.short_description || ''),
    shortDescription: decodeHtmlEntities(item.short_description || item.summary || ''),
    coverImage: item.image || (item.thumbnails && (item.thumbnails.large || item.thumbnails.medium || item.thumbnails.small)) || null,
    thumbnails: item.thumbnails || null,
    galleryImages: Array.isArray(item.submission_images) ? item.submission_images : [],
    author: {
      id: item.user_id || null,
      name: item.display_name || item.username || item.user_nicename || 'Anonymous',
      username: item.username || item.user_nicename || '',
      avatar: item.user_avatar || null,
      role: item.user_role || null
    },
    metrics: {
      downloadsCount: item.downloadCount || item.downloadsCount || 0,
      averageRating: item.average_rating || 0,
      downloads1d: item.downloads1d || 0,
      downloads7d: item.downloads7d || 0,
      downloads14d: item.downloads14d || 0,
      downloads28d: item.downloads28d || 0
    },
    dates: {
      createdAt: item.created_at || null,
      updatedAt: item.update_date || item.updated_at || null,
      publishedAt: item.publish_date || item.created_at || null,
      sortDate: item.sort_date || null
    },
    categories,
    tags,
    cfTags,
    downloads,
    revisions,
    serverInfo: item.server_information ? {
      ip: item.server_ip || null,
      port: item.port || null,
      type: item.servertype || null,
      info: item.server_information || null
    } : null,
    isPopular: Boolean(item.popular)
  };
}

/**
 * Normalize Search Results from /api/search/advanced
 * @param {object} item - Raw search result item
 * @returns {object}
 */
function normalizeSearchResult(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: item.id || null,
    title: decodeHtmlEntities(item.title || ''),
    slug: item.slug || '',
    url: item.slug ? `${BASE_WEB_URL}/${item.slug}/` : '',
    introduction: decodeHtmlEntities(item.introduction || item.summary || ''),
    summary: decodeHtmlEntities(item.summary || item.introduction || ''),
    image: item.image || null,
    author: {
      id: item.user_id || null,
      name: item.display_name || item.user_nicename || 'Anonymous',
      username: item.user_nicename || '',
      avatar: item.user_avatar || null
    },
    metrics: {
      downloadsCount: item.downloadCount || 0,
      averageRating: item.average_rating || 0,
      score: item.score || 0
    },
    dates: {
      createdAt: item.created_at || null,
      updatedAt: item.updated_at || null,
      sortDate: item.sort_date || null
    },
    cfTags: Array.isArray(item.cf_tags) ? item.cf_tags : []
  };
}

/**
 * Parse HTML page from https://mcpedl.com/{slug}/ and extract all rich content
 * @param {string} html - Raw HTML source of submission page
 * @param {string} [slug=''] - Slug of the submission
 * @returns {object}
 */
function parseSubmissionHtml(html, slug = '') {
  if (!html || typeof html !== 'string') {
    throw new Error('Invalid HTML input for submission parser');
  }

  const unescaped = unescapeUnicode(html);

  // 1. Title
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';

  // 2. Meta Description & Tags
  const metaDescMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
  const metaDescription = metaDescMatch ? decodeHtmlEntities(metaDescMatch[1]) : '';

  // 3. Author info
  const authorMatch = html.match(/class="[^"]*post-header__author[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const authorName = authorMatch ? stripTags(authorMatch[1]) : '';

  // 4. Badges (downloads, date, rating)
  const dlBadgeMatch = html.match(/submission-header__downloads[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/i);
  const downloadsFormatted = dlBadgeMatch ? stripTags(dlBadgeMatch[1]) : '';

  const dateBadgeMatch = html.match(/submission-header__date[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/i);
  const dateFormatted = dateBadgeMatch ? stripTags(dateBadgeMatch[1]) : '';

  // 5. Section Cards (Introduction, Description, Supported Versions, Changelog, Installation, Related)
  const sections = [];
  const sectionMap = {};
  const sectionRegex = /<section class="section-card">([\s\S]*?)<\/section>/gi;
  let sMatch;

  while ((sMatch = sectionRegex.exec(html)) !== null) {
    const secHtml = sMatch[1];
    const sTitleMatch = secHtml.match(/<div class="section-card__title">([\s\S]*?)<\/div>/i);
    const sTitle = sTitleMatch ? stripTags(sTitleMatch[1]) : 'Section';
    const sBoxMatch = secHtml.match(/<div class="section-card__box">([\s\S]*?)<\/div>\s*(?:<\/section>|$)/i);
    const sContentHtml = sBoxMatch ? sBoxMatch[1].trim() : '';
    const sContentText = stripTags(sContentHtml);

    const sectionObj = {
      title: sTitle,
      html: sContentHtml,
      text: sContentText
    };

    sections.push(sectionObj);
    const key = sTitle.toLowerCase().replace(/[^a-z0-9]/g, '_');
    sectionMap[key] = sectionObj;
  }

  // Extract Supported Minecraft Versions
  let supportedVersions = [];
  if (sectionMap['supported_minecraft_versions']) {
    const verMatches = sectionMap['supported_minecraft_versions'].text.match(/\d+\.\d+(?:\.\d+)?/g) || [];
    supportedVersions = [...new Set(verMatches)];
  }

  // Extract Introduction and Main Description
  const introduction = sectionMap['introduction'] ? sectionMap['introduction'].text : metaDescription;
  const descriptionHtml = sectionMap['description'] ? sectionMap['description'].html : '';
  const descriptionText = sectionMap['description'] ? sectionMap['description'].text : '';
  const changelog = sectionMap['latest_changes'] ? sectionMap['latest_changes'].text : (sectionMap['changelog'] ? sectionMap['changelog'].text : '');

  // 6. Extract Media / Gallery Images
  const imgUrlMatches = unescaped.match(/https?:\/\/[a-zA-Z0-9\.\-_/]+\.(?:png|jpg|jpeg|webp|gif)/gi) || [];
  const galleryImages = [...new Set(
    imgUrlMatches.filter(u => {
      return (u.includes('forgecdn.net/attachments') || u.includes('mcpedl.com/users')) &&
             !u.includes('logo') && !u.includes('empty.png') && !u.includes('avatar');
    })
  )];

  // 7. Extract Download Files (.mcpack, .mcaddon, .mcworld, .zip, .jar, .apk)
  const fileUrlMatches = unescaped.match(/https?:\/\/(?:edge\.mcpedl\.com|edge\.forgecdn\.net|mediafire\.com)[a-zA-Z0-9\.\-_/ %]+\.(?:mcpack|mcaddon|mcworld|zip|jar|apk)/gi) || [];
  const directDownloadUrls = [...new Set(fileUrlMatches)];

  const downloads = directDownloadUrls.map(url => {
    let cleanUrl = url.trim();
    let filename = '';
    try {
      const urlObj = new URL(cleanUrl);
      filename = decodeURIComponent(urlObj.pathname.split('/').pop() || '');
    } catch (_) {
      filename = cleanUrl.split('/').pop() || '';
    }
    const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extMatch ? extMatch[1].toLowerCase() : '';

    return {
      name: filename.replace(/\.[^/.]+$/, ''),
      filename,
      extension,
      url: cleanUrl
    };
  });

  // 8. Extract Related Submissions
  const related = [];
  if (sectionMap['related']) {
    const linkRegex = /<a\s+[^>]*href="\/([^"/]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi;
    let rMatch;
    while ((rMatch = linkRegex.exec(sectionMap['related'].html)) !== null) {
      const rSlug = rMatch[1];
      const rTitle = stripTags(rMatch[2]);
      if (rSlug && rTitle && rSlug !== slug) {
        related.push({
          title: rTitle,
          slug: rSlug,
          url: `${BASE_WEB_URL}/${rSlug}/`
        });
      }
    }
  }

  // 9. Schema JSON-LD metadata if present
  let schemaData = null;
  const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      schemaData = JSON.parse(jsonLdMatch[1].trim());
    } catch (_) {
      schemaData = null;
    }
  }

  return {
    title,
    slug: slug || extractSlug(title),
    url: slug ? `${BASE_WEB_URL}/${slug}/` : '',
    author: {
      name: authorName || 'Anonymous'
    },
    metaDescription,
    introduction,
    description: {
      html: descriptionHtml,
      text: descriptionText
    },
    changelog,
    supportedVersions,
    downloadsCount: downloadsFormatted,
    updatedDate: dateFormatted,
    sections,
    galleryImages,
    downloads,
    related,
    schema: schemaData
  };
}

/**
 * MCPEDL Client Class
 */
class MCPEDL {
  constructor(options = {}) {
    this.timeout = options.timeout || 15000;
    this.customHeaders = options.headers || {};
  }

  /**
   * Internal HTTP Request Helper
   * @private
   */
  async _get(url) {
    return httpRequest(url, {
      timeout: this.timeout,
      headers: this.customHeaders
    });
  }

  /**
   * Get submissions catalog with sorting and pagination
   * @param {object} [options={}] - Options
   * @param {number} [options.page=1] - Page number (1-based)
   * @param {string} [options.sort='popular'] - Sort type: 'popular', 'update_date', 'downloads', 'created_at'
   * @returns {Promise<{data: object[], meta: object, raw: object}>}
   */
  async getSubmissions(options = {}) {
    const page = Number(options.page) || 1;
    const sort = options.sort || SORTS.POPULAR;
    const url = `${BASE_API_URL}/submissions?sort=${encodeURIComponent(sort)}&page=${page}`;

    const res = await this._get(url);
    if (!res.isJson || !res.json) {
      throw new Error(`Failed to fetch submissions from MCPEDL API: HTTP ${res.statusCode}`);
    }

    const rawData = res.json.data || [];
    const normalized = rawData.map(normalizeApiSubmission).filter(Boolean);

    return {
      data: normalized,
      meta: {
        total: res.json.meta?.total || normalized.length,
        currentPage: page,
        perPage: res.json.meta?.per_page || rawData.length,
        lastPage: res.json.meta?.last_page || Math.ceil((res.json.meta?.total || 1000) / (res.json.meta?.per_page || 15)),
        sort
      },
      raw: res.json
    };
  }

  /**
   * Alias for getSubmissions
   */
  async getCatalog(options = {}) {
    return this.getSubmissions(options);
  }

  /**
   * Get latest submissions ordered by update date
   * @param {number} [page=1] - Page number
   * @returns {Promise<{data: object[], meta: object}>}
   */
  async getLatest(page = 1) {
    return this.getSubmissions({ page, sort: SORTS.UPDATED });
  }

  /**
   * Get most popular submissions
   * @param {number} [page=1] - Page number
   * @returns {Promise<{data: object[], meta: object}>}
   */
  async getPopular(page = 1) {
    return this.getSubmissions({ page, sort: SORTS.POPULAR });
  }

  /**
   * Get most downloaded submissions
   * @param {number} [page=1] - Page number
   * @returns {Promise<{data: object[], meta: object}>}
   */
  async getMostDownloaded(page = 1) {
    return this.getSubmissions({ page, sort: SORTS.DOWNLOADS });
  }

  /**
   * Search MCPEDL submissions by query string
   * @param {string} query - Search term
   * @param {object} [options={}] - Search options
   * @param {number} [options.page=1] - Page number
   * @param {string} [options.sort] - Optional sort filter
   * @returns {Promise<{results: object[], meta: object, query: string}>}
   */
  async search(query, options = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new Error('Search query must be a non-empty string');
    }

    const cleanQuery = query.trim();
    const page = Number(options.page) || 1;
    let url = `${BASE_API_URL}/search/advanced?q=${encodeURIComponent(cleanQuery)}&page=${page}`;
    if (options.sort) {
      url += `&sort=${encodeURIComponent(options.sort)}`;
    }

    const res = await this._get(url);
    if (!res.isJson || !res.json) {
      throw new Error(`Failed to execute search on MCPEDL: HTTP ${res.statusCode}`);
    }

    const rawResults = res.json.results || [];
    const normalized = rawResults.map(normalizeSearchResult).filter(Boolean);

    return {
      query: cleanQuery,
      results: normalized,
      meta: {
        total: res.json.meta?.total || normalized.length,
        page: res.json.meta?.page || page,
        pageSize: res.json.meta?.page_size || normalized.length,
        pageCount: res.json.meta?.page_count || 1
      },
      raw: res.json
    };
  }

  /**
   * Get Frontpage Shelves & Curated Categories (All, Addons, Maps, Texture Packs, Skins, Scripts)
   * @returns {Promise<object>}
   */
  async getFrontpage() {
    const url = `${BASE_API_URL}/search/frontpage`;
    const res = await this._get(url);
    if (!res.isJson || !res.json) {
      throw new Error(`Failed to fetch frontpage from MCPEDL: HTTP ${res.statusCode}`);
    }
    return res.json;
  }

  /**
   * Get Frontpage Featured Carousels & Monthly Theme Banner
   * @returns {Promise<{featured: object[], monthlyTheme: object|null}>}
   */
  async getFeaturedCarousels() {
    const url = `${BASE_API_URL}/carousels/fp`;
    const res = await this._get(url);
    if (!res.isJson || !res.json) {
      throw new Error(`Failed to fetch carousels from MCPEDL: HTTP ${res.statusCode}`);
    }

    const items = (Array.isArray(res.json.data) ? res.json.data : []).map(normalizeApiSubmission).filter(Boolean);
    return {
      featured: items,
      monthlyTheme: res.json.monthlyTheme || null,
      cached: Boolean(res.json.cached)
    };
  }

  /**
   * Get Frontpage Shelves v2 (New, Updated, Popular)
   * @returns {Promise<object>}
   */
  async getShelves() {
    const url = `${BASE_API_URL}/search/frontpage/v2`;
    const res = await this._get(url);
    if (!res.isJson || !res.json) {
      throw new Error(`Failed to fetch shelves v2 from MCPEDL: HTTP ${res.statusCode}`);
    }
    return res.json.shelves || res.json;
  }

  /**
   * Get Complete Details for a specific submission by Slug or URL
   * Combines SSR HTML extraction + Search metadata for 100% comprehensive data
   * @param {string} slugOrUrl - Submission slug (e.g. 'spectral-essentials') or full URL
   * @returns {Promise<object>}
   */
  async getDetail(slugOrUrl) {
    const slug = extractSlug(slugOrUrl);
    if (!slug) {
      throw new Error(`Invalid slug or URL: "${slugOrUrl}"`);
    }

    const targetUrl = `${BASE_WEB_URL}/${slug}/`;
    const res = await this._get(targetUrl);

    if (res.statusCode === 404) {
      throw new Error(`Submission not found for slug: "${slug}" (HTTP 404)`);
    }

    if (res.statusCode !== 200) {
      throw new Error(`Failed to fetch submission page "${targetUrl}": HTTP ${res.statusCode}`);
    }

    // Parse SSR HTML
    const htmlData = parseSubmissionHtml(res.body, slug);

    return {
      ...htmlData,
      slug,
      url: targetUrl
    };
  }

  /**
   * Alias for getDetail
   */
  async getSubmission(slugOrUrl) {
    return this.getDetail(slugOrUrl);
  }

  /**
   * Get all downloadable files (.mcpack, .mcaddon, .mcworld, .zip, etc.) for a submission
   * @param {string} slugOrUrl - Submission slug or full URL
   * @returns {Promise<Array<{name: string, filename: string, extension: string, url: string}>>}
   */
  async getDownloadLinks(slugOrUrl) {
    const detail = await this.getDetail(slugOrUrl);
    return detail.downloads || [];
  }
}

// Create default singleton instance
const defaultClient = new MCPEDL();

// Export singleton instance methods directly for convenience
module.exports = {
  MCPEDL,
  SORTS,
  CATEGORIES,
  BASE_API_URL,
  BASE_WEB_URL,
  EDGE_CDN_URL,
  FORGE_CDN_URL,

  // Direct helper functions using default client
  getSubmissions: (options) => defaultClient.getSubmissions(options),
  getCatalog: (options) => defaultClient.getCatalog(options),
  getLatest: (page) => defaultClient.getLatest(page),
  getPopular: (page) => defaultClient.getPopular(page),
  getMostDownloaded: (page) => defaultClient.getMostDownloaded(page),
  search: (query, options) => defaultClient.search(query, options),
  getFrontpage: () => defaultClient.getFrontpage(),
  getFeaturedCarousels: () => defaultClient.getFeaturedCarousels(),
  getShelves: () => defaultClient.getShelves(),
  getDetail: (slugOrUrl) => defaultClient.getDetail(slugOrUrl),
  getSubmission: (slugOrUrl) => defaultClient.getSubmission(slugOrUrl),
  getDownloadLinks: (slugOrUrl) => defaultClient.getDownloadLinks(slugOrUrl),

  // Utility exports
  extractSlug,
  stripTags,
  formatBytes,
  decodeHtmlEntities,
  parseSubmissionHtml,
  normalizeApiSubmission,
  normalizeSearchResult
};

// CLI Execution Handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] ? args[0].toLowerCase() : 'help';
  const param1 = args[1];
  const param2 = args[2];

  async function runCli() {
    try {
      switch (command) {
        case 'search': {
          if (!param1) {
            console.error('Usage: node mcpedl.js search <keyword> [page]');
            process.exit(1);
          }
          console.log(`\n🔍 Searching MCPEDL for "${param1}"...`);
          const res = await defaultClient.search(param1, { page: param2 || 1 });
          console.log(`\nFound ${res.meta.total} results (Page ${res.meta.page}/${res.meta.pageCount}):\n`);
          res.results.forEach((item, idx) => {
            console.log(`[${idx + 1}] ${item.title}`);
            console.log(`    Slug: ${item.slug}`);
            console.log(`    URL:  ${item.url}`);
            console.log(`    Author: ${item.author.name} | Rating: ⭐ ${item.metrics.averageRating} | Downloads: 📥 ${item.metrics.downloadsCount}`);
            if (item.introduction) {
              console.log(`    Intro:  ${item.introduction.slice(0, 100)}...`);
            }
            console.log('');
          });
          break;
        }

        case 'latest': {
          const page = Number(param1) || 1;
          console.log(`\n📦 Fetching latest submissions (Page ${page})...`);
          const res = await defaultClient.getLatest(page);
          console.log(`\nTotal Submissions: ${res.meta.total} | Page: ${res.meta.currentPage}:\n`);
          res.data.forEach((item, idx) => {
            console.log(`[${idx + 1}] ${item.title}`);
            console.log(`    Slug: ${item.slug}`);
            console.log(`    URL:  ${item.url}`);
            console.log(`    Author: ${item.author.name} | Downloads: 📥 ${item.metrics.downloadsCount}`);
            if (item.downloads.length > 0) {
              console.log(`    Files: ${item.downloads.map(d => d.filename || d.name).join(', ')}`);
            }
            console.log('');
          });
          break;
        }

        case 'popular': {
          const page = Number(param1) || 1;
          console.log(`\n🔥 Fetching popular submissions (Page ${page})...`);
          const res = await defaultClient.getPopular(page);
          console.log(`\nPopular Submissions (Page ${res.meta.currentPage}):\n`);
          res.data.forEach((item, idx) => {
            console.log(`[${idx + 1}] ${item.title}`);
            console.log(`    Slug: ${item.slug}`);
            console.log(`    URL:  ${item.url}`);
            console.log(`    Downloads: 📥 ${item.metrics.downloadsCount} | Rating: ⭐ ${item.metrics.averageRating}`);
            console.log('');
          });
          break;
        }

        case 'detail':
        case 'info': {
          if (!param1) {
            console.error('Usage: node mcpedl.js detail <slug-or-url>');
            process.exit(1);
          }
          console.log(`\n📄 Fetching details for "${param1}"...`);
          const detail = await defaultClient.getDetail(param1);
          console.log(`\n========================================`);
          console.log(`Title:       ${detail.title}`);
          console.log(`Slug:        ${detail.slug}`);
          console.log(`URL:         ${detail.url}`);
          console.log(`Author:      ${detail.author.name}`);
          console.log(`Downloads:   ${detail.downloadsCount || 'N/A'}`);
          console.log(`Updated:     ${detail.updatedDate || 'N/A'}`);
          if (detail.supportedVersions.length > 0) {
            console.log(`MC Versions: ${detail.supportedVersions.join(', ')}`);
          }
          if (detail.introduction) {
            console.log(`\nIntroduction:\n${detail.introduction}`);
          }
          if (detail.downloads.length > 0) {
            console.log(`\n💾 Direct Download Files (${detail.downloads.length}):`);
            detail.downloads.forEach(dl => {
              console.log(`  - [${dl.extension.toUpperCase()}] ${dl.filename}`);
              console.log(`    Link: ${dl.url}`);
            });
          }
          if (detail.galleryImages.length > 0) {
            console.log(`\n🖼️ Gallery Images (${detail.galleryImages.length}):`);
            detail.galleryImages.slice(0, 5).forEach(img => console.log(`  - ${img}`));
          }
          console.log(`========================================\n`);
          break;
        }

        case 'downloads':
        case 'dl': {
          if (!param1) {
            console.error('Usage: node mcpedl.js downloads <slug-or-url>');
            process.exit(1);
          }
          console.log(`\n💾 Extracting direct download files for "${param1}"...`);
          const files = await defaultClient.getDownloadLinks(param1);
          if (files.length === 0) {
            console.log('No downloadable files found for this submission.');
          } else {
            console.log(`\nFound ${files.length} downloadable file(s):\n`);
            files.forEach((file, idx) => {
              console.log(`[${idx + 1}] ${file.filename}`);
              console.log(`    Format: .${file.extension}`);
              console.log(`    Direct URL: ${file.url}`);
              console.log('');
            });
          }
          break;
        }

        case 'featured': {
          console.log(`\n⭐ Fetching featured carousel items...`);
          const res = await defaultClient.getFeaturedCarousels();
          if (res.monthlyTheme) {
            console.log(`Monthly Theme: ${res.monthlyTheme.title || JSON.stringify(res.monthlyTheme)}`);
          }
          console.log(`Featured Items (${res.featured.length}):\n`);
          res.featured.forEach((item, idx) => {
            console.log(`[${idx + 1}] ${item.title} (${item.slug})`);
            console.log(`    URL: ${item.url}`);
            console.log(`    Author: ${item.author.name}`);
            console.log('');
          });
          break;
        }

        case 'help':
        default: {
          console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                   MCPEDL.COM SCRAPER & CLI                    ║
║      Zero-dependency Minecraft Bedrock Scraper & API SDK      ║
╚═══════════════════════════════════════════════════════════════╝

Usage:
  node mcpedl.js <command> [arguments]

Commands:
  search <keyword> [page]     Search mods, texture packs, maps, skins by keyword
  latest [page]               Get latest updated submissions
  popular [page]              Get most popular submissions
  detail <slug-or-url>        Get full submission details, versions & gallery
  downloads <slug-or-url>     Extract direct .mcpack/.mcaddon download links
  featured                    Get frontpage carousel featured mods & monthly theme
  help                        Show this help menu

Examples:
  node mcpedl.js search furniture
  node mcpedl.js detail spectral-essentials
  node mcpedl.js downloads furnicraft-furniture
  node mcpedl.js latest 1
  node mcpedl.js featured
`);
          break;
        }
      }
    } catch (error) {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  }

  runCli();
}

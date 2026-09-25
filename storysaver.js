/*
 * Instagram Story Downloader
 *
 * Author: Dippy (https://github.com/Dipper3142)
 * Base: https://www.storysaver.net/en/
 * Source: https://whatsapp.com/channel/0029Vb93wNfD8SE6mgz31526
 *
 * Note: Jangan di hapus we em nya, hargai dev-scraper kecil :) (BANYAK PAKE TOKEN BJIR)
 */

/**
 * StorySaver.net Scraper (Node.js)
 * --------------------------------
 * Scrapes Instagram Stories, Highlights, and Highlight Media albums via StorySaver.net
 * using Cheerio and native fetch.
 */

const cheerio = require('cheerio');
const fs = require('fs');
const { URL } = require('url');

class StorySaverScraper {
  static BASE_URL = 'https://www.storysaver.net';
  static DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  /**
   * @param {Object} [options]
   * @param {string} [options.userAgent] Custom User-Agent header
   */
  constructor(options = {}) {
    this.baseUrl = StorySaverScraper.BASE_URL;
    this.userAgent = options.userAgent || StorySaverScraper.DEFAULT_USER_AGENT;
    this.cookies = new Map();
  }

  /**
   * StorySaver client-side Turnstile fallback hash algorithm
   * Replicates `x = ((x * 31) + charCode) & 0xFFFFFFFF`
   * @param {string} ua
   * @returns {string} Hex string prefixed with 0x
   */
  computeCfMigrate(ua) {
    let x = 0;
    for (let i = 0; i < ua.length; i++) {
      x = (Math.imul(x, 31) + ua.charCodeAt(i)) >>> 0;
    }
    return '0x' + x.toString(16);
  }

  /**
   * Stores cookies from response Set-Cookie headers
   * @private
   */
  _updateCookies(response) {
    const rawCookies = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);

    for (const cookieStr of rawCookies) {
      const parts = cookieStr.split(';')[0].split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        this.cookies.set(key, value);
      }
    }
  }

  /**
   * Formats stored cookies into a Cookie header string
   * @private
   */
  _getCookieHeader() {
    if (this.cookies.size === 0) return '';
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /**
   * Wrapper for fetch requests with headers, cookies, and error handling
   * @private
   */
  async _request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const { headers: customHeaders, ...restOptions } = options;

    const headers = {
      'User-Agent': this.userAgent,
      'Referer': `${this.baseUrl}/`,
      'Origin': this.baseUrl,
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(customHeaders || {}),
    };

    const cookieHeader = this._getCookieHeader();
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    const fetchOptions = {
      method: options.method || 'GET',
      headers,
      ...restOptions,
    };

    const response = await fetch(url, fetchOptions);
    this._updateCookies(response);
    return response;
  }

  /**
   * Cleans Instagram handles, usernames, and profile/story URLs
   * @param {string} inputStr
   * @returns {string} Clean username
   */
  cleanUsername(inputStr) {
    if (!inputStr) return '';
    let cleaned = inputStr.trim();
    if (cleaned.startsWith('@')) {
      return cleaned.slice(1);
    }
    if (cleaned.includes('instagram.com')) {
      try {
        const parsed = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0) {
          if (pathParts[0] === 'stories' && pathParts.length > 1) {
            return pathParts[1];
          }
          return pathParts[0];
        }
      } catch {
        // Fallback to raw string if URL parsing fails
      }
    }
    return cleaned;
  }

  /**
   * Parses StorySaver HTML output for stories
   * @private
   */
  _parseStoryHtml(html, username) {
    const $ = cheerio.load(html);

    const userInfo = {
      username: username,
      avatar: null,
      story_count: null,
      last_story_added: null,
    };

    // User profile statistics card
    const userCards = $('ul.statistics > li.stylefirst');
    if (userCards.length > 1) {
      const targetCard = userCards.eq(1);
      userInfo.avatar = targetCard.find('img').attr('src') || null;
      userInfo.username = targetCard.find('p').text().trim() || username;
      userInfo.story_count = targetCard.find('.storycount').text().trim() || null;
      userInfo.last_story_added = targetCard.find('.storytime').text().trim() || null;
    }

    // Story media items
    const stories = [];
    $('li.stylestory').each((idx, el) => {
      const item = $(el);
      const videoEl = item.find('video');
      const imgEl = item.find('img');
      const sourceEl = item.find('video source');
      const downloadBtn = item.find('a.button, a[download]');

      const isVideo = videoEl.length > 0;
      const mediaType = isVideo ? 'video' : (imgEl.length > 0 ? 'photo' : 'unknown');

      let poster = null;
      let mediaUrl = null;

      if (isVideo) {
        poster = videoEl.attr('poster') || null;
        mediaUrl = sourceEl.attr('src') || videoEl.attr('src') || null;
      } else if (imgEl.length > 0) {
        poster = imgEl.attr('src') || null;
        mediaUrl = poster;
      }

      const downloadUrl = downloadBtn.attr('href') || mediaUrl;

      stories.push({
        index: idx + 1,
        type: mediaType,
        thumbnail: poster,
        media_url: mediaUrl,
        download_url: downloadUrl,
      });
    });

    return {
      success: true,
      user: userInfo,
      total_stories: stories.length,
      stories,
    };
  }

  /**
   * Fetches active 24h stories for an Instagram user
   * @param {string} usernameOrUrl
   * @returns {Promise<Object>}
   */
  async getStories(usernameOrUrl) {
    const username = this.cleanUsername(usernameOrUrl);
    if (!username) {
      return { success: false, error: 'Invalid username provided.' };
    }

    try {
      // 1. Warm-up session request
      await this._request('/');

      // 2. Trigger initial process
      const body1 = new URLSearchParams();
      body1.append('text_username', username);
      body1.append('rpt', '');

      await this._request('/storyProcesstcf.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body1.toString(),
      });

      // 3. Compute Turnstile fallback token & execute main query
      const cfMigrate = this.computeCfMigrate(this.userAgent);
      const body2 = new URLSearchParams();
      body2.append('text_username', username);
      body2.append('user_data', '');
      body2.append('cf_migrate', cfMigrate);

      const response = await this._request('/storyProcesstcf.php?c=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body2.toString(),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP error ${response.status}` };
      }

      const html = await response.text();
      if (!html || html.includes('No stories found') || html.includes('Account is private')) {
        return {
          success: false,
          error: 'No stories found or the account is private/not found.',
          username,
        };
      }

      return this._parseStoryHtml(html, username);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Fetches highlight albums for an Instagram user
   * @param {string} usernameOrUrl
   * @returns {Promise<Object>}
   */
  async getHighlights(usernameOrUrl) {
    const username = this.cleanUsername(usernameOrUrl);
    if (!username) {
      return { success: false, error: 'Invalid username provided.' };
    }

    try {
      await this._request('/');

      const body = new URLSearchParams();
      body.append('text_username', username);

      const response = await this._request('/highlightsmy.php?clean=25025320', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString(),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP error ${response.status}` };
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const highlights = [];

      $('li.stylefirst').each((idx, el) => {
        const item = $(el);
        const imgEl = item.find('img');
        const titleEl = item.find('.storycount');
        const btn = item.find('input[onclick]');
        const onclick = btn.attr('onclick') || '';

        const match = onclick.match(/ajaxHighlights\(\s*\d+\s*,\s*['"]([^'"]+)['"]\s*\)/);
        const sid = match ? match[1] : null;

        if (sid) {
          highlights.push({
            index: idx + 1,
            title: titleEl.text().trim() || `Highlight ${idx + 1}`,
            cover: imgEl.attr('src') || null,
            sid: sid,
          });
        }
      });

      return {
        success: true,
        username,
        total_highlights: highlights.length,
        highlights,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Fetches all stories/media inside a specific highlight album by its SID
   * @param {string} sid
   * @returns {Promise<Object>}
   */
  async getHighlightStories(sid) {
    if (!sid) {
      return { success: false, error: 'Highlight SID is required.' };
    }

    try {
      await this._request('/');

      const body = new URLSearchParams();
      body.append('sid', sid);

      const response = await this._request('/highlightProcess.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString(),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP error ${response.status}` };
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const stories = [];

      $('li.stylestory').each((idx, el) => {
        const item = $(el);
        const videoEl = item.find('video');
        const imgEl = item.find('img');
        const sourceEl = item.find('video source');
        const downloadBtn = item.find('a.button, a[download]');

        const isVideo = videoEl.length > 0;
        const mediaType = isVideo ? 'video' : (imgEl.length > 0 ? 'photo' : 'unknown');

        let poster = null;
        let mediaUrl = null;

        if (isVideo) {
          poster = videoEl.attr('poster') || null;
          mediaUrl = sourceEl.attr('src') || videoEl.attr('src') || null;
        } else if (imgEl.length > 0) {
          poster = imgEl.attr('src') || null;
          mediaUrl = poster;
        }

        const downloadUrl = downloadBtn.attr('href') || mediaUrl;

        stories.push({
          index: idx + 1,
          type: mediaType,
          thumbnail: poster,
          media_url: mediaUrl,
          download_url: downloadUrl,
        });
      });

      return {
        success: true,
        sid,
        total_stories: stories.length,
        stories,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

// CLI Execution Helper
async function runCli() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`
StorySaver.net Scraper (Node.js)
Usage:
  node scraper.js <username_or_url> [options]

Options:
  --highlights            Fetch user's highlight albums list
  --highlight-sid <sid>   Fetch stories inside a specific highlight SID
  --output, -o <file>     Save JSON result to a file
  -h, --help              Show help menu

Examples:
  node scraper.js instagram
  node scraper.js instagram --highlights
  node scraper.js --highlight-sid 18223279177302854:instagram
  node scraper.js instagram -o result.json
`);
    return;
  }

  const scraper = new StorySaverScraper();
  let target = '';
  let isHighlights = false;
  let highlightSid = null;
  let outputFile = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--highlights') {
      isHighlights = true;
    } else if (arg === '--highlight-sid') {
      highlightSid = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      outputFile = args[++i];
    } else if (!arg.startsWith('-')) {
      target = arg;
    }
  }

  let result;
  if (highlightSid) {
    result = await scraper.getHighlightStories(highlightSid);
  } else if (isHighlights) {
    if (!target) {
      console.error('Error: Username or profile URL is required for --highlights.');
      process.exit(1);
    }
    result = await scraper.getHighlights(target);
  } else {
    if (!target) {
      console.error('Error: Username or profile URL is required.');
      process.exit(1);
    }
    result = await scraper.getStories(target);
  }

  const jsonOutput = JSON.stringify(result, null, 2);
  console.log(jsonOutput);

  if (outputFile) {
    fs.writeFileSync(outputFile, jsonOutput, 'utf8');
    console.log(`\n[+] Saved results to ${outputFile}`);
  }
}

// Export for module usage & run if called directly
module.exports = { StorySaverScraper };

if (require.main === module) {
  runCli().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

/**
 * @file generator_email.js
 * @description Standalone zero-dependency Node.js SDK and CLI for generator.email
 * (Temporary / Disposable Email Generator, Inbox Poller, Domain Search, and Message Parser).
 *
 * Features:
 * - Zero external npm dependencies (pure standard Node.js & Web APIs: fetch, URL, WebSocket)
 * - Automatic CSRF/Anti-Bot API token extraction (`meta[name="api-token"]` & `X-API-Token`)
 * - Cookie-based and URL-based mailbox routing (`inbox_ctx`, `inbox_n`)
 * - Live random domain fetching (`/api/domains.php`) and keyword search (`/search.php`)
 * - Fast new message status checking (`/mark_remove.php` with `chekinbox`)
 * - Message polling with customizable timeouts, intervals, and predicate filters
 * - Rich message content parsing (HTML body, plain text, headers, attachments, raw source)
 * - Message deletion (`delete_mess` via `/mark_remove.php`)
 * - Domain uptime checks (`/uptime.php`) and Punycode conversion (`/dom_to_punycode.php`)
 * - WebSocket live push notification channel support (`/notificon/ws`)
 * - Built-in Command Line Interface (CLI) with JSON and formatted output
 */

import { fileURLToPath } from 'url';

const DEFAULT_BASE_URL = 'https://generator.email';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * Utility helper to generate random alphanumeric string
 * @param {number} length
 * @returns {string}
 */
export function generateRandomUsername(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Utility to strip HTML tags to get clean plain text
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Utility to decode standard HTML entities
 * @param {string} str
 * @returns {string}
 */
export function decodeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Main GeneratorEmail Client Class
 */
export class GeneratorEmail {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl='https://generator.email']
   * @param {string} [options.user] - Optional initial username
   * @param {string} [options.domain] - Optional initial domain
   * @param {string} [options.email] - Optional full email (e.g. user@domain.com)
   * @param {string} [options.userAgent] - Custom User-Agent header
   * @param {number} [options.timeout=15000] - Request timeout in milliseconds
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.timeout = options.timeout || 15000;

    this.apiToken = options.apiToken || '';
    this.cookies = new Map();
    this.siteData = null;

    this.user = options.user || '';
    this.domain = options.domain || '';

    if (options.email && options.email.includes('@')) {
      const parts = options.email.split('@');
      this.user = parts[0];
      this.domain = parts[1];
    }
  }

  /**
   * Returns current full email address
   * @returns {string}
   */
  getEmail() {
    if (!this.user || !this.domain) return '';
    return `${this.user}@${this.domain}`;
  }

  /**
   * Sets the active user and domain
   * @param {string} userOrEmail
   * @param {string} [domain]
   */
  setMailbox(userOrEmail, domain) {
    if (userOrEmail && userOrEmail.includes('@')) {
      const parts = userOrEmail.split('@');
      this.user = parts[0];
      this.domain = parts.slice(1).join('@');
    } else if (userOrEmail && domain) {
      this.user = userOrEmail;
      this.domain = domain;
    } else if (!userOrEmail && !domain) {
      this.user = '';
      this.domain = '';
    } else {
      throw new Error(`Invalid email address format: ${userOrEmail}`);
    }
    if (this.user && this.domain) {
      this.setCookie('inbox_ctx', `${this.domain}/${this.user}/`);
    }
    return this.getEmail();
  }

  /**
   * Internal helper: set cookie
   * @param {string} name
   * @param {string} value
   */
  setCookie(name, value) {
    this.cookies.set(name, value);
  }

  /**
   * Internal helper: get cookie value
   * @param {string} name
   * @returns {string|undefined}
   */
  getCookie(name) {
    return this.cookies.get(name);
  }

  /**
   * Internal helper: get formatted Cookie header string
   * @returns {string}
   */
  getCookieHeader() {
    const parts = [];
    for (const [name, val] of this.cookies.entries()) {
      parts.push(`${name}=${encodeURIComponent(val)}`);
    }
    return parts.join('; ');
  }

  /**
   * Alias for getCookieHeader()
   * @returns {string}
   */
  _buildCookieHeader() {
    return this.getCookieHeader();
  }

  /**
   * Internal helper: parse and store Set-Cookie headers from fetch response
   * @param {Response} response
   */
  _updateCookiesFromResponse(response) {
    let rawCookies = [];
    if (typeof response.headers.getSetCookie === 'function') {
      rawCookies = response.headers.getSetCookie();
    } else {
      const single = response.headers.get('set-cookie');
      if (single) rawCookies = [single];
    }

    for (const cookieStr of rawCookies) {
      if (!cookieStr) continue;
      const pair = cookieStr.split(';')[0];
      const eqIdx = pair.indexOf('=');
      if (eqIdx !== -1) {
        const name = pair.slice(0, eqIdx).trim();
        const val = decodeURIComponent(pair.slice(eqIdx + 1).trim());
        this.cookies.set(name, val);
      }
    }
  }

  /**
   * Internal HTTP fetch wrapper with timeout, headers, and cookie handling
   * @param {string} pathOrUrl
   * @param {RequestInit} [options={}]
   * @returns {Promise<Response>}
   */
  async _request(pathOrUrl, options = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

    const headers = {
      'User-Agent': this.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': `${this.baseUrl}/`,
      ...options.headers
    };

    const cookieHeader = this.getCookieHeader();
    if (cookieHeader && !headers['Cookie']) {
      headers['Cookie'] = cookieHeader;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      this._updateCookiesFromResponse(response);
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Initializes a session: fetches the home page, extracts CSRF token and default mailbox
   * @returns {Promise<{ email: string, user: string, domain: string, apiToken: string }>}
   */
  async initSession() {
    const response = await this._request('/');
    if (!response.ok) {
      throw new Error(`Failed to initialize session: HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Extract API token from <meta name="api-token" content="...">
    const tokenMatch = html.match(/name="api-token"\s+content="([^"]+)"/i);
    if (tokenMatch) {
      this.apiToken = tokenMatch[1];
    }

    // Extract SITE_DATA if present in HTML
    const siteDataMatch = html.match(/window\.SITE_DATA\s*=\s*(\{[\s\S]*?\});/i);
    if (siteDataMatch) {
      try {
        // Simple evaluation / JSON extraction of keys
        const rawJson = siteDataMatch[1];
        this.siteData = {
          cur_user: (rawJson.match(/cur_user\s*:\s*"([^"]+)"/) || [])[1] || '',
          cur_domain: (rawJson.match(/cur_domain\s*:\s*"([^"]+)"/) || [])[1] || '',
          cur_domain_ascii: (rawJson.match(/cur_domain_ascii\s*:\s*"([^"]+)"/) || [])[1] || '',
          secret_del_mess: (rawJson.match(/secret_del_mess\s*:\s*"([^"]+)"/) || [])[1] || '',
          num_mess: parseInt((rawJson.match(/num_mess\s*:\s*(\d+)/) || [])[1] || '0', 10)
        };
      } catch (err) {
        this.siteData = null;
      }
    }

    // If user and domain weren't set yet, extract from default page
    if (!this.user || !this.domain) {
      const emailMatch = html.match(/id="email_ch_text"[^>]*>([^<]+)</i);
      if (emailMatch && emailMatch[1].includes('@')) {
        this.setMailbox(emailMatch[1].trim());
      } else if (this.siteData && this.siteData.cur_user && this.siteData.cur_domain) {
        this.setMailbox(this.siteData.cur_user, this.siteData.cur_domain);
      }
    }

    return {
      email: this.getEmail(),
      user: this.user,
      domain: this.domain,
      apiToken: this.apiToken
    };
  }

  /**
   * Ensures an API token exists, fetching one if necessary
   * @private
   */
  async _ensureToken() {
    if (!this.apiToken) {
      await this.initSession();
    }
  }

  /**
   * Fetches the list of active random domains from /api/domains.php
   * @returns {Promise<Array<{ ascii: string, display: string, idn: boolean }>>}
   */
  async getDomains() {
    await this._ensureToken();

    const response = await this._request('/api/domains.php', {
      headers: {
        'X-API-Token': this.apiToken,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch domains: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(`Unexpected domains response format: ${JSON.stringify(data)}`);
    }

    return data;
  }

  /**
   * Searches for available domains matching a keyword
   * @param {string} keyword
   * @returns {Promise<string[]>} List of domain names
   */
  async searchDomains(keyword) {
    if (!keyword) throw new Error('Search keyword cannot be empty');
    await this._ensureToken();

    const url = `/search.php?key=${encodeURIComponent(keyword)}`;
    const response = await this._request(url, {
      headers: {
        'X-API-Token': this.apiToken,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      }
    });

    if (!response.ok) {
      throw new Error(`Domain search failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Generates and sets a fresh random email address from available domains
   * @param {Object} [options={}]
   * @param {string} [options.prefix] - Optional username prefix
   * @param {number} [options.length=8] - Random username length
   * @param {string} [options.domain] - Specific domain to use (picks random active domain if omitted)
   * @returns {Promise<string>} The new generated email address
   */
  async generateRandomEmail(options = {}) {
    const userLength = options.length || 8;
    const prefix = options.prefix || '';
    const randomUser = prefix ? `${prefix}${generateRandomUsername(userLength)}` : generateRandomUsername(userLength);

    let chosenDomain = options.domain;
    if (!chosenDomain) {
      try {
        const domains = await this.getDomains();
        if (domains && domains.length > 0) {
          const randomIndex = Math.floor(Math.random() * domains.length);
          chosenDomain = domains[randomIndex].ascii || domains[randomIndex].display;
        }
      } catch (err) {
        // Fallback domain if API fails
        chosenDomain = 'kakao-mail.com';
      }
    }

    if (!chosenDomain) chosenDomain = 'kakao-mail.com';

    this.setMailbox(randomUser, chosenDomain);
    return this.getEmail();
  }

  /**
   * Checks for new message count for the current or specified email
   * @param {string} [email]
   * @returns {Promise<{ hasNew: boolean, count: number, raw: string }>}
   */
  async checkNewMessages(email = this.getEmail()) {
    if (!email) throw new Error('No email address provided or configured');

    const response = await this._request('/mark_remove.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': this.baseUrl,
        'Referer': `${this.baseUrl}/`
      },
      body: `chekinbox=${encodeURIComponent(email.toLowerCase())}`
    });

    if (!response.ok) {
      throw new Error(`Failed to check inbox status: HTTP ${response.status}`);
    }

    const raw = (await response.text()).trim();
    const count = parseInt(raw, 10);
    const isValidCount = !isNaN(count);

    return {
      hasNew: isValidCount ? count > 0 : false,
      count: isValidCount ? count : 0,
      raw
    };
  }

  /**
   * Checks domain uptime and health status
   * @param {string} [domain=this.domain]
   * @param {string} [user=this.user]
   * @returns {Promise<{ status: string, uptime: string, raw: string }>}
   */
  async checkDomainUptime(domain = this.domain, user = this.user) {
    if (!domain) throw new Error('Domain required for uptime check');

    const response = await this._request('/uptime.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': this.baseUrl,
        'Referer': `${this.baseUrl}/`
      },
      body: `dmn=${encodeURIComponent(domain)}&usr=${encodeURIComponent(user || 'user')}`
    });

    if (!response.ok) {
      throw new Error(`Failed to check uptime: HTTP ${response.status}`);
    }

    const raw = await response.text();
    try {
      const json = JSON.parse(raw);
      return {
        status: json.status || 'unknown',
        uptime: json.uptime || '0',
        raw
      };
    } catch {
      return { status: 'unknown', uptime: '0', raw };
    }
  }

  /**
   * Converts internationalized domain to punycode ASCII
   * @param {string} domain
   * @returns {Promise<string>}
   */
  async convertToPunycode(domain) {
    if (!domain) throw new Error('Domain required');

    const response = await this._request('/dom_to_punycode.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': this.baseUrl,
        'Referer': `${this.baseUrl}/`
      },
      body: `dmn=${encodeURIComponent(domain)}`
    });

    if (!response.ok) {
      throw new Error(`Failed to convert punycode: HTTP ${response.status}`);
    }

    return (await response.text()).trim();
  }

  /**
   * Retrieves the inbox overview and list of email messages
   * @param {Object} [options={}]
   * @param {string} [options.email] - Optional specific email address to inspect
   * @returns {Promise<{ email: string, user: string, domain: string, messageCount: number, messages: Array<Object>, activeMessage: Object|null }>}
   */
  async getInbox(options = {}) {
    if (options.email) {
      this.setMailbox(options.email);
    }
    if (!this.user || !this.domain) {
      await this.initSession();
    }

    const inboxUrl = `/${this.domain}/${this.user}`;
    this.setCookie('inbox_ctx', `${this.domain}/${this.user}/`);

    const response = await this._request(inboxUrl);
    if (!response.ok) {
      throw new Error(`Failed to load inbox for ${this.getEmail()}: HTTP ${response.status}`);
    }

    const html = await response.text();
    return this._parseInboxHtml(html);
  }

  /**
   * Internal parser for mailbox HTML pages
   * @private
   * @param {string} html
   * @returns {Object}
   */
  _parseInboxHtml(html) {
    // Extract current email
    const emailMatch = html.match(/id="email_ch_text"[^>]*>([^<]+)</i);
    const email = emailMatch ? emailMatch[1].trim() : this.getEmail();

    // Extract SITE_DATA
    const siteDataMatch = html.match(/window\.SITE_DATA\s*=\s*(\{[\s\S]*?\});/i);
    let secretDel = '';
    let msgCount = 0;
    let curMsgId = '';
    let bodyFinded = 1;

    if (siteDataMatch) {
      const rawJson = siteDataMatch[1];
      secretDel = (rawJson.match(/secret_del_mess\s*:\s*"([^"]+)"/) || [])[1] || '';
      msgCount = parseInt((rawJson.match(/num_mess\s*:\s*(\d+)/) || [])[1] || '0', 10);
      curMsgId = (rawJson.match(/cur_msg_id\s*:\s*"([^"]+)"/) || [])[1] || '';
      const bfMatch = rawJson.match(/body_finded\s*:\s*(\d+)/);
      if (bfMatch) {
        bodyFinded = parseInt(bfMatch[1], 10);
      }
    }

    // Parse list of messages from #email-table and .list-group-item / loadInboxClientSide
    const messages = [];
    const itemRegex = /onclick="loadInboxClientSide\('([^']+)'\)"[^>]*>([\s\S]*?)(?=(?:onclick="loadInboxClientSide|<\/div>\s*<\/div>\s*<div\s+class="panel|<div\s+class="panel-head|<div\s+id="markodile"|$))/gi;

    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const link = match[1];
      const itemContent = match[2];

      const fromMatch = itemContent.match(/class="[^"]*from_div[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const subjMatch = itemContent.match(/class="[^"]*subj_div[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const timeMatch = itemContent.match(/class="[^"]*time_div[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

      // Extract message ID from link if present (e.g. /domain/user/msgId)
      const linkParts = link.split('/').filter(Boolean);
      const messageId = linkParts.length >= 3 ? linkParts[2] : link;

      messages.push({
        id: messageId,
        from: fromMatch ? decodeHtml(fromMatch[1].trim()) : '',
        subject: subjMatch ? decodeHtml(subjMatch[1].trim()) : '',
        time: timeMatch ? decodeHtml(timeMatch[1].trim()) : '',
        link: link
      });
    }

    // Parse Active / Current Message details if rendered in this view
    let activeMessage = null;
    const bodyContentMatch = html.match(/id="mail-summary-body"[^>]*>([\s\S]*?)(?=(?:<div\s+class="mailsrc|<div\s+id="mailsrc|<pre|<ins\s+class="adsbygoogle|<\/body>|$))/i) ||
                             html.match(/class="[^"]*panel-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const subjWrapMatch = html.match(/class="[^"]*subj-h1[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/class="[^"]*subj_div_45g45gg[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const fromDetailMatch = html.match(/class="[^"]*from_div_45g45gg[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const timeDetailMatch = html.match(/class="[^"]*time_div_45g45gg[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    // Attachments extraction
    const attachments = [];
    const atchRegex = /<a\b[^>]*\bclass="[^"]*atch-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let atchMatch;
    while ((atchMatch = atchRegex.exec(html)) !== null) {
      const fullTag = atchMatch[0];
      const innerHtml = atchMatch[1];
      const hrefMatch = fullTag.match(/href="([^"]+)"/i) || fullTag.match(/href='([^']+)'/i);
      const href = hrefMatch ? hrefMatch[1] : '';
      const linkText = stripHtml(innerHtml);
      const sizeMatch = innerHtml.match(/class="[^"]*atch-size[^"]*"[^>]*>([^<]+)</i);
      attachments.push({
        url: href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`,
        filename: linkText.replace(sizeMatch ? sizeMatch[1] : '', '').trim(),
        size: sizeMatch ? sizeMatch[1].trim() : ''
      });
    }

    // Raw email source if present
    const rawSourceMatch = html.match(/<pre[^>]*class="[^"]*mailsrc[^"]*"[^>]*>([\s\S]*?)<\/pre>/i);

    if (bodyFinded === 1 && (bodyContentMatch || subjWrapMatch)) {
      const rawHtmlBody = bodyContentMatch ? (bodyContentMatch[1] || bodyContentMatch[0]) : '';
      activeMessage = {
        id: curMsgId || (messages.length > 0 ? messages[0].id : ''),
        subject: subjWrapMatch ? stripHtml(subjWrapMatch[1]) : '',
        from: fromDetailMatch ? stripHtml(fromDetailMatch[1]) : '',
        time: timeDetailMatch ? stripHtml(timeDetailMatch[1]) : '',
        html: rawHtmlBody,
        text: stripHtml(rawHtmlBody),
        attachments,
        rawSource: rawSourceMatch ? stripHtml(rawSourceMatch[1]) : null,
        deleteToken: secretDel
      };
    }

    return {
      email,
      user: this.user,
      domain: this.domain,
      messageCount: Math.max(msgCount, messages.length),
      messages,
      activeMessage
    };
  }

  /**
   * Retrieves a specific message by its message ID or full relative path
   * @param {string} messageId
   * @returns {Promise<Object>} The parsed message details
   */
  async getMessage(messageId) {
    if (!messageId) throw new Error('Message ID required');
    if (!this.user || !this.domain) {
      await this.initSession();
    }

    const path = messageId.startsWith('/') ? messageId : `/${this.domain}/${this.user}/${messageId}`;
    this.setCookie('inbox_ctx', `${this.domain}/${this.user}/${messageId}`);

    const response = await this._request(path);
    if (!response.ok) {
      throw new Error(`Failed to load message ${messageId}: HTTP ${response.status}`);
    }

    const html = await response.text();
    const inbox = this._parseInboxHtml(html);
    if (!inbox.activeMessage) {
      throw new Error(`Could not parse message content for ID: ${messageId}`);
    }

    return inbox.activeMessage;
  }

  /**
   * Deletes a message using its secret delete token
   * @param {string} [secretToken] - The message delete token (defaults to current active message token)
   * @returns {Promise<boolean>} True if successfully deleted
   */
  async deleteMessage(secretToken) {
    const token = secretToken || (this.siteData && this.siteData.secret_del_mess);
    if (!token) {
      throw new Error('No delete token provided');
    }

    const response = await this._request('/mark_remove.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': this.baseUrl,
        'Referer': `${this.baseUrl}/`
      },
      body: `delete_mess=${encodeURIComponent(token)}`
    });

    if (!response.ok) {
      throw new Error(`Failed to delete message: HTTP ${response.status}`);
    }

    const text = (await response.text()).trim();
    return text === 'Message deleted successfully' || text.includes('successfully');
  }

  /**
   * Polls the mailbox until a message arrives matching an optional predicate
   * @param {Object} [options={}]
   * @param {number} [options.timeoutMs=60000] - Maximum waiting time in ms (default 60s)
   * @param {number} [options.pollIntervalMs=3000] - Polling interval in ms (default 3s)
   * @param {Function} [options.predicate] - Optional filter function (msg => boolean)
   * @param {Function} [options.onPoll] - Optional callback invoked on each poll attempt
   * @returns {Promise<Object>} The first matching message or active message
   */
  async waitForMessage(options = {}) {
    const timeoutMs = options.timeoutMs || 60000;
    const pollIntervalMs = options.pollIntervalMs || 3000;
    const predicate = options.predicate || null;
    const onPoll = options.onPoll || null;

    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
      attempt++;
      if (typeof onPoll === 'function') {
        onPoll({ attempt, elapsedMs: Date.now() - startTime });
      }

      // Fast check via /mark_remove.php
      try {
        const check = await this.checkNewMessages();
        if (check.hasNew || check.count > 0) {
          const inbox = await this.getInbox();
          if (inbox.messages && inbox.messages.length > 0) {
            for (const msg of inbox.messages) {
              if (!predicate || predicate(msg)) {
                return await this.getMessage(msg.id);
              }
            }
          }
          if (inbox.activeMessage && (!predicate || predicate(inbox.activeMessage))) {
            return inbox.activeMessage;
          }
        }
      } catch (err) {
        // Continue on transient network blip
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Timed out waiting for message after ${timeoutMs}ms (${attempt} attempts)`);
  }

  /**
   * Returns the live WebSocket notification URL for the current mailbox
   * @param {string} [email=this.getEmail()]
   * @returns {string}
   */
  getWebSocketUrl(email = this.getEmail()) {
    if (!email) throw new Error('Email address required for WebSocket connection');
    const host = this.baseUrl.replace(/^https?:\/\//, '');
    return `wss://${host}/notificon/ws?email=${encodeURIComponent(email)}`;
  }
}

// ---------------------------------------------------------------------------
// CLI Execution Handler
// ---------------------------------------------------------------------------
async function runCli() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
generator.email - Standalone Zero-Dependency Temporary Email CLI

Usage:
  node generator_email.js [command] [options]

Commands:
  --random                 Generate a fresh random temporary email address
  --domains                List active random domains
  --search <keyword>       Search domains matching keyword
  --inbox [email]          Check inbox and list messages for email
  --message <id> [email]   Read specific message by ID
  --wait [email]           Wait / poll for incoming message (timeout: 60s)
  --uptime [domain]        Check domain uptime status
  --punycode <domain>      Convert international domain to Punycode ASCII

Options:
  --json                   Output raw JSON format
  --timeout <ms>           Set timeout in milliseconds (default: 60000 for wait)
  --help, -h               Show this help message

Examples:
  node generator_email.js --random
  node generator_email.js --domains --json
  node generator_email.js --search mail
  node generator_email.js --inbox testuser@c-newstv.ru
  node generator_email.js --wait mytemp123@kakao-mail.com
`);
    return;
  }

  const isJson = args.includes('--json');
  const client = new GeneratorEmail();

  try {
    if (args.includes('--random')) {
      const domainIdx = args.indexOf('--domain');
      const domain = domainIdx !== -1 ? args[domainIdx + 1] : undefined;
      const email = await client.generateRandomEmail({ domain });
      if (isJson) {
        console.log(JSON.stringify({ email, user: client.user, domain: client.domain }, null, 2));
      } else {
        console.log(`Generated Email: ${email}`);
        console.log(`Inbox URL:       ${client.baseUrl}/${client.domain}/${client.user}`);
        console.log(`WebSocket URL:   ${client.getWebSocketUrl()}`);
      }
      return;
    }

    if (args.includes('--domains')) {
      const domains = await client.getDomains();
      if (isJson) {
        console.log(JSON.stringify(domains, null, 2));
      } else {
        console.log(`Active Domains (${domains.length} total):`);
        domains.forEach((d, i) => {
          console.log(`  ${(i + 1).toString().padStart(2, ' ')}. ${d.ascii}${d.idn ? ` (${d.display})` : ''}`);
        });
      }
      return;
    }

    const searchIdx = args.indexOf('--search');
    if (searchIdx !== -1) {
      const keyword = args[searchIdx + 1];
      if (!keyword) {
        console.error('Error: Please specify a search term. Example: --search mail');
        process.exit(1);
      }
      const results = await client.searchDomains(keyword);
      if (isJson) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(`Search Results for "${keyword}" (${results.length} found):`);
        results.forEach((d, i) => console.log(`  ${(i + 1).toString().padStart(2, ' ')}. ${d}`));
      }
      return;
    }

    const inboxIdx = args.indexOf('--inbox');
    if (inboxIdx !== -1) {
      const emailArg = args[inboxIdx + 1];
      const targetEmail = (emailArg && !emailArg.startsWith('--')) ? emailArg : undefined;
      const inbox = await client.getInbox({ email: targetEmail });
      if (isJson) {
        console.log(JSON.stringify(inbox, null, 2));
      } else {
        console.log(`Inbox for:     ${inbox.email}`);
        console.log(`Messages:      ${inbox.messageCount}`);
        if (inbox.messages.length > 0) {
          console.log('\nMessage List:');
          inbox.messages.forEach((m, i) => {
            console.log(`  [${i + 1}] ID: ${m.id} | From: ${m.from} | Subj: ${m.subject} | Time: ${m.time}`);
          });
        } else {
          console.log('\n(Inbox is empty)');
        }
      }
      return;
    }

    const msgIdx = args.indexOf('--message');
    if (msgIdx !== -1) {
      const msgId = args[msgIdx + 1];
      const emailArg = args[msgIdx + 2];
      if (!msgId) {
        console.error('Error: Please specify a message ID.');
        process.exit(1);
      }
      if (emailArg && !emailArg.startsWith('--')) {
        client.setMailbox(emailArg);
      }
      const msg = await client.getMessage(msgId);
      if (isJson) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        console.log(`Subject:  ${msg.subject}`);
        console.log(`From:     ${msg.from}`);
        console.log(`Time:     ${msg.time}`);
        console.log(`Attachments: ${msg.attachments.length}`);
        console.log('\n--- Content ---\n');
        console.log(msg.text || msg.html);
      }
      return;
    }

    const uptimeIdx = args.indexOf('--uptime');
    if (uptimeIdx !== -1) {
      const dmn = args[uptimeIdx + 1] || 'kakao-mail.com';
      const up = await client.checkDomainUptime(dmn);
      if (isJson) {
        console.log(JSON.stringify(up, null, 2));
      } else {
        console.log(`Uptime for ${dmn}: Status=${up.status}, Uptime=${up.uptime}s`);
      }
      return;
    }

    const punyIdx = args.indexOf('--punycode');
    if (punyIdx !== -1) {
      const dmn = args[punyIdx + 1];
      if (!dmn) {
        console.error('Error: Please provide domain to convert.');
        process.exit(1);
      }
      const puny = await client.convertToPunycode(dmn);
      if (isJson) {
        console.log(JSON.stringify({ domain: dmn, punycode: puny }, null, 2));
      } else {
        console.log(`Punycode: ${puny}`);
      }
      return;
    }

    const waitIdx = args.indexOf('--wait');
    if (waitIdx !== -1) {
      const emailArg = args[waitIdx + 1];
      if (emailArg && !emailArg.startsWith('--')) {
        client.setMailbox(emailArg);
      } else {
        await client.initSession();
      }
      console.log(`Waiting for emails to arrive at: ${client.getEmail()} ...`);
      const msg = await client.waitForMessage({
        timeoutMs: 30000,
        onPoll: ({ attempt }) => process.stdout.write(`\rPolling attempt ${attempt}...`)
      });
      console.log('\n\n[!] Email received!');
      console.log(`From:    ${msg.from}`);
      console.log(`Subject: ${msg.subject}`);
      console.log(`Body:    ${msg.text}`);
      return;
    }

  } catch (err) {
    if (isJson) {
      console.error(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

// Execute CLI if run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli();
}

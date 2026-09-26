/*
 * Pinterest Download
 *
 * Author: Dippy (https://github.com/Dipper3142)
 * Base: https://www.bratgenerator.com/
 * Source: https://whatsapp.com/channel/0029Vb93wNfD8SE6mgz31526
 *
 * Note1: Jangan di hapus we em nya, hargai dev-scraper kecil :) (BANYAK PAKE TOKEN BJIR)
 */

/**
 * ============================================================================
 * KLICKPIN PINTEREST DOWNLOADER - 100% INDEPENDENT STANDALONE SINGLE-FILE
 * ============================================================================
 * 
 * Zero external npm dependencies. Pure standard Node.js library.
 * Fully embedded Pinterest URL resolver, media parser, streaming proxy, 
 * REST API, CLI, and responsive Web UI.
 *
 * USAGE:
 *   1. Start Web Server:
 *      node standalone.js
 *      node standalone.js --serve 3001
 *
 *   2. CLI Extraction / Download:
 *      node standalone.js https://pin.it/example
 *      node standalone.js https://pinterest.com/pin/12345/ --download
 *
 *   3. Import as an ES Module:
 *      import { extractPinterestMedia, downloadMediaFile } from './standalone.js';
 *      const media = await extractPinterestMedia('https://pin.it/xyz');
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { Readable } from 'stream';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Chromium";v="130", "Google Chrome";v="130"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

// ---------------------------------------------------------------------------
// 1. PINTEREST URL RESOLVER
// ---------------------------------------------------------------------------
export async function resolvePinterestUrl(inputUrl) {
  const cleanUrl = String(inputUrl || '').trim();
  if (!cleanUrl) throw new Error('URL cannot be empty');

  try {
    const res = await fetch(cleanUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: BROWSER_HEADERS
    });
    return {
      resolvedUrl: res.url,
      status: res.status,
      html: await res.text()
    };
  } catch (err) {
    throw new Error('Failed to resolve Pinterest URL: ' + err.message);
  }
}

export function extractPinId(pinUrl) {
  const match = String(pinUrl).match(/\/pin\/(\d+)/) || String(pinUrl).match(/\/pin\/([A-Za-z0-9\-_]+)/);
  return match ? match[1] : null;
}

export function sanitizeFileName(str) {
  return (str || 'pinterest_download').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 50);
}

export function decodeHtmlEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

// ---------------------------------------------------------------------------
// 2. CORE MEDIA SCRAPER & METADATA EXTRACTION ENGINE
// ---------------------------------------------------------------------------
export async function extractPinterestMedia(targetUrl) {
  const { resolvedUrl, html } = await resolvePinterestUrl(targetUrl);
  const pinId = extractPinId(resolvedUrl) || extractPinId(targetUrl);

  // 1. Metadata Extraction (Title, Description, Author)
  let title = 'Pinterest Media';
  let description = '';
  let author = '';

  const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i);
  if (ogTitle) title = decodeHtmlEntities(ogTitle[1]);

  const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/i);
  if (ogDesc) description = decodeHtmlEntities(ogDesc[1]);

  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const schema = JSON.parse(jsonLdMatch[1]);
      if (schema.name) title = schema.name;
      if (schema.headline) title = schema.headline;
      if (schema.description) description = schema.description;
      if (schema.author && schema.author.name) author = schema.author.name;
    } catch (e) {}
  }

  // 2. Video Extraction
  const videos = [];
  const videoUrls = new Set();

  const vRegex = /https?:\\\/\\\/v\.pinimg\.com\\\/videos\\\/[^\s"'>\\]+|https?:\/\/v\.pinimg\.com\/videos\/[^\s"'>\\]+/gi;
  let vMatch;
  while ((vMatch = vRegex.exec(html)) !== null) {
    const clean = vMatch[0].replace(/\\\//g, '/').replace(/\u0026/g, '&').replace(/[\);'"]+.*$/, '');
    videoUrls.add(clean);
  }

  const ogVideo = html.match(/<meta property="og:video:secure_url" content="([^"]+)"/i) || html.match(/<meta property="og:video" content="([^"]+)"/i);
  if (ogVideo) {
    videoUrls.add(ogVideo[1]);
  }

  for (const vUrl of videoUrls) {
    let quality = 'Standard Video (MP4)';
    let resolution = '480p';
    let isHls = vUrl.includes('.m3u8');

    if (vUrl.includes('/1080p/')) {
      quality = 'Full HD Video (1080p)';
      resolution = '1080p';
    } else if (vUrl.includes('/720p/')) {
      quality = 'HD Video (720p)';
      resolution = '720p';
    } else if (vUrl.includes('/480p/')) {
      quality = 'SD Video (480p)';
      resolution = '480p';
    } else if (isHls) {
      quality = 'HLS Video Stream (m3u8)';
      resolution = 'Adaptive';
    }

    videos.push({
      type: 'video',
      quality,
      resolution,
      format: isHls ? 'm3u8' : 'mp4',
      url: vUrl,
      proxyDownloadUrl: '/api/download-proxy?url=' + encodeURIComponent(vUrl) + '&name=' + encodeURIComponent(sanitizeFileName(title) + '_' + resolution + '.mp4')
    });
  }

  const qualityWeight = { '1080p': 3, '720p': 2, '480p': 1, 'Adaptive': 0 };
  videos.sort((a, b) => (qualityWeight[b.resolution] || 0) - (qualityWeight[a.resolution] || 0));

  // 3. Image Extraction
  const images = [];
  const imageUrls = new Set();

  const origRegex = /https?:\\\/\\\/i\.pinimg\.com\\\/originals\\\/[^\s"'>\\]+|https?:\/\/i\.pinimg\.com\/originals\/[^\s"'>\\]+/gi;
  let oMatch;
  while ((oMatch = origRegex.exec(html)) !== null) {
    const clean = oMatch[0].replace(/\\\//g, '/').replace(/\u0026/g, '&').replace(/[\);'"]+.*$/, '');
    imageUrls.add(clean);
  }

  const img736Regex = /https?:\\\/\\\/i\.pinimg\.com\\\/736x\\\/[^\s"'>\\]+|https?:\/\/i\.pinimg\.com\/736x\/[^\s"'>\\]+/gi;
  let imgMatch;
  while ((imgMatch = img736Regex.exec(html)) !== null) {
    const clean = imgMatch[0].replace(/\\\//g, '/').replace(/\u0026/g, '&').replace(/[\);'"]+.*$/, '');
    const derivedOrig = clean.replace('/736x/', '/originals/');
    imageUrls.add(derivedOrig);
    imageUrls.add(clean);
  }

  const ogImg = html.match(/<meta property="og:image" content="([^"]+)"/i);
  if (ogImg) {
    imageUrls.add(ogImg[1].replace('/736x/', '/originals/'));
    imageUrls.add(ogImg[1]);
  }

  for (const imgUrl of imageUrls) {
    const isOrig = imgUrl.includes('/originals/');
    const ext = imgUrl.endsWith('.png') ? 'png' : imgUrl.endsWith('.webp') ? 'webp' : imgUrl.endsWith('.gif') ? 'gif' : 'jpg';
    const quality = isOrig ? 'Original Full Resolution (HD)' : 'Standard High Res (736p)';
    
    images.push({
      type: 'image',
      quality,
      resolution: isOrig ? 'Original' : '736p',
      format: ext,
      url: imgUrl,
      proxyDownloadUrl: '/api/download-proxy?url=' + encodeURIComponent(imgUrl) + '&name=' + encodeURIComponent(sanitizeFileName(title) + (isOrig ? '_original.' : '_736p.') + ext)
    });
  }

  images.sort((a, b) => (b.resolution === 'Original' ? 1 : 0) - (a.resolution === 'Original' ? 1 : 0));

  const bestThumbnail = (images[0] && images[0].url) || (ogImg ? ogImg[1] : null);

  return {
    success: true,
    pinId,
    resolvedUrl,
    title,
    description,
    author,
    thumbnail: bestThumbnail,
    hasVideo: videos.length > 0,
    videos,
    images
  };
}

// ---------------------------------------------------------------------------
// 3. STREAMING DOWNLOAD PROXY (Solves CORS and Sets Download Headers)
// ---------------------------------------------------------------------------
export async function handleStreamingProxy(req, res, targetMediaUrl, fileName) {
  try {
    const remoteRes = await fetch(targetMediaUrl, {
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        'Referer': 'https://www.pinterest.com/'
      }
    });

    if (!remoteRes.ok) {
      res.writeHead(remoteRes.status, { 'Content-Type': 'text/plain' });
      res.end('Failed to fetch remote media: ' + remoteRes.statusText);
      return;
    }

    const contentType = remoteRes.headers.get('content-type') || 'application/octet-stream';
    const contentLength = remoteRes.headers.get('content-length');

    const headers = {
      'Content-Type': contentType,
      'Content-Disposition': 'attachment; filename="' + (fileName || 'download') + '"',
      'Access-Control-Allow-Origin': '*'
    };
    if (contentLength) headers['Content-Length'] = contentLength;

    res.writeHead(200, headers);

    if (remoteRes.body && typeof remoteRes.body.getReader === 'function') {
      const nodeStream = Readable.fromWeb(remoteRes.body);
      nodeStream.pipe(res);
    } else {
      const buffer = Buffer.from(await remoteRes.arrayBuffer());
      res.end(buffer);
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    res.end('Proxy error: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// 4. CLI FILE DOWNLOAD HELPER
// ---------------------------------------------------------------------------
export async function downloadMediaFile(mediaUrl, outputPath) {
  const res = await fetch(mediaUrl, {
    headers: {
      'User-Agent': BROWSER_HEADERS['User-Agent'],
      'Referer': 'https://www.pinterest.com/'
    }
  });

  if (!res.ok) throw new Error('Download failed with status: ' + res.status);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ---------------------------------------------------------------------------
// 5. EMBEDDED WEB INTERFACE
// ---------------------------------------------------------------------------
export function getEmbeddedHtml() {
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>KlickPin - Pinterest Video & Image Downloader (Standalone)</title>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link href=\"https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">\n  <style>\n    :root {\n      --primary: #E60023;\n      --primary-hover: #ad081b;\n      --bg: #0f172a;\n      --card-bg: #1e293b;\n      --border: #334155;\n      --text: #f8fafc;\n      --text-muted: #94a3b8;\n      --success: #10b981;\n    }\n    * { box-sizing: border-box; margin: 0; padding: 0; }\n    body {\n      font-family: 'Plus Jakarta Sans', sans-serif;\n      background-color: var(--bg);\n      color: var(--text);\n      min-height: 100vh;\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      padding: 32px 16px;\n    }\n    header {\n      text-align: center;\n      max-width: 650px;\n      margin-bottom: 32px;\n    }\n    .badge {\n      display: inline-block;\n      padding: 4px 12px;\n      border-radius: 9999px;\n      background: rgba(230, 0, 35, 0.15);\n      color: #ff4d6d;\n      font-size: 0.8rem;\n      font-weight: 700;\n      text-transform: uppercase;\n      letter-spacing: 0.05em;\n      margin-bottom: 12px;\n    }\n    h1 {\n      font-size: 2.5rem;\n      font-weight: 800;\n      letter-spacing: -0.03em;\n      margin-bottom: 8px;\n    }\n    h1 span { color: var(--primary); }\n    p.lead {\n      color: var(--text-muted);\n      font-size: 1.05rem;\n    }\n    .search-card {\n      background: var(--card-bg);\n      border: 1px solid var(--border);\n      border-radius: 16px;\n      padding: 24px;\n      width: 100%;\n      max-width: 760px;\n      box-shadow: 0 20px 40px rgba(0,0,0,0.4);\n      margin-bottom: 32px;\n    }\n    .input-form {\n      display: flex;\n      flex-direction: column;\n      gap: 12px;\n    }\n    @media (min-width: 640px) {\n      .input-form {\n        flex-direction: row;\n      }\n    }\n    input[type=\"url\"] {\n      flex: 1;\n      padding: 16px 20px;\n      border-radius: 12px;\n      border: 1px solid var(--border);\n      background: #0b1120;\n      color: #fff;\n      font-size: 1rem;\n      outline: none;\n      transition: border-color 0.2s;\n    }\n    input[type=\"url\"]:focus {\n      border-color: var(--primary);\n    }\n    button.btn-search {\n      padding: 16px 28px;\n      border-radius: 12px;\n      border: none;\n      background: var(--primary);\n      color: #fff;\n      font-weight: 700;\n      font-size: 1rem;\n      cursor: pointer;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      gap: 8px;\n      transition: background 0.2s, transform 0.1s;\n    }\n    button.btn-search:hover {\n      background: var(--primary-hover);\n      transform: translateY(-1px);\n    }\n    button.btn-search:disabled {\n      opacity: 0.6;\n      cursor: not-allowed;\n    }\n    #loading {\n      display: none;\n      text-align: center;\n      padding: 20px;\n      color: var(--text-muted);\n      font-weight: 500;\n    }\n    .spinner {\n      border: 3px solid rgba(255,255,255,0.1);\n      border-top-color: var(--primary);\n      border-radius: 50%;\n      width: 28px;\n      height: 28px;\n      animation: spin 0.8s linear infinite;\n      margin: 0 auto 12px;\n    }\n    @keyframes spin { to { transform: rotate(360deg); } }\n    #results {\n      width: 100%;\n      max-width: 760px;\n      display: none;\n    }\n    .result-card {\n      background: var(--card-bg);\n      border: 1px solid var(--border);\n      border-radius: 16px;\n      padding: 24px;\n      display: flex;\n      flex-direction: column;\n      gap: 20px;\n      margin-bottom: 24px;\n    }\n    @media (min-width: 640px) {\n      .result-card {\n        flex-direction: row;\n      }\n    }\n    .media-preview {\n      width: 100%;\n      max-width: 240px;\n      border-radius: 12px;\n      overflow: hidden;\n      background: #000;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n    }\n    .media-preview img, .media-preview video {\n      width: 100%;\n      height: auto;\n      display: block;\n      object-fit: cover;\n    }\n    .media-details {\n      flex: 1;\n      display: flex;\n      flex-direction: column;\n      gap: 12px;\n    }\n    .media-title {\n      font-size: 1.25rem;\n      font-weight: 700;\n      line-height: 1.3;\n    }\n    .media-desc {\n      color: var(--text-muted);\n      font-size: 0.9rem;\n      line-height: 1.5;\n    }\n    .downloads-list {\n      display: flex;\n      flex-direction: column;\n      gap: 8px;\n      margin-top: 8px;\n    }\n    .dl-btn {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      padding: 12px 16px;\n      background: #0b1120;\n      border: 1px solid var(--border);\n      border-radius: 8px;\n      color: #fff;\n      text-decoration: none;\n      font-weight: 600;\n      font-size: 0.9rem;\n      transition: background 0.2s, border-color 0.2s;\n    }\n    .dl-btn:hover {\n      background: #1e293b;\n      border-color: var(--primary);\n    }\n    .dl-tag {\n      background: rgba(230, 0, 35, 0.2);\n      color: #ff4d6d;\n      padding: 2px 8px;\n      border-radius: 4px;\n      font-size: 0.75rem;\n      font-weight: 700;\n    }\n    .features {\n      display: grid;\n      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));\n      gap: 16px;\n      width: 100%;\n      max-width: 760px;\n      margin-top: 16px;\n    }\n    .feature-item {\n      background: var(--card-bg);\n      border: 1px solid var(--border);\n      border-radius: 12px;\n      padding: 16px;\n      text-align: center;\n    }\n    .feature-item h3 {\n      font-size: 1rem;\n      margin-bottom: 6px;\n      color: #fff;\n    }\n    .feature-item p {\n      font-size: 0.85rem;\n      color: var(--text-muted);\n    }\n    #errorBox {\n      display: none;\n      background: rgba(239, 68, 68, 0.15);\n      border: 1px solid #ef4444;\n      color: #fca5a5;\n      padding: 16px;\n      border-radius: 12px;\n      width: 100%;\n      max-width: 760px;\n      margin-bottom: 24px;\n    }\n  </style>\n</head>\n<body>\n  <header>\n    <div class=\"badge\">Standalone 100% Independent Node.js</div>\n    <h1>KlickPin <span>Downloader</span></h1>\n    <p class=\"lead\">Download Full HD Videos (1080p, 720p), GIFs, & Original HD Images from Pinterest with zero dependencies.</p>\n  </header>\n\n  <div class=\"search-card\">\n    <form class=\"input-form\" onsubmit=\"handleExtract(event)\">\n      <input type=\"url\" id=\"pinUrl\" placeholder=\"Paste Pinterest link (e.g. https://pin.it/... or https://pinterest.com/pin/...)\" required autocomplete=\"off\">\n      <button type=\"submit\" class=\"btn-search\" id=\"submitBtn\">Fetch Media</button>\n    </form>\n  </div>\n\n  <div id=\"loading\">\n    <div class=\"spinner\"></div>\n    Extracting media formats, HD video streams & original photos...\n  </div>\n\n  <div id=\"errorBox\"></div>\n\n  <div id=\"results\">\n    <div class=\"result-card\">\n      <div class=\"media-preview\" id=\"mediaPreview\"></div>\n      <div class=\"media-details\">\n        <h2 class=\"media-title\" id=\"mediaTitle\"></h2>\n        <p class=\"media-desc\" id=\"mediaDesc\"></p>\n        <div class=\"downloads-list\" id=\"downloadsList\"></div>\n      </div>\n    </div>\n  </div>\n\n  <div class=\"features\">\n    <div class=\"feature-item\">\n      <h3>🚀 Shortlinks Supported</h3>\n      <p>Seamlessly resolves pin.it redirects automatically.</p>\n    </div>\n    <div class=\"feature-item\">\n      <h3>🎬 1080p & 720p HD Video</h3>\n      <p>Direct MP4 streaming proxy with proper attachments.</p>\n    </div>\n    <div class=\"feature-item\">\n      <h3>📸 Original HD Photos</h3>\n      <p>Pulls full-resolution source graphics directly.</p>\n    </div>\n  </div>\n\n  <script>\n    async function handleExtract(e) {\n      e.preventDefault();\n      const urlInput = document.getElementById('pinUrl');\n      const submitBtn = document.getElementById('submitBtn');\n      const loading = document.getElementById('loading');\n      const results = document.getElementById('results');\n      const errorBox = document.getElementById('errorBox');\n\n      const url = urlInput.value.trim();\n      if (!url) return;\n\n      errorBox.style.display = 'none';\n      results.style.display = 'none';\n      loading.style.display = 'block';\n      submitBtn.disabled = true;\n\n      try {\n        const res = await fetch('/api/extract?url=' + encodeURIComponent(url));\n        const data = await res.json();\n\n        if (!res.ok || !data.success) {\n          throw new Error(data.error || 'Failed to extract media from this URL.');\n        }\n\n        renderResults(data);\n      } catch (err) {\n        errorBox.innerText = '⚠️ ' + err.message;\n        errorBox.style.display = 'block';\n      } finally {\n        loading.style.display = 'none';\n        submitBtn.disabled = false;\n      }\n    }\n\n    function renderResults(data) {\n      const results = document.getElementById('results');\n      const mediaPreview = document.getElementById('mediaPreview');\n      const mediaTitle = document.getElementById('mediaTitle');\n      const mediaDesc = document.getElementById('mediaDesc');\n      const dlList = document.getElementById('downloadsList');\n\n      mediaTitle.innerText = data.title || 'Pinterest Media';\n      mediaDesc.innerText = data.description || '';\n\n      if (data.videos && data.videos.length > 0) {\n        const bestVideo = data.videos[0];\n        mediaPreview.innerHTML = '<video controls autoplay muted loop src=\"' + bestVideo.url + '\" style=\"width:100%; border-radius:8px;\"></video>';\n      } else if (data.thumbnail) {\n        mediaPreview.innerHTML = '<img src=\"' + data.thumbnail + '\" alt=\"Preview\" style=\"width:100%; border-radius:8px;\">';\n      } else {\n        mediaPreview.innerHTML = '';\n      }\n\n      let html = '';\n      if (data.videos && data.videos.length > 0) {\n        html += '<div style=\"font-size:0.85rem; color:#94a3b8; font-weight:700; margin-top:4px;\">VIDEO DOWNLOADS:</div>';\n        data.videos.forEach(v => {\n          html += '<a class=\"dl-btn\" href=\"' + v.proxyDownloadUrl + '\" target=\"_blank\">' +\n                  '<span>Download ' + v.quality + '</span>' +\n                  '<span class=\"dl-tag\">' + v.format.toUpperCase() + '</span></a>';\n        });\n      }\n\n      if (data.images && data.images.length > 0) {\n        html += '<div style=\"font-size:0.85rem; color:#94a3b8; font-weight:700; margin-top:8px;\">IMAGE DOWNLOADS:</div>';\n        data.images.forEach(img => {\n          html += '<a class=\"dl-btn\" href=\"' + img.proxyDownloadUrl + '\" target=\"_blank\">' +\n                  '<span>Download ' + img.quality + '</span>' +\n                  '<span class=\"dl-tag\">' + img.format.toUpperCase() + '</span></a>';\n        });\n      }\n\n      dlList.innerHTML = html;\n      results.style.display = 'block';\n    }\n  </script>\n</body>\n</html>";
}

// ---------------------------------------------------------------------------
// 6. EMBEDDED HTTP & REST API SERVER
// ---------------------------------------------------------------------------
export function startServer(port = 3001) {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    // 1. Root: Serve Embedded Web Interface
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(getEmbeddedHtml());
    }

    // 2. REST API: /api/extract
    if (pathname === '/api/extract') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            let targetUrl = '';
            if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
              const json = JSON.parse(body || '{}');
              targetUrl = json.url;
            } else {
              const params = new URLSearchParams(body);
              targetUrl = params.get('url');
            }

            if (!targetUrl) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: false, error: "Missing 'url' parameter" }));
            }

            const mediaData = await extractPinterestMedia(targetUrl);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(mediaData, null, 2));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
        return;
      }

      // GET /api/extract?url=...
      const targetUrl = query.url;
      if (!targetUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: "Missing 'url' query parameter" }));
      }

      try {
        const mediaData = await extractPinterestMedia(targetUrl);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(mediaData, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 3. REST API: /api/download-proxy
    if (pathname === '/api/download-proxy') {
      const mediaUrl = query.url;
      const fileName = query.name || 'pinterest_download';
      if (!mediaUrl) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing media url parameter');
      }
      return handleStreamingProxy(req, res, mediaUrl, fileName);
    }

    // 4. Health Check
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  });

  server.listen(port, () => {
    console.log('===========================================================');
    console.log('📌 KLICKPIN DOWNLOADER (100% Independent Standalone Node.js)');
    console.log('===========================================================');
    console.log('🌐 Web Interface: http://localhost:' + port);
    console.log('⚡ REST API:      http://localhost:' + port + '/api/extract?url=<pinterest_url>');
    console.log('📥 Media Proxy:   http://localhost:' + port + '/api/download-proxy?url=<media_url>');
    console.log('===========================================================');
  });

  return server;
}

// ---------------------------------------------------------------------------
// 7. CLI & ENTRY POINT
// ---------------------------------------------------------------------------
async function runCLI() {
  const args = process.argv.slice(2);
  let targetUrl = null;
  let shouldDownload = false;
  let serve = false;
  let port = 3001;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--serve' || arg === '-s') {
      serve = true;
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        port = parseInt(args[++i], 10) || 3001;
      }
    } else if (arg === '--download' || arg === '-d') {
      shouldDownload = true;
    } else if (!arg.startsWith('-') && !targetUrl) {
      targetUrl = arg;
    }
  }

  if (serve || (!targetUrl && args.length === 0)) {
    startServer(port);
    return;
  }

  if (!targetUrl) {
    console.log('Usage: node standalone.js <pinterest_url> [--download] [--serve [port]]');
    process.exit(1);
  }

  console.log('🔍 Scraping Pinterest Media for:', targetUrl);
  try {
    const result = await extractPinterestMedia(targetUrl);
    console.log('\n📋 Title:', result.title);
    if (result.description) console.log('📝 Description:', result.description);
    if (result.author) console.log('👤 Author:', result.author);
    console.log('📌 Pin ID:', result.pinId);

    if (result.videos.length > 0) {
      console.log('\n🎬 Available Video Formats:');
      result.videos.forEach((v, idx) => {
        console.log(`  [${idx + 1}] ${v.quality} (${v.resolution}) -> ${v.url}`);
      });
    }

    if (result.images.length > 0) {
      console.log('\n📸 Available Image Formats:');
      result.images.forEach((img, idx) => {
        console.log(`  [${idx + 1}] ${img.quality} (${img.format}) -> ${img.url}`);
      });
    }

    if (shouldDownload) {
      const bestMedia = result.videos[0] || result.images[0];
      if (bestMedia) {
        const ext = bestMedia.type === 'video' ? 'mp4' : bestMedia.format;
        const outName = sanitizeFileName(result.title) + '.' + ext;
        console.log(`\n📥 Downloading highest quality (${bestMedia.quality}) to ${outName}...`);
        await downloadMediaFile(bestMedia.url, outName);
        console.log(`✅ Download complete: ${outName}`);
      }
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

const isMain = process.argv[1] && (path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url)));
if (isMain) {
  runCLI();
}

export default {
  extractPinterestMedia,
  resolvePinterestUrl,
  downloadMediaFile,
  handleStreamingProxy,
  startServer,
  getEmbeddedHtml
};

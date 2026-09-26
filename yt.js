#!/usr/bin/env node

/*
 * Youtube
 *
 * Author: Dippy (https://github.com/Dipper3142)
 * Base: https://www.youtube.com
 * Source: https://whatsapp.com/channel/0029Vb93wNfD8SE6mgz31526
 *
 * Note1: Jangan di hapus we em nya, hargai dev-scraper kecil :) (BANYAK PAKE TOKEN BJIR)
 */

/**
 * ============================================================================
 * 🚀 YouTube InnerTube & Web Scraper (Standalone, Zero-Dependency Node.js)
 * ============================================================================
 * Author: Dippy (https://github.com/Dipper3142)
 * Source: https://www.youtube.com/
 * License: MIT
 *
 * Features:
 *  - 🔍 Universal Search (Videos, Shorts, Channels, Playlists, Filters & Continuation)
 *  - 📹 Full Video Metadata (Stats, Likes, Views, Duration, Captions & Related)
 *  - 💬 Comment Threads & Replies Extractor (Entity Batch Mutation + Legacy Support)
 *  - 👤 Channel Profiles, Metrics & Tab Explorers (Videos, Shorts, Playlists)
 *  - 📋 Playlist Information & Tracklist Extractor
 *  - 🔥 Trending Feeds (Now, Music, Gaming, Movies/Films)
 *  - ⚡ Shorts Intelligence & View Metrics
 *  - 💡 Search Autocomplete Suggestions
 *  - 📝 Closed Captions & Timed Text Tracks Discovery
 *  - 🖼️ HD Thumbnail Local File Downloader
 * ============================================================================
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class YouTube {
  /**
   * @param {Object} [options]
   * @param {string} [options.hl='en'] - Language code (e.g., 'en', 'id', 'es', 'ja')
   * @param {string} [options.gl='US'] - Geolocation country code (e.g., 'US', 'ID', 'GB', 'JP')
   * @param {number} [options.timeout=25000] - Request timeout in milliseconds
   * @param {string} [options.userAgent] - Custom User-Agent header
   * @param {string} [options.cookie] - Optional session cookie string
   */
  constructor(options = {}) {
    this.hl = options.hl || 'en';
    this.gl = options.gl || 'US';
    this.timeout = options.timeout || 25000;
    this.cookie = options.cookie || '';
    this.userAgent = options.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    // Standard InnerTube Web Client configuration
    this.innertubeApiKey = 'AIzaSyAO_FJ2SlqAE4AnIazUlEhSMIn6S080Z_U';
    this.clientName = 'WEB';
    this.clientVersion = '2.20240410.01.00';
  }

  // ==========================================================================
  // 🌐 CORE NETWORKING & HTTP UTILITIES
  // ==========================================================================

  /**
   * Internal HTTP POST helper targeting YouTube InnerTube API
   * @private
   */
  async _postInnerTube(endpoint, payload = {}) {
    const url = `https://www.youtube.com/youtubei/v1/${endpoint.replace(/^\//, '')}?key=${this.innertubeApiKey}&prettyPrint=false`;

    const requestData = {
      context: {
        client: {
          hl: this.hl,
          gl: this.gl,
          remoteHost: '',
          deviceMake: '',
          deviceModel: '',
          visitorData: payload.visitorData || '',
          userAgent: this.userAgent,
          clientName: this.clientName,
          clientVersion: this.clientVersion,
          originalUrl: 'https://www.youtube.com',
          platform: 'DESKTOP',
          clientFormFactor: 'UNKNOWN_FORM_FACTOR',
          configInfo: {
            appInstallData: ''
          },
          userInterfaceTheme: 'USER_INTERFACE_THEME_DARK'
        },
        user: {
          lockedSafetyMode: false
        },
        request: {
          useSsl: true,
          internalExperimentFlags: [],
          consistencyTokenJars: []
        }
      },
      ...payload
    };

    delete requestData.visitorData;

    const bodyString = JSON.stringify(requestData);
    const parsedUrl = new URL(url);

    return new Promise((resolve, reject) => {
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
        'User-Agent': this.userAgent,
        'Accept-Language': `${this.hl}-${this.gl},${this.hl};q=0.9,en;q=0.8`,
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': this.clientVersion,
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Dest': 'empty'
      };

      if (this.cookie) {
        headers['Cookie'] = this.cookie;
      }

      const req = https.request({
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers,
        timeout: this.timeout
      }, (res) => {
        let rawData = '';
        res.setEncoding('utf8');
        res.on('data', chunk => rawData += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            if (parsed.error) {
              const err = new Error(`InnerTube API Error (${parsed.error.code}): ${parsed.error.message || 'Unknown error'}`);
              err.details = parsed.error;
              return reject(err);
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse InnerTube JSON response: ${e.message} (Raw preview: ${rawData.substring(0, 150)}...)`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`InnerTube API request to '${endpoint}' timed out after ${this.timeout}ms`));
      });

      req.on('error', (err) => {
        reject(new Error(`Network error requesting InnerTube '${endpoint}': ${err.message}`));
      });

      req.write(bodyString);
      req.end();
    });
  }

  /**
   * Internal HTTP GET helper for fetching YouTube Web HTML & JSON endpoints
   * @private
   */
  async _get(url, customHeaders = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'http:' ? http : https;

      const headers = {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': `${this.hl}-${this.gl},${this.hl};q=0.9,en;q=0.8`,
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-Dest': 'document',
        ...customHeaders
      };

      if (this.cookie && !headers['Cookie']) {
        headers['Cookie'] = this.cookie;
      }

      const req = client.get(url, { headers, timeout: this.timeout }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          return resolve(this._get(redirectUrl, customHeaders));
        }

        let rawData = '';
        res.setEncoding('utf8');
        res.on('data', chunk => rawData += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP Request failed with status ${res.statusCode} for ${url}`));
          }
          resolve(rawData);
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${this.timeout}ms for ${url}`));
      });

      req.on('error', (err) => {
        reject(new Error(`Network error requesting ${url}: ${err.message}`));
      });
    });
  }

  // ==========================================================================
  // 🔍 1. UNIVERSAL SEARCH (Videos, Shorts, Channels, Playlists, Cont.)
  // ==========================================================================

  /**
   * Search YouTube for videos, shorts, channels, or playlists
   * @param {string} query - Search keyword or sentence
   * @param {Object} [options]
   * @param {'all'|'video'|'channel'|'playlist'|'movie'|'short'} [options.type='all'] - Filter search type
   * @param {string} [options.continuation] - Pagination continuation token
   * @returns {Promise<Object>} Search results object
   */
  async search(query, options = {}) {
    if (!query && !options.continuation) {
      throw new Error('Search query or continuation token is required');
    }

    const typeFilters = {
      video: 'EgIQAQ%3D%3D',
      channel: 'EgIQAg%3D%3D',
      playlist: 'EgIQAw%3D%3D',
      movie: 'EgIQBA%3D%3D',
      short: 'EgIYAQ%3D%3D'
    };

    const payload = {};
    if (options.continuation) {
      payload.continuation = options.continuation;
    } else {
      payload.query = query;
      if (options.type && typeFilters[options.type]) {
        payload.params = typeFilters[options.type];
      }
    }

    const response = await this._postInnerTube('search', payload);
    return this._parseSearchResults(response, query);
  }

  /**
   * Parse InnerTube Search response payload
   * @private
   */
  _parseSearchResults(response, originalQuery) {
    const results = {
      query: originalQuery || '',
      estimatedResults: response.estimatedResults ? parseInt(response.estimatedResults, 10) : null,
      videos: [],
      shorts: [],
      channels: [],
      playlists: [],
      continuationToken: null
    };

    let items = [];

    // Search results direct structure
    const primaryContents = response.contents?.twoColumnSearchResultsRenderer?.primaryContents;
    const sectionList = primaryContents?.sectionListRenderer?.contents || [];

    for (const section of sectionList) {
      const itemSection = section.itemSectionRenderer?.contents || [];
      items.push(...itemSection);

      // Check continuation in sectionList
      if (section.continuationItemRenderer) {
        results.continuationToken = section.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null;
      }
    }

    // Continuation response structure
    if (response.onResponseReceivedCommands) {
      for (const cmd of response.onResponseReceivedCommands) {
        const actions = cmd.appendContinuationItemsAction?.continuationItems || [];
        for (const item of actions) {
          if (item.itemSectionRenderer?.contents) {
            items.push(...item.itemSectionRenderer.contents);
          } else if (item.continuationItemRenderer) {
            results.continuationToken = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null;
          } else {
            items.push(item);
          }
        }
      }
    }

    // Parse extracted items
    for (const item of items) {
      // 1. Lockup View Model (Modern Video / Item Renderer)
      if (item.lockupViewModel) {
        const parsed = this._parseLockupViewModel(item.lockupViewModel);
        if (parsed) {
          if (parsed.contentType === 'PLAYLIST' || parsed.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST') results.playlists.push(parsed);
          else if (parsed.contentType === 'CHANNEL' || parsed.contentType === 'LOCKUP_CONTENT_TYPE_CHANNEL') results.channels.push(parsed);
          else if (parsed.contentType === 'SHORT' || parsed.contentType === 'LOCKUP_CONTENT_TYPE_SHORT') results.shorts.push(parsed);
          else results.videos.push(parsed);
        }
      }
      // 2. Shorts Lockup View Model
      else if (item.shortsLockupViewModel) {
        const parsedShort = this._parseShortsLockupViewModel(item.shortsLockupViewModel);
        if (parsedShort) results.shorts.push(parsedShort);
      }
      // 3. Grid Shelf View Model (Shorts / Reels shelf)
      else if (item.gridShelfViewModel) {
        const gridItems = item.gridShelfViewModel.contents || [];
        for (const gItem of gridItems) {
          if (gItem.shortsLockupViewModel) {
            results.shorts.push(this._parseShortsLockupViewModel(gItem.shortsLockupViewModel));
          } else if (gItem.lockupViewModel) {
            const p = this._parseLockupViewModel(gItem.lockupViewModel);
            if (p) results.videos.push(p);
          }
        }
      }
      // 4. Official Card View Model (Verified Channel Card in Search)
      else if (item.officialCardViewModel) {
        const card = item.officialCardViewModel;
        const title = card.title?.content || '';
        const handle = card.subtitle?.content || '';
        const avatar = card.image?.avatarViewModel?.image?.sources?.slice(-1)[0]?.url || '';
        const browseId = card.onTap?.innertubeCommand?.browseEndpoint?.browseId || '';
        results.channels.push({
          id: browseId,
          url: browseId ? `https://www.youtube.com/channel/${browseId}` : '',
          contentType: 'CHANNEL',
          title,
          handle,
          description: '',
          avatar,
          isVerified: true
        });
      }
      // 5. Legacy Video Renderer
      else if (item.videoRenderer) {
        const parsed = this._parseVideoRenderer(item.videoRenderer);
        if (parsed) results.videos.push(parsed);
      }
      // 6. Channel Renderer
      else if (item.channelRenderer) {
        const parsed = this._parseChannelRenderer(item.channelRenderer);
        if (parsed) results.channels.push(parsed);
      }
      // 7. Playlist Renderer
      else if (item.playlistRenderer) {
        const parsed = this._parsePlaylistRenderer(item.playlistRenderer);
        if (parsed) results.playlists.push(parsed);
      }
      // 8. Reel / Shorts Shelf
      else if (item.reelShelfRenderer) {
        const reelItems = item.reelShelfRenderer.items || [];
        for (const reel of reelItems) {
          if (reel.reelItemRenderer) {
            results.shorts.push(this._parseReelItemRenderer(reel.reelItemRenderer));
          } else if (reel.shortsLockupViewModel) {
            results.shorts.push(this._parseShortsLockupViewModel(reel.shortsLockupViewModel));
          }
        }
      }
      // 9. Shelf Renderer (Grouped Results)
      else if (item.shelfRenderer) {
        const shelfContents = item.shelfRenderer.content?.verticalListRenderer?.items ||
          item.shelfRenderer.content?.horizontalListRenderer?.items || [];
        for (const sItem of shelfContents) {
          if (sItem.videoRenderer) results.videos.push(this._parseVideoRenderer(sItem.videoRenderer));
          else if (sItem.lockupViewModel) results.videos.push(this._parseLockupViewModel(sItem.lockupViewModel));
        }
      }
    }

    return results;
  }

  // ==========================================================================
  // 📹 2. VIDEO METADATA & PLAYER DETAILS
  // ==========================================================================

  /**
   * Fetch complete video metadata, stats, author info, and recommendations
   * @param {string} videoIdOrUrl - Video ID or YouTube Watch/Shorts URL
   * @returns {Promise<Object>} Detailed video object
   */
  async getVideo(videoIdOrUrl) {
    const videoId = this._extractVideoId(videoIdOrUrl);
    if (!videoId) {
      throw new Error(`Invalid YouTube video ID or URL: '${videoIdOrUrl}'`);
    }

    // Fetch InnerTube Next (Sidebar recommendations, metadata) & Player (Base video data)
    const [playerRes, nextRes] = await Promise.all([
      this._postInnerTube('player', { videoId }),
      this._postInnerTube('next', { videoId })
    ]);

    const videoDetails = playerRes.videoDetails || {};
    const microformat = playerRes.microformat?.playerMicroformatRenderer || {};

    // Extract Like count & Subscribe data from Next response
    let likeCount = null;
    let isLiked = false;
    let subscriberCountText = null;
    let channelAvatar = null;
    let isVerified = false;

    // Parse primary info from Next
    const results = nextRes.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
    for (const resItem of results) {
      if (resItem.videoPrimaryInfoRenderer) {
        const primary = resItem.videoPrimaryInfoRenderer;
        const topLevelButtons = primary.videoActions?.menuRenderer?.topLevelButtons || [];
        for (const btn of topLevelButtons) {
          const segmented = btn.segmentedLikeDislikeButtonViewModel || btn.segmentedLikeDislikeButtonRenderer;
          if (segmented) {
            const likeBtn = segmented.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel ||
              segmented.likeButton?.toggleButtonRenderer;
            if (likeBtn) {
              const likeText = likeBtn.title || this._parseRuns(likeBtn.defaultText?.runs) || likeBtn.accessibilityText;
              if (likeText) {
                const match = likeText.replace(/,/g, '').match(/\d+/);
                if (match) likeCount = parseInt(match[0], 10);
              }
            }
          }
        }
      }
      if (resItem.videoSecondaryInfoRenderer) {
        const sec = resItem.videoSecondaryInfoRenderer;
        const owner = sec.owner?.videoOwnerRenderer;
        if (owner) {
          subscriberCountText = this._parseRuns(owner.subscriberCountText?.runs) || owner.subscriberCountText?.simpleText || null;
          channelAvatar = owner.thumbnail?.thumbnails?.slice(-1)[0]?.url || null;
          isVerified = (owner.badges || []).some(b => b.metadataBadgeRenderer?.style?.includes('VERIFIED'));
        }
      }
      if (resItem.itemSectionRenderer?.contents) {
        // Look for comments continuation token
        for (const secContent of resItem.itemSectionRenderer.contents) {
          if (secContent.commentsEntryPointHeaderRenderer) {
            const countText = secContent.commentsEntryPointHeaderRenderer.commentCount?.simpleText;
            if (countText && !videoDetails.commentCount) {
              videoDetails.commentCount = parseInt(countText.replace(/\D/g, ''), 10);
            }
          }
        }
      }
    }

    // Extract related / recommended videos
    const relatedVideos = [];
    const secondaryContents = nextRes.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results || [];
    for (const sec of secondaryContents) {
      if (sec.compactVideoRenderer) {
        relatedVideos.push(this._parseCompactVideoRenderer(sec.compactVideoRenderer));
      } else if (sec.lockupViewModel) {
        const parsed = this._parseLockupViewModel(sec.lockupViewModel);
        if (parsed) relatedVideos.push(parsed);
      }
    }

    // Extract available captions list
    const captionTracks = playerRes.captions?.playerCaptionsTracklistRenderer?.captionTracks?.map(track => ({
      languageCode: track.languageCode,
      name: track.name?.simpleText || track.name?.runs?.[0]?.text || track.languageCode,
      kind: track.kind || 'standard',
      isAutoGenerated: track.kind === 'asr',
      isTranslatable: !!track.isTranslatable,
      baseUrl: track.baseUrl
    })) || [];

    const durationSeconds = parseInt(videoDetails.lengthSeconds || '0', 10);

    return {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: videoDetails.title || microformat.title?.simpleText || '',
      description: videoDetails.shortDescription || microformat.description?.simpleText || '',
      duration: {
        seconds: durationSeconds,
        formatted: this._formatDuration(durationSeconds)
      },
      views: {
        count: parseInt(videoDetails.viewCount || '0', 10),
        formatted: parseInt(videoDetails.viewCount || '0', 10).toLocaleString()
      },
      likes: {
        count: likeCount,
        formatted: likeCount ? likeCount.toLocaleString() : null
      },
      author: {
        id: videoDetails.channelId || '',
        name: videoDetails.author || '',
        url: videoDetails.channelId ? `https://www.youtube.com/channel/${videoDetails.channelId}` : '',
        avatar: channelAvatar,
        subscribers: subscriberCountText,
        isVerified
      },
      publishedDate: microformat.publishDate || null,
      uploadDate: microformat.uploadDate || null,
      category: microformat.category || null,
      tags: videoDetails.keywords || [],
      isLive: !!videoDetails.isLiveContent,
      isPrivate: !!videoDetails.isPrivate,
      isUnlisted: !!microformat.isUnlisted,
      isFamilySafe: !!microformat.isFamilySafe,
      thumbnails: videoDetails.thumbnail?.thumbnails || [],
      bestThumbnail: this._getBestThumbnail(videoId, videoDetails.thumbnail?.thumbnails),
      captions: captionTracks,
      relatedVideos
    };
  }

  // ==========================================================================
  // 💬 3. COMMENT THREADS & REPLIES EXTRACTOR
  // ==========================================================================

  /**
   * Extract comments for a YouTube video with pagination cursor support
   * @param {string} videoIdOrUrl - Video ID or YouTube URL
   * @param {Object} [options]
   * @param {string} [options.continuation] - Comments continuation token
   * @param {number} [options.limit=20] - Maximum comments to collect
   * @returns {Promise<Object>} Comments list and pagination continuation token
   */
  async getComments(videoIdOrUrl, options = {}) {
    let continuation = options.continuation;

    if (!continuation) {
      const videoId = this._extractVideoId(videoIdOrUrl);
      if (!videoId) throw new Error(`Invalid YouTube video ID or URL: '${videoIdOrUrl}'`);

      // Retrieve comments section continuation token from Next response
      const nextRes = await this._postInnerTube('next', { videoId });
      const results = nextRes.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];

      for (const section of results) {
        if (section.itemSectionRenderer) {
          const contents = section.itemSectionRenderer.contents || [];
          for (const item of contents) {
            if (item.continuationItemRenderer) {
              continuation = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
            }
          }
        }
      }

      // Check engagement panels
      if (!continuation && nextRes.engagementPanels) {
        for (const panel of nextRes.engagementPanels) {
          const renderer = panel.engagementPanelSectionListRenderer;
          if (renderer && (renderer.panelIdentifier === 'engagement-panel-comments-section' || renderer.panelIdentifier?.includes('comments'))) {
            // Direct continuation item
            if (renderer.content?.continuationItemRenderer) {
              continuation = renderer.content.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
            }
            // Section list continuation
            const sContents = renderer.content?.sectionListRenderer?.contents || [];
            for (const sc of sContents) {
              const items = sc.itemSectionRenderer?.contents || [];
              for (const it of items) {
                if (it.continuationItemRenderer) {
                  continuation = it.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
                }
              }
            }
          }
        }
      }

      if (!continuation) {
        return {
          comments: [],
          totalComments: 0,
          continuationToken: null,
          commentsDisabled: true
        };
      }
    }

    // Fetch comments via Next continuation endpoint
    const response = await this._postInnerTube('next', { continuation });
    return this._parseCommentsResponse(response, options.limit || 20);
  }

  /**
   * Fetch replies for a specific comment thread
   * @param {string} replyToken - Reply continuation token from a comment thread
   * @returns {Promise<Object>} Replies array and continuation token
   */
  async getCommentReplies(replyToken) {
    if (!replyToken) throw new Error('A valid reply continuation token is required');
    const response = await this._postInnerTube('next', { continuation: replyToken });
    return this._parseCommentsResponse(response, 50);
  }

  /**
   * Parse InnerTube Comments payload handling both Entity Mutations & Legacy ViewModels
   * @private
   */
  _parseCommentsResponse(response, limit = 20) {
    const comments = [];
    let nextContinuationToken = null;
    let totalCount = 0;

    // 1. Build Entity Map from Mutations (Modern YouTube Web architecture)
    const entityMap = {};
    const mutations = response.frameworkUpdates?.entityBatchUpdate?.mutations || [];
    for (const m of mutations) {
      const payload = m.payload;
      if (payload) {
        if (payload.commentEntityPayload) {
          entityMap[payload.commentEntityPayload.key] = payload.commentEntityPayload;
        }
        if (payload.toolbarStateEntityPayload) {
          entityMap[payload.toolbarStateEntityPayload.key] = payload.toolbarStateEntityPayload;
        }
      }
    }

    // 2. Extract items from onResponseReceivedEndpoints
    const endpoints = response.onResponseReceivedEndpoints || [];
    for (const ep of endpoints) {
      const items = ep.reloadContinuationItemsCommand?.continuationItems ||
        ep.appendContinuationItemsAction?.continuationItems || [];

      for (const item of items) {
        // Comments header renderer
        if (item.commentsHeaderRenderer) {
          const countText = this._parseRuns(item.commentsHeaderRenderer.countText?.runs) || item.commentsHeaderRenderer.countText?.simpleText;
          if (countText) {
            totalCount = parseInt(countText.replace(/\D/g, ''), 10) || 0;
          }
        }

        // Comment Thread Renderer
        if (item.commentThreadRenderer) {
          const thread = item.commentThreadRenderer;
          const commentModel = thread.commentViewModel?.commentViewModel || thread.comment?.commentViewModel || thread.commentViewModel;
          const commentRenderer = thread.comment?.commentRenderer || thread.commentRenderer;

          let parsed = null;
          if (commentModel) {
            parsed = this._parseCommentViewModel(commentModel, entityMap);
          } else if (commentRenderer) {
            parsed = this._parseLegacyCommentRenderer(commentRenderer);
          }

          if (parsed) {
            // Check for reply continuation token
            const replyContinuations = thread.replies?.commentRepliesRenderer?.contents || [];
            for (const rCont of replyContinuations) {
              if (rCont.continuationItemRenderer) {
                parsed.replyContinuationToken = rCont.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null;
              }
            }
            comments.push(parsed);
          }
        }

        // Direct Comment View Model (e.g. within replies)
        if (item.commentViewModel) {
          const parsed = this._parseCommentViewModel(item.commentViewModel, entityMap);
          if (parsed) comments.push(parsed);
        } else if (item.commentRenderer) {
          const parsed = this._parseLegacyCommentRenderer(item.commentRenderer);
          if (parsed) comments.push(parsed);
        }

        // Continuation item
        if (item.continuationItemRenderer) {
          nextContinuationToken = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token ||
            item.continuationItemRenderer.button?.buttonRenderer?.command?.continuationCommand?.token || null;
        }
      }
    }

    return {
      totalComments: totalCount || comments.length,
      count: comments.length,
      comments: comments.slice(0, limit),
      continuationToken: nextContinuationToken
    };
  }

  /**
   * Parse modern commentViewModel with entity map fallback
   * @private
   */
  _parseCommentViewModel(vm, entityMap) {
    const commentKey = vm.commentKey;
    const toolbarKey = vm.toolbar?.toolbarStateEntityKey;

    const entity = entityMap[commentKey] || {};
    const toolbar = entityMap[toolbarKey] || {};

    const authorText = entity.author?.displayName || '';
    const authorHandle = entity.author?.channelHandle || '';
    const authorChannelId = entity.author?.channelId || '';
    const authorAvatar = entity.author?.avatar?.image?.sources?.slice(-1)[0]?.url || '';
    const text = entity.properties?.content?.content || '';
    const publishedTime = entity.properties?.publishedTime || '';
    const isPinned = !!entity.properties?.isPinned;

    let likesCount = null;
    if (toolbar.likeCountNotliked) {
      const match = toolbar.likeCountNotliked.replace(/,/g, '').match(/\d+/);
      if (match) likesCount = parseInt(match[0], 10);
    }

    let replyCount = 0;
    if (toolbar.replyCount) {
      const match = toolbar.replyCount.replace(/,/g, '').match(/\d+/);
      if (match) replyCount = parseInt(match[0], 10);
    }

    return {
      id: entity.properties?.commentId || vm.commentId || commentKey || '',
      author: {
        name: authorText,
        handle: authorHandle,
        channelId: authorChannelId,
        channelUrl: authorChannelId ? `https://www.youtube.com/channel/${authorChannelId}` : (authorHandle ? `https://www.youtube.com/${authorHandle}` : ''),
        avatar: authorAvatar,
        isCreator: !!entity.author?.isCreator,
        isVerified: !!entity.author?.isVerified
      },
      text,
      publishedTime,
      likes: {
        count: likesCount,
        formatted: toolbar.likeCountNotliked || '0'
      },
      isHearted: !!toolbar.isHearted,
      isPinned,
      replyCount,
      replyContinuationToken: null
    };
  }

  /**
   * Parse legacy commentRenderer
   * @private
   */
  _parseLegacyCommentRenderer(renderer) {
    const authorText = renderer.authorText?.simpleText || this._parseRuns(renderer.authorText?.runs) || '';
    const authorChannelId = renderer.authorEndpoint?.browseEndpoint?.browseId || '';
    const text = this._parseRuns(renderer.contentText?.runs) || renderer.contentText?.simpleText || '';
    const publishedTime = this._parseRuns(renderer.publishedTimeText?.runs) || renderer.publishedTimeText?.simpleText || '';

    let likesCount = 0;
    if (renderer.voteCount) {
      const countStr = this._parseRuns(renderer.voteCount.runs) || renderer.voteCount.simpleText;
      if (countStr) {
        const match = countStr.replace(/,/g, '').match(/\d+/);
        if (match) likesCount = parseInt(match[0], 10);
      }
    }

    return {
      id: renderer.commentId || '',
      author: {
        name: authorText,
        handle: '',
        channelId: authorChannelId,
        channelUrl: authorChannelId ? `https://www.youtube.com/channel/${authorChannelId}` : '',
        avatar: renderer.authorThumbnail?.thumbnails?.slice(-1)[0]?.url || '',
        isCreator: !!renderer.authorIsChannelOwner,
        isVerified: (renderer.authorBadges || []).some(b => b.metadataBadgeRenderer?.style?.includes('VERIFIED'))
      },
      text,
      publishedTime,
      likes: {
        count: likesCount,
        formatted: likesCount.toLocaleString()
      },
      isHearted: !!renderer.actionButtons?.commentActionButtonsRenderer?.creatorHeart?.creatorHeartRenderer?.isHearted,
      isPinned: !!renderer.pinnedCommentBadge,
      replyCount: renderer.replyCount || 0,
      replyContinuationToken: null
    };
  }

  // ==========================================================================
  // 👤 4. CHANNEL PROFILES, METRICS & TAB EXPLORER
  // ==========================================================================

  /**
   * Fetch complete channel information, metrics, and tab content
   * @param {string} channelIdOrHandleOrUrl - Channel ID (UC...), Handle (@user), or URL
   * @param {Object} [options]
   * @param {'videos'|'shorts'|'playlists'|'community'|'about'} [options.tab='videos'] - Channel tab to fetch
   * @param {string} [options.continuation] - Tab continuation token
   * @returns {Promise<Object>} Channel information and items
   */
  async getChannel(channelIdOrHandleOrUrl, options = {}) {
    const cleanTarget = this._extractChannelIdOrHandle(channelIdOrHandleOrUrl);
    if (!cleanTarget) throw new Error(`Invalid channel ID, handle, or URL: '${channelIdOrHandleOrUrl}'`);

    const selectedTab = options.tab || 'videos';
    const tabParams = {
      videos: 'EgZ2aWRlb3PyBgQKAjoA',
      shorts: 'EgZzaG9ydHPyBgUKA5oBAA%3D%3D',
      playlists: 'EglwbGF5bGlzdHPyBgoKCEIGCgIQaCIA',
      community: 'EgVwb3N0c_IGBAoCSgA%3D'
    };

    let browseId = cleanTarget;
    if (!cleanTarget.startsWith('UC')) {
      const resolveUrl = cleanTarget.startsWith('@')
        ? `https://www.youtube.com/${cleanTarget}`
        : (cleanTarget.startsWith('http') ? cleanTarget : `https://www.youtube.com/@${cleanTarget}`);
      try {
        const resolveRes = await this._postInnerTube('navigation/resolve_url', { url: resolveUrl });
        const resolvedId = resolveRes.endpoint?.browseEndpoint?.browseId;
        if (resolvedId) {
          browseId = resolvedId;
        }
      } catch (e) {
        // Continue with original cleanTarget if resolve fails
      }
    }

    let payload = {};
    if (options.continuation) {
      payload.continuation = options.continuation;
    } else {
      payload.browseId = browseId;
      if (tabParams[selectedTab]) {
        payload.params = tabParams[selectedTab];
      }
    }

    const response = await this._postInnerTube('browse', payload);
    return this._parseChannelResponse(response, cleanTarget, selectedTab);
  }

  /**
   * Parse InnerTube Browse response for channels
   * @private
   */
  _parseChannelResponse(response, target, activeTab) {
    const header = response.header?.pageHeaderRenderer?.content?.pageHeaderViewModel ||
      response.header?.c4TabbedHeaderRenderer || {};
    const metadata = response.metadata?.channelMetadataRenderer || {};

    // Parse header avatar, title, handle, subscribers, video count
    let title = metadata.title || '';
    let handle = '';
    let subscriberCount = null;
    let videoCount = null;
    let avatarUrl = metadata.avatar?.thumbnails?.slice(-1)[0]?.url || '';
    let bannerUrl = '';
    let description = metadata.description || '';
    let isVerified = false;

    // Modern pageHeaderViewModel
    if (header.title) {
      title = header.title.dynamicTextViewModel?.text?.content || title;
      const metadataRows = header.metadata?.contentMetadataViewModel?.metadataRows || [];
      for (const row of metadataRows) {
        const parts = row.metadataParts || [];
        for (const p of parts) {
          const text = p.text?.content || '';
          if (text.startsWith('@')) handle = text;
          else if (text.toLowerCase().includes('subscriber')) subscriberCount = text;
          else if (text.toLowerCase().includes('video')) videoCount = text;
        }
      }
      avatarUrl = header.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.slice(-1)[0]?.url || avatarUrl;
      bannerUrl = header.banner?.imageBannerViewModel?.image?.sources?.slice(-1)[0]?.url || bannerUrl;
    }
    // Legacy c4TabbedHeaderRenderer
    else if (header.title) {
      title = header.title || title;
      avatarUrl = header.avatar?.thumbnails?.slice(-1)[0]?.url || avatarUrl;
      bannerUrl = header.banner?.thumbnails?.slice(-1)[0]?.url || bannerUrl;
      subscriberCount = header.subscriberCountText?.simpleText || this._parseRuns(header.subscriberCountText?.runs);
      videoCount = header.videosCountText?.runs?.[0]?.text || null;
      isVerified = (header.badges || []).some(b => b.metadataBadgeRenderer?.style?.includes('VERIFIED'));
    }

    // Extract items from active tab
    const items = [];
    let continuationToken = null;

    const tabs = response.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    for (const tab of tabs) {
      const tabRenderer = tab.tabRenderer;
      if (tabRenderer && (tabRenderer.selected || !items.length)) {
        let content = [];
        if (tabRenderer.content?.richGridRenderer?.contents?.length) {
          content = tabRenderer.content.richGridRenderer.contents;
        } else if (tabRenderer.content?.sectionListRenderer?.contents?.length) {
          content = tabRenderer.content.sectionListRenderer.contents;
        }

        for (const section of content) {
          // 1. Rich Grid Contents (Videos, Shorts)
          if (section.richItemRenderer) {
            const richContent = section.richItemRenderer.content;
            if (richContent?.videoRenderer) items.push(this._parseVideoRenderer(richContent.videoRenderer));
            else if (richContent?.lockupViewModel) items.push(this._parseLockupViewModel(richContent.lockupViewModel));
            else if (richContent?.shortsLockupViewModel) items.push(this._parseShortsLockupViewModel(richContent.shortsLockupViewModel));
            else if (richContent?.reelItemRenderer) items.push(this._parseReelItemRenderer(richContent.reelItemRenderer));
          }
          // 2. Rich Section / Shelf Renderer
          else if (section.richSectionRenderer) {
            const shelf = section.richSectionRenderer.content?.richShelfRenderer?.contents || [];
            for (const sItem of shelf) {
              if (sItem.richItemRenderer?.content?.shortsLockupViewModel) {
                items.push(this._parseShortsLockupViewModel(sItem.richItemRenderer.content.shortsLockupViewModel));
              }
            }
          }
          // 3. Item Section Renderer
          else if (section.itemSectionRenderer) {
            const secItems = section.itemSectionRenderer.contents || [];
            for (const sItem of secItems) {
              if (sItem.gridVideoRenderer) items.push(this._parseGridVideoRenderer(sItem.gridVideoRenderer));
              else if (sItem.gridPlaylistRenderer) items.push(this._parseGridPlaylistRenderer(sItem.gridPlaylistRenderer));
              else if (sItem.videoRenderer) items.push(this._parseVideoRenderer(sItem.videoRenderer));
            }
          }
          // 4. Continuation item
          else if (section.continuationItemRenderer) {
            continuationToken = section.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null;
          }
        }
      }
    }

    // Continuation response parsing
    if (response.onResponseReceivedActions) {
      for (const action of response.onResponseReceivedActions) {
        const continuationItems = action.appendContinuationItemsAction?.continuationItems || [];
        for (const item of continuationItems) {
          if (item.richItemRenderer?.content) {
            const rc = item.richItemRenderer.content;
            if (rc.videoRenderer) items.push(this._parseVideoRenderer(rc.videoRenderer));
            else if (rc.lockupViewModel) items.push(this._parseLockupViewModel(rc.lockupViewModel));
            else if (rc.shortsLockupViewModel) items.push(this._parseShortsLockupViewModel(rc.shortsLockupViewModel));
          } else if (item.continuationItemRenderer) {
            continuationToken = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null;
          }
        }
      }
    }

    const channelId = metadata.externalId || response.responseContext?.serviceTrackingParams?.[0]?.params?.find(p => p.key === 'browse_id')?.value || target;

    return {
      id: channelId,
      url: channelId.startsWith('UC') ? `https://www.youtube.com/channel/${channelId}` : `https://www.youtube.com/${handle || target}`,
      title,
      handle: handle || (target.startsWith('@') ? target : `@${target}`),
      description,
      subscribers: {
        text: subscriberCount,
        count: this._parseApproxCount(subscriberCount)
      },
      videosCount: {
        text: videoCount,
        count: this._parseApproxCount(videoCount)
      },
      avatar: avatarUrl,
      banner: bannerUrl,
      isVerified,
      activeTab,
      itemsCount: items.length,
      items,
      continuationToken
    };
  }

  // ==========================================================================
  // 📋 5. PLAYLIST INFORMATION & TRACKLIST EXTRACTOR
  // ==========================================================================

  /**
   * Fetch complete playlist details and tracklist
   * @param {string} playlistIdOrUrl - Playlist ID (PL...) or YouTube Playlist URL
   * @param {Object} [options]
   * @param {string} [options.continuation] - Playlist continuation token
   * @returns {Promise<Object>} Playlist metadata and videos list
   */
  async getPlaylist(playlistIdOrUrl, options = {}) {
    const playlistId = this._extractPlaylistId(playlistIdOrUrl);
    if (!playlistId) throw new Error(`Invalid YouTube playlist ID or URL: '${playlistIdOrUrl}'`);

    let payload = {};
    if (options.continuation) {
      payload.continuation = options.continuation;
    } else {
      payload.browseId = `VL${playlistId}`;
    }

    const response = await this._postInnerTube('browse', payload);
    return this._parsePlaylistResponse(response, playlistId);
  }

  /**
   * Parse InnerTube Playlist payload
   * @private
   */
  _parsePlaylistResponse(response, playlistId) {
    const header = response.header?.playlistHeaderRenderer || {};
    const sidebar = response.sidebar?.playlistSidebarRenderer?.items || [];

    let title = header.title?.simpleText || this._parseRuns(header.title?.runs) || '';
    let description = header.descriptionText?.simpleText || this._parseRuns(header.descriptionText?.runs) || '';
    let author = { name: '', id: '', url: '' };
    let videoCount = 0;
    let viewCount = null;
    let lastUpdated = '';
    let thumbnails = header.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail?.thumbnails || [];

    // Extract details from sidebar if present
    for (const side of sidebar) {
      const primary = side.playlistSidebarPrimaryInfoRenderer;
      if (primary) {
        title = title || this._parseRuns(primary.title?.runs);
        const stats = primary.stats || [];
        for (const stat of stats) {
          const text = this._parseRuns(stat.runs) || stat.simpleText || '';
          if (text.toLowerCase().includes('video')) videoCount = parseInt(text.replace(/\D/g, ''), 10) || 0;
          else if (text.toLowerCase().includes('view')) viewCount = text;
        }
        if (primary.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail?.thumbnails) {
          thumbnails = primary.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails;
        }
      }
      const secondary = side.playlistSidebarSecondaryInfoRenderer;
      if (secondary?.videoOwner?.videoOwnerRenderer) {
        const owner = secondary.videoOwner.videoOwnerRenderer;
        author = {
          name: this._parseRuns(owner.title?.runs) || owner.title?.simpleText || '',
          id: owner.navigationEndpoint?.browseEndpoint?.browseId || '',
          url: owner.navigationEndpoint?.browseEndpoint?.browseId ? `https://www.youtube.com/channel/${owner.navigationEndpoint.browseEndpoint.browseId}` : '',
          avatar: owner.thumbnail?.thumbnails?.slice(-1)[0]?.url || ''
        };
      }
    }

    // Extract videos list
    const videos = [];
    let continuationToken = null;

    const tabs = response.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    for (const tab of tabs) {
      const contents = tab.tabRenderer?.content?.sectionListRenderer?.contents || [];
      for (const section of contents) {
        const itemSection = section.itemSectionRenderer?.contents || [];
        for (const isItem of itemSection) {
          const playlistList = isItem.playlistVideoListRenderer?.contents || [];
          for (const item of playlistList) {
            if (item.playlistVideoRenderer) {
              videos.push(this._parsePlaylistVideoRenderer(item.playlistVideoRenderer));
            } else if (item.lockupViewModel) {
              videos.push(this._parseLockupViewModel(item.lockupViewModel));
            } else if (item.continuationItemRenderer) {
              continuationToken = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null;
            }
          }
          if (isItem.lockupViewModel) {
            videos.push(this._parseLockupViewModel(isItem.lockupViewModel));
          } else if (isItem.playlistVideoRenderer) {
            videos.push(this._parsePlaylistVideoRenderer(isItem.playlistVideoRenderer));
          }
        }
      }
    }

    // Continuation response
    if (response.onResponseReceivedActions) {
      for (const action of response.onResponseReceivedActions) {
        const items = action.appendContinuationItemsAction?.continuationItems || [];
        for (const item of items) {
          if (item.playlistVideoRenderer) {
            videos.push(this._parsePlaylistVideoRenderer(item.playlistVideoRenderer));
          } else if (item.lockupViewModel) {
            videos.push(this._parseLockupViewModel(item.lockupViewModel));
          } else if (item.continuationItemRenderer) {
            continuationToken = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null;
          }
        }
      }
    }

    return {
      id: playlistId,
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
      title,
      description,
      videoCount: videoCount || videos.length,
      views: viewCount,
      author,
      lastUpdated,
      thumbnails,
      videos,
      continuationToken
    };
  }

  // ==========================================================================
  // 🔥 6. TRENDING FEEDS (Now, Music, Gaming, Movies/Films)
  // ==========================================================================

  /**
   * Fetch YouTube trending videos for a specific category
   * @param {'now'|'music'|'gaming'|'movies'} [category='now'] - Trending category
   * @returns {Promise<Object>} Trending videos list
   */
  async getTrending(category = 'now') {
    const cleanCat = (category || 'now').toLowerCase();

    // Map categories to official YouTube Topic Channels or trending feeds
    const topicChannels = {
      gaming: 'UC4R8DWoMoI7CAwX8_BQxUEw',
      movies: 'UClgRkhTL3_hImCAmdLfDE4g',
      music: 'UC-9-kyTW8ZkZNDHQJ6FgpwQ'
    };

    if (cleanCat !== 'now' && topicChannels[cleanCat]) {
      try {
        const channelData = await this.getChannel(topicChannels[cleanCat], { tab: 'videos' });
        if (channelData.items && channelData.items.length > 0) {
          return {
            category: cleanCat,
            title: `YouTube Trending - ${cleanCat.toUpperCase()}`,
            count: channelData.items.length,
            videos: channelData.items
          };
        }
      } catch (e) {}
    }

    // Fetch trending via Search `#trending` query fallback for maximum reliability
    const searchQuery = cleanCat === 'now' ? '#trending' : `#trending #${cleanCat}`;
    const searchRes = await this.search(searchQuery, { type: 'video' });
    return {
      category: cleanCat,
      title: cleanCat === 'now' ? 'YouTube Trending Videos' : `YouTube Trending - ${cleanCat.toUpperCase()}`,
      count: searchRes.videos.length,
      videos: searchRes.videos
    };
  }

  // ==========================================================================
  // ⚡ 7. SHORTS INTELLIGENCE & VIEW METRICS
  // ==========================================================================

  /**
   * Fetch specialized YouTube Shorts video information
   * @param {string} videoIdOrUrl - Shorts Video ID or URL
   * @returns {Promise<Object>} Shorts details
   */
  async getShorts(videoIdOrUrl) {
    const video = await this.getVideo(videoIdOrUrl);
    return {
      id: video.id,
      url: `https://www.youtube.com/shorts/${video.id}`,
      title: video.title,
      description: video.description,
      duration: video.duration,
      views: video.views,
      likes: video.likes,
      author: video.author,
      publishedDate: video.publishedDate,
      thumbnails: video.thumbnails,
      bestThumbnail: video.bestThumbnail,
      tags: video.tags
    };
  }

  // ==========================================================================
  // 💡 8. SEARCH AUTOCOMPLETE SUGGESTIONS
  // ==========================================================================

  /**
   * Fetch real-time YouTube search suggestions
   * @param {string} query - Keyword query
   * @returns {Promise<Array<string>>} Suggestions list
   */
  async getSuggestions(query) {
    if (!query) return [];
    const encoded = encodeURIComponent(query);

    // Primary: Google Suggest API (Firefox client format returns direct clean JSON array)
    try {
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=${this.hl}&gl=${this.gl}&q=${encoded}`;
      const raw = await this._get(url);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && Array.isArray(parsed[1])) {
        return parsed[1];
      }
    } catch (e) {}

    // Secondary fallback: YouTube Suggest API
    try {
      const fallbackUrl = `https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&hl=${this.hl}&gl=${this.gl}&q=${encoded}&ds=yt`;
      const raw = await this._get(fallbackUrl);
      const match = raw.match(/google\.sbox\.p50\s*&&\s*google\.sbox\.p50\((.+)\)/);
      if (match) {
        const parsed = JSON.parse(match[1]);
        const entries = parsed[1] || [];
        return entries.map(item => Array.isArray(item) ? item[0] : item);
      }
    } catch (e) {}

    return [];
  }

  // ==========================================================================
  // 📝 9. TIMED TEXT & CAPTIONS DISCOVERY
  // ==========================================================================

  /**
   * Fetch all available subtitle / caption tracks for a video
   * @param {string} videoIdOrUrl - Video ID or YouTube URL
   * @returns {Promise<Array<Object>>} Caption tracks metadata list
   */
  async getCaptions(videoIdOrUrl) {
    const videoId = this._extractVideoId(videoIdOrUrl);
    if (!videoId) throw new Error(`Invalid YouTube video ID or URL: '${videoIdOrUrl}'`);

    let captionTracks = [];
    try {
      const playerRes = await this._postInnerTube('player', { videoId });
      captionTracks = playerRes.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    } catch (e) {}

    // Fallback: Parse watch page HTML ytInitialPlayerResponse if InnerTube didn't return tracks
    if (captionTracks.length === 0) {
      try {
        const watchHtml = await this._get(`https://www.youtube.com/watch?v=${videoId}`);
        const match = watchHtml.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:var|<\/script)/);
        if (match) {
          const playerObj = JSON.parse(match[1]);
          captionTracks = playerObj.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        }
      } catch (e) {}
    }

    return captionTracks.map(track => ({
      languageCode: track.languageCode,
      name: track.name?.simpleText || track.name?.runs?.[0]?.text || track.languageCode,
      kind: track.kind || 'standard',
      isAutoGenerated: track.kind === 'asr',
      isTranslatable: !!track.isTranslatable,
      baseUrl: track.baseUrl
    }));
  }

  // ==========================================================================
  // 🖼️ 10. THUMBNAIL DOWNLOADER
  // ==========================================================================

  /**
   * Download the highest resolution thumbnail of a video directly to a local file
   * @param {string} videoIdOrUrl - Video ID or YouTube URL
   * @param {string} outputPath - Local output file path (e.g., './thumbnail.jpg')
   * @param {'max'|'high'|'medium'|'standard'} [quality='max'] - Thumbnail resolution
   * @returns {Promise<string>} Saved absolute file path
   */
  async downloadThumbnail(videoIdOrUrl, outputPath, quality = 'max') {
    const videoId = this._extractVideoId(videoIdOrUrl);
    if (!videoId) throw new Error(`Invalid YouTube video ID or URL: '${videoIdOrUrl}'`);

    const destPath = path.resolve(outputPath);
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const qualityFiles = {
      max: 'maxresdefault.jpg',
      high: 'hqdefault.jpg',
      medium: 'mqdefault.jpg',
      standard: 'sddefault.jpg'
    };

    const targetFileName = qualityFiles[quality] || 'maxresdefault.jpg';
    const candidateUrls = [
      `https://i.ytimg.com/vi/${videoId}/${targetFileName}`,
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
    ];

    let downloaded = false;
    let lastError = null;

    for (const url of candidateUrls) {
      try {
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(destPath);
          const req = https.get(url, { headers: { 'User-Agent': this.userAgent } }, (res) => {
            if (res.statusCode !== 200) {
              file.close();
              fs.unlink(destPath, () => {});
              return reject(new Error(`HTTP ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
          });
          req.on('error', (err) => {
            file.close();
            fs.unlink(destPath, () => {});
            reject(err);
          });
        });

        const stat = fs.statSync(destPath);
        // YouTube returns a 1097-byte blank image if maxresdefault doesn't exist
        if (stat.size > 1500) {
          downloaded = true;
          break;
        } else {
          fs.unlinkSync(destPath);
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!downloaded) {
      throw new Error(`Failed to download thumbnail for video '${videoId}': ${lastError?.message || 'No valid thumbnail found'}`);
    }

    return destPath;
  }

  // ==========================================================================
  // 🛠️ INTERNAL PARSERS & HELPERS
  // ==========================================================================

  /**
   * Parse modern Lockup View Model item
   * @private
   */
  _parseLockupViewModel(vm) {
    if (!vm) return null;
    const contentType = vm.contentType || 'VIDEO';
    const contentId = vm.contentId || '';

    // Title
    const title = vm.metadata?.lockupMetadataViewModel?.title?.content || '';

    // Metadata lines (Author, Views, Published Date)
    let authorName = '';
    let authorChannelId = '';
    let authorUrl = '';
    let viewsText = '';
    let publishedTime = '';

    const metadataRows = vm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
    for (let i = 0; i < metadataRows.length; i++) {
      const parts = metadataRows[i].metadataParts || [];
      for (const p of parts) {
        const text = p.text?.content || '';
        if (i === 0 && !authorName) {
          authorName = text;
          const browseId = p.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId;
          if (browseId) {
            authorChannelId = browseId;
            authorUrl = `https://www.youtube.com/channel/${browseId}`;
          }
        } else if (text.toLowerCase().includes('view')) {
          viewsText = text;
        } else if (text.toLowerCase().includes('ago') || text.toLowerCase().includes('streamed')) {
          publishedTime = text;
        }
      }
    }

    // Duration from overlay badges
    let durationText = '';
    const overlays = vm.contentImage?.thumbnailViewModel?.overlays || [];
    for (const ov of overlays) {
      const badge = ov.thumbnailOverlayTimeStatusViewModel?.text || ov.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text;
      if (badge) durationText = badge;
    }

    // Thumbnails
    const thumbnails = vm.contentImage?.thumbnailViewModel?.image?.sources || [];

    return {
      id: contentId,
      url: contentType === 'PLAYLIST' ? `https://www.youtube.com/playlist?list=${contentId}` : `https://www.youtube.com/watch?v=${contentId}`,
      contentType,
      title,
      duration: {
        formatted: durationText,
        seconds: this._parseDurationText(durationText)
      },
      views: {
        text: viewsText,
        count: this._parseApproxCount(viewsText)
      },
      publishedTime,
      author: {
        name: authorName,
        id: authorChannelId,
        url: authorUrl
      },
      thumbnails,
      bestThumbnail: this._getBestThumbnail(contentId, thumbnails)
    };
  }

  /**
   * Parse modern Shorts Lockup View Model item
   * @private
   */
  _parseShortsLockupViewModel(vm) {
    if (!vm) return null;
    const videoId = vm.entityId?.replace(/^shorts-shelf-item-/, '') || vm.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || '';
    const title = vm.overlayMetadata?.primaryText?.content || '';
    const viewsText = vm.overlayMetadata?.secondaryText?.content || '';
    const thumbnails = vm.thumbnail?.sources || [];

    return {
      id: videoId,
      url: `https://www.youtube.com/shorts/${videoId}`,
      contentType: 'SHORT',
      title,
      views: {
        text: viewsText,
        count: this._parseApproxCount(viewsText)
      },
      thumbnails,
      bestThumbnail: this._getBestThumbnail(videoId, thumbnails)
    };
  }

  /**
   * Parse legacy videoRenderer
   * @private
   */
  _parseVideoRenderer(renderer) {
    if (!renderer) return null;
    const videoId = renderer.videoId || '';
    const title = this._parseRuns(renderer.title?.runs) || renderer.title?.simpleText || '';
    const description = this._parseRuns(renderer.detailedMetadataSnippets?.[0]?.snippetText?.runs) || this._parseRuns(renderer.descriptionSnippet?.runs) || '';
    const durationText = renderer.lengthText?.simpleText || this._parseRuns(renderer.lengthText?.runs) || '';
    const viewsText = renderer.viewCountText?.simpleText || this._parseRuns(renderer.viewCountText?.runs) || '';
    const publishedTime = renderer.publishedTimeText?.simpleText || this._parseRuns(renderer.publishedTimeText?.runs) || '';

    const owner = renderer.ownerText || renderer.shortBylineText;
    const authorName = this._parseRuns(owner?.runs) || owner?.simpleText || '';
    const authorChannelId = owner?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '';

    const badges = (renderer.ownerBadges || []).map(b => b.metadataBadgeRenderer?.style);
    const isVerified = badges.some(b => b?.includes('VERIFIED'));

    const thumbnails = renderer.thumbnail?.thumbnails || [];

    return {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      contentType: 'VIDEO',
      title,
      description,
      duration: {
        formatted: durationText,
        seconds: this._parseDurationText(durationText)
      },
      views: {
        text: viewsText,
        count: this._parseApproxCount(viewsText)
      },
      publishedTime,
      author: {
        name: authorName,
        id: authorChannelId,
        url: authorChannelId ? `https://www.youtube.com/channel/${authorChannelId}` : '',
        isVerified
      },
      thumbnails,
      bestThumbnail: this._getBestThumbnail(videoId, thumbnails)
    };
  }

  /**
   * Parse legacy channelRenderer
   * @private
   */
  _parseChannelRenderer(renderer) {
    if (!renderer) return null;
    const channelId = renderer.channelId || '';
    const title = renderer.title?.simpleText || this._parseRuns(renderer.title?.runs) || '';
    const handle = renderer.subscriberCountText?.simpleText || '';
    const videoCountText = renderer.videoCountText?.simpleText || this._parseRuns(renderer.videoCountText?.runs) || '';
    const description = this._parseRuns(renderer.descriptionSnippet?.runs) || '';
    const thumbnails = renderer.thumbnail?.thumbnails || [];

    return {
      id: channelId,
      url: `https://www.youtube.com/channel/${channelId}`,
      contentType: 'CHANNEL',
      title,
      handle,
      description,
      videosCount: {
        text: videoCountText,
        count: this._parseApproxCount(videoCountText)
      },
      thumbnails,
      avatar: thumbnails.slice(-1)[0]?.url || ''
    };
  }

  /**
   * Parse legacy playlistRenderer
   * @private
   */
  _parsePlaylistRenderer(renderer) {
    if (!renderer) return null;
    const playlistId = renderer.playlistId || '';
    const title = renderer.title?.simpleText || this._parseRuns(renderer.title?.runs) || '';
    const videoCountText = renderer.videoCount || renderer.videoCountText?.simpleText || '';
    const authorName = this._parseRuns(renderer.shortBylineText?.runs) || renderer.shortBylineText?.simpleText || '';
    const thumbnails = renderer.thumbnails?.flatMap(t => t.thumbnails || t) || [];

    return {
      id: playlistId,
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
      contentType: 'PLAYLIST',
      title,
      videoCount: {
        text: videoCountText,
        count: this._parseApproxCount(videoCountText)
      },
      author: {
        name: authorName
      },
      thumbnails,
      bestThumbnail: thumbnails.slice(-1)[0]?.url || ''
    };
  }

  /**
   * Parse compact video renderer (Sidebar / Recommendations)
   * @private
   */
  _parseCompactVideoRenderer(renderer) {
    const videoId = renderer.videoId || '';
    const title = this._parseRuns(renderer.title?.runs) || renderer.title?.simpleText || '';
    const durationText = renderer.lengthText?.simpleText || this._parseRuns(renderer.lengthText?.runs) || '';
    const viewsText = renderer.viewCountText?.simpleText || this._parseRuns(renderer.viewCountText?.runs) || '';
    const publishedTime = renderer.publishedTimeText?.simpleText || this._parseRuns(renderer.publishedTimeText?.runs) || '';
    const authorName = this._parseRuns(renderer.shortBylineText?.runs) || renderer.shortBylineText?.simpleText || '';
    const authorChannelId = renderer.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '';
    const thumbnails = renderer.thumbnail?.thumbnails || [];

    return {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      duration: {
        formatted: durationText,
        seconds: this._parseDurationText(durationText)
      },
      views: {
        text: viewsText,
        count: this._parseApproxCount(viewsText)
      },
      publishedTime,
      author: {
        name: authorName,
        id: authorChannelId,
        url: authorChannelId ? `https://www.youtube.com/channel/${authorChannelId}` : ''
      },
      thumbnails,
      bestThumbnail: this._getBestThumbnail(videoId, thumbnails)
    };
  }

  /**
   * Parse grid video renderer (Channel videos tab)
   * @private
   */
  _parseGridVideoRenderer(renderer) {
    const videoId = renderer.videoId || '';
    const title = this._parseRuns(renderer.title?.runs) || renderer.title?.simpleText || '';
    const durationText = renderer.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '';
    const viewsText = renderer.viewCountText?.simpleText || this._parseRuns(renderer.viewCountText?.runs) || '';
    const publishedTime = renderer.publishedTimeText?.simpleText || this._parseRuns(renderer.publishedTimeText?.runs) || '';
    const thumbnails = renderer.thumbnail?.thumbnails || [];

    return {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      duration: {
        formatted: durationText,
        seconds: this._parseDurationText(durationText)
      },
      views: {
        text: viewsText,
        count: this._parseApproxCount(viewsText)
      },
      publishedTime,
      thumbnails,
      bestThumbnail: this._getBestThumbnail(videoId, thumbnails)
    };
  }

  /**
   * Parse grid playlist renderer (Channel playlists tab)
   * @private
   */
  _parseGridPlaylistRenderer(renderer) {
    const playlistId = renderer.playlistId || '';
    const title = this._parseRuns(renderer.title?.runs) || renderer.title?.simpleText || '';
    const videoCountText = renderer.videoCountShortText?.simpleText || '';
    const thumbnails = renderer.thumbnail?.thumbnails || [];

    return {
      id: playlistId,
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
      title,
      videoCount: {
        text: videoCountText,
        count: this._parseApproxCount(videoCountText)
      },
      thumbnails,
      bestThumbnail: thumbnails.slice(-1)[0]?.url || ''
    };
  }

  /**
   * Parse playlist video item renderer
   * @private
   */
  _parsePlaylistVideoRenderer(renderer) {
    const videoId = renderer.videoId || '';
    const title = this._parseRuns(renderer.title?.runs) || renderer.title?.simpleText || '';
    const durationText = renderer.lengthText?.simpleText || this._parseRuns(renderer.lengthText?.runs) || '';
    const authorName = this._parseRuns(renderer.shortBylineText?.runs) || renderer.shortBylineText?.simpleText || '';
    const authorChannelId = renderer.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '';
    const thumbnails = renderer.thumbnail?.thumbnails || [];
    const index = parseInt(renderer.index?.simpleText || '0', 10);

    return {
      index,
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      duration: {
        formatted: durationText,
        seconds: parseInt(renderer.lengthSeconds || '0', 10) || this._parseDurationText(durationText)
      },
      author: {
        name: authorName,
        id: authorChannelId,
        url: authorChannelId ? `https://www.youtube.com/channel/${authorChannelId}` : ''
      },
      thumbnails,
      bestThumbnail: this._getBestThumbnail(videoId, thumbnails)
    };
  }

  /**
   * Parse reel item renderer (Shorts)
   * @private
   */
  _parseReelItemRenderer(renderer) {
    const videoId = renderer.videoId || '';
    const title = renderer.headline?.simpleText || this._parseRuns(renderer.headline?.runs) || '';
    const viewsText = renderer.viewCountText?.simpleText || this._parseRuns(renderer.viewCountText?.runs) || '';
    const thumbnails = renderer.thumbnail?.thumbnails || [];

    return {
      id: videoId,
      url: `https://www.youtube.com/shorts/${videoId}`,
      contentType: 'SHORT',
      title,
      views: {
        text: viewsText,
        count: this._parseApproxCount(viewsText)
      },
      thumbnails,
      bestThumbnail: this._getBestThumbnail(videoId, thumbnails)
    };
  }

  /**
   * Extract video ID from various YouTube URL formats or ID strings
   * @private
   */
  _extractVideoId(input) {
    if (!input || typeof input !== 'string') return null;
    const clean = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;

    const match = clean.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  /**
   * Extract channel ID or handle from URL or string
   * @private
   */
  _extractChannelIdOrHandle(input) {
    if (!input || typeof input !== 'string') return null;
    const clean = input.trim();

    // Direct Channel ID
    if (/^UC[a-zA-Z0-9_-]{22}$/.test(clean)) return clean;
    // Direct Handle
    if (/^@[a-zA-Z0-9_.-]+$/.test(clean)) return clean;

    // URL matching
    const channelMatch = clean.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    if (channelMatch) return channelMatch[1];

    const handleMatch = clean.match(/youtube\.com\/(@[a-zA-Z0-9_.-]+)/);
    if (handleMatch) return handleMatch[1];

    const cMatch = clean.match(/youtube\.com\/c\/([a-zA-Z0-9_.-]+)/);
    if (cMatch) return `@${cMatch[1]}`;

    const userMatch = clean.match(/youtube\.com\/user\/([a-zA-Z0-9_.-]+)/);
    if (userMatch) return `@${userMatch[1]}`;

    return clean;
  }

  /**
   * Extract playlist ID from URL or string
   * @private
   */
  _extractPlaylistId(input) {
    if (!input || typeof input !== 'string') return null;
    const clean = input.trim();
    if (/^(PL|UU|FL|RD|OLAK5uy_)[a-zA-Z0-9_-]+$/.test(clean)) return clean;

    const match = clean.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  /**
   * Parse text runs array into a single string
   * @private
   */
  _parseRuns(runs) {
    if (!runs || !Array.isArray(runs)) return '';
    return runs.map(r => r.text || '').join('');
  }

  /**
   * Convert duration string (e.g., "12:34" or "1:23:45") to total seconds
   * @private
   */
  _parseDurationText(text) {
    if (!text || typeof text !== 'string') return 0;
    const parts = text.trim().split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return 0;
  }

  /**
   * Format duration in seconds to "HH:MM:SS" or "MM:SS"
   * @private
   */
  _formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Parse approximate metric counts (e.g. "1.2M views", "450K subscribers")
   * @private
   */
  _parseApproxCount(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/([\d\.]+)\s*([KMBkmb]?)/);
    if (!match) return null;
    const num = parseFloat(match[1]);
    const unit = (match[2] || '').toUpperCase();
    if (unit === 'K') return Math.round(num * 1000);
    if (unit === 'M') return Math.round(num * 1000000);
    if (unit === 'B') return Math.round(num * 1000000000);
    return Math.round(num);
  }

  /**
   * Resolve highest resolution thumbnail URL
   * @private
   */
  _getBestThumbnail(videoId, thumbnails) {
    if (thumbnails && thumbnails.length > 0) {
      return thumbnails.slice(-1)[0].url;
    }
    if (videoId) {
      return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    }
    return '';
  }
}

// ============================================================================
// 🖥️ CLI INTERFACE (When executed directly from command line)
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  function printHelp() {
    console.log(`
==============================================================================
🚀 YouTube Scraper & Downloader CLI - InnerTube API (Zero Dependencies)
==============================================================================
Author: Dippy (https://github.com/Dipper3142)

Usage:
  node yt.js <command> [target] [options]

Commands:
  search, -s <query>             Search videos, shorts, channels, playlists
                                 Options: --type <video|channel|playlist|movie|short>
  video, -v <videoId|url>        Get detailed video metadata and statistics
  comments, -c <videoId|url>     Get comments list
                                 Options: --limit <number>
  channel, -ch <handle|id|url>   Get channel profile and tab contents
                                 Options: --tab <videos|shorts|playlists>
  playlist, -p <playlistId|url>  Get playlist details and tracks list
  trending, -t [category]        Get trending videos (now, music, gaming, movies)
  shorts <videoId|url>           Get Shorts video details and view metrics
  suggestions, -q <query>        Get search autocomplete suggestions
  captions <videoId|url>         Get caption tracks and available languages
  thumbnail <videoId|url>        Download highest resolution video thumbnail
                                 Options: --out <path> (default: ./thumbnail.jpg)

Examples:
  node yt.js search "lofi hip hop"
  node yt.js video "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  node yt.js comments "dQw4w9WgXcQ" --limit 10
  node yt.js channel "@MrBeast" --tab videos
  node yt.js trending music
  node yt.js suggestions "javascript tutorial"
  node yt.js thumbnail "dQw4w9WgXcQ" --out ./rickroll_thumb.jpg
==============================================================================
`);
  }

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const command = args[0].toLowerCase();
  const target = args[1];

  // Helper to parse flags
  function getFlag(flagName, defaultValue = null) {
    const idx = args.indexOf(flagName);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
      return args[idx + 1];
    }
    return defaultValue;
  }

  (async () => {
    const yt = new YouTube();

    try {
      if (command === 'search' || command === '-s') {
        if (!target) throw new Error('Search query is required');
        const type = getFlag('--type', 'all');
        const result = await yt.search(target, { type });
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'video' || command === '-v') {
        if (!target) throw new Error('Video ID or URL is required');
        const result = await yt.getVideo(target);
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'comments' || command === '-c') {
        if (!target) throw new Error('Video ID or URL is required');
        const limit = parseInt(getFlag('--limit', '20'), 10);
        const result = await yt.getComments(target, { limit });
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'channel' || command === '-ch') {
        if (!target) throw new Error('Channel Handle, ID, or URL is required');
        const tab = getFlag('--tab', 'videos');
        const result = await yt.getChannel(target, { tab });
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'playlist' || command === '-p') {
        if (!target) throw new Error('Playlist ID or URL is required');
        const result = await yt.getPlaylist(target);
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'trending' || command === '-t') {
        const cat = target || 'now';
        const result = await yt.getTrending(cat);
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'shorts') {
        if (!target) throw new Error('Shorts Video ID or URL is required');
        const result = await yt.getShorts(target);
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'suggestions' || command === '-q') {
        if (!target) throw new Error('Query is required');
        const result = await yt.getSuggestions(target);
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'captions') {
        if (!target) throw new Error('Video ID or URL is required');
        const result = await yt.getCaptions(target);
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'thumbnail') {
        if (!target) throw new Error('Video ID or URL is required');
        const out = getFlag('--out', './thumbnail.jpg');
        const saved = await yt.downloadThumbnail(target, out);
        console.log(`✅ Thumbnail downloaded successfully to: ${saved}`);
      } else {
        // If first argument is a video ID or URL directly
        const videoId = yt._extractVideoId(command);
        if (videoId) {
          const result = await yt.getVideo(videoId);
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.error(`Unknown command: '${command}'`);
          printHelp();
          process.exit(1);
        }
      }
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  })();
}

module.exports = YouTube;

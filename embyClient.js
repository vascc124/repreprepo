const axios = require("axios");

// --- Constants ---
const EMBY_CLIENT_NAME = 'StreamBridge';
const EMBY_CLIENT_VERSION = '1.1.0';
const EMBY_DEVICE_NAME = 'StreamBridge Addon';
const HEADER_EMBY_TOKEN = 'X-Emby-Token';
const HEADER_EMBY_DEVICE_ID = 'X-Emby-Device-Id';
const HEADER_EMBY_DEVICE_NAME = 'X-Emby-Device-Name';
const HEADER_EMBY_CLIENT = 'X-Emby-Client';
const HEADER_EMBY_CLIENT_VERSION = 'X-Emby-Client-Version';
const HEADER_EMBY_AUTHORIZATION = 'X-Emby-Authorization';
const DEFAULT_REQUEST_TIMEOUT = 15000;
const ITEM_TYPE_MOVIE = 'Movie';
const ITEM_TYPE_EPISODE = 'Episode';
const ITEM_TYPE_SERIES = 'Series';
const DEFAULT_FIELDS = "ProviderIds,Name,MediaSources,Path,Id,IndexNumber,ParentIndexNumber"; // Consolidated fields
const DEVICE_ID = 'stremio-addon-device-id';
const COLLECTION_TYPE_MAP = {
    movies: ['movie'],
    tvshows: ['series'],
    mixed: ['movie', 'series'],
    boxsets: ['movie'],
    homevideos: ['movie', 'series'],
    folders: ['movie', 'series']
};
const DEFAULT_CATALOG_LIMIT = 150;
const FALLBACK_SUBTITLE_FORMAT = 'vtt';
const FALLBACK_META_PREFIX = "emby";
const EMBY_ID_KINDS = { MOVIE: "movie", SERIES: "series", EPISODE: "episode" };

const MOVIE_ITEM_TYPES = ['Movie', 'Video'];
const SERIES_ITEM_TYPES = ['Series', 'Folder'];

const SERIES_CHILD_ITEM_TYPES = new Set(['Episode', 'Video', 'Movie']);

function encodeEmbyIdValue(raw) {
    const base64 = Buffer.from(String(raw), 'utf8').toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeEmbyIdValue(encoded) {
    if (!encoded) return null;
    let normalized = String(encoded).replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) normalized += '=';
    try {
        return Buffer.from(normalized, 'base64').toString('utf8');
    } catch (err) {
        console.warn('? Failed to decode Emby fallback id:', encoded, err.message);
        return null;
    }
}

function buildFallbackMetaId(kind, rawId) {
    if (!rawId) return null;
    const encoded = encodeEmbyIdValue(rawId);
    return encoded ? `${FALLBACK_META_PREFIX}~${kind}~${encoded}` : null;
}

const COMMON_VIDEO_EXTENSIONS = new Set(['mkv','mp4','avi','mov','wmv','flv','m4v','mpg','mpeg','ts','m2ts','webm','iso','m2v','ogm','3gp','divx']);
const RELEASE_TOKEN_REGEX = /\b(480p|720p|1080p|1440p|2160p|4k|8k|x264|x265|h264|h265|hevc|hdr|hdr10|dvdrip|brrip|bluray|web[- ]?dl|webrip|hdtv|remux|ac3|dts|10bit|8bit|proper|repack|uncut|extended|imax|subbed|multi)\b/gi;

function stripFileExtension(value) {
    if (!value) return value;
    const lastDot = value.lastIndexOf('.');
    if (lastDot === -1) return value;
    const ext = value.slice(lastDot + 1).toLowerCase();
    return COMMON_VIDEO_EXTENSIONS.has(ext) ? value.slice(0, lastDot) : value;
}

function extractFileStem(pathValue) {
    if (!pathValue) return null;
    const normalized = String(pathValue).split(/[\/]/).pop();
    if (!normalized) return null;
    return stripFileExtension(normalized);
}

function sanitizeTitleCandidate(raw, { removeReleaseTokens = false } = {}) {
    if (!raw) return null;
    let cleaned = String(raw).trim();
    if (!cleaned) return null;
    cleaned = cleaned.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (removeReleaseTokens) {
        RELEASE_TOKEN_REGEX.lastIndex = 0;
        cleaned = cleaned.replace(RELEASE_TOKEN_REGEX, ' ');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
    }
    return cleaned;
}

function hasReleaseTokens(value) {
    if (!value) return false;
    RELEASE_TOKEN_REGEX.lastIndex = 0;
    const result = RELEASE_TOKEN_REGEX.test(value);
    RELEASE_TOKEN_REGEX.lastIndex = 0;
    return result;
}

function deriveDisplayName(item) {
    if (!item) return 'Unknown';
    const rawName = (item.Name || '').trim();
    const originalTitle = (item.OriginalTitle || '').trim();
    const pathStem = extractFileStem(item.Path);

    const sanitizedOriginal = sanitizeTitleCandidate(originalTitle);
    const sanitizedNameLoose = sanitizeTitleCandidate(rawName);
    const sanitizedNameClean = sanitizeTitleCandidate(rawName, { removeReleaseTokens: true });
    const sanitizedStem = sanitizeTitleCandidate(pathStem, { removeReleaseTokens: true });

    const toLower = (value) => (value ? value.toLowerCase() : '');

    const rawMatchesStem = rawName && pathStem && toLower(rawName) === toLower(pathStem);
    const nameLooksLikeFile = Boolean(rawName && (rawMatchesStem || rawName.includes('_') || rawName.includes('.') || hasReleaseTokens(rawName)));

    if (sanitizedOriginal && sanitizedOriginal.length > 1) {
        return sanitizedOriginal;
    }

    if (!nameLooksLikeFile && sanitizedNameLoose && sanitizedNameLoose.length > 1) {
        return sanitizedNameLoose;
    }

    if (sanitizedNameClean && sanitizedNameClean.length > 1) {
        return sanitizedNameClean;
    }

    if (sanitizedStem && sanitizedStem.length > 1) {
        return sanitizedStem;
    }

    if (sanitizedNameLoose && sanitizedNameLoose.length > 1) {
        return sanitizedNameLoose;
    }

    if (rawName) return rawName;
    return 'Unknown';
}

function parseFallbackMetaId(metaId) {
    if (!metaId || typeof metaId !== 'string') return null;
    if (!metaId.startsWith(`${FALLBACK_META_PREFIX}~`)) return null;
    const parts = metaId.split('~');
    if (parts.length !== 3) return null;
    const [, kind, encoded] = parts;
    const rawId = decodeEmbyIdValue(encoded);
    if (!rawId) return null;
    return { kind, rawId };
}

function buildEmbyHeaders(config) {
    const headers = { Accept: 'application/json' };
    if (config && config.accessToken) {
        headers[HEADER_EMBY_TOKEN] = config.accessToken;
    }
    headers[HEADER_EMBY_DEVICE_ID] = DEVICE_ID;
    headers[HEADER_EMBY_DEVICE_NAME] = EMBY_DEVICE_NAME;
    headers[HEADER_EMBY_CLIENT] = EMBY_CLIENT_NAME;
    headers[HEADER_EMBY_CLIENT_VERSION] = EMBY_CLIENT_VERSION;
    headers[HEADER_EMBY_AUTHORIZATION] = `MediaBrowser Client="${EMBY_CLIENT_NAME}", Device="${EMBY_DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${EMBY_CLIENT_VERSION}"`;
    return headers;
}

function buildRequestParams(params = {}, config, { includeUserId = false } = {}) {
    const query = { ...(params || {}) };
    if (config && config.accessToken && !query.api_key) {
        query.api_key = config.accessToken;
    }
    if (includeUserId && config && config.userId && !query.UserId) {
        query.UserId = config.userId;
    }
    if (!query.DeviceId) {
        query.DeviceId = DEVICE_ID;
    }
    return query;
}

function appendAuthParams(rawUrl, config, extraParams = {}) {
    if (!rawUrl) return null;
    try {
        const urlObj = new URL(rawUrl, config.serverUrl);
        if (config && config.accessToken && !urlObj.searchParams.has('api_key')) {
            urlObj.searchParams.append('api_key', config.accessToken);
        }
        if (config && config.userId && !urlObj.searchParams.has('UserId')) {
            urlObj.searchParams.append('UserId', config.userId);
        }
        if (!urlObj.searchParams.has('DeviceId')) {
            urlObj.searchParams.append('DeviceId', DEVICE_ID);
        }
        Object.entries(extraParams || {}).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            if (!urlObj.searchParams.has(key)) {
                urlObj.searchParams.append(key, String(value));
            }
        });
        return urlObj.toString();
    } catch (err) {
        console.warn('[StreamBridge] Failed to append auth params to URL:', err.message);
        return rawUrl;
    }
}

async function requestPlaybackInfo(itemId, config) {
    if (!itemId || !config || !config.serverUrl) return null;
    const headers = buildEmbyHeaders(config);
    const params = buildRequestParams({}, config, { includeUserId: true });
    const payload = {
        UserId: config.userId,
        AutoOpenLiveStream: false,
        EnableDirectPlay: true,
        EnableDirectStream: true,
        EnableTranscoding: true
    };
    try {
        const response = await axios.post(`${config.serverUrl}/Items/${itemId}/PlaybackInfo`, payload, {
            headers,
            params,
            timeout: DEFAULT_REQUEST_TIMEOUT
        });
        return response.data;
    } catch (err) {
        console.warn(`PlaybackInfo request failed for ${itemId}:`, err.message);
        return null;
    }
}


// --- Helper Functions ---

function resolveCollectionTypes(view) {
    if (!view) return ['movie'];

    const collectionType = (view.CollectionType || '').toLowerCase();
    const explicit = collectionType ? COLLECTION_TYPE_MAP[collectionType] : null;
    if (explicit && explicit.length) return explicit;

    const viewType = (view.Type || '').toLowerCase();
    const nameTokens = (view.Name || '').toLowerCase();
    const combinedTokens = [collectionType, viewType, nameTokens].filter(Boolean).join(' ');

    const hasSeriesHint = /(tv|show|series)/.test(combinedTokens);
    const hasMovieHint = /(movie|film|cinema|video)/.test(combinedTokens);
    const hasMixedHint = /(mix|mixed|collection|folder)/.test(combinedTokens) || (hasSeriesHint && hasMovieHint);

    if (hasMixedHint) return ['movie', 'series'];
    if (hasSeriesHint && !hasMovieHint) return ['series'];
    if (hasMovieHint && !hasSeriesHint) return ['movie'];

    if (!collectionType && (viewType === 'folder' || viewType === 'userview' || viewType === 'collectionfolder')) {
        return ['movie', 'series'];
    }

    return ['movie'];
}

function extractProviderId(providerIds, keys) {
    if (!providerIds) return null;
    for (const key of keys) {
        const value = providerIds[key];
        if (value !== undefined && value !== null && value !== '') {
            return String(value);
        }
    }
    return null;
}

function ensureImdbFormat(id) {
    if (!id) return null;
    return id.startsWith('tt') ? id : 'tt' + id;
}



/**
 * Checks if Emby provider IDs match the given IMDb or TMDb IDs, handling variations.
 * @param {object} providerIds - The ProviderIds object from Emby.
 * @param {string|null} imdbIdToMatch - The IMDb ID (e.g., "tt1234567").
 * @param {string|null} tmdbIdToMatch - The TMDb ID (as a string).
 * @param {string|null} tvdbIdToMatch - The TVDB ID (as a string).
 * @param {string|null} anidbIdToMatch - The AniDB ID (as a string).
 * @returns {boolean} True if a match is found, false otherwise.
 */
function _isMatchingProviderId(providerIds, imdbIdToMatch, tmdbIdToMatch, tvdbIdToMatch, anidbIdToMatch) {
    if (!providerIds) return false;

    // Check IMDb (case-insensitive and numeric format)
    if (imdbIdToMatch) {
        const numericImdbVal = imdbIdToMatch.replace('tt', '');
        if (providerIds.Imdb === imdbIdToMatch || providerIds.imdb === imdbIdToMatch || providerIds.IMDB === imdbIdToMatch) return true;
        if (numericImdbVal && (providerIds.Imdb === numericImdbVal || providerIds.imdb === numericImdbVal || providerIds.IMDB === numericImdbVal)) return true;
    }

    // Check TMDb (case-insensitive and string/number comparison)
    if (tmdbIdToMatch) {
        const tmdbIdStr = String(tmdbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.Tmdb === tmdbIdStr || providerIds.tmdb === tmdbIdStr || providerIds.TMDB === tmdbIdStr ||
            (providerIds.Tmdb && String(providerIds.Tmdb) === tmdbIdStr)) return true; // Compare against Emby's value as string too
    }

    // Check TVDB (case-insensitive and string/number comparison)
    if (tvdbIdToMatch) {
        const tvdbIdStr = String(tvdbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.Tvdb === tvdbIdStr || providerIds.tvdb === tvdbIdStr || providerIds.TVDB === tvdbIdStr ||
            (providerIds.Tvdb && String(providerIds.Tvdb) === tvdbIdStr)) return true; // Compare against Emby's value as string too
    }

    // Check AniDB (case-insensitive and string/number comparison)
    if (anidbIdToMatch) {
        const anidbIdStr = String(anidbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.AniDb === anidbIdStr || providerIds.anidb === anidbIdStr || providerIds.ANIDB === anidbIdStr ||
            (providerIds.AniDb && String(providerIds.AniDb) === anidbIdStr)) return true; // Compare against Emby's value as string too
    }
    return false;
}

/**
 * Parses the Stremio-style ID (e.g., "tt12345", "tmdb12345", "tt12345:1:2")
 * into its components.
 * @param {string} idOrExternalId - The input ID string.
 * @returns {object|null} An object containing parsed info { baseId, itemType, seasonNumber, episodeNumber, imdbId, tmdbId } or null if format is invalid.
 */
function parseMediaId(idOrExternalId) {
    if (!idOrExternalId) return null;

    const parts = idOrExternalId.split(':');
    let baseId = parts[0];
    let itemType = ITEM_TYPE_MOVIE; // Default to Movie
    let seasonNumber = null;
    let episodeNumber = null;
    let imdbId = null;
    let tmdbId = null;
    let tvdbId = null;
    let anidbId = null;

    if (parts.length === 3) {
        itemType = ITEM_TYPE_EPISODE; // Indicates a series episode
        seasonNumber = parseInt(parts[1], 10);
        episodeNumber = parseInt(parts[2], 10);
        if (isNaN(seasonNumber) || isNaN(episodeNumber)) {
             console.warn("❌ Invalid season/episode number in ID:", idOrExternalId);
             return null; // Invalid format
        }
    } else if (parts.length === 2) {

        const prefix = parts[0].toLowerCase();
        const idPart = parts[1];
        if (!idPart) {
            console.warn(`❌ Missing ${prefix.toUpperCase()} ID part in ID:`, idOrExternalId);
            return null;
        }
        if (prefix === "tmdb") {
            tmdbId = idPart;
            baseId = `tmdb${idPart}`; // normalized
        } else if (prefix === "imdb") {
            imdbId = idPart.startsWith("tt") ? idPart : `tt${idPart}`;
            baseId = imdbId; // normalized
        } else if (prefix === "tvdb") {
            tvdbId = idPart;
            baseId = `tvdb${idPart}`; // normalized
        } else if (prefix === "anidb") {
            anidbId = idPart;
            baseId = `anidb${idPart}`; // normalized
        } else {
            console.warn("❌ Unsupported prefix in ID:", prefix);
            return null;
        }
    } else if (parts.length !== 1) {
        console.warn("❌ Unexpected ID format:", idOrExternalId);
        return null; // Unexpected format
    }

    if (baseId.startsWith("tt")) {
        if (baseId.length <= 2) {
            console.warn("❌ Incomplete IMDb ID format:", baseId);
            return null;
        }
        imdbId = baseId;
    } else if (baseId.startsWith("imdb") && baseId.length > 4) { 
        imdbId = baseId.substring(4); 
        if (!imdbId.startsWith("tt")) imdbId = "tt" + imdbId; 
    } else if (baseId.startsWith("tmdb") && baseId.length > 4) {
        tmdbId = baseId.substring(4);
    } else if (baseId.startsWith("tvdb") && baseId.length > 4) {
        tvdbId = baseId.substring(4);
    } else if (baseId.startsWith("anidb") && baseId.length > 5) {
        anidbId = baseId.substring(5);
    } else {
        console.warn("❌ Unsupported base ID format (expected tt..., tmdb..., tvdb..., or anidb...):", baseId);
        return null;
    }

    return { baseId, itemType, seasonNumber, episodeNumber, imdbId, tmdbId, tvdbId, anidbId };
}


// --- Emby Item Finding ---

/**
 * Performs an Emby API request with standard headers and error handling.
 * @param {string} url - The full URL for the API request.
 * @param {object} [params] - Optional query parameters.
 * @param {string} [method='get'] - The HTTP method.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The response data object or null if an error occurs.
 */
async function makeEmbyApiRequest(url, params = {}, config) {
    try {
        const headers = buildEmbyHeaders(config);
        const query = buildRequestParams(params, config);
        const response = await axios.get(url, {
            headers,
            params: query,
            timeout: DEFAULT_REQUEST_TIMEOUT
        });
        return response.data;
    } catch (err) {
        const status = err.response?.status;
        const statusHint = status ? ' (status ' + status + ')' : '';
        console.warn('[StreamBridge] API request failed for ' + url + ' with params ' + JSON.stringify(params) + statusHint + ':', err.message);
        if (status === 401) {
             console.log('[StreamBridge] Detected Unauthorized (401). The provided access token might be invalid or expired.');
        }
        return null; // Indicate failure
    }
}

/**
 * Attempts to find a movie item in Emby using various strategies.
 * @param {string|null} imdbId - The IMDb ID to search for.
 * @param {string|null} tmdbId - The TMDb ID to search for.
 * @param {string|null} tvdbId - The TVDB ID to search for.
 * @param {string|null} anidbId - The AniDB ID to search for.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The found Emby movie item or null.
 */
async function findMovieItem(imdbId, tmdbId, tvdbId, anidbId, config) {
    let foundItems = [];
    const baseMovieParams = {
        IncludeItemTypes: ITEM_TYPE_MOVIE,
        Recursive: true,
        Fields: DEFAULT_FIELDS,
        Limit: 10, // Limit results per query
        Filters: "IsNotFolder", // Important filter for movies
        UserId: config.userId
    };

    // --- Strategy 1: Direct ID Lookup (/Items) ---
    const directLookupParams = { ...baseMovieParams };
    let searchedIdField = "";
    if (imdbId) { directLookupParams.ImdbId = imdbId; searchedIdField = "ImdbId"; }
    else if (tmdbId) { directLookupParams.TmdbId = tmdbId; searchedIdField = "TmdbId"; }
    else if (tvdbId) { directLookupParams.TvdbId = tvdbId; searchedIdField = "TvdbId"; }
    else if (anidbId) { directLookupParams.AniDbId = anidbId; searchedIdField = "AniDbId"; }
    if (searchedIdField) {
        const data = await makeEmbyApiRequest(`${config.serverUrl}/Items`, directLookupParams, config);
        if (data?.Items?.length > 0) {
            const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
            if (matches.length > 0) {
                //console.log(`🔍 Found movie via /Items with ${searchedIdField}=${directLookupParams[searchedIdField]}`);
                foundItems.push(...matches);
            }
        }
    }

    // --- Strategy 2: AnyProviderIdEquals Lookup (/Users/{UserId}/Items) ---
    if (foundItems.length === 0) {
        const anyProviderIdFormats = [];
        if (imdbId) {
            const numericImdbId = imdbId.replace('tt', '');
            anyProviderIdFormats.push(`imdb.${imdbId}`, `Imdb.${imdbId}`);
            if (numericImdbId !== imdbId) anyProviderIdFormats.push(`imdb.${numericImdbId}`, `Imdb.${numericImdbId}`);
        } else if (tmdbId) {
            anyProviderIdFormats.push(`tmdb.${tmdbId}`, `Tmdb.${tmdbId}`);
        } else if (tvdbId) {
            anyProviderIdFormats.push(`tvdb.${tvdbId}`, `Tvdb.${tvdbId}`);
        } else if (anidbId) {
            anyProviderIdFormats.push(`anidb.${anidbId}`, `AniDb.${anidbId}`);
        }

        for (const attemptFormat of anyProviderIdFormats) {
            const altParams = { ...baseMovieParams, AnyProviderIdEquals: attemptFormat };
            delete altParams.ImdbId; // Remove specific ID params when using AnyProviderIdEquals
            delete altParams.TmdbId;
            delete altParams.TvdbId;
            delete altParams.AniDbId;
            delete altParams.UserId; // /Users/{userId}/Items doesn't need UserId in params

            const data = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config);
            if (data?.Items?.length > 0) {
                const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                 if (matches.length > 0) {
                    //console.log(`🔍 Found movie via /Users/{UserId}/Items with AnyProviderIdEquals=${attemptFormat}`);
                    foundItems.push(...matches);
                }
            }
        }
    }

     //if (foundItems.length === 0) 
        //console.log(`📭 No Emby movie match found for ${imdbId || tmdbId || tvdbId || anidbId}.`);
    return foundItems; // Return foundItems if found after all attempts
}


/**
 * Attempts to find a series item in Emby.
 * @param {string|null} imdbId - The IMDb ID of the series.
 * @param {string|null} tmdbId - The TMDb ID of the series.
 * @param {string|null} tvdbId - The TVDB ID of the series.
 * @param {string|null} anidbId - The AniDB ID of the series.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The found Emby series item or null.
 */
async function findSeriesItem(imdbId, tmdbId, tvdbId, anidbId, config) {
    let foundSeries = [];
    const baseSeriesParams = {
        IncludeItemTypes: ITEM_TYPE_SERIES,
        Recursive: true,
        Fields: "ProviderIds,Name,Id", // Only need these fields for series lookup
        Limit: 5
    };

    // --- Strategy 1: Direct ID Lookup (/Users/{UserId}/Items) ---
    const seriesLookupParams1 = { ...baseSeriesParams };
    if (imdbId) seriesLookupParams1.ImdbId = imdbId;
    else if (tmdbId) seriesLookupParams1.TmdbId = tmdbId;
    else if (tvdbId) seriesLookupParams1.TvdbId = tvdbId;
    else if (anidbId) seriesLookupParams1.AniDbId = anidbId;
    const data1 = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, seriesLookupParams1, config);
    if (data1?.Items?.length > 0) {
        const matches = data1.Items.filter(s => _isMatchingProviderId(s.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
        if (matches.length > 0) {
             //console.log(`🔍 Found series via /Users/{UserId}/Items with ImdbId/TmdbId`);
            foundSeries.push(...matches);
        }
    }

    // --- Strategy 2: AnyProviderIdEquals Lookup (/Users/{UserId}/Items) ---
    if (foundSeries.length === 0) {
        let anyProviderIdValue = null;
        if (imdbId) anyProviderIdValue = `imdb.${imdbId}`;
        else if (tmdbId) anyProviderIdValue = `tmdb.${tmdbId}`;
        else if (tvdbId) anyProviderIdValue = `tvdb.${tvdbId}`;
        else if (anidbId) anyProviderIdValue = `anidb.${anidbId}`;
        if (anyProviderIdValue) {
            const seriesLookupParams2 = { ...baseSeriesParams, AnyProviderIdEquals: anyProviderIdValue };
            delete seriesLookupParams2.ImdbId; // Remove specific ID params
            delete seriesLookupParams2.TmdbId;
            delete seriesLookupParams2.TvdbId;
            delete seriesLookupParams2.AniDbId;
            const data2 = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, seriesLookupParams2, config);
            if (data2?.Items?.length > 0) {
                const matches = data2.Items.filter(s => _isMatchingProviderId(s.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                 if (matches.length > 0) {
                    //console.log(`🔍 Found series via /Users/{UserId}/Items with AnyProviderIdEquals=${anyProviderIdValue}`);
                    foundSeries.push(...matches);
                }
            }
        }
    }

    //if (foundSeries.length === 0) console.log(`📭 No Emby series match found for ${imdbId || tmdbId || tvdbId || anidbId}.`);
    return foundSeries;
}

/**
 * Finds a specific episode within a given series and season in Emby.
 * @param {object} parentSeriesItem - The Emby series item object (must have Id and Name).
 * @param {number} seasonNumber - The season number to look for.
 * @param {number} episodeNumber - The episode number to look for.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The found Emby episode item or null.
 */
async function findEpisodeItem(parentSeriesItem, seasonNumber, episodeNumber, config) {
    // 1. Get Seasons for the Series
    const seasonsParams = { UserId: config.userId, Fields: "Id,IndexNumber,Name" };
    const seasonsData = await makeEmbyApiRequest(`${config.serverUrl}/Shows/${parentSeriesItem.Id}/Seasons`, seasonsParams, config);

    if (!seasonsData?.Items?.length > 0) {
        console.warn(`❌ No seasons found for series: ${parentSeriesItem.Name} (${parentSeriesItem.Id})`);
        return null;
    }

    // 2. Find the Target Season
    const targetSeason = seasonsData.Items.find(s => s.IndexNumber === seasonNumber);
    if (!targetSeason) {
        //console.info(`ℹ️ Season ${seasonNumber} not found for series: ${parentSeriesItem.Name}`);
        return null;
    }

    // 3. Get Episodes for the Target Season
    //console.log(`🔎 Fetching episodes for ${parentSeriesItem.Name} S${seasonNumber} (Season ID: ${targetSeason.Id})`);
    const episodesParams = {
        SeasonId: targetSeason.Id,
        UserId: config.userId,
        Fields: DEFAULT_FIELDS // Request all needed fields for the episode
    };
    const episodesData = await makeEmbyApiRequest(`${config.serverUrl}/Shows/${parentSeriesItem.Id}/Episodes`, episodesParams, config);

    if (!episodesData?.Items?.length > 0) {
        console.warn(`❌ No episodes found for season ${seasonNumber} in series: ${parentSeriesItem.Name}`);
        return null;
    }

    // 4. Find the Target Episode
    const targetEpisode = episodesData.Items.find(ep => ep.IndexNumber === episodeNumber && ep.ParentIndexNumber === seasonNumber);

    if (!targetEpisode) {
        console.info(`ℹ️ Episode S${seasonNumber}E${episodeNumber} not found in series: ${parentSeriesItem.Name}`);
        return null;
    }

     //console.log(`🎯 Found episode: ${targetEpisode.Name} (S${targetEpisode.ParentIndexNumber}E${targetEpisode.IndexNumber}, ID: ${targetEpisode.Id})`);
    return targetEpisode;
}



function buildPrimaryImageUrl(item, config) {
    const tag = item?.ImageTags?.Primary;
    if (!tag) return null;
    return `${config.serverUrl}/Items/${item.Id}/Images/Primary?tag=${tag}&quality=90&maxWidth=500&api_key=${config.accessToken}`;
}

function buildBackdropImageUrl(item, config) {
    const tag = Array.isArray(item?.BackdropImageTags) ? item.BackdropImageTags[0] : null;
    if (!tag) return null;
    return `${config.serverUrl}/Items/${item.Id}/Images/Backdrop?tag=${tag}&quality=90&maxWidth=1280&api_key=${config.accessToken}`;
}

async function buildFallbackSeriesVideos(seriesItem, config) {
    const params = {
        ParentId: seriesItem.Id,
        IncludeItemTypes: Array.from(SERIES_CHILD_ITEM_TYPES).join(','),
        Fields: 'Name,IndexNumber,ParentIndexNumber,Id,Overview,PremiereDate,ImageTags,SortName',
        SortBy: 'ParentIndexNumber,IndexNumber,SortName',
        SortOrder: 'Ascending',
        Recursive: true,
        UserId: config.userId,
        Limit: 3000,
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary'
    };

    const data = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, params, config);
    if (!data?.Items?.length) return [];

    let fallbackCounter = 1;
    return data.Items
        .filter(child => child && SERIES_CHILD_ITEM_TYPES.has(child.Type))
        .map(child => {
            const fallbackId = buildFallbackMetaId(EMBY_ID_KINDS.EPISODE, child.Id);
            if (!fallbackId) return null;

            const orderIndex = fallbackCounter++;
            const seasonNumber = typeof child.ParentIndexNumber === 'number' ? child.ParentIndexNumber : 1;
            const episodeNumber = typeof child.IndexNumber === 'number' ? child.IndexNumber : orderIndex;

            const derivedTitle = deriveDisplayName(child);
            const video = {
                id: fallbackId,
                title: derivedTitle && derivedTitle !== 'Unknown' ? derivedTitle : (child.Name || `Episode ${episodeNumber}`),
                season: seasonNumber,
                episode: episodeNumber
            };

            if (child.Overview) video.overview = child.Overview;
            if (child.PremiereDate) video.released = child.PremiereDate;

            const thumb = buildPrimaryImageUrl(child, config);
            if (thumb) video.thumbnail = thumb;

            return video;
        })
        .filter(Boolean)
        .sort((a, b) => {
            const seasonDiff = (a.season ?? 0) - (b.season ?? 0);
            if (seasonDiff !== 0) return seasonDiff;
            return (a.episode ?? 0) - (b.episode ?? 0);
        });
}



async function mapEmbyItemToMeta(item, stremioType, config, preferredMetaId = null, options = {}) {
    if (!item) return null;
    const providerIds = item.ProviderIds || {};
    const imdbId = ensureImdbFormat(extractProviderId(providerIds, ['Imdb', 'IMDB', 'imdb']));
    const tmdbId = extractProviderId(providerIds, ['Tmdb', 'TMDB', 'tmdb']);
    const tvdbId = extractProviderId(providerIds, ['Tvdb', 'TVDB', 'tvdb']);
    const anidbId = extractProviderId(providerIds, ['AniDb', 'ANIDB', 'anidb']);

    let metaId = imdbId || (tmdbId ? `tmdb${tmdbId}` : null) || (tvdbId ? `tvdb${tvdbId}` : null) || (anidbId ? `anidb${anidbId}` : null);

    if (!metaId) {
        const fallbackKind = stremioType === 'series' ? EMBY_ID_KINDS.SERIES : EMBY_ID_KINDS.MOVIE;
        metaId = buildFallbackMetaId(fallbackKind, item.Id);
    }

    if (!metaId && !preferredMetaId) return null;

    const chosenMetaId = preferredMetaId || metaId;
    const includeVideos = Boolean(options.includeVideos);

    const displayName = deriveDisplayName(item);

    const meta = {
        id: chosenMetaId,
        type: stremioType,
        name: displayName
    };

    if (!meta.name && item.Name) {
        meta.name = item.Name;
    }

    if (item.Overview) meta.description = item.Overview;
    if (item.ProductionYear) meta.releaseInfo = String(item.ProductionYear);

    const poster = buildPrimaryImageUrl(item, config);
    if (poster) meta.poster = poster;

    const backdrop = buildBackdropImageUrl(item, config);
    if (backdrop) meta.background = backdrop;

    if (item.PremiereDate) {
        meta.released = item.PremiereDate;
    }

    if (stremioType === 'series' && includeVideos) {
        meta.videos = await buildFallbackSeriesVideos(item, config);
    }

    return meta;
}



async function getLibraryDefinitions(config) {
    const data = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Views`, {}, config);
    if (!data?.Items?.length) return [];

    const definitions = [];
    for (const view of data.Items) {
        const types = resolveCollectionTypes(view);
        for (const type of types) {
            const suffix = types.length > 1 ? (type === 'series' ? ' (Series)' : ' (Movies)') : '';
            const baseName = `${view.Name}${suffix}`;
            definitions.push({
                libraryId: view.Id,
                type,
                name: baseName
            });
            definitions.push({
                libraryId: `${view.Id}::lastAdded`,
                type,
                name: `${baseName} (Last Added)`
            });
        }
    }
    return definitions;
}


function parseLibraryCatalogId(rawId) {
    if (!rawId || typeof rawId !== 'string') {
        return { libraryId: rawId, mode: 'all' };
    }
    const [libraryId, modeToken] = rawId.split('::');
    const mode = modeToken === 'favorites' ? 'all' : (modeToken || 'all');
    return { libraryId, mode };
}


async function getLibraryMetas(libraryId, stremioType, options = {}, config) {
    const { libraryId: baseLibraryId, mode } = parseLibraryCatalogId(libraryId);

    const params = {
        ParentId: baseLibraryId,
        IncludeItemTypes: (stremioType === 'series' ? SERIES_ITEM_TYPES : MOVIE_ITEM_TYPES).join(','),
        Fields: 'ProviderIds,Name,Overview,ProductionYear,ImageTags,BackdropImageTags,PremiereDate',
        ImageTypeLimit: 2,
        EnableImageTypes: 'Primary,Backdrop',
        Recursive: true,
        UserId: config.userId,
        Limit: typeof options.limit === "number" ? options.limit : DEFAULT_CATALOG_LIMIT
    };

    if (typeof options.skip === "number" && options.skip >= 0) params.StartIndex = options.skip;
    if (options.search && options.search.trim()) params.SearchTerm = options.search.trim();

    let sortStrategy = options.sort;
    if (!sortStrategy && mode === 'lastAdded') sortStrategy = 'lastAdded';

    if (sortStrategy === 'lastAdded') {
        params.SortBy = 'DateCreated';
        params.SortOrder = 'Descending';
    } else if (!params.SearchTerm || sortStrategy === 'name') {
        params.SortBy = 'SortName';
        params.SortOrder = 'Ascending';
    }

    const data = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, params, config);
    if (!data?.Items?.length) return [];

    const allowedTypes = new Set(stremioType === 'series' ? SERIES_ITEM_TYPES : MOVIE_ITEM_TYPES);
    const visitedFolders = new Set();
    const seenItems = new Set();
    const expandedItems = [];
    const queue = Array.isArray(data.Items) ? [...data.Items] : [];

    while (queue.length) {
        const current = queue.shift();
        if (!current) continue;

        if (stremioType === 'series' && current.Type === 'Folder') {
            if (visitedFolders.has(current.Id)) continue;
            visitedFolders.add(current.Id);

            const childParams = {
                ParentId: current.Id,
                IncludeItemTypes: SERIES_ITEM_TYPES.join(','),
                Fields: 'ProviderIds,Name,Overview,ProductionYear,ImageTags,BackdropImageTags,PremiereDate',
                ImageTypeLimit: 2,
                EnableImageTypes: 'Primary,Backdrop',
                Recursive: false,
                UserId: config.userId,
                Limit: DEFAULT_CATALOG_LIMIT
            };
            const childData = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, childParams, config);
            const childItems = Array.isArray(childData?.Items) ? childData.Items : [];

            let hasAllowedChild = false;
            for (const child of childItems) {
                if (!child) continue;
                if (child.Type === 'Folder') {
                    if (!visitedFolders.has(child.Id)) queue.push(child);
                    continue;
                }
                if (!seenItems.has(child.Id)) queue.push(child);
                if (allowedTypes.has(child.Type)) hasAllowedChild = true;
            }

            if (!hasAllowedChild && !seenItems.has(current.Id)) {
                expandedItems.push(current);
                seenItems.add(current.Id);
            }
            continue;
        }

        if (allowedTypes.has(current.Type) && !seenItems.has(current.Id)) {
            expandedItems.push(current);
            seenItems.add(current.Id);
        }
    }

    if (!expandedItems.length) return [];

    const metas = await Promise.all(
        expandedItems.map(item => mapEmbyItemToMeta(item, stremioType, config))
    );

    return metas.filter(Boolean);
}

async function getMeta(metaId, stremioType, config) {
    if (!metaId || !stremioType) return null;

    const fallbackMeta = parseFallbackMetaId(metaId);
    if (fallbackMeta) {
        const item = await getItemById(fallbackMeta.rawId, config);
        if (!item) return null;
        const includeVideos = stremioType === 'series';
        return await mapEmbyItemToMeta(item, stremioType, config, metaId, { includeVideos });
    }

    const parsed = parseMediaId(metaId);
    if (!parsed) return null;

    if (stremioType === 'series') {
        const seriesItems = await findSeriesItem(parsed.imdbId, parsed.tmdbId, parsed.tvdbId, parsed.anidbId, config);
        const seriesItem = Array.isArray(seriesItems) && seriesItems.length ? seriesItems[0] : null;
        if (!seriesItem) return null;
        return await mapEmbyItemToMeta(seriesItem, 'series', config, metaId, { includeVideos: true });
    }

    const movieItems = await findMovieItem(parsed.imdbId, parsed.tmdbId, parsed.tvdbId, parsed.anidbId, config);
    const movieItem = Array.isArray(movieItems) && movieItems.length ? movieItems[0] : null;
    if (!movieItem) return null;
    return await mapEmbyItemToMeta(movieItem, 'movie', config, metaId);
}



async function getItemById(itemId, config) {
    if (!itemId) return null;
    const params = {
        Fields: `${DEFAULT_FIELDS},Overview,ImageTags,BackdropImageTags,PremiereDate,SeriesName,ParentId`
    };
    return await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items/${itemId}`, params, config);
}

// --- Stream Generation ---

function determineSubtitleFormat(subtitleStream) {
    const codec = (subtitleStream?.Codec || '').toLowerCase();
    if (codec === 'subrip') return 'srt';
    if (codec === 'ass' || codec === 'ssa') return 'ass';
    if (codec) return codec;
    const container = (subtitleStream?.Container || '').toLowerCase();
    if (container === 'subrip') return 'srt';
    if (container) return container;
    return FALLBACK_SUBTITLE_FORMAT;
}

function buildSubtitleObject(subtitleStream, embyItem, mediaSourceId, config) {
    if (!subtitleStream || subtitleStream.IsImageSubtitleStream) return null;
    if (subtitleStream.IsTextSubtitleStream === false && subtitleStream.SupportsExternalStream === false) return null;
    const streamIndex = typeof subtitleStream.Index === "number" ? subtitleStream.Index : null;
    if (streamIndex === null || streamIndex < 0) return null;
    const detectedFormat = determineSubtitleFormat(subtitleStream);
    const isTextTrack = subtitleStream.IsTextSubtitleStream !== false;
    const targetFormat = detectedFormat || FALLBACK_SUBTITLE_FORMAT;
    const baseAddonUrl = config.__addonBaseUrl;
    const cfgToken = config.__cfg;
    let url;
    if (isTextTrack && baseAddonUrl && cfgToken) {
        const codecQuery = detectedFormat ? `?codec=${encodeURIComponent(detectedFormat)}` : '';
        url = `${baseAddonUrl}/${cfgToken}/subtitle/${embyItem.Id}/${mediaSourceId}/${streamIndex}.${targetFormat}${codecQuery}`;
    } else {
        const directBase = `${config.serverUrl}/Videos/${embyItem.Id}/${mediaSourceId}/Subtitles/${streamIndex}/Stream.${targetFormat}`;
        const extraParams = { Static: 'true' };
        if (isTextTrack) extraParams.encoding = 'utf-8';
        if (detectedFormat && detectedFormat !== targetFormat) {
            extraParams.SubtitleCodec = detectedFormat;
        }
        url = appendAuthParams(directBase, config, extraParams) || directBase;
    }
    const lang = subtitleStream.DisplayTitle || subtitleStream.Language || (detectedFormat || targetFormat).toUpperCase();
    return {
        id: `emby-${embyItem.Id}-${mediaSourceId}-${streamIndex}`,
        url,
        lang,
        forced: Boolean(subtitleStream.IsForced)
    };
}

function mapSubtitleStreams(source, embyItem, config) {
    if (!source?.MediaStreams?.length) return [];
    return source.MediaStreams
        .filter(ms => ms && ms.Type === 'Subtitle')
        .map(ms => buildSubtitleObject(ms, embyItem, source.Id, config))
        .filter(Boolean);
}
/**
 * @param {object} embyItem - The Emby movie or episode item (must have Id, Name, Type).
 * @param {string|null} [seriesName=null] - Optional: The name of the series if item is an episode.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if no suitable streams are found.
 */
async function getPlaybackStreams(embyItem, seriesName = null, config) {
    const playbackInfoData = await requestPlaybackInfo(embyItem.Id, config);

    if (!playbackInfoData?.MediaSources?.length) {
        console.warn('[StreamBridge] No media sources found for item:', embyItem.Name, `(${embyItem.Id})`);
        return null;
    }

    const streamDetailsArray = [];

    for (const source of playbackInfoData.MediaSources) {
        if (!source) continue;

        const videoStream = Array.isArray(source.MediaStreams) ? source.MediaStreams.find(ms => ms && ms.Type === 'Video') : null;
        const audioStream = Array.isArray(source.MediaStreams) ? source.MediaStreams.find(ms => ms && ms.Type === 'Audio') : null;
        const subtitles = mapSubtitleStreams(source, embyItem, config);

        let directPlayUrl = null;

        if (source.DirectStreamUrl) {
            directPlayUrl = appendAuthParams(source.DirectStreamUrl, config, {
                MediaSourceId: source.Id,
                Static: source.SupportsDirectPlay ? 'true' : undefined
            });
        }

        if (!directPlayUrl && source.Path && /^https?:/i.test(source.Path)) {
            directPlayUrl = appendAuthParams(source.Path, config, { MediaSourceId: source.Id });
        }

        if (!directPlayUrl && source.TranscodingUrl) {
            const transcodingBase = source.TranscodingUrl.startsWith('http') ? source.TranscodingUrl : `${config.serverUrl}${source.TranscodingUrl}`;
            directPlayUrl = appendAuthParams(transcodingBase, config, { MediaSourceId: source.Id });
        }

        if (!directPlayUrl) {
            const extension = source.Container ? `.${source.Container}` : '';
            const fallbackBase = `${config.serverUrl}/Videos/${embyItem.Id}/stream${extension}`;
            directPlayUrl = appendAuthParams(fallbackBase, config, {
                MediaSourceId: source.Id,
                Static: source.SupportsDirectPlay ? 'true' : undefined
            });
        }

        if (!directPlayUrl) continue;

        let qualityTitle = '';
        if (videoStream) {
            if (videoStream.DisplayTitle) qualityTitle += videoStream.DisplayTitle;
            if (videoStream.Height) {
                const resolutionToken = `${videoStream.Height}p`;
                if (!qualityTitle.toLowerCase().includes(resolutionToken.toLowerCase())) {
                    qualityTitle = (qualityTitle ? qualityTitle + ' ' : '') + resolutionToken;
                }
            }
            if (videoStream.Codec) {
                const codecToken = videoStream.Codec.toUpperCase();
                if (!qualityTitle.toLowerCase().includes(videoStream.Codec.toLowerCase())) {
                    qualityTitle = (qualityTitle ? qualityTitle + ' ' : '') + codecToken;
                }
            }
        }
        if (!qualityTitle && source.Container) qualityTitle = source.Container.toUpperCase();
        if (!qualityTitle && source.Name) qualityTitle = source.Name;
        if (!qualityTitle) qualityTitle = 'Direct Play';

        streamDetailsArray.push({
            directPlayUrl,
            itemName: embyItem.Name,
            seriesName,
            seasonNumber: embyItem.Type === ITEM_TYPE_EPISODE ? embyItem.ParentIndexNumber : null,
            episodeNumber: embyItem.Type === ITEM_TYPE_EPISODE ? embyItem.IndexNumber : null,
            itemId: embyItem.Id,
            mediaSourceId: source.Id,
            container: source.Container || null,
            videoCodec: videoStream?.Codec || source.VideoCodec || null,
            audioCodec: audioStream?.Codec || null,
            qualityTitle,
            subtitles,
            embyUrlBase: config.serverUrl,
            apiKey: config.accessToken
        });
    }

    if (!streamDetailsArray.length) {
        console.warn(`[StreamBridge] No playable sources found for item: ${embyItem.Name} (${embyItem.Id})`);
        return null;
    }

    return streamDetailsArray;
}


// --- Main Exported Function ---

/**
 * Orchestrates the process of finding an Emby item (movie or episode) based on
 * an external ID and returning direct play stream information, using provided configuration.
 * @param {string} idOrExternalId - The Stremio-style ID (e.g., "tt12345", "tmdb12345:1:2").
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if unsuccessful.
 */
async function getStreamsForFallback(fallbackMeta, config) {
    if (!fallbackMeta) return null;
    const { kind, rawId } = fallbackMeta;
    const item = await getItemById(rawId, config);
    if (!item) {
        console.warn(`Fallback stream lookup failed for item ${rawId}`);
        return null;
    }

    if (kind === EMBY_ID_KINDS.MOVIE) {
        return getPlaybackStreams(item, null, config);
    }

    if (kind === EMBY_ID_KINDS.EPISODE) {
        return getPlaybackStreams(item, item.SeriesName || null, config);
    }

    if (kind === EMBY_ID_KINDS.SERIES) {
        console.info('Received series fallback id without specific episode.');
        return null;
    }

    return null;
}

async function getStream(idOrExternalId, config) {


    // Validate provided configuration
    if (!config.serverUrl || !config.userId || !config.accessToken) {
        console.error("? Configuration missing (serverUrl, userId, or accessToken)");
        return null; // Critical configuration is missing
    }
    const fallbackMeta = parseFallbackMetaId(idOrExternalId);
    if (fallbackMeta) {
        const fallbackStreams = await getStreamsForFallback(fallbackMeta, config);
        return fallbackStreams && fallbackStreams.length ? fallbackStreams : null;
    }
    let fullIdForLog = idOrExternalId;
    try {
        // 1. Parse Input ID
        const parsedId = parseMediaId(idOrExternalId);
        if (parsedId) {
            fullIdForLog = parsedId.baseId + (parsedId.itemType === ITEM_TYPE_EPISODE ? ` S${parsedId.seasonNumber}E${parsedId.episodeNumber}` : '');
        }
        if (!parsedId) {
            console.error(`? Failed to parse input ID: ${idOrExternalId}`);
            return null;
        }
        //const fullIdForLog = parsedId.baseId + (parsedId.itemType === ITEM_TYPE_EPISODE ? ` S${parsedId.seasonNumber}E${parsedId.episodeNumber}` : '');

        // 2. Find the Emby Item
        let embyItem = null;
        let parentSeriesName = null;

        if (parsedId.itemType === ITEM_TYPE_MOVIE) {
            //console.log(`?? Searching for Movie: ${parsedId.imdbId || parsedId.tmdbId}`);
            embyItem = await findMovieItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
        } else if (parsedId.itemType === ITEM_TYPE_EPISODE) {   
            //console.log(`?? Searching for Series: ${parsedId.imdbId || parsedId.tmdbId}`);
            const seriesItems = await findSeriesItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
            if (seriesItems && seriesItems.length > 0) {
                let allStreams = [];
                let totalSeries = seriesItems.length;
                let failedSeries = 0;
                for (const series of seriesItems) {
                    const episode = await findEpisodeItem(series, parsedId.seasonNumber, parsedId.episodeNumber, config);
                    if (episode) {
                        const streams = await getPlaybackStreams(episode, series.Name, config);  
                        if (streams) allStreams.push(...streams);
                    } else {
                        failedSeries++;  // ?? Count failures
                    }
                }
                if (allStreams.length > 0) {
                    return allStreams;
                } else {
                    if (failedSeries === totalSeries) {
                        console.warn(`?? Could not find episode S${parsedId.seasonNumber}E${parsedId.episodeNumber} for ${fullIdForLog} in any matching series.`);
                    } else {
                        console.info(`?? Found partial matches, but no streams for S${parsedId.seasonNumber}E${parsedId.episodeNumber} in available series.`);
                    }
                    return null;
                }
            } else {
                console.warn(`?? Could not find parent series for ${fullIdForLog}, cannot find episode.`);
                return null;
            }
        }

        // 3. Get Playback Streams if Item Found
        if (embyItem && embyItem.length > 0) {  
            let allStreams = [];
            for (const item of embyItem) {
                const streams = await getPlaybackStreams(item, parentSeriesName, config);
                if (streams) allStreams.push(...streams);
            }
            return allStreams.length > 0 ? allStreams : null;
        } else {
             console.warn(`?? No Emby match found for ${fullIdForLog} after all attempts.`);
            return null;
        }

    } catch (err) {
        console.error(`? Unhandled error in getStreamWithConfig for ID ${fullIdForLog}:`, err.message, err.stack);
        return null;
    } 
}


// --- Exports ---
module.exports = {
    getStream,
    parseMediaId,
    getLibraryDefinitions,
    getLibraryMetas,
    getMeta
};













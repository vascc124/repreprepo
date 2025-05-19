const axios = require("axios");
// require('dotenv').config(); // No longer needed

// --- Configuration ---
// const EMBY_URL = process.env.EMBY_URL; // Removed
// const USERNAME = process.env.EMBY_USERNAME; // Removed
// const PASSWORD = process.env.EMBY_PASSWORD; // Removed

// --- State ---\n// These will be temporarily set by getStreamWithConfig
let currentEmbyUrl = null;
let currentAccessToken = null;
let currentUserId = null;

// Store original globals to restore them
let originalEmbyUrlGlobal = null; 
let originalAccessTokenGlobal = null;
let originalUserIdGlobal = null;

// --- Constants ---
const ITEM_TYPE_MOVIE = 'Movie';
const ITEM_TYPE_EPISODE = 'Episode';
const ITEM_TYPE_SERIES = 'Series';
const HEADER_EMBY_TOKEN = 'X-Emby-Token';
const HEADER_EMBY_AUTHORIZATION = 'X-Emby-Authorization';
const DEFAULT_FIELDS = "ProviderIds,Name,MediaSources,Path,Id,IndexNumber,ParentIndexNumber"; // Consolidated fields

// --- Helper Functions ---

/**
 * Builds the standard Emby Authorization header value.
 * @returns {string} The authorization header string.
 */
function buildAuthorizationHeader() {
    return `MediaBrowser Client="StremioEmbyAddon", Device="NodeServer", DeviceId="addon-client-001", Version="1.0.0"`;
}

/**
 * Checks if Emby provider IDs match the given IMDb or TMDb IDs, handling variations.
 * @param {object} providerIds - The ProviderIds object from Emby.
 * @param {string|null} imdbIdToMatch - The IMDb ID (e.g., "tt1234567").
 * @param {string|null} tmdbIdToMatch - The TMDb ID (as a string).
 * @returns {boolean} True if a match is found, false otherwise.
 */
function _isMatchingProviderId(providerIds, imdbIdToMatch, tmdbIdToMatch) {
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
    const baseId = parts[0];
    let itemType = ITEM_TYPE_MOVIE; // Default to Movie
    let seasonNumber = null;
    let episodeNumber = null;
    let imdbId = null;
    let tmdbId = null;

    if (parts.length === 3) {
        itemType = ITEM_TYPE_EPISODE; // Indicates a series episode
        seasonNumber = parseInt(parts[1], 10);
        episodeNumber = parseInt(parts[2], 10);
        if (isNaN(seasonNumber) || isNaN(episodeNumber)) {
             console.warn("❌ Invalid season/episode number in ID:", idOrExternalId);
             return null; // Invalid format
        }
    } else if (parts.length !== 1) {
         console.warn("❌ Unexpected ID format:", idOrExternalId);
         return null; // Unexpected format
    }

    if (baseId.startsWith("tt")) {
        imdbId = baseId;
    } else if (baseId.startsWith("imdb") && baseId.length > 4) { // Handle cases like "imdbtt12345" if they occur, or just "imdb:tt..."? Assuming prefix needs removal. Check original intent if needed.
        imdbId = baseId.substring(4); // Assuming "imdb" prefix needs removal; adjust if it's "imdb:tt..."
        if (!imdbId.startsWith("tt")) imdbId = "tt" + imdbId; // Ensure format consistency if only number follows "imdb"
    } else if (baseId.startsWith("tmdb") && baseId.length > 4) {
        tmdbId = baseId.substring(4);
    } else {
        console.warn("❌ Unsupported base ID format (expected tt... or tmdb...):", baseId);
        return null;
    }

    return { baseId, itemType, seasonNumber, episodeNumber, imdbId, tmdbId };
}

// --- Emby Item Finding ---

/**
 * Performs an Emby API request with standard headers and error handling.
 * @param {string} url - The full URL for the API request.
 * @param {object} [params] - Optional query parameters.
 * @param {string} [method='get'] - The HTTP method.
 * @returns {Promise<object|null>} The response data object or null if an error occurs.
 */
async function makeEmbyApiRequest(url, params = {}, method = 'get') {
    try {
        const response = await axios({
            method: method,
            url: url, // This will use the temporarily set currentEmbyUrl via the functions that call it
            headers: { [HEADER_EMBY_TOKEN]: currentAccessToken }, // Use currentAccessToken
            params: params,
        });
        return response.data;
    } catch (err) {
        console.warn(`⚠️ API Request failed for ${url} with params ${JSON.stringify(params)}:`, err.message);
        if (err.response?.status === 401) {
             console.log("🔧 Detected Unauthorized (401). The provided access token might be invalid or expired.");
             // No longer clearing global token here as it's managed by getStreamWithConfig
        }
        return null; // Indicate failure
    }
}

/**
 * Attempts to find a movie item in Emby using various strategies.
 * @param {string|null} imdbId - The IMDb ID to search for.
 * @param {string|null} tmdbId - The TMDb ID to search for.
 * @returns {Promise<object|null>} The found Emby movie item or null.
 */
async function findMovieItem(imdbId, tmdbId) {
    let foundItem = null;
    const baseMovieParams = {
        IncludeItemTypes: ITEM_TYPE_MOVIE,
        Recursive: true,
        Fields: DEFAULT_FIELDS,
        Limit: 10, // Limit results per query
        Filters: "IsNotFolder", // Important filter for movies
        UserId: currentUserId // Use currentUserId
    };

    // --- Strategy 1: Direct ID Lookup (/Items) ---
    const directLookupParams = { ...baseMovieParams };
    let searchedIdField = "";
    if (imdbId) { directLookupParams.ImdbId = imdbId; searchedIdField = "ImdbId"; }
    else if (tmdbId) { directLookupParams.TmdbId = tmdbId; searchedIdField = "TmdbId"; }

    if (searchedIdField) {
        const data = await makeEmbyApiRequest(`${currentEmbyUrl}/Items`, directLookupParams);
        if (data?.Items?.length > 0) {
            foundItem = data.Items.find(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId));
             if (foundItem) {
                console.log(`🔍 Found movie via /Items with ${searchedIdField}=${directLookupParams[searchedIdField]}`);
                return foundItem;
            }
        }
    }

    // --- Strategy 2: AnyProviderIdEquals Lookup (/Users/{UserId}/Items) ---
    if (!foundItem) {
        const anyProviderIdFormats = [];
        if (imdbId) {
            const numericImdbId = imdbId.replace('tt', '');
            anyProviderIdFormats.push(`imdb.${imdbId}`, `Imdb.${imdbId}`);
            if (numericImdbId !== imdbId) anyProviderIdFormats.push(`imdb.${numericImdbId}`, `Imdb.${numericImdbId}`);
        } else if (tmdbId) {
            anyProviderIdFormats.push(`tmdb.${tmdbId}`, `Tmdb.${tmdbId}`);
        }

        for (const attemptFormat of anyProviderIdFormats) {
            const altParams = { ...baseMovieParams, AnyProviderIdEquals: attemptFormat };
            delete altParams.ImdbId; // Remove specific ID params when using AnyProviderIdEquals
            delete altParams.TmdbId;
            delete altParams.UserId; // /Users/{userId}/Items doesn't need UserId in params

            const data = await makeEmbyApiRequest(`${currentEmbyUrl}/Users/${currentUserId}/Items`, altParams);
            if (data?.Items?.length > 0) {
                foundItem = data.Items.find(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId));
                 if (foundItem) {
                    console.log(`🔍 Found movie via /Users/{UserId}/Items with AnyProviderIdEquals=${attemptFormat}`);
                    return foundItem;
                }
            }
        }
    }

     if (!foundItem) console.log(`📭 No Emby movie match found for ${imdbId || tmdbId}.`);
    return null; // Return null if not found after all attempts
}

/**
 * Attempts to find a series item in Emby.
 * @param {string|null} imdbId - The IMDb ID of the series.
 * @param {string|null} tmdbId - The TMDb ID of the series.
 * @returns {Promise<object|null>} The found Emby series item or null.
 */
async function findSeriesItem(imdbId, tmdbId) {
    let foundSeries = null;
    const baseSeriesParams = {
        IncludeItemTypes: ITEM_TYPE_SERIES,
        Recursive: true,
        Fields: "ProviderIds,Name,Id", // Only need these fields for series lookup
        Limit: 5,
        UserId: currentUserId // Use currentUserId
    };

    // --- Strategy 1: Direct ID Lookup (/Users/{UserId}/Items) ---
    const seriesLookupParams1 = { ...baseSeriesParams };
    if (imdbId) seriesLookupParams1.ImdbId = imdbId;
    else if (tmdbId) seriesLookupParams1.TmdbId = tmdbId;

    const data1 = await makeEmbyApiRequest(`${currentEmbyUrl}/Users/${currentUserId}/Items`, seriesLookupParams1);
    if (data1?.Items?.length > 0) {
        foundSeries = data1.Items.find(s => _isMatchingProviderId(s.ProviderIds, imdbId, tmdbId));
        if (foundSeries) {
             console.log(`🔍 Found series via /Users/{UserId}/Items with ImdbId/TmdbId`);
            return foundSeries;
        }
    }

    // --- Strategy 2: AnyProviderIdEquals Lookup (/Users/{UserId}/Items) ---
    if (!foundSeries) {
        let anyProviderIdValue = null;
        if (imdbId) anyProviderIdValue = `imdb.${imdbId}`;
        else if (tmdbId) anyProviderIdValue = `tmdb.${tmdbId}`;

        if (anyProviderIdValue) {
            const seriesLookupParams2 = { ...baseSeriesParams, AnyProviderIdEquals: anyProviderIdValue };
            delete seriesLookupParams2.ImdbId; // Remove specific ID params
            delete seriesLookupParams2.TmdbId;

            const data2 = await makeEmbyApiRequest(`${currentEmbyUrl}/Users/${currentUserId}/Items`, seriesLookupParams2);
            if (data2?.Items?.length > 0) {
                foundSeries = data2.Items.find(s => _isMatchingProviderId(s.ProviderIds, imdbId, tmdbId));
                 if (foundSeries) {
                    console.log(`🔍 Found series via /Users/{UserId}/Items with AnyProviderIdEquals=${anyProviderIdValue}`);
                    return foundSeries;
                }
            }
        }
    }

    // Note: Could add numeric IMDb ID lookup or fallback scan for series too if needed.

    if (!foundSeries) console.log(`📭 No Emby series match found for ${imdbId || tmdbId}.`);
    return null;
}

/**
 * Finds a specific episode within a given series and season in Emby.
 * @param {object} parentSeriesItem - The Emby series item object (must have Id and Name).
 * @param {number} seasonNumber - The season number to look for.
 * @param {number} episodeNumber - The episode number to look for.
 * @returns {Promise<object|null>} The found Emby episode item or null.
 */
async function findEpisodeItem(parentSeriesItem, seasonNumber, episodeNumber) {
    if (!parentSeriesItem || !parentSeriesItem.Id) {
        console.warn("❌ Cannot find episode without parent series item ID.");
        return null;
    }
    const params = {
        ParentId: parentSeriesItem.Id,
        SeasonNumber: seasonNumber,
        IndexNumber: episodeNumber, // Emby uses IndexNumber for episode
        IncludeItemTypes: ITEM_TYPE_EPISODE,
        Recursive: true,
        Fields: DEFAULT_FIELDS,
        UserId: currentUserId, // Use currentUserId
        Limit: 1
    };

    // Use currentEmbyUrl
    const data = await makeEmbyApiRequest(`${currentEmbyUrl}/Items`, params);

    if (data?.Items?.length > 0) {
        // Assuming the first item is the correct one if multiple are returned (should be rare with specific S/E numbers)
        const episodeItem = data.Items[0];
        // Double check ParentIndexNumber (season) and IndexNumber (episode)
        if (episodeItem.ParentIndexNumber === seasonNumber && episodeItem.IndexNumber === episodeNumber) {
            console.log(`🎞️ Found episode: S${seasonNumber}E${episodeNumber} - ${episodeItem.Name}`);
            return episodeItem;
        } else {
            console.warn(`Found episode item for S${seasonNumber}E${episodeNumber}, but season/episode numbers didn't match Emby item: Emby S${episodeItem.ParentIndexNumber}E${episodeItem.IndexNumber}`);
        }
    }
    console.log(`📭 No Emby episode match found for S${seasonNumber}E${episodeNumber} in series ${parentSeriesItem.Name}.`);
    return null;
}

// --- Stream Generation ---

/**
 * Gets playback information for an Emby item and generates direct play stream URLs.
 * @param {object} embyItem - The Emby movie or episode item (must have Id, Name, Type).
 * @param {string|null} [seriesName=null] - Optional: The name of the series if item is an episode.
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if no suitable streams are found.
 */
async function getPlaybackStreams(embyItem, seriesName = null) {
    if (!embyItem || !embyItem.Id) { // We only need embyItem.Id to make the PlaybackInfo call initially
        console.warn("❌ Emby item ID missing, cannot get playback streams.");
        return [];
    }

    const playbackInfoParams = { UserId: currentUserId };
    const playbackInfoData = await makeEmbyApiRequest(
        `${currentEmbyUrl}/Items/${embyItem.Id}/PlaybackInfo`,
        playbackInfoParams
    );

    if (!playbackInfoData || !playbackInfoData.MediaSources || playbackInfoData.MediaSources.length === 0) {
        console.warn(`❌ No MediaSources found from PlaybackInfo for item: ${embyItem.Name} (${embyItem.Id})`);
        return [];
    }

    const streamDetails = [];

    for (const source of playbackInfoData.MediaSources) { // Iterate over sources from PlaybackInfo
        if (!source.Id) { // Path might not always be present for all source types, but Id is crucial
            console.warn("⚠️ Skipping a media source due to missing ID:", source);
            continue;
        }
        
        // Construct DirectPlayUrl. Note: Some sources might not be direct play, Stremio might filter these later.
        // The api_key is added for direct streams. For transcodes, Emby usually handles auth differently or embeds tokens.
        // This addon focuses on DirectPlay, so api_key is relevant.
        const directPlayUrl = `${currentEmbyUrl}/Videos/${embyItem.Id}/${source.Id}/stream.${source.Container}?MediaSourceId=${source.Id}&Static=true&api_key=${currentAccessToken}`;
        
        let qualityTitle = "Direct Play"; // Default
        // Use MediaSource.Name if available and more descriptive than constructed one.
        if (source.Name && source.Name !== "Direct Play") { 
            qualityTitle = source.Name;
        } else if (source.Type === 'Video' || source.MediaStreams) { // source.Type might not be 'Video' for main source, check MediaStreams
            const videoStream = source.MediaStreams?.find(ms => ms.Type === 'Video');
            const audioStream = source.MediaStreams?.find(ms => ms.Type === 'Audio');
            
            const resolution = videoStream?.Height ? `${videoStream.Height}p` : (source.Width && source.Height ? `${source.Height}p` : ''); // Prioritize videoStream Height
            const videoCodec = videoStream?.Codec || '';
            const audioCodec = audioStream?.Codec || '';
            const container = source.Container || '';

            let dynamicTitleParts = [];
            if (resolution) dynamicTitleParts.push(resolution);
            
            // Try to get more specific video info if available (e.g. HDR, DV)
            if (videoStream?.VideoRangeType) dynamicTitleParts.push(videoStream.VideoRangeType);
            else if (videoStream?.Profile) dynamicTitleParts.push(videoStream.Profile);
            
            if (videoCodec) dynamicTitleParts.push(videoCodec.toUpperCase());
            if (audioCodec) dynamicTitleParts.push(audioCodec.toUpperCase());
            if (container && !qualityTitle.includes(container.toUpperCase())) dynamicTitleParts.push(container.toUpperCase()); // Avoid duplicate container in title
            
            if (dynamicTitleParts.length > 0) {
                qualityTitle = dynamicTitleParts.join(' / ');
            } else if (source.Name) { // Fallback to source.Name if dynamic parts are empty
                 qualityTitle = source.Name;
            } else {
                qualityTitle = "Direct Stream"; // More generic fallback
            }
        }
        
        // For series, prefix with series name and episode details if available
        // embyItem here refers to the item for which we called PlaybackInfo (movie or episode)
        let streamNamePrefix = "";
        if (embyItem.Type === ITEM_TYPE_EPISODE) {
            const seriesDisplayName = seriesName || embyItem.SeriesName || "Series"; // seriesName is passed from _internalGetStreamLogic
            const seasonNum = embyItem.ParentIndexNumber !== undefined ? `S${String(embyItem.ParentIndexNumber).padStart(2, '0')}` : "";
            const episodeNum = embyItem.IndexNumber !== undefined ? `E${String(embyItem.IndexNumber).padStart(2, '0')}` : "";
            streamNamePrefix = `[${seriesDisplayName} ${seasonNum}${episodeNum}] `;
        } else if (embyItem.Type === ITEM_TYPE_MOVIE && embyItem.Name) {
            streamNamePrefix = `[${embyItem.Name}] `;
        }

        streamDetails.push({
            embyItemId: embyItem.Id, // ID of the movie or episode
            sourceId: source.Id,     // ID of this specific media source
            directPlayUrl: directPlayUrl,
            qualityTitle: streamNamePrefix + qualityTitle,
            name: source.Name, // Stremio's 'name' field (usually provider name)
            // title: streamNamePrefix + qualityTitle, // Stremio's 'title' field (more descriptive)
            container: source.Container,
            size: source.Size, 
            protocol: source.Protocol,
            isVideo: source.IsVideo || (source.MediaStreams?.some(ms => ms.Type === 'Video')), // Check IsVideo or if it has video streams
            // Additional details that might be useful for Stremio display or filtering
            bitrate: source.Bitrate,
            height: source.MediaStreams?.find(ms => ms.Type === 'Video')?.Height || source.Height,
            width: source.MediaStreams?.find(ms => ms.Type === 'Video')?.Width || source.Width,
            videoCodec: source.MediaStreams?.find(ms => ms.Type === 'Video')?.Codec,
            audioCodec: source.MediaStreams?.find(ms => ms.Type === 'Audio')?.Codec,
            isRemote: source.IsRemote, // Useful for Stremio's behaviorHints.bingeGroup
            supportsDirectPlay: source.SupportsDirectPlay,
            supportsDirectStream: source.SupportsDirectStream,
            supportsTranscoding: source.SupportsTranscoding
        });
    }
    return streamDetails;
}

// This is the old getStream, refactored to be an internal function
async function _internalGetStreamLogic(idOrExternalId) {
    console.log(`🎞️ Processing Emby ID (internal): ${idOrExternalId}`);

    const parsedId = parseMediaId(idOrExternalId);
    if (!parsedId) {
        console.warn("❌ Could not parse media ID:", idOrExternalId);
        return [];
    }

    const { itemType, imdbId, tmdbId, seasonNumber, episodeNumber } = parsedId;
    let embyItem = null;
    let seriesForEpisodeName = null; // To pass series name for better episode stream titles

    try {
        if (itemType === ITEM_TYPE_MOVIE) {
            embyItem = await findMovieItem(imdbId, tmdbId);
        } else if (itemType === ITEM_TYPE_EPISODE) {
            const seriesItem = await findSeriesItem(imdbId, tmdbId);
            if (seriesItem) {
                seriesForEpisodeName = seriesItem.Name; // Store series name
                embyItem = await findEpisodeItem(seriesItem, seasonNumber, episodeNumber);
            } else {
                console.warn(`📭 Series not found for episode request (IMDb: ${imdbId}, TMDb: ${tmdbId}).`);
            }
        } else {
            console.warn(`Unsupported item type: ${itemType} for ID: ${idOrExternalId}`);
            return [];
        }

        if (!embyItem) {
            console.warn(`📭 Emby item not found for ${itemType} with ID: ${idOrExternalId}`);
            return [];
        }

        const playbackInfo = await getPlaybackStreams(embyItem, seriesForEpisodeName);
        console.log(`🎥 Found ${playbackInfo.length} playback stream(s) for ${embyItem.Name}`);
        return playbackInfo;

    } catch (err) {
        console.error(`❌ Error processing Emby ID ${idOrExternalId}:`, err);
        return [];
    }
}

// --- Public API ---

/**
 * Fetches stream details from Emby based on an IMDb or TMDb ID, using configured credentials.
 * @param {string} idOrExternalId - The Stremio-style ID (e.g., "tt12345", "tmdb12345", "tt12345:1:2").
 * @param {object} config - Configuration object.
 * @param {string} config.serverUrl - The Emby server URL.
 * @param {string} config.userId - The Emby User ID.
 * @param {string} config.accessToken - The Emby Access Token.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of stream detail objects.
 */
async function getStreamWithConfig(idOrExternalId, { serverUrl, userId: newUserId, accessToken: newAccessToken }) {
    // Backup original globals
    originalEmbyUrlGlobal = currentEmbyUrl;
    originalAccessTokenGlobal = currentAccessToken;
    originalUserIdGlobal = currentUserId;

    // Set globals from config for this request
    currentEmbyUrl = serverUrl;
    currentAccessToken = newAccessToken;
    currentUserId = newUserId;

    console.log(`🔧 Using Emby config - URL: ${currentEmbyUrl}, UserID: ${currentUserId}`);

    if (!currentEmbyUrl || !currentUserId || !currentAccessToken) {
        console.error("❌ Emby server URL, User ID, or Access Token is missing in the configuration.");
        // Restore globals before returning
        currentEmbyUrl = originalEmbyUrlGlobal;
        currentAccessToken = originalAccessTokenGlobal;
        currentUserId = originalUserIdGlobal;
        return [];
    }
    
    try {
        // No explicit authentication call needed here as we have the token.
        // The makeEmbyApiRequest function will use currentAccessToken.
        // The findItem functions will use currentUserId and currentEmbyUrl.
        
        const streams = await _internalGetStreamLogic(idOrExternalId);
        return streams;
    } catch (error) {
        console.error("❌ Error in getStreamWithConfig:", error);
        return [];
    } finally {
        // Restore original globals
        currentEmbyUrl = originalEmbyUrlGlobal;
        currentAccessToken = originalAccessTokenGlobal;
        currentUserId = originalUserIdGlobal;
        console.log("🔧 Emby config restored to original state (if any).");
    }
}

module.exports = {
    getStreamWithConfig, // Expose the new function
    // getStream // Do not expose the old getStream directly if it's fully replaced
};

// --- Legacy/Removed Authentication Logic ---
// /**
//  * Authenticates with the Emby server using credentials from environment variables.
//  * Stores the access token and user ID globally upon success.
//  * @throws {Error} If authentication fails.
//  */
// async function authenticate() { ... } // Removed
//
// /**
//  * Ensures that a valid authentication token exists, authenticating if necessary.
//  * @throws {Error} If authentication fails.
//  */
// async function ensureAuth() { ... } // Removed
  
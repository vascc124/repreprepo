const axios = require("axios");

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
const DEFAULT_FIELDS = "ProviderIds,Name,MediaSources,Path,Id,IndexNumber,ParentIndexNumber"; // Consolidated fields

// --- Helper Functions ---


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
            url: url,
            headers: { [HEADER_EMBY_TOKEN]: currentAccessToken },
            params: params,
        });
        return response.data;
    } catch (err) {
        
        console.warn(`⚠️ API Request failed for ${url} with params ${JSON.stringify(params)}:`, err.message);
        
        if (err.response?.status === 401) {
             console.log("🔧 Detected Unauthorized (401). The provided access token might be invalid or expired.");
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
        UserId: currentUserId
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

            const data = await makeEmbyApiRequest(`${EMBY_URL}/Users/${userId}/Items`, altParams);
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
        Limit: 5
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
    // 1. Get Seasons for the Series
    const seasonsParams = { UserId: currentUserId, Fields: "Id,IndexNumber,Name" };
    const seasonsData = await makeEmbyApiRequest(`${currentEmbyUrl}/Shows/${parentSeriesItem.Id}/Seasons`, seasonsParams);

    if (!seasonsData?.Items?.length > 0) {
        console.warn(`❌ No seasons found for series: ${parentSeriesItem.Name} (${parentSeriesItem.Id})`);
        return null;
    }

    // 2. Find the Target Season
    const targetSeason = seasonsData.Items.find(s => s.IndexNumber === seasonNumber);
    if (!targetSeason) {
        console.warn(`❌ Season ${seasonNumber} not found for series: ${parentSeriesItem.Name}`);
        return null;
    }

    // 3. Get Episodes for the Target Season
    console.log(`🔎 Fetching episodes for ${parentSeriesItem.Name} S${seasonNumber} (Season ID: ${targetSeason.Id})`);
    const episodesParams = {
        SeasonId: targetSeason.Id,
        UserId: currentUserId,
        Fields: DEFAULT_FIELDS // Request all needed fields for the episode
    };
    const episodesData = await makeEmbyApiRequest(`${currentEmbyUrl}/Shows/${parentSeriesItem.Id}/Episodes`, episodesParams);

    if (!episodesData?.Items?.length > 0) {
        console.warn(`❌ No episodes found for season ${seasonNumber} in series: ${parentSeriesItem.Name}`);
        return null;
    }

    // 4. Find the Target Episode
    const targetEpisode = episodesData.Items.find(ep => ep.IndexNumber === episodeNumber && ep.ParentIndexNumber === seasonNumber);

    if (!targetEpisode) {
        console.warn(`❌ Episode S${seasonNumber}E${episodeNumber} not found in series: ${parentSeriesItem.Name}`);
        return null;
    }

     console.log(`🎯 Found episode: ${targetEpisode.Name} (S${targetEpisode.ParentIndexNumber}E${targetEpisode.IndexNumber}, ID: ${targetEpisode.Id})`);
    return targetEpisode;
}


// --- Stream Generation ---

/**
 * Gets playback information for an Emby item and generates direct play stream URLs.
 * @param {object} embyItem - The Emby movie or episode item (must have Id, Name, Type).
 * @param {string|null} [seriesName=null] - Optional: The name of the series if item is an episode.
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if no suitable streams are found.
 */
async function getPlaybackStreams(embyItem, seriesName = null) {
    const playbackInfoParams = { UserId: currentUserId};
    const playbackInfoData = await makeEmbyApiRequest(
        `${currentEmbyUrl}/Items/${embyItem.Id}/PlaybackInfo`,
        playbackInfoParams
    );

    if (!playbackInfoData?.MediaSources?.length > 0) {
        console.warn("❌ No MediaSources found for item:", embyItem.Name, `(${embyItem.Id})`);
        return null;
    }

    const streamDetailsArray = [];

    for (const source of playbackInfoData.MediaSources) {
        
      const videoStream = source.MediaStreams?.find(ms => ms.Type === 'Video');
      const audioStream = source.MediaStreams?.find(ms => ms.Type === 'Audio');

      const directPlayUrl = `${currentEmbyUrl}/Videos/${embyItem.Id}/stream.${source.Container}?MediaSourceId=${source.Id}&Static=true&api_key=${currentAccessToken}&DeviceId=stremio-addon-device-id`; // Ensure DeviceId is appropriate

      // Build Quality Title (same logic as original)
      let qualityTitle = "";
        if (videoStream) {
          qualityTitle += videoStream.DisplayTitle || "";
          if (videoStream.Width && videoStream.Height) {
              if (!qualityTitle.toLowerCase().includes(videoStream.Height + "p") && !qualityTitle.toLowerCase().includes(videoStream.Width + "x" + videoStream.Height)) {
                  qualityTitle = (qualityTitle ? qualityTitle + " " : "") + `${videoStream.Height}p`;
              }
          }
          if (videoStream.Codec) {
              if (!qualityTitle.toLowerCase().includes(videoStream.Codec.toLowerCase())) {
                    qualityTitle = (qualityTitle ? qualityTitle + " " : "") + videoStream.Codec.toUpperCase();
              }
          }
      } else if (source.Container) {
          qualityTitle = source.Container.toUpperCase();
      }
      if (source.Name && !qualityTitle) {
            qualityTitle = source.Name;
      }
      qualityTitle = qualityTitle || 'Direct Play'; // Fallback title

      streamDetailsArray.push({
          directPlayUrl: directPlayUrl,
          itemName: embyItem.Name,
          seriesName: seriesName, // Pass the series name if available
          // Use season/episode numbers directly from the embyItem if it's an episode
          seasonNumber: embyItem.Type === ITEM_TYPE_EPISODE ? embyItem.ParentIndexNumber : null,
          episodeNumber: embyItem.Type === ITEM_TYPE_EPISODE ? embyItem.IndexNumber : null,
          itemId: embyItem.Id,
          mediaSourceId: source.Id,
          container: source.Container,
          videoCodec: videoStream?.Codec || source.VideoCodec || null, // Prefer stream info
          audioCodec: audioStream?.Codec || null, // Prefer stream info
          qualityTitle: qualityTitle,
          embyUrlBase: currentEmbyUrl,
          apiKey: currentAccessToken // Exposing API key here - ensure this is acceptable for the client
      });
      
    }

    if (streamDetailsArray.length === 0) {
        console.warn(`❌ No direct playable sources found for item: ${embyItem.Name} (${embyItem.Id})`);
        return null;
    }

    return streamDetailsArray;
}


// --- Main Exported Function (Modified) ---

/**
 * Orchestrates the process of finding an Emby item (movie or episode) based on
 * an external ID and returning direct play stream information, using provided configuration.
 * @param {string} idOrExternalId - The Stremio-style ID (e.g., "tt12345", "tmdb12345:1:2").
 * @param {object} config - Configuration object.
 * @param {string} config.serverUrl - The Emby server URL.
 * @param {string} config.userId - The Emby user ID.
 * @param {string} config.accessToken - The Emby access token.
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if unsuccessful.
 */
async function getStream(idOrExternalId, { serverUrl, userId: newUserId, accessToken: newAccessToken }) {
    // Backup original globals
    originalEmbyUrlGlobal = currentEmbyUrl;
    originalAccessTokenGlobal = currentAccessToken;
    originalUserIdGlobal = currentUserId;

    // Set globals from config for this request
    currentEmbyUrl = serverUrl;
    currentAccessToken = newAccessToken;
    currentUserId = newUserId;
    
    console.log(`🔧 Using Emby config - URL: ${currentEmbyUrl}, UserID: ${currentUserId}`);
    // Validate provided configuration
    if (!currentEmbyUrl || !currentUserId || !currentAccessToken) {
        console.error("❌ Configuration missing (serverUrl, userId, or accessToken)");
        // Restore globals before returning
        currentEmbyUrl = originalEmbyUrlGlobal;
        currentAccessToken = originalAccessTokenGlobal;
        currentUserId = originalUserIdGlobal;
        return null; // Critical configuration is missing
    }
    
    try {
        // 1. Parse Input ID
        const parsedId = parseMediaId(idOrExternalId);
        if (!parsedId) {
            console.error(`❌ Failed to parse input ID: ${idOrExternalId}`);
            return null;
        }
        fullIdForLog = parsedId.baseId + (parsedId.itemType === ITEM_TYPE_EPISODE ? ` S${parsedId.seasonNumber}E${parsedId.episodeNumber}` : '');

        // 2. Find the Emby Item
        let embyItem = null;
        let parentSeriesName = null;

        if (parsedId.itemType === ITEM_TYPE_MOVIE) {
            console.log(`🎬 Searching for Movie: ${parsedId.imdbId || parsedId.tmdbId} on ${embyConfig.serverUrl}`);
            embyItem = await findMovieItem(parsedId.imdbId, parsedId.tmdbId, embyConfig);
        } else if (parsedId.itemType === ITEM_TYPE_EPISODE) {
            console.log(`📺 Searching for Series: ${parsedId.imdbId || parsedId.tmdbId} on ${embyConfig.serverUrl}`);
            const seriesItem = await findSeriesItem(parsedId.imdbId, parsedId.tmdbId, embyConfig);
            if (seriesItem) {
                parentSeriesName = seriesItem.Name;
                embyItem = await findEpisodeItem(seriesItem, parsedId.seasonNumber, parsedId.episodeNumber, embyConfig);
            } else {
                 console.warn(`📭 Could not find parent series for ${fullIdForLog}, cannot find episode.`);
            }
        }

        // 3. Get Playback Streams if Item Found
        if (embyItem) {
             console.log(`🎯 Using final Emby item: ${embyItem.Name} (${embyItem.Id}), Type: ${embyItem.Type}`);
            return await getPlaybackStreams(embyItem, parentSeriesName, embyConfig);
        } else {
             console.warn(`📭 No Emby match found for ${fullIdForLog} after all attempts.`);
            return null;
        }

    } catch (err) {
        console.error(`❌ Unhandled error in getStreamWithConfig for ID ${fullIdForLog}:`, err.message, err.stack);
        return null;
    }
}

// --- Exports ---
module.exports = {
    getStream,
};
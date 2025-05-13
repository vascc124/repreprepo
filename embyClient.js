const axios = require("axios");
require('dotenv').config();

// --- Configuration ---
const EMBY_URL = process.env.EMBY_URL;
const USERNAME = process.env.EMBY_USERNAME;
const PASSWORD = process.env.EMBY_PASSWORD;

// --- State ---
let accessToken = null;
let userId = null;

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

// --- Authentication ---

/**
 * Authenticates with the Emby server using credentials from environment variables.
 * Stores the access token and user ID globally upon success.
 * @throws {Error} If authentication fails.
 */
async function authenticate() {
    try {
        const res = await axios.post(
            `${EMBY_URL}/Users/AuthenticateByName`,
            {
                Username: USERNAME,
                Pw: PASSWORD,
            },
            {
                headers: {
                    [HEADER_EMBY_AUTHORIZATION]: buildAuthorizationHeader(),
                },
            }
        );

        accessToken = res.data.AccessToken;
        userId = res.data.User.Id;

        console.log("✅ Authenticated to Emby.");
    } catch (err) {
        console.error("❌ Emby Authentication Failed:", err.response?.data || err.message);
        // Clear potentially stale credentials
        accessToken = null;
        userId = null;
        throw new Error("Failed to authenticate with Emby.");
    }
}

/**
 * Ensures that a valid authentication token exists, authenticating if necessary.
 * @throws {Error} If authentication fails.
 */
async function ensureAuth() {
    if (!accessToken || !userId) {
        console.log("🔧 No active Emby session found. Authenticating...");
        await authenticate();
    }
    // Optional: Add a check here to verify if the existing token is still valid
    // e.g., by making a simple ping request. If it fails, re-authenticate.
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
            headers: { [HEADER_EMBY_TOKEN]: accessToken },
            params: params,
        });
        return response.data;
    } catch (err) {
        // More specific error logging could be added here (e.g., status code)
        console.warn(`⚠️ API Request failed for ${url} with params ${JSON.stringify(params)}:`, err.message);
        // If 401 Unauthorized, maybe trigger re-authentication?
        if (err.response?.status === 401) {
             console.log("🔧 Detected Unauthorized (401). Clearing token for re-auth attempt.");
             accessToken = null; // Clear token to force re-auth on next ensureAuth call
             userId = null;
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
        UserId: userId
    };

    // --- Strategy 1: Direct ID Lookup (/Items) ---
    const directLookupParams = { ...baseMovieParams };
    let searchedIdField = "";
    if (imdbId) { directLookupParams.ImdbId = imdbId; searchedIdField = "ImdbId"; }
    else if (tmdbId) { directLookupParams.TmdbId = tmdbId; searchedIdField = "TmdbId"; }

    if (searchedIdField) {
        const data = await makeEmbyApiRequest(`${EMBY_URL}/Items`, directLookupParams);
        if (data?.Items?.length > 0) {
            foundItem = data.Items.find(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId));
             if (foundItem) {
                console.log(`🔍 Found movie via /Items with ${searchedIdField}=${directLookupParams[searchedIdField]}`);
                return foundItem;
            }
        }
    }

    // --- Strategy 2: Numeric IMDb ID Lookup (/Items) ---
    if (!foundItem && imdbId) {
        const numericImdbId = imdbId.replace('tt', '');
        if (numericImdbId !== imdbId) {
            const numericMovieParams = { ...baseMovieParams, ImdbId: numericImdbId };
            delete numericMovieParams.TmdbId; // Ensure TmdbId isn't included
            const data = await makeEmbyApiRequest(`${EMBY_URL}/Items`, numericMovieParams);
             if (data?.Items?.length > 0) {
                foundItem = data.Items.find(i => _isMatchingProviderId(i.ProviderIds, imdbId, null)); // Only check against original imdbId
                 if (foundItem) {
                    console.log(`🔍 Found movie via /Items with numeric ImdbId=${numericImdbId}`);
                    return foundItem;
                }
            }
        }
    }

    // --- Strategy 3: AnyProviderIdEquals Lookup (/Users/{UserId}/Items) ---
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

    const data1 = await makeEmbyApiRequest(`${EMBY_URL}/Users/${userId}/Items`, seriesLookupParams1);
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

            const data2 = await makeEmbyApiRequest(`${EMBY_URL}/Users/${userId}/Items`, seriesLookupParams2);
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
    const seasonsParams = { UserId: userId, Fields: "Id,IndexNumber,Name" };
    const seasonsData = await makeEmbyApiRequest(`${EMBY_URL}/Shows/${parentSeriesItem.Id}/Seasons`, seasonsParams);

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
        UserId: userId,
        Fields: DEFAULT_FIELDS // Request all needed fields for the episode
    };
    const episodesData = await makeEmbyApiRequest(`${EMBY_URL}/Shows/${parentSeriesItem.Id}/Episodes`, episodesParams);

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
    const playbackInfoParams = { UserId: userId };
    const playbackInfoData = await makeEmbyApiRequest(
        `${EMBY_URL}/Items/${embyItem.Id}/PlaybackInfo`,
        playbackInfoParams
    );

    if (!playbackInfoData?.MediaSources?.length > 0) {
        console.warn("❌ No MediaSources found for item:", embyItem.Name, `(${embyItem.Id})`);
        return null;
    }

    const streamDetailsArray = [];

    for (const source of playbackInfoData.MediaSources) {
        // Only consider direct playable MKV sources as per original logic
        if (source.SupportsDirectPlay && source.Container //&& source.Container.toLowerCase() === 'mkv'
          ) {
            const videoStream = source.MediaStreams?.find(ms => ms.Type === 'Video');
            const audioStream = source.MediaStreams?.find(ms => ms.Type === 'Audio');

            const directPlayUrl = `${EMBY_URL}/Videos/${embyItem.Id}/stream.${source.Container}?MediaSourceId=${source.Id}&Static=true&api_key=${accessToken}&DeviceId=stremio-addon-device-id`; // Ensure DeviceId is appropriate

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


             console.log(`✅ Adding DirectPlay stream: (Quality hint: ${qualityTitle})`);
            // console.log(`   URL: ${directPlayUrl}`); // Optional: Log the full URL if needed for debugging

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
                embyUrlBase: EMBY_URL,
                apiKey: accessToken // Exposing API key here - ensure this is acceptable for the client
            });
        }
    }

    if (streamDetailsArray.length === 0) {
        console.warn(`❌ No direct playable sources found for item: ${embyItem.Name} (${embyItem.Id})`);
        return null;
    }

    return streamDetailsArray;
}


// --- Main Exported Function ---

/**
 * Orchestrates the process of finding an Emby item (movie or episode) based on
 * an external ID and returning direct play stream information.
 * @param {string} idOrExternalId - The Stremio-style ID (e.g., "tt12345", "tmdb12345:1:2").
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if unsuccessful.
 */
async function getStream(idOrExternalId) {
    let fullIdForLog = idOrExternalId || "undefined"; // For logging
    try {
        // 1. Ensure Authentication
        await ensureAuth();
        if (!accessToken || !userId) {
            throw new Error("Authentication failed or was not established."); // Should be caught by ensureAuth, but double-check
        }

        // 2. Parse Input ID
        const parsedId = parseMediaId(idOrExternalId);
        if (!parsedId) {
            console.error(`❌ Failed to parse input ID: ${idOrExternalId}`);
            return null;
        }
        fullIdForLog = parsedId.baseId + (parsedId.itemType === ITEM_TYPE_EPISODE ? ` S${parsedId.seasonNumber}E${parsedId.episodeNumber}` : ''); // Update log ID

        // 3. Find the Emby Item
        let embyItem = null;
        let parentSeriesName = null;

        if (parsedId.itemType === ITEM_TYPE_MOVIE) {
            console.log(`🎬 Searching for Movie: ${parsedId.imdbId || parsedId.tmdbId}`);
            embyItem = await findMovieItem(parsedId.imdbId, parsedId.tmdbId);
        } else if (parsedId.itemType === ITEM_TYPE_EPISODE) {
            console.log(`📺 Searching for Series: ${parsedId.imdbId || parsedId.tmdbId}`);
            const seriesItem = await findSeriesItem(parsedId.imdbId, parsedId.tmdbId);
            if (seriesItem) {
                parentSeriesName = seriesItem.Name; // Store name for stream details
                embyItem = await findEpisodeItem(seriesItem, parsedId.seasonNumber, parsedId.episodeNumber);
            } else {
                 console.warn(`📭 Could not find parent series for ${fullIdForLog}, cannot find episode.`);
            }
        }

        // 4. Get Playback Streams if Item Found
        if (embyItem) {
             console.log(`🎯 Using final Emby item: ${embyItem.Name} (${embyItem.Id}), Type: ${embyItem.Type}`);
            return await getPlaybackStreams(embyItem, parentSeriesName);
        } else {
             console.warn(`📭 No Emby match found for ${fullIdForLog} after all attempts.`);
            return null;
        }

    } catch (err) {
        console.error(`❌ Unhandled error in getStream for ID ${fullIdForLog}:`, err.message, err.stack);
        // If the error was due to auth failure during ensureAuth, token might be null now.
        if (err.message.includes("authenticate")) {
            accessToken = null; // Ensure token is cleared if auth specifically failed
             userId = null;
        }
        return null; // Return null on any catastrophic failure
    }
}

// --- Exports ---
module.exports = {
    getStream,
};
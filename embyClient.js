  const axios = require("axios");
  require('dotenv').config();

  const EMBY_URL = process.env.EMBY_URL 
  const USERNAME = process.env.EMBY_USERNAME
  const PASSWORD = process.env.EMBY_PASSWORD

  let accessToken = null;
  let userId = null;

  // Helper function to check provider IDs
  function _isMatchingProviderId(providerIds, imdbIdToMatch, tmdbIdToMatch) {
    if (!providerIds) return false;
    
    if (imdbIdToMatch) {
      const numericImdbVal = imdbIdToMatch.replace('tt', '');
      if (providerIds.Imdb === imdbIdToMatch || providerIds.imdb === imdbIdToMatch || providerIds.IMDB === imdbIdToMatch) return true;
      if (numericImdbVal && (providerIds.Imdb === numericImdbVal || providerIds.imdb === numericImdbVal || providerIds.IMDB === numericImdbVal)) return true;
    }
    
    if (tmdbIdToMatch) {
      // Checking against string version of Tmdb ID as well, as it might be stored as a number by Emby
      if (providerIds.Tmdb === tmdbIdToMatch || providerIds.tmdb === tmdbIdToMatch || providerIds.TMDB === tmdbIdToMatch || 
          (providerIds.Tmdb && String(providerIds.Tmdb) === tmdbIdToMatch)) return true;
    }
    
    return false;
  }

  function buildAuthorizationHeader() {
    return `MediaBrowser Client="StremioEmbyAddon", Device="NodeServer", DeviceId="addon-client-001", Version="1.0.0"`;
  }

  /**
   * Authenticate to Emby and store token + user ID
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
            "X-Emby-Authorization": buildAuthorizationHeader(),
          },
        }
      );

      accessToken = res.data.AccessToken;
      userId = res.data.User.Id;

      console.log("✅ Authenticated to Emby.");
    } catch (err) {
      console.error("❌ Emby Authentication Failed:", err.response?.data || err.message);
      throw new Error("Failed to authenticate with Emby.");
    }
  }


  /**
   * Ensure authentication is valid before making API calls
   */
  async function ensureAuth() {
    if (!accessToken || !userId) {
      await authenticate();
    }
  }

  async function getStream(idOrExternalId) {
    await ensureAuth();

    let baseId = null; // Will hold tt12345 or tmdb12345
    let seasonNumber = null;
    let episodeNumber = null;
    let itemType = 'Movie'; // Default to Movie

    const parts = idOrExternalId.split(':');
    baseId = parts[0];

    if (parts.length === 3) {
      itemType = 'Episode'; // Indicates a series episode
      seasonNumber = parseInt(parts[1], 10);
      episodeNumber = parseInt(parts[2], 10);
    }

    let imdbId = null;
    let tmdbId = null;

    if (baseId.startsWith("tt")) {
      imdbId = baseId;
    } else if (baseId.startsWith("imdb")) { // Handle cases like "imdb:tt12345"
      imdbId = baseId.substring(5);
    } else if (baseId.startsWith("tmdb")) {
      tmdbId = baseId.substring(5);
    } else {
      console.warn("❌ Unsupported base ID format (expected tt... or tmdb...):", baseId);
      return null;
    }


    try {
      let itemToGetPlaybackInfoFor; // Renamed from finalItem for clarity
      let parentSeriesItem = null; // To store parent series item if applicable

      if (itemType === 'Movie') {
        let queryParams = {
          IncludeItemTypes: "Movie", // Explicitly Movie for this block
          Recursive: true,
          Fields: "ProviderIds,Name,MediaSources,Path", // MediaSources might be resolved later via PlaybackInfo too
          Limit: 10, 
          Filters: "IsNotFolder"
        };
        let searchedIdField = "";
        let successfullyUsedParams = {};

        if (imdbId) {
          queryParams.ImdbId = imdbId;
          searchedIdField = "ImdbId";
        } else if (tmdbId) {
          queryParams.TmdbId = tmdbId;
          searchedIdField = "TmdbId";
        }

        if (searchedIdField) {
          try {
            const response = await axios.get(`${EMBY_URL}/Items`, {
              headers: { "X-Emby-Token": accessToken },
              params: { ...queryParams, UserId: userId } 
            });
            successfullyUsedParams = { ...queryParams, UserId: userId };
            if (response.data.Items && response.data.Items.length > 0) {
              itemToGetPlaybackInfoFor = response.data.Items.find(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId));
              if (itemToGetPlaybackInfoFor) {
              } else {
              }
            }
          } catch (e) {
            console.warn(`Error during movie /Items lookup with ${searchedIdField}=${queryParams[searchedIdField]}:`, e.message);
          }
        }

        if (!itemToGetPlaybackInfoFor && imdbId) {
          const numericImdbId = imdbId.replace('tt', '');
          if (numericImdbId !== imdbId) { 
            const numericMovieQueryParams = { ...queryParams, ImdbId: numericImdbId, UserId: userId };
            delete numericMovieQueryParams.TmdbId;
            try {
              const response = await axios.get(`${EMBY_URL}/Items`, { headers: { "X-Emby-Token": accessToken }, params: numericMovieQueryParams });
              successfullyUsedParams = numericMovieQueryParams;
              if (response.data.Items && response.data.Items.length > 0) {
                itemToGetPlaybackInfoFor = response.data.Items.find(i => _isMatchingProviderId(i.ProviderIds, imdbId, null));
                if (itemToGetPlaybackInfoFor) {
                } else {
                }
              }
            } catch (e) {
              console.warn(`Error during movie /Items lookup with numeric ImdbId=${numericImdbId}:`, e.message);
            }
          }
        }
        
        if (!itemToGetPlaybackInfoFor) {
          const anyProviderIdFormats = [];
          if (imdbId) {
            const numericImdbId = imdbId.replace('tt', '');
            anyProviderIdFormats.push(`imdb.${imdbId}`);
            anyProviderIdFormats.push(`Imdb.${imdbId}`);
            if (numericImdbId !== imdbId) {
              anyProviderIdFormats.push(`imdb.${numericImdbId}`);
              anyProviderIdFormats.push(`Imdb.${numericImdbId}`);
            }
          } else if (tmdbId) {
            anyProviderIdFormats.push(`tmdb.${tmdbId}`);
            anyProviderIdFormats.push(`Tmdb.${tmdbId}`);
          }

          for (const attemptFormat of anyProviderIdFormats) {
            if (itemToGetPlaybackInfoFor) break; 
            try {
              const altResponse = await axios.get(`${EMBY_URL}/Users/${userId}/Items`, {
                headers: { "X-Emby-Token": accessToken },
                params: { Recursive: true, IncludeItemTypes: "Movie", Fields: "ProviderIds,Name,MediaSources,Path", AnyProviderIdEquals: attemptFormat, Limit: 10, Filters: "IsNotFolder" }
              });
              successfullyUsedParams = { AnyProviderIdEquals: attemptFormat, UserId: userId };
              if (altResponse.data.Items && altResponse.data.Items.length > 0) {
                const found = altResponse.data.Items.find(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId));
                if (found) {
                  itemToGetPlaybackInfoFor = found;
                } else {
                }
              } else {
              }
            } catch (e) {
              console.warn(`Error during movie /Users/{UserId}/Items lookup with AnyProviderIdEquals=${attemptFormat}:`, e.message);
            }
          }
        }

        if (!itemToGetPlaybackInfoFor) {
          try {
            const fallbackResponse = await axios.get(`${EMBY_URL}/Users/${userId}/Items`, {
              headers: { "X-Emby-Token": accessToken },
              params: { Recursive: true, IncludeItemTypes: "Movie", Fields: "ProviderIds,Name,MediaSources,Path", Limit: 100, SortBy: "DateCreated", SortOrder: "Descending", Filters: "IsNotFolder" }
            });
            successfullyUsedParams = { FallbackScan: true, UserId: userId };
            if (fallbackResponse.data.Items && fallbackResponse.data.Items.length > 0) {
              const matchingItem = fallbackResponse.data.Items.find(movie => _isMatchingProviderId(movie.ProviderIds, imdbId, tmdbId));
              if (matchingItem) {
                itemToGetPlaybackInfoFor = matchingItem;
              } else {
              }
            } else {
            }
          } catch (e) {
            console.warn("Error during movie fallback manual scan:", e.message);
          }
        }
      } else if (itemType === 'Episode') {
        let seriesLookupParams = { IncludeItemTypes: "Series", Recursive: true, Fields: "ProviderIds,Name,Id", Limit: 5 };
        if (imdbId) seriesLookupParams.ImdbId = imdbId;
        else if (tmdbId) seriesLookupParams.TmdbId = tmdbId; // Assuming tmdbId is set if it's a TMDB series ID

        let seriesLookupParams1_stream = { IncludeItemTypes: "Series", Recursive: true, Fields: seriesLookupParams.Fields, Limit: seriesLookupParams.Limit };
        if (imdbId) seriesLookupParams1_stream.ImdbId = imdbId;
        else if (tmdbId) seriesLookupParams1_stream.TmdbId = tmdbId; // Assuming tmdbId is just the number string

        const seriesResponse1_stream = await axios.get(`${EMBY_URL}/Users/${userId}/Items`, { 
          headers: { "X-Emby-Token": accessToken }, 
          params: seriesLookupParams1_stream
        });
        
        if (seriesResponse1_stream.data && seriesResponse1_stream.data.Items) {
          parentSeriesItem = seriesResponse1_stream.data.Items.find(s => _isMatchingProviderId(s.ProviderIds, imdbId, tmdbId));
        }

        // --- Attempt 2: AnyProviderIdEquals query (if Attempt 1 failed or no exact match) ---
        if (!parentSeriesItem) {
          let anyProviderIdValue_stream = null;
          if (imdbId) anyProviderIdValue_stream = `imdb.${imdbId}`;
          else if (tmdbId) anyProviderIdValue_stream = `tmdb.${tmdbId}`; // Assuming tmdbId is the number from Stremio ID tmdb:ID_NUM
          
          if (anyProviderIdValue_stream) {
            const seriesLookupParams2_stream = { IncludeItemTypes: "Series", Recursive: true, Fields: seriesLookupParams.Fields, Limit: seriesLookupParams.Limit, AnyProviderIdEquals: anyProviderIdValue_stream };
            const seriesResponse2_stream = await axios.get(`${EMBY_URL}/Users/${userId}/Items`, {
              headers: { "X-Emby-Token": accessToken },
              params: seriesLookupParams2_stream
            });

            if (seriesResponse2_stream.data && seriesResponse2_stream.data.Items) {
              parentSeriesItem = seriesResponse2_stream.data.Items.find(s => _isMatchingProviderId(s.ProviderIds, imdbId, tmdbId));
            }
          }
        }

        if (!parentSeriesItem) {
          const idUsedForLog = baseId + (itemType === 'Episode' ? ` S${seasonNumber}E${episodeNumber}` : '');
          console.warn(`📭 No Emby parent series found for ${itemType} ID: ${idUsedForLog} after all attempts.`);
          return null;
        }

        const seasonsResponse = await axios.get(`${EMBY_URL}/Shows/${parentSeriesItem.Id}/Seasons`, {
          headers: { "X-Emby-Token": accessToken },
          params: { UserId: userId, Fields: "Id,IndexNumber,Name" }
        });

        if (!seasonsResponse.data || !seasonsResponse.data.Items || seasonsResponse.data.Items.length === 0) {
          console.warn(`❌ No seasons found for series: ${parentSeriesItem.Name} (${parentSeriesItem.Id})`);
          return null;
        }

        const targetSeason = seasonsResponse.data.Items.find(s => s.IndexNumber === seasonNumber);
        if (!targetSeason) {
          console.warn(`❌ Season ${seasonNumber} not found for series: ${parentSeriesItem.Name}`);
          return null;
        }

        console.log(`Fetching episodes for season ID: ${targetSeason.Id}`);
        const episodesResponse = await axios.get(`${EMBY_URL}/Shows/${parentSeriesItem.Id}/Episodes`, {
          headers: { "X-Emby-Token": accessToken },
          params: {
            SeasonId: targetSeason.Id,
            UserId: userId,
            Fields: "Id,IndexNumber,ParentIndexNumber,Name,ProviderIds,MediaSources,Path" // Added MediaSources,Path
          }
        });

        if (!episodesResponse.data || !episodesResponse.data.Items || episodesResponse.data.Items.length === 0) {
          console.warn(`❌ No episodes found for season ${seasonNumber} in series: ${parentSeriesItem.Name}`);
          return null;
        }

        itemToGetPlaybackInfoFor = episodesResponse.data.Items.find(ep => ep.IndexNumber === episodeNumber && ep.ParentIndexNumber === seasonNumber);

        if (!itemToGetPlaybackInfoFor) {
          console.warn(`❌ Episode S${seasonNumber}E${episodeNumber} not found in series: ${parentSeriesItem.Name}`);
          return null;
        }
      }
      // Ensure itemToGetPlaybackInfoFor is set if we reach here (either movie or episode)
      if (!itemToGetPlaybackInfoFor) {
        const idUsedForLog = baseId + (itemType === 'Episode' ? ` S${seasonNumber}E${episodeNumber}` : '');
        console.warn(`📭 No Emby match found for ${itemType} ID: ${idUsedForLog} after all attempts.`);
        return null;
      }


      console.log(`🎯 Using final Emby item: ${itemToGetPlaybackInfoFor.Name} (${itemToGetPlaybackInfoFor.Id}), Type: ${itemToGetPlaybackInfoFor.Type || itemType}`);

      const playbackInfoRes = await axios.get(
        `${EMBY_URL}/Items/${itemToGetPlaybackInfoFor.Id}/PlaybackInfo`,
        {
          params: { UserId: userId },
          headers: { "X-Emby-Token": accessToken },
        }
      );

      if (!playbackInfoRes.data || !playbackInfoRes.data.MediaSources || playbackInfoRes.data.MediaSources.length === 0) {
        console.warn("❌ No MediaSources found for item:", itemToGetPlaybackInfoFor.Id);
        return null;
      }

      const streamDetailsArray = [];

      for (const source of playbackInfoRes.data.MediaSources) {
        if (source.SupportsDirectPlay && source.Container && source.Container.toLowerCase() === 'mkv') {
          const videoStream = source.MediaStreams ? source.MediaStreams.find(ms => ms.Type === 'Video') : null;
          const audioStream = source.MediaStreams ? source.MediaStreams.find(ms => ms.Type === 'Audio') : null;
            
          const directPlayUrl = `${EMBY_URL}/Videos/${itemToGetPlaybackInfoFor.Id}/stream.${source.Container}?MediaSourceId=${source.Id}&Static=true&api_key=${accessToken}&DeviceId=stremio-addon-device-id`;
            
          let qualityTitle = "";
          if (videoStream) {
              qualityTitle += videoStream.DisplayTitle || ""; // e.g., "1080p H264"
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
          if (source.Name && !qualityTitle) { // Fallback to MediaSource name if no video stream info
              qualityTitle = source.Name;
          }


          console.log(`✅ Adding DirectPlay MKV stream: ${directPlayUrl} (Quality hint: ${qualityTitle || 'Default'})`);
            
            streamDetailsArray.push({
              directPlayUrl: directPlayUrl,
              itemName: itemToGetPlaybackInfoFor.Name, // Episode name or Movie name
              seriesName: parentSeriesItem ? parentSeriesItem.Name : null,
              seasonNumber: itemToGetPlaybackInfoFor.Type === 'Episode' ? itemToGetPlaybackInfoFor.ParentIndexNumber : seasonNumber, // Use ParentIndexNumber from episode if available
              episodeNumber: itemToGetPlaybackInfoFor.Type === 'Episode' ? itemToGetPlaybackInfoFor.IndexNumber : episodeNumber, // Use IndexNumber from episode if available
              itemId: itemToGetPlaybackInfoFor.Id,
              mediaSourceId: source.Id,
              container: source.Container,
              videoCodec: videoStream ? videoStream.Codec : (source.VideoCodec || null),
              audioCodec: audioStream ? audioStream.Codec : null,
              qualityTitle: qualityTitle || 'Direct Play', // Used for Stremio title
              embyUrlBase: EMBY_URL,
              apiKey: accessToken
            });
        }
      }

      if (streamDetailsArray.length === 0) {
          console.warn(`❌ No direct playable MKV sources found for item: ${itemToGetPlaybackInfoFor.Name} (${itemToGetPlaybackInfoFor.Id})`);
          return null;
      }

      return streamDetailsArray;

    } catch (err) {
      let fullIdForLog = baseId;
      if (itemType === 'Episode') {
          fullIdForLog += `:${seasonNumber}:${episodeNumber}`;
      }
      console.error(`❌ Error in getStream for ID ${fullIdForLog}:`, err.response?.data || err.message, err.stack);
      return null; 
    }
  }

  module.exports = {
    getStream,
  };

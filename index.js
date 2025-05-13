const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const emby = require("./embyClient");
require('dotenv').config();

const PORT = process.env.PORT || 7000;

const builder = new addonBuilder({
  id: "org.streambridge.embyresolver",   
  version: "1.0.0",
  name: "StreamBridge: Emby to Stremio",
  description: "Streams media from your personal or shared Embyserver using IMDb/TMDB IDs.",
  resources: [
    {
      name: "stream",
      types: ["movie", "series"],
      idPrefixes: ["tt", "imdb:", "tmdb:"]
    }
  ],
  types: ["movie", "series"],
  idPrefixes: ["tt", "imdb:", "tmdb:"],
  catalogs: [] // required syntactically
});

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {  
  console.log(`📥 Received ${type} stream request for ID: ${id}`);

  try {
    /* Get the stream details from Emby */
    const streamDetailsArray = await emby.getStream(id);

    /* If no stream details are returned, log an error */
    if (!streamDetailsArray || streamDetailsArray.length === 0) {
      console.warn("📭 No stream details returned from embyClient for ID:", id);
      return { streams: [] };
    }

    /* Map the stream details to Stremio streams */
    const stremioStreams = streamDetailsArray.map(details => {
      if (!details.directPlayUrl) return null;

      /* Construct the title for the Stremio stream */
      let title = ""; 
      /* Add the quality title to the title if it exists */
      title += details.qualityTitle && details.qualityTitle !== "Direct Play"
        ? `${details.qualityTitle}`
        : "Direct Play";

      /* Return the Stremio stream */
      return {
        title,
        name: `Emby`,
        url: details.directPlayUrl,
        behaviorHints: {
          notWebReady: true
        }
      };
    }).filter(Boolean);

    /* If no valid streams are returned, log an error */
    if (stremioStreams.length === 0) {
      console.warn("📭 No valid streams could be constructed for Stremio for ID:", id);
      return { streams: [] };
    }

    /* Log the number of streams returned */
    console.log(`✅ Returning ${stremioStreams.length} stream(s) for ID ${id}`);

    /* Return the Stremio streams */
    return { streams: stremioStreams };

  } catch (err) {
    console.error(`❌ Stream handler error for ID ${id}:`, err);
    return { streams: [] };
  }
});

// Start HTTP server
serveHTTP(builder.getInterface(), { port: PORT, hostname: '0.0.0.0' });
console.log(`🚀 StreamBridge:Emby to Stremio Addon running at http://localhost:${PORT}/manifest.json`);

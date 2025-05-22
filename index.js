const express = require("express");
const path = require("path");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const emby = require("./embyClient");
require('dotenv').config();


const PORT = process.env.PORT || 7000;
const app = express();

// Serve static files from the "public" folder (e.g., /helper.html)
app.use(express.static(path.join(__dirname, "public")));



const builder = new addonBuilder({
  id: "org.streambridge.embyresolver",   
  version: "1.0.1",
  name: "StreamBridge: Emby to Stremio",
  description: "Streams media from your personal or shared Embyserver using IMDb/TMDB IDs. Get your Emby Access Token and User ID by opening {addon-url}/helper.html in your browser.",
  resources: [
    {
      name: "stream",
      types: ["movie", "series"],
      idPrefixes: ["tt", "imdb:", "tmdb:"]
    }
  ],
  types: ["movie", "series"],
  idPrefixes: ["tt", "imdb:", "tmdb:"],
  catalogs: [], // required syntactically
  behaviorHints: {
    configurable: true,
    configurationRequired: true
  },
  config: [
    { key: "serverUrl", type: "text", title: "Emby Server URL (e.g., http://abcxyz.com:443)", required: true },
    { key: "userId", type: "text", title: "Emby User ID", required: true },
    { key: "accessToken", type: "password", title: "Emby Access Token (or API Key)", required: true }
  ]
});

// Stream handler
builder.defineStreamHandler(async (args) => {  
  const { type, id, config } = args;
  //console.log(`📥 Received ${type} stream request for ID: ${id}`);

  if (!config || !config.serverUrl || !config.userId || !config.accessToken) {
    console.warn("🔧 Configuration missing. Please configure the addon.");
    return { streams: [] };
  }

  try {
    /* Get the stream details from Emby */
    const streamDetailsArray = await emby.getStream(id, config);

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

// Attach Stremio interface to Express
app.use("/", getRouter(builder.getInterface()));

/// Start server
app.listen(PORT, () => {
  console.log(`🚀 StreamBridge running at http://localhost:${PORT}/manifest.json`);
});

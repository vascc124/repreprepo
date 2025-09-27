/**
 * StreamBridge – Emby → Stremio addon
 * Full Express server with parameterised manifest + stream routes
 * User data is embedded in the URL path as a base64-url string.
 */

const express      = require("express");
const path         = require("path");
const cors         = require("cors");
const emby         = require("./embyClient");   
const axios       = require("axios");
const iconv       = require("iconv-lite");
const jschardet   = require("jschardet");
const { URLSearchParams } = require("url");
require("dotenv").config();

const PORT = process.env.PORT || 7000;
const app  = express();
const TEXT_SUBTITLE_FORMATS = new Set(['srt', 'subrip', 'ssa', 'ass', 'smi', 'sami', 'sub', 'vtt', 'dfxp', 'ttml', 'txt']);
const DEVICE_ID = 'stremio-addon-device-id';
const ADDON_TYPES = ['movie', 'series', 'channel'];
const BASE_CATALOG_EXTRAS = [
  { name: 'search', isRequired: false },
  { name: 'skip', isRequired: false },
  { name: 'limit', isRequired: false },
  { name: 'sort', isRequired: false, options: ['name', 'lastAdded'] }
];
const LIVE_TV_CATALOG_ID = 'emby-live-tv';
const LIVE_TV_CATALOG_NAME = 'Emby Live TV';


// ──────────────────────────────────────────────────────────────────────────
// Global middleware & static assets
// ──────────────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ──────────────────────────────────────────────────────────────────────────
// Helper: build a naked manifest (no user-specific data yet)
// ──────────────────────────────────────────────────────────────────────────
function baseManifest () {
  return {
    id      : "org.streambridge.embyresolver",
    version : "1.1.0",
    name    : "StreamBridge: Emby to Stremio",
    description:
      "Stream media from your personal or shared Emby server using IMDb/TMDB IDs.",
    catalogs : [],
    resources: [
      { name: "stream",
        types: ADDON_TYPES,
        idPrefixes: ["tt", "imdb:", "tmdb:", "emby~"] },
      { name: "meta",
        types: ADDON_TYPES,
        idPrefixes: ["tt", "imdb:", "tmdb:", "tvdb", "anidb", "emby~"] },
      { name: "catalog",
        types: ADDON_TYPES }
    ],
    types: ADDON_TYPES,
    behaviorHints: { configurable: true, configurationRequired: true },
    config: [
      { key: "serverUrl",   type: "text", title: "Emby Server URL",  required: true },
      { key: "userId",      type: "text", title: "Emby User ID",     required: true },
      { key: "accessToken", type: "text", title: "Emby Access Token", required: true }
    ]
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: decode the cfg string into an object
// ──────────────────────────────────────────────────────────────────────────
function decodeCfg(str) {
  return JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
}   

// ──────────────────────────────────────────────────────────────────────────
// Parameterised MANIFEST route  →  /<cfg>/manifest.json
//     <cfg> is a base64-url-encoded JSON blob with {serverUrl,userId,accessToken}
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/manifest.json", async (req, res) => {
  const cfgString = req.params.cfg;
  let cfg;
  try {
    cfg = decodeCfg(cfgString);
    const addonBaseUrl = `${req.protocol}://${req.get("host")}`;
    cfg.__cfg = cfgString;
    cfg.__addonBaseUrl = addonBaseUrl;
  } catch (err) {
    console.error("[ERROR] Error decoding cfg in manifest route:", err.message);
    console.error("[ERROR] Problematic cfgString was:", cfgString);
    return res.status(400).json({ err: "Bad config in URL", details: err.message });
  }

  const mf = baseManifest();

  if (!mf) {
    console.error("[FATAL] baseManifest() returned undefined. This is the cause of the error.");
    return res.status(500).json({ err: "Server error: Failed to generate base manifest object." });
  }

  mf.id += "." + cfgString.slice(0, 8);

  const serverHostname = (cfg && cfg.serverUrl) ? cfg.serverUrl.replace(/^https?:\/\//, "") : "Unknown Server";
  mf.name += ` (${serverHostname})`;
  mf.behaviorHints.configurationRequired = false;

  try {
    const catalogDefs = await emby.getLibraryDefinitions(cfg);
    if (Array.isArray(catalogDefs) && catalogDefs.length) {
      const catalogResource = mf.resources.find(r => r.name === "catalog");
      if (catalogResource) {
        const typeSet = new Set(catalogResource.types || []);
        catalogDefs.forEach(def => typeSet.add(def.type));
        catalogResource.types = Array.from(typeSet);
      }
      const catalogExtras = BASE_CATALOG_EXTRAS;
      mf.catalogs = catalogDefs.map(def => ({
        type: def.type,
        id: def.libraryId,
        name: def.name,
        extra: catalogExtras.map(extra => ({ ...extra })),
        extraSupported: catalogExtras.map(extra => extra.name)
      }));
    }
  } catch (err) {
    console.error("[WARN] Unable to load Emby libraries for manifest:", err.message);
  }

  try {
    const hasLiveTv = await emby.hasLiveTvChannels(cfg);
    if (hasLiveTv) {
      const catalogResource = mf.resources.find(r => r.name === "catalog");
      if (catalogResource) {
        const typeSet = new Set(catalogResource.types || []);
        typeSet.add("channel");
        catalogResource.types = Array.from(typeSet);
      }
      const liveExtras = BASE_CATALOG_EXTRAS.map(extra => ({ ...extra }));
      mf.catalogs.push({
        type: "channel",
        id: LIVE_TV_CATALOG_ID,
        name: LIVE_TV_CATALOG_NAME,
        extra: liveExtras,
        extraSupported: liveExtras.map(extra => extra.name)
      });
    }
  } catch (err) {
    console.error("[WARN] Unable to detect Emby Live TV channels:", err.message);
  }

  res.json(mf);
});

app.get("/:cfg/meta/:type/:id.json", async (req, res) => {
  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
    const addonBaseUrl = `${req.protocol}://${req.get("host")}`;
    cfg.__cfg = req.params.cfg;
    cfg.__addonBaseUrl = addonBaseUrl;
  } catch {
    return res.json({ meta: null });
  }

  const { id, type } = req.params;
  if (!cfg.serverUrl || !cfg.userId || !cfg.accessToken) return res.json({ meta: null });

  const allowedTypes = new Set(["movie", "series", "channel"]);
  if (!allowedTypes.has(type)) return res.json({ meta: null });

  try {
    let meta = null;
    if (type === "channel") {
      meta = await emby.getLiveTvChannelMeta(id, cfg);
    } else {
      meta = await emby.getMeta(id, type, cfg);
    }
    res.json({ meta: meta || null });
  } catch (err) {
    console.error("Meta handler error:", err.message);
    res.json({ meta: null });
  }
});

app.get("/:cfg/catalog/:type/:id.json", async (req, res) => {
  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
    const addonBaseUrl = `${req.protocol}://${req.get("host")}`;
    cfg.__cfg = req.params.cfg;
    cfg.__addonBaseUrl = addonBaseUrl;
  } catch {
    return res.json({ metas: [] });
  }

  const { id, type } = req.params;
  if (!cfg.serverUrl || !cfg.userId || !cfg.accessToken) return res.json({ metas: [] });
  const allowedCatalogTypes = new Set(["movie", "series", "channel"]);
  if (!allowedCatalogTypes.has(type)) return res.json({ metas: [] });

  const options = {};
  const skip = Number.parseInt(req.query.skip, 10);
  if (!Number.isNaN(skip) && skip >= 0) options.skip = skip;
  const limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isNaN(limit) && limit > 0) options.limit = limit;
  if (typeof req.query.search === "string") options.search = req.query.search;
  if (typeof req.query.sort === "string") options.sort = req.query.sort;

  if (type === "channel") {
    if (id !== LIVE_TV_CATALOG_ID) return res.json({ metas: [] });
    try {
      const metas = await emby.getLiveTvChannelMetas(options, cfg);
      return res.json({ metas });
    } catch (err) {
      console.error("Catalog handler error:", err.message);
      return res.json({ metas: [] });
    }
  }

  try {
    const metas = await emby.getLibraryMetas(id, type, options, cfg);
    res.json({ metas });
  } catch (err) {
    console.error("Catalog handler error:", err.message);
    res.json({ metas: [] });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// STREAM route  →  /<cfg>/stream/<type>/<id>.json
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/subtitle/:itemId/:mediaSourceId/:streamIndex.:format", async (req, res) => {
  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch (err) {
    console.error('Subtitle request config decode error:', err.message);
    return res.status(400).send('Bad config in subtitle URL');
  }

  const { itemId, mediaSourceId, streamIndex, format } = req.params;
  const lowerFormat = format.toLowerCase();
  const isText = TEXT_SUBTITLE_FORMATS.has(lowerFormat);

  const params = new URLSearchParams({
    api_key: cfg.accessToken,
    Static: 'true',
    DeviceId: DEVICE_ID
  });
  if (req.query.codec) params.append('SubtitleCodec', req.query.codec);
  if (isText) params.append('encoding', 'utf-8');

  const embyUrl = cfg.serverUrl + '/Videos/' + itemId + '/' + mediaSourceId + '/Subtitles/' + streamIndex + '/Stream.' + format + '?' + params.toString();

  try {
    const response = await axios.get(embyUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    if (isText) {
      let detection = jschardet.detect(buffer);
      let sourceEncoding = detection && detection.encoding ? detection.encoding.toLowerCase() : 'utf-8';
      if (sourceEncoding === 'ascii') sourceEncoding = 'utf-8';
      let subtitleText;
      try {
        subtitleText = iconv.decode(buffer, sourceEncoding);
      } catch (decodeErr) {
        console.warn('Subtitle decode fallback:', decodeErr.message);
        subtitleText = iconv.decode(buffer, 'utf-8');
      }

      subtitleText = subtitleText.replace(/\r?\n/g, "\n");
      const contentType = lowerFormat === 'vtt' ? 'text/vtt; charset=utf-8' : 'text/plain; charset=utf-8';
      if (lowerFormat === 'vtt' && !subtitleText.trimStart().toUpperCase().startsWith('WEBVTT')) {
        subtitleText = 'WEBVTT\n\n' + subtitleText;
      }

      res.set('Content-Type', contentType);
      res.send(subtitleText);

    } else {
      res.set('Content-Type', response.headers['content-type'] || 'application/octet-stream');
      res.send(buffer);
    }

  } catch (err) {
    console.error('Subtitle proxy error:', err.message);
    res.status(err.response?.status || 502).send('Failed to fetch subtitle');
  }

});

app.get("/:cfg/stream/:type/:id.json", async (req, res) => {
  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch {
    return res.json({ streams: [] });
  }

  const { id } = req.params;
  if (!cfg.serverUrl || !cfg.userId || !cfg.accessToken)
    return res.json({ streams: [] });

  try {
    cfg.__cfg = req.params.cfg;
    cfg.__addonBaseUrl = `${req.protocol}://${req.get("host")}`;
    const raw = await emby.getStream(id, cfg);
    const streams = (raw || [])
      .filter(s => s.directPlayUrl)
      .map(s => {
        const baseTitle = s.qualityTitle || (s.isLive ? "Live Stream" : "Direct Play");
        const labelParts = [baseTitle];
        if (s.isLive && s.currentProgramName) labelParts.push(s.currentProgramName);
        const stream = {
          title : labelParts.join(" - "),
          name  : s.isLive ? "Emby Live" : "Emby",
          url   : s.directPlayUrl
        };
        const behaviorHints = { bingeGroup: `Emby-${s.qualityTitle || (s.isLive ? "Live" : "Stream")}` };
        if (s.isLive) {
          behaviorHints.live = true;
          stream.isLive = true;
          if (s.currentProgramOverview) {
            stream.description = s.currentProgramOverview;
          }
        } else {
          behaviorHints.notWebReady = true;
        }
        stream.behaviorHints = behaviorHints;
        if (Array.isArray(s.subtitles) && s.subtitles.length) {
          stream.subtitles = s.subtitles.map(sub => ({
            url: sub.url,
            lang: sub.lang,
            id: sub.id,
            forced: Boolean(sub.forced)
          }));
        }
        return stream;
      });

    res.json({ streams });
  } catch (e) {
    console.error("Stream handler error:", e);
    res.json({ streams: [] });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// FALLBACK manifest for users who hit /manifest.json with no cfg
//     (Stremio will show its built-in config form)
// ──────────────────────────────────────────────────────────────────────────
app.get("/manifest.json", (_req, res) => {
  const mf = baseManifest();
  if (!mf) {
    console.error("[FATAL] baseManifest() returned undefined for fallback route.");
    return res.status(500).json({ err: "Server error: Failed to generate base manifest object." });
  }
  res.json(mf);
});

// ──────────────────────────────────────────────────────────────────────────
// CONFIGURE route  →  /configure
// ──────────────────────────────────────────────────────────────────────────
app.get("/configure", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "configure.html")));

app.get("/:cfg/configure", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "configure.html"));
});
// ──────────────────────────────────────────────────────────────────────────
// Start the server
// ──────────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`🚀  StreamBridge up at http://localhost:${PORT}/<cfg>/manifest.json`)
);


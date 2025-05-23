/**
 * StreamBridge – Emby → Stremio addon
 * Full Express server with parameterised manifest + stream routes
 * User data is embedded in the URL path as a base64-url string.
 */

const express      = require("express");
const path         = require("path");
const cors         = require("cors");
const { addonBuilder } = require("stremio-addon-sdk");
const emby         = require("./embyClient");   // <-- keep your helper module
require("dotenv").config();

const PORT = process.env.PORT || 7000;
const app  = express();

// ──────────────────────────────────────────────────────────────────────────
// 1.  Global middleware & static assets (/helper.html, /configure.html …)
// ──────────────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ──────────────────────────────────────────────────────────────────────────
// 2.  Helper: build a naked manifest (no user-specific data yet)
// ──────────────────────────────────────────────────────────────────────────
function baseManifest() {
  const builder = new addonBuilder({
    id      : "org.streambridge.embyresolver",
    version : "1.1.0",
    name    : "StreamBridge: Emby to Stremio",
    description:
      "Stream media from your personal or shared Emby server using IMDb/TMDB IDs.",
    catalogs: [],
    resources: [
      { name: "stream", types: ["movie", "series"],
        idPrefixes: ["tt", "imdb:", "tmdb:"] }
    ],
    types: ["movie", "series"],
    behaviorHints: { configurable: true, configurationRequired: true },
    config: [
      { key: "serverUrl"  , type: "text"    , title: "Emby Server URL" , required: true },
      { key: "userId"     , type: "text"    , title: "Emby User ID"    , required: true },
      { key: "accessToken", type: "text", title: "Emby Access Token", required: true }
    ]
  });
  return builder.manifest;
}

// ──────────────────────────────────────────────────────────────────────────
// 3.  Parameterised MANIFEST route  →  /<cfg>/manifest.json
//     <cfg> is a base64-url-encoded JSON blob with {serverUrl,userId,accessToken}
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/manifest.json", (req, res) => {
  const cfgString = req.params.cfg;
  let cfg;
  try {
    // decode base64-url
    const json = Buffer.from(cfgString.replace(/-/g, "+").replace(/_/g, "/"), "base64")
                       .toString("utf8");
    cfg = JSON.parse(json);
  } catch {
    return res.status(400).json({ err: "Bad config in URL" });
  }

  // build a manifest UNIQUE to this cfg so multiple installs coexist
  const mf         = baseManifest();
  mf.id            += "." + cfgString.slice(0, 8);               // keep short
  mf.name          += " (" + cfg.serverUrl.replace(/^https?:\/\//, "") + ")";
  mf.behaviorHints.configurationRequired = false;                // already set
  res.json(mf);
});

// ──────────────────────────────────────────────────────────────────────────
// 4.  STREAM route  →  /<cfg>/stream/<type>/<id>.json
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/stream/:type/:id.json", async (req, res) => {
  // decode cfg (same helper as above)
  let cfg;
  try {
    const json = Buffer.from(req.params.cfg.replace(/-/g, "+").replace(/_/g, "/"), "base64")
                       .toString("utf8");
    cfg = JSON.parse(json);
  } catch {
    return res.json({ streams: [] });
  }

  const { id } = req.params;
  if (!cfg.serverUrl || !cfg.userId || !cfg.accessToken)
    return res.json({ streams: [] });

  try {
    const raw = await emby.getStream(id, cfg);         // <- your existing helper
    const streams = (raw || [])
      .filter(s => s.directPlayUrl)
      .map(s => ({
        title : s.qualityTitle || "Direct Play",
        name  : "Emby",
        url   : s.directPlayUrl,
        behaviorHints: { notWebReady: true }
      }));
    res.json({ streams });
  } catch (e) {
    console.error("Stream handler error:", e);
    res.json({ streams: [] });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// 5.  FALLBACK manifest for users who hit /manifest.json with no cfg
//     (Stremio will show its built-in config form)
// ──────────────────────────────────────────────────────────────────────────
app.get("/manifest.json", (_req, res) => res.json(baseManifest()));

app.get("/configure", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "configure.html")));

// ──────────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`🚀  StreamBridge up at http://localhost:${PORT}/<cfg>/manifest.json`)
);

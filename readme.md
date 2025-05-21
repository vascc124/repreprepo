# StreamBridge: Emby to Stremio

**StreamBridge** is an unofficial Stremio addon that allows you to stream content from your personal Emby server using IMDb or TMDb IDs. This addon acts as a resolver, responding to stream requests in Stremio with direct play links from your Emby library. This branch introduces a **configuration flow**, allowing you to input Emby server details directly from the Stremio interface — no `.env` required.

> ⚠️ **Note:** This branch only works when the addon is deployed to a public URL (e.g., on Render or Railway). **Local hosting will not work in the Stremio client. Use `main` branch for local deployment**

---

## 🔧 Features

- ✅ No `.env` setup — user config entered in Stremio
- ✅ Direct streaming from Emby to Stremio
- ✅ Supports both movies and TV episodes
- ✅ Matches by IMDb or TMDb ID (e.g., `tt1234567`, `tmdb:98765`)
- ❌ No public catalog or metadata – uses Cinemeta defaults

---

## 🧪 How It Works

1. You install this addon in Stremio (via manifest URL)
2. Stremio sends stream requests for clicked titles (e.g., from Cinemeta)
3. StreamBridge checks your Emby library for a matching item
4. If found, it responds with a direct stream link

---

## 🌐 Deploying the Addon

### Option 1: Deploy to [Render](https://render.com)

1. Fork this repository  
   👉 https://github.com/h4harsimran/streambridge

2. Go to [Render Node.js deployment](https://render.com/docs/deploy-node)

3. Connect your GitHub and select the `config-flow-setup` branch

4. Set your start command:

   ```
   node index.js

   ```
5. Set your start command:
   ```
   https://your-app-name.onrender.com/manifest.json

   ```

## 📦 Add to Stremio

1. Open **Stremio** (desktop app or web)
2. Go to **Add-ons** → **Add addon**
3. Paste:

   ```
   https://your-app-name.onrender.com/manifest.json

   ```
4. Enter the configuration fields prompted:

   - Emby Server URL (e.g., httpw://yourembyserverURL@xyx.com:443)
   - Emby User ID
   - Emby Access Token

## 🔐 How to Get Your Emby Credentials

If you don’t know your Emby User ID or Access Token, you can get them with this `curl` command:

```bash
curl -X POST http://<EMBY_SERVER>/Users/AuthenticateByName \
  -H 'X-Emby-Authorization: MediaBrowser Client="StreamBridge", Device="WebHelper", DeviceId="addon-ui", Version="1.0.0"' \
  -H "Content-Type: application/json" \
  -d '{"Username":"yourUsername","Pw":"yourPassword"}'
```

From the JSON response:

* `"User"."Id"` → Your **User ID**
* `"AccessToken"` → Your **Access Token**

These values can be pasted into the addon config popup in Stremio.

## 🛠 Tech Stack

* Node.js
* [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk)
* Emby REST API
* Axios
* dotenv

---

## ⚠️ Disclaimer

This project is intended for **personal and educational use** only. It is **not affiliated with or endorsed by Emby or Stremio**.

You are responsible for ensuring your use of this project complies with any applicable terms of service.

---

## 📄 License

MIT License

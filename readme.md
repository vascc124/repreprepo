# StreamBridge: Emby to Stremio

**StreamBridge** is an unofficial Stremio addon that lets you stream content from your personal or shared Emby server using IMDb or TMDb IDs. It works as a **stream resolver**: when you browse titles in Stremio using catalog addons like **Cinemeta** (or any other metadata addon), StreamBridge checks if the clicked movie or episode exists in your Emby library and, if found, returns a direct play link to stream it instantly from the emby server.

---

## 🔧 Features

- 🎬 Stream movies and episodes from Emby into Stremio
- 🔐 User configuration via the Stremio interface
- 🆔 Matches content using IMDb ID (`tt1234567`) or TMDb ID (`tmdb:98765`)
- ⚡️ Direct play URLs with support for different quality options
- 🛠 Includes helper UI (`/helper.html`) to retrieve Emby credentials.

---
## 📦 Add to Stremio

To use this addon:

1. Go to the configuration page:
[StreamBridge Configure](https://39427cdac546-streambridge.baby-beamup.club/configure)

2. Paste your:
    - **Emby Server URL** (e.g., `http://abcxyz.com:443`)
    - **User ID**
    - **Access Token**

3. Install in Stremio when prompted.

4. The addon will return streams for matching titles in your Emby server when clicked in Stremio.

---

## 🆘 How to Get Your Emby Access Info

Use the built-in helper page:
[StreamBridge Helper](https://39427cdac546-streambridge.baby-beamup.club/helper.html)

1. Enter your Emby server URL, username, and password
2. Click “Get Access Info”
3. Copy your **User ID** and **Access Token** to use in the addon config screen

You can also use this curl command if you prefer CLI:

```bash
curl -X POST http://<EMBY_SERVER>/Users/AuthenticateByName \
  -H 'X-Emby-Authorization: MediaBrowser Client="StreamBridge", Device="WebHelper", DeviceId="addon-ui", Version="1.0.0"' \
  -H "Content-Type: application/json" \
  -d '{"Username":"yourUsername","Pw":"yourPassword"}'
```

## 🚀 Addon Deployment Guide 
***Note: This is only for Developers who want to deploy their own version, not needed to use the addon. If you are here to just use the addon, the guide above should suffice that.***

### One-Click Deploy with [BeamUp](https://beamup.dev/)

> BeamUp is a free hosting service built specifically for Stremio addons.

1. Install BeamUp CLI:

   ```bash
   npm install -g beamup-cli
   ```

2. Initialize and deploy:

   ```bash
   beamup
   ```

3. Follow prompts and push with:

   ```bash
   git push beamup main:master
   ```

4. Your addon is live at:

   ```
   https://<addon-id>.baby-beamup.club/manifest.json
   ```


## 🛠 Tech Stack

* Node.js
* [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk)
* Emby REST API
* Axios
* express

---

## ⚠️ Disclaimer

This addon is for **educational and personal use only**. It is not affiliated with or endorsed by Emby or Stremio.

---

## 📄 License

MIT License

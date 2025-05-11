# StreamBridge: Emby to Stremio

**StreamBridge** is an unofficial Stremio addon that allows you to stream content from your personal Emby server using IMDb or TMDb IDs. This addon acts as a resolver, responding to stream requests in Stremio with direct play MKV links from your Emby library.

> ⚠️ This addon does **not** expose your full Emby catalog to Stremio. It works as a resolver only: when a movie or series is clicked in Stremio (and matches your Emby library), this addon returns a playable stream URL.

---

## 🔧 Features

- ✅ Direct MKV streaming from Emby to Stremio
- ✅ Supports both movies and TV episodes
- ✅ Matches by IMDb or TMDb ID (e.g., `tt1234567`, `tmdb:98765`)
- ✅ Private use only – no external exposure of your library
- ❌ No public catalog or metadata – uses Cinemeta defaults

---

## 🧪 How It Works

1. You install this addon in Stremio (via manifest URL)
2. Stremio sends stream requests for clicked titles (e.g., from Cinemeta)
3. StreamBridge checks your Emby library for a matching item
4. If found, it responds with a direct stream link (MKV only)

---

## 🚀 Getting Started

### 1. Clone this repo

```
git clone https://github.com/h4harsimran/streambridge.git
cd streambridge
```

### 2. Install dependencies

```
npm install
```

### 3. Create a `.env` file

```
EMBY_URL=https://your-emby-server:443
EMBY_USERNAME=yourServerUsername
EMBY_PASSWORD=yourPassword
```

### 4. Start the addon

```
node index.js
```

The addon will run at:

```
http://localhost:7000/manifest.json
```

---

## 📦 Add to Stremio

1. Open **Stremio** (desktop app or web)
2. Go to **Add-ons** → **Community Add-ons**
3. Click **"Install via URL"**
4. Paste:

```
http://localhost:7000/manifest.json
```

Yes — that’s a great idea. Instead of assuming everyone needs to configure inbound rules or port forwarding, it’s cleaner and safer to **just give a heads-up** that network access may require extra setup depending on the user’s OS and firewall.

Here’s a concise, professional way to phrase it in your `README.md`:

---
### 📺 Using on Local Network (TV or Other Devices)

If your TV (e.g. Android TV, Firestick) or another device is on the **same Wi-Fi or local network** as the computer running this addon:

1. Start the addon with:

   ```
   node index.js
   ```

2. Find your computer’s local IP address (e.g., `192.168.1.100`)

3. On your TV, open Stremio → Add-ons → Install via URL and enter:

   ```
   http://192.168.1.100:7000/manifest.json
   ```

> ⚠️ **Heads-up:** Depending on your setup (e.g., Windows Firewall, UFW on Linux), you may need to allow inbound connections to port `7000` on your local machine. This is required for other devices on your network to connect.

You do **not** need to expose this to the internet unless you want remote access.

---
## 📅 Future Plans
- Deploy to render or awslambda as function and use that as addon URL.
- Docker container for easy deployment on home servers
- Support multiple Emby libraries in stremio
---

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



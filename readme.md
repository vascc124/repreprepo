# StreamBridge: Emby to Stremio

**StreamBridge** is an unofficial Stremio addon that lets you stream content from your personal or shared Emby server using IMDb or TMDb IDs. It works as a **stream resolver**: when you browse titles in Stremio using catalog addons like **Cinemeta** (or any other metadata addon), StreamBridge checks if the clicked movie or episode exists in your Emby library and, if found, returns a direct play link to stream it instantly from the emby server.

## 🔧 Features

| Features                       | Description                                                                                      |
|--------------------------------|----------------------------------------------------------------------------------------------------|
| **One-page setup**             | Custom User configuration page to help user get thier **User ID** + **Access Token** *and* builds the ready-to-install link. |
| **IMDb / TMDb matching**       | Works with IDs like `tt1234567` or `tmdb:98765`.                                                   |
| **Direct-play multi-quality**  | Direct play URLs with support for different quality options       |

--
## 📦 Quick Install

To use this addon:

1. Go to the Stremio app.

2. Install addon using link. Use the following link.

   ```
   https://39427cdac546-streambridge.baby-beamup.club/manifest.json
   ```

3. Use **Configure** button to open the configure page. On the configure page:
      - In **Step 1**, enter your Emby **ServerURL**, **username** and **password**
      - Click **Get Access Info**. 
      - Your **User ID** and **Access Token** appear and auto-fill the form below.

4. Click **Create & Install Add-on**. A `stremio://…` link opens or focuses the Stremio app; confirm the install prompt.
5. The addon will return streams for matching titles in your Emby server when clicked in Stremio.

You can also use the link below and skip step 1 and 2.

```
https://39427cdac546-streambridge.baby-beamup.club/configure
```
## 🚀 Addon Deployment Guide 
***Note: This is only for Developers who want to deploy their own version, not needed to use the addon. If you are here to just use the addon, the guide above should suffice that.***

### One-Click Deploy with Beamup.

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

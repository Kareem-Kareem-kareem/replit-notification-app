# VoiceCast Desktop

The Windows desktop receiver for VoiceCast. It runs in the system tray and plays voice recordings sent by the admin (mobile app) every 60 seconds until the app is closed.

## Requirements

- **Windows 10 or later** (for system notifications)
- **Node.js 18+** (for development / building)

## Quick Start (Development)

```bash
cd desktop-app
npm install
npm start
```

On first launch you'll see a settings window — enter:
1. **Your Name** (so the admin can see you're online)
2. **Server URL** — the Replit URL of your deployed VoiceCast API, e.g.:
   `https://your-workspace.replit.app`

Click **Connect & Minimize to Tray**. The app disappears to the system tray and stays there.

## Building the Windows Installer (.exe)

```bash
cd desktop-app
npm install
npm run build
```

The installer is output to `desktop-app/dist/VoiceCast Desktop Setup X.X.X.exe`.

Distribute this installer to all desktop users. They install it, run the app, enter their name + server URL, and they're connected.

## How It Works

- The app connects via WebSocket to the VoiceCast server
- When the admin sends a voice recording, all connected desktops:
  1. Receive a Windows notification
  2. Play the audio at full volume
  3. Repeat every **60 seconds** until the app is closed (no dismiss)
- The admin can see everyone's name in the mobile app

## System Tray

Right-click the tray icon to:
- See connection status
- Open Settings (change name or server URL)
- Quit the app

## Server URL

Use the deployed Replit URL (after publishing the backend):
```
https://your-project-name.replit.app
```

For development/testing, use the Replit dev domain:
```
https://c3e74268-aea4-415e-a2d6-7d3f9b98e4c8-00-1573wn36eqdzb.pike.replit.dev
```

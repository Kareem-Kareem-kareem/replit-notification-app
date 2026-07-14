'use strict';

const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain, shell } = require('electron');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// ─── App setup ───────────────────────────────────────────────────────────────
app.setAppUserModelId('com.voicecast.desktop'); // required for Windows notifications

// Allow audio autoplay in hidden renderer windows (no user gesture available)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const CONFIG_PATH = path.join(app.getPath('userData'), 'voicecast-config.json');

let config = { name: '', serverUrl: '' };
let mainWindow = null;
let audioWindow = null;
let tray = null;
let ws = null;
let reconnectTimer = null;
let repeatIntervalId = null;
let currentAudioUrl = null;
let isQuitting = false;

// ─── Config ───────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to load config:', e.message);
  }
}

function saveConfig(data) {
  config = { ...config, ...data };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e.message);
  }
}

function isConfigured() {
  return !!(config.name && config.serverUrl);
}

// ─── Audio playback (hidden renderer window) ──────────────────────────────────
function getOrCreateAudioWindow() {
  if (audioWindow && !audioWindow.isDestroyed()) return audioWindow;

  audioWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  audioWindow.loadURL('data:text/html,<!DOCTYPE html><html><body></body></html>');

  audioWindow.on('closed', () => {
    audioWindow = null;
  });

  return audioWindow;
}

function playAudio(url) {
  const win = getOrCreateAudioWindow();
  if (!win) return;

  const safeUrl = url.replace(/"/g, '\\"');
  win.webContents.executeJavaScript(`
    (function() {
      if (window.__vc_audio) {
        window.__vc_audio.pause();
        window.__vc_audio = null;
      }
      const audio = new Audio("${safeUrl}");
      audio.volume = 1.0;
      window.__vc_audio = audio;
      audio.play().catch(err => console.error('Audio play failed:', err));
    })();
  `).catch(err => console.error('executeJavaScript error:', err));
}

function showNotification() {
  if (!Notification.isSupported()) return;

  const n = new Notification({
    title: 'VoiceCast — New Voice Message',
    body: 'A voice message has been sent by the admin.',
    silent: false,
  });

  n.show();
}

// ─── Audio repeat logic ───────────────────────────────────────────────────────
function handleIncomingAudio(audioRelUrl) {
  // Build full URL
  const serverUrl = (config.serverUrl || '').replace(/\/$/, '');
  currentAudioUrl = serverUrl + audioRelUrl;

  // Clear any existing repeat cycle
  if (repeatIntervalId) {
    clearInterval(repeatIntervalId);
    repeatIntervalId = null;
  }

  // Play + notify immediately
  playAudio(currentAudioUrl);
  showNotification();

  // Repeat every 60 seconds — no dismiss, runs until app exits
  repeatIntervalId = setInterval(() => {
    if (currentAudioUrl) {
      playAudio(currentAudioUrl);
      showNotification();
    }
  }, 60 * 1000);
}

// ─── WebSocket connection ─────────────────────────────────────────────────────
function buildWsUrl() {
  const base = (config.serverUrl || '').replace(/\/$/, '');
  return base.replace(/^https?:\/\//, (m) => m === 'https://' ? 'wss://' : 'ws://') + '/ws';
}

function connectWebSocket() {
  if (!isConfigured()) return;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const wsUrl = buildWsUrl();
  console.log('Connecting to', wsUrl);

  try {
    ws = new WebSocket(wsUrl, {
      handshakeTimeout: 10000,
      rejectUnauthorized: false, // allow self-signed in dev
    });
  } catch (err) {
    console.error('WS create error:', err.message);
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    console.log('WebSocket connected');
    // Register as desktop client
    ws.send(JSON.stringify({ type: 'register', name: config.name }));
    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ws-status', { connected: true });
    }
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'audio' && msg.url) {
        handleIncomingAudio(msg.url);
      }
    } catch (e) {
      console.error('WS message parse error:', e.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log('WebSocket closed:', code, reason?.toString());
    ws = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ws-status', { connected: false });
    }
    if (!isQuitting) scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
}

function scheduleReconnect(delayMs = 5000) {
  reconnectTimer = setTimeout(() => {
    if (!isQuitting) connectWebSocket();
  }, delayMs);
}

function disconnectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.terminate();
    ws = null;
  }
}

// ─── Main window (settings UI) ────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 460,
    resizable: false,
    frame: true,
    title: 'VoiceCast Desktop',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function getTrayIcon() {
  // Minimal 16x16 red PNG as base64 (safe fallback)
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVQ4jWP4z8BQDwADhQGAWjR9EQAAAABJRU5ErkJggg==';
  try {
    const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
    if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath);
  } catch {}
  return nativeImage.createFromDataURL('data:image/png;base64,' + base64);
}

function createTray() {
  const icon = getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('VoiceCast Desktop — Receiving');

  const updateMenu = () => {
    const connected = ws && ws.readyState === WebSocket.OPEN;
    const menu = Menu.buildFromTemplate([
      {
        label: `Status: ${connected ? '🟢 Connected' : '🔴 Disconnected'}`,
        enabled: false,
      },
      {
        label: `Name: ${config.name || '(not set)'}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open Settings',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit VoiceCast',
        click: () => {
          isQuitting = true;
          disconnectWebSocket();
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
  };

  updateMenu();
  setInterval(updateMenu, 5000);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => {
  return {
    name: config.name,
    serverUrl: config.serverUrl,
  };
});

ipcMain.handle('save-and-connect', (_event, data) => {
  saveConfig({ name: data.name, serverUrl: data.serverUrl });
  disconnectWebSocket();
  connectWebSocket();
  // Hide window after connecting
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  }, 500);
  return { success: true };
});

ipcMain.handle('get-status', () => {
  return {
    connected: !!(ws && ws.readyState === WebSocket.OPEN),
    name: config.name,
    serverUrl: config.serverUrl,
  };
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadConfig();
  createMainWindow();
  createTray();

  if (isConfigured()) {
    // Already set up: go straight to tray
    mainWindow.hide();
    connectWebSocket();
  }
  // else: show the settings window for first-time setup
});

app.on('window-all-closed', (e) => {
  // Prevent quitting when all windows are closed — stay in tray
  e.preventDefault();
});

app.on('before-quit', () => {
  isQuitting = true;
  disconnectWebSocket();
  if (repeatIntervalId) clearInterval(repeatIntervalId);
});

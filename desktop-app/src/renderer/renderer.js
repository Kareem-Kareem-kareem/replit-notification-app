'use strict';

const nameInput = document.getElementById('nameInput');
const serverInput = document.getElementById('serverInput');
const connectBtn = document.getElementById('connectBtn');
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');

function setStatus(connected) {
  if (connected) {
    statusBar.className = 'status-bar connected';
    statusText.textContent = 'Connected — listening for voice messages';
  } else {
    statusBar.className = 'status-bar disconnected';
    statusText.textContent = 'Disconnected — retrying…';
  }
}

async function init() {
  const config = await window.voicecast.getConfig();
  if (config.name) nameInput.value = config.name;
  if (config.serverUrl) serverInput.value = config.serverUrl;

  const status = await window.voicecast.getStatus();
  setStatus(status.connected);
}

// Listen for live status updates from main process
window.voicecast.onWsStatus((data) => {
  setStatus(data.connected);
});

connectBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const serverUrl = serverInput.value.trim().replace(/\/$/, '');

  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = '#FF2D55';
    setTimeout(() => (nameInput.style.borderColor = ''), 1500);
    return;
  }

  if (!serverUrl || !serverUrl.startsWith('http')) {
    serverInput.focus();
    serverInput.style.borderColor = '#FF2D55';
    setTimeout(() => (serverInput.style.borderColor = ''), 1500);
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';

  try {
    await window.voicecast.saveAndConnect({ name, serverUrl });
    connectBtn.textContent = 'Connected ✓';
    setStatus(false); // will update when WS fires
  } catch (e) {
    connectBtn.textContent = 'Connect & Minimize to Tray';
    connectBtn.disabled = false;
  }
}); 

// Poll status every 3 seconds as fallback
setInterval(async () => {
  const status = await window.voicecast.getStatus();
  setStatus(status.connected);
}, 3000);

init();

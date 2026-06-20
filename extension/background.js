chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-link",
    title: "Open link in FloatPiP",
    contexts: ["link"]
  });
  chrome.contextMenus.create({
    id: "open-page",
    title: "Open page in FloatPiP",
    contexts: ["page", "frame", "video", "audio"]
  });
});

function frameGetYouTubeSubtitleLang() {
  try {
    const player = document.querySelector('#movie_player');
    if (!player || typeof player.getOption !== 'function') return null;
    const track = player.getOption('captions', 'track');
    if (track && track.languageCode) return track.languageCode;
    try {
      const list = player.getOption('captions', 'tracklist');
      if (Array.isArray(list)) {
        for (const t of list) {
          if ((t.is_selected || t.isSelected || t.selected) && t.languageCode) return t.languageCode;
        }
      }
    } catch {}
    try {
      const lang = window.ytInitialPlayerResponse?.videoDetails?.defaultAudioLanguage;
      if (lang) return lang;
    } catch {}
    return null;
  } catch {
    return null;
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let targetUrl;
  if (info.menuItemId === "open-link") {
    targetUrl = info.linkUrl;
  } else if (info.menuItemId === "open-page") {
    targetUrl = info.pageUrl || info.frameUrl;
  }
  if (!targetUrl) return;
  let deepLink = "floatpip://open?url=" + encodeURIComponent(targetUrl);
  if (tab && tab.url && /youtube\.com\/(watch|shorts)|youtu\.be\//.test(tab.url)) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        func: frameGetYouTubeSubtitleLang,
      });
      const lang = results?.[0]?.result;
      if (lang) deepLink += '&subtitleLang=' + encodeURIComponent(lang);
    } catch {}
  }
  chrome.tabs.create({ url: deepLink });
});

// --- Companion PiP auto-resend ---

async function getToken() {
  const data = await chrome.storage.local.get('floatpipToken');
  if (data.floatpipToken) return data.floatpipToken;
  const token = crypto.randomUUID();
  await chrome.storage.local.set({ floatpipToken: token });
  return token;
}

async function getMirrored(tabId) {
  const key = 'mirrored_' + tabId;
  const data = await chrome.storage.session.get(key);
  return data[key] ?? null;
}

async function setMirrored(tabId, videoId) {
  const key = 'mirrored_' + tabId;
  await chrome.storage.session.set({ [key]: videoId });
}

async function deleteMirrored(tabId) {
  await chrome.storage.session.remove('mirrored_' + tabId);
}

function videoIdOf(url) {
  try {
    const u = new URL(url);
    const v = u.searchParams.get('v');
    if (v) return v;
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname === 'youtu.be' && parts[0]) return parts[0];
    if (parts[0] === 'shorts' && parts[1]) return parts[1];
    return null;
  } catch {
    return null;
  }
}

async function sendToApp(tabId, payload) {
  const token = await getToken();
  try {
    const res = await fetch('http://127.0.0.1:47821/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FloatPip-Token': token,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return true;
    if (res.status === 503) {
      // App hidden to tray — stop tracking this tab
      await deleteMirrored(tabId);
      return false;
    }
  } catch {}
  // cold / 401 fallback: deep link
  let dl = 'floatpip://open?url=' + encodeURIComponent(payload.url)
    + '&ct=' + encodeURIComponent(token);
  if (payload.startTime > 0) dl += '&startTime=' + encodeURIComponent(payload.startTime);
  if (payload.subtitleLang) dl += '&subtitleLang=' + encodeURIComponent(payload.subtitleLang);
  const t = await chrome.tabs.create({ url: dl, active: false });
  setTimeout(() => chrome.tabs.remove(t.id).catch(() => {}), 700);
  return true;
}

function frameGetAndPauseVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (!videos.length) return null;
  const best = videos.sort((a, b) => {
    const score = v => (!v.paused ? 1000 : 0) + v.offsetWidth * v.offsetHeight;
    return score(b) - score(a);
  })[0];
  const currentTime = best.currentTime;
  best.pause();
  return currentTime > 0 ? currentTime : null;
}

async function tryPauseWithRetry(tabId, maxAttempts, delayMs) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: frameGetAndPauseVideo,
      });
      const hit = results?.find(r => r.result != null);
      if (hit) return hit.result;
    } catch {}
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

chrome.webNavigation.onHistoryStateUpdated.addListener(async ({ tabId, url }) => {
  const data = await chrome.storage.local.get('companionPip');
  if (!data.companionPip) return;

  const currentVideoId = await getMirrored(tabId);
  if (!currentVideoId) return;

  const nid = videoIdOf(url);
  if (!nid || nid === currentVideoId) return;

  const startTime = await tryPauseWithRetry(tabId, 5, 500);

  let subtitleLang = null;
  if (/youtube\.com\/(watch|shorts)|youtu\.be\//.test(url)) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        func: frameGetYouTubeSubtitleLang,
      });
      subtitleLang = results?.[0]?.result ?? null;
    } catch {}
  }

  const tracking = await sendToApp(tabId, { url, startTime, subtitleLang });
  if (tracking) await setMirrored(tabId, nid);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  deleteMirrored(tabId).catch(() => {});
});

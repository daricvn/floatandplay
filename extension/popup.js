let companionEnabled = false;

const DRM_HOSTNAMES = new Set([
  'www.netflix.com', 'netflix.com',
  'www.disneyplus.com', 'disneyplus.com',
  'www.primevideo.com', 'primevideo.com',
  'www.max.com', 'max.com', 'www.hbo.com', 'hbo.com',
  'www.hulu.com', 'hulu.com',
  'www.peacocktv.com', 'peacocktv.com',
  'www.paramountplus.com', 'paramountplus.com',
  'tv.apple.com', 'www.apple.com',
  'www.crunchyroll.com', 'crunchyroll.com',
  'www.funimation.com', 'funimation.com',
]);

function isDrmTab(tab) {
  try {
    return DRM_HOSTNAMES.has(new URL(tab.url).hostname);
  } catch { return false; }
}

function showDrmToast() {
  const toast = document.getElementById('drm-toast');
  toast.textContent = 'DRM-protected site — Companion PiP is not supported.';
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

/** Runs in page/frame context — true if any loaded video exists. */
function frameHasVideo() {
  return Array.from(document.querySelectorAll('video')).some(v => v.readyState > 0);
}

/** Runs in page/frame context — activates PiP on best video. */
function framePip() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (!videos.length) return false;
  const best = videos.sort((a, b) => {
    const score = v => (!v.paused ? 1000 : 0) + v.offsetWidth * v.offsetHeight;
    return score(b) - score(a);
  })[0];
  best.requestPictureInPicture().catch(() => {});
  return true;
}

/** Runs in page/frame context — pauses best video and returns its currentTime, or null if none. */
function frameGetAndPauseVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (!videos.length) return null;
  const best = videos.sort((a, b) => {
    const score = v => (!v.paused ? 1000 : 0) + v.offsetWidth * v.offsetHeight;
    return score(b) - score(a);
  })[0];
  const currentTime = best.currentTime;
  best.pause();
  return currentTime;
}

/** Runs in page/frame context — returns active YouTube caption languageCode or null. */
function frameGetYouTubeSubtitleLang() {
  try {
    const player = document.querySelector('#movie_player');
    if (!player || typeof player.getOption !== 'function') return null;
    const track = player.getOption('captions', 'track');
    if (track && track.languageCode) return track.languageCode;
    // ASR tracks may not set languageCode on the active track object — check tracklist
    try {
      const list = player.getOption('captions', 'tracklist');
      if (Array.isArray(list)) {
        for (const t of list) {
          if ((t.is_selected || t.isSelected || t.selected) && t.languageCode) return t.languageCode;
        }
      }
    } catch {}
    return null;
  } catch {
    return null;
  }
}

/** Per-tab check with timeout so a crashed/loading tab never blocks the list. */
function checkTabForVideo(tab) {
  return new Promise(resolve => {
    const done = (hasVideo) => { clearTimeout(timer); resolve({ tab, hasVideo }); };
    const timer = setTimeout(() => done(false), 2500);
    chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: frameHasVideo,
    })
      .then(results => done(results.some(r => r.result === true)))
      .catch(() => done(false));
  });
}

async function activateNativePip(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: framePip,
  }).catch(() => {});
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  window.close();
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

async function openCompanionPip(tab) {
  // Get or create companion token
  let token;
  const stored = await chrome.storage.local.get('floatpipToken');
  if (stored.floatpipToken) {
    token = stored.floatpipToken;
  } else {
    token = crypto.randomUUID();
    await chrome.storage.local.set({ floatpipToken: token });
  }

  let deepLink = 'floatpip://open?url=' + encodeURIComponent(tab.url)
    + '&ct=' + encodeURIComponent(token);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: frameGetAndPauseVideo,
    });
    const hit = results?.find(r => r.result != null && r.result > 0);
    if (hit) deepLink += '&startTime=' + encodeURIComponent(String(hit.result));
  } catch {}
  if (tab.url && /youtube\.com\/(watch|shorts)|youtu\.be\//.test(tab.url)) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        func: frameGetYouTubeSubtitleLang,
      });
      const lang = results?.[0]?.result;
      if (lang) deepLink += '&subtitleLang=' + encodeURIComponent(lang);
    } catch {}
  }

  // Record tab as mirrored for auto-resend on navigation
  const videoId = videoIdOf(tab.url);
  if (videoId) {
    await chrome.storage.session.set({ ['mirrored_' + tab.id]: videoId });
  }

  chrome.tabs.create({ url: deepLink });
  window.close();
}

function faviconEl(tab) {
  if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
    const img = document.createElement('img');
    img.className = 'tab-favicon';
    img.src = tab.favIconUrl;
    img.alt = '';
    img.onerror = () => img.replaceWith(placeholderFavicon());
    return img;
  }
  return placeholderFavicon();
}

function placeholderFavicon() {
  const s = document.createElement('span');
  s.className = 'tab-favicon-placeholder';
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="2" y="6" width="20" height="14" rx="2"/>
    <polygon points="9,10 9,16 16,13" fill="currentColor" stroke="none"/>
  </svg>`;
  return s;
}

function pipArrowIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('class', 'tab-pip-icon');
  svg.innerHTML = `<rect x="12" y="12" width="10" height="7" rx="1.5"/>
    <path d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>`;
  return svg;
}

function makeTabItem(tab, isCurrent) {
  const li = document.createElement('li');
  li.className = 'tab-item';
  li.title = tab.title || tab.url;

  const isDrm = isDrmTab(tab);

  const info = document.createElement('span');
  info.className = 'tab-info';

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || tab.url;
  info.appendChild(title);

  if (isCurrent || isDrm) {
    const badges = document.createElement('span');
    badges.className = 'tab-badges';
    if (isCurrent) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-current';
      badge.textContent = 'current';
      badges.appendChild(badge);
    }
    if (isDrm) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-drm';
      badge.textContent = 'DRM';
      badges.appendChild(badge);
    }
    info.appendChild(badges);
  }

  li.appendChild(faviconEl(tab));
  li.appendChild(info);
  li.appendChild(pipArrowIcon());

  li.addEventListener('click', () => {
    if (companionEnabled && isDrm) {
      showDrmToast();
    } else if (companionEnabled) {
      openCompanionPip(tab);
    } else {
      activateNativePip(tab.id);
    }
  });

  return li;
}

function renderCurrentTab(tab) {
  const list = document.getElementById('tab-list');
  list.innerHTML = '';
  list.appendChild(makeTabItem(tab, true));

  const spinner = document.createElement('li');
  spinner.className = 'tab-loading';
  spinner.id = 'scanner-row';
  spinner.textContent = 'Scanning other tabs…';
  list.appendChild(spinner);
}

function appendOtherTabs(tabs, currentTabId) {
  const list = document.getElementById('tab-list');
  const spinnerRow = document.getElementById('scanner-row');
  if (spinnerRow) spinnerRow.remove();

  for (const tab of tabs) {
    if (tab.id === currentTabId) continue;
    list.appendChild(makeTabItem(tab, false));
  }
}

function rebuildList(currentTab, otherTabs, currentTabId) {
  const list = document.getElementById('tab-list');
  list.innerHTML = '';

  if (currentTab) {
    list.appendChild(makeTabItem(currentTab, true));
  }

  for (const tab of otherTabs) {
    if (tab.id === currentTabId) continue;
    list.appendChild(makeTabItem(tab, false));
  }

  if (!currentTab && !otherTabs.length) {
    const li = document.createElement('li');
    li.className = 'tab-empty';
    li.textContent = 'No video tabs detected';
    list.appendChild(li);
  }
}

async function init() {
  const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = currentTabs[0] ?? null;
  const currentTabId = currentTab?.id;

  const toggle = document.getElementById('companion-toggle');

  let otherVideoTabs = [];

  if (currentTab) {
    renderCurrentTab(currentTab);
  }

  chrome.storage.local.get('companionPip').then(({ companionPip }) => {
    companionEnabled = !!companionPip;
    toggle.checked = companionEnabled;
  });

  toggle.addEventListener('change', () => {
    companionEnabled = toggle.checked;
    chrome.storage.local.set({ companionPip: companionEnabled });
    rebuildList(currentTab, otherVideoTabs, currentTabId);
  });

  const allTabs = await chrome.tabs.query({});
  const otherTabs = allTabs.filter(t => t.id !== currentTabId);
  const results = await Promise.all(otherTabs.map(checkTabForVideo));
  otherVideoTabs = results.filter(r => r.hasVideo).map(r => r.tab);

  appendOtherTabs(otherVideoTabs, currentTabId);
}

init();

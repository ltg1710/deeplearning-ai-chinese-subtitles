// Handles cross-origin fetches: subtitle files + Google Translate.
// Content script sends { type: 'fetchAndTranslate', trackUrl } and gets back cues.

const CACHE_PREFIX = 'subs:';

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return r.text();
}

function resolveUrl(base, ref) {
  return new URL(ref, base).href;
}

function parseM3u8ForVtt(m3u8, baseUrl) {
  const lines = m3u8.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  return lines.map(l => resolveUrl(baseUrl, l));
}

function parseVtt(vtt) {
  const blocks = vtt.replace(/\r\n/g, '\n').trim().split(/\n\n+/);
  const cues = [];
  for (const b of blocks) {
    if (/^WEBVTT/.test(b)) continue;
    const lines = b.split('\n');
    let i = 0;
    if (lines[i] && !lines[i].includes('-->')) i = 1;
    if (!lines[i]) continue;
    const m = lines[i].match(/(\d+:\d+:[\d.]+)\s*-->\s*(\d+:\d+:[\d.]+)/);
    if (!m) continue;
    const toSec = s => {
      const [h, mm, rest] = s.split(':');
      return parseInt(h) * 3600 + parseInt(mm) * 60 + parseFloat(rest);
    };
    const text = lines.slice(i + 1).join('\n').trim();
    if (text) cues.push({ s: toSec(m[1]), e: toSec(m[2]), en: text });
  }
  return cues;
}

async function translate(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' + encodeURIComponent(text);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`translate ${r.status}`);
  const data = await r.json();
  return (data[0] || []).map(seg => seg[0]).filter(Boolean).join('');
}

async function translateAll(cues, onProgress) {
  const results = [];
  const CONCURRENCY = 4;
  let i = 0;
  let done = 0;
  const total = cues.length;
  async function worker() {
    while (i < cues.length) {
      const idx = i++;
      const c = cues[idx];
      try {
        c.zh = await translate(c.en);
      } catch (e) {
        c.zh = '[翻译失败]';
      }
      done++;
      if (onProgress) onProgress(done, total);
      results[idx] = c;
    }
  }
  const workers = Array.from({ length: CONCURRENCY }, worker);
  await Promise.all(workers);
  return results;
}

async function fetchAndTranslate(trackUrl, sender) {
  const cached = await chrome.storage.local.get(CACHE_PREFIX + trackUrl);
  if (cached[CACHE_PREFIX + trackUrl]) {
    return { cues: cached[CACHE_PREFIX + trackUrl], cached: true };
  }

  // Fetch the subtitle source. It can be either a .m3u8 playlist or a direct .vtt.
  let vttText;
  if (/\.m3u8(\?|$)/i.test(trackUrl)) {
    const m3u8 = await fetchText(trackUrl);
    const vttUrls = parseM3u8ForVtt(m3u8, trackUrl);
    const parts = await Promise.all(vttUrls.map(u => fetchText(u)));
    vttText = parts.join('\n\n');
  } else {
    vttText = await fetchText(trackUrl);
  }

  const cues = parseVtt(vttText);
  if (!cues.length) return { cues: [], empty: true };

  const tabId = sender?.tab?.id;
  const sendProgress = (done, total) => {
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, { type: 'progress', done, total }).catch(() => {});
    }
  };

  const translated = await translateAll(cues, sendProgress);
  await chrome.storage.local.set({ [CACHE_PREFIX + trackUrl]: translated });
  return { cues: translated, cached: false };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetchAndTranslate') {
    fetchAndTranslate(msg.trackUrl, sender)
      .then(res => sendResponse({ ok: true, ...res }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === 'clearCache') {
    chrome.storage.local.clear().then(() => sendResponse({ ok: true }));
    return true;
  }
});

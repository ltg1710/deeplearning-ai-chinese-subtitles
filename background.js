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

// 带重试 + 退避(429/timeout 等临时失败)
// 单个 cue 最多 ~5s, 不会让 UI 看着卡死
const RETRY_DELAYS = [600, 1500, 3000];  // 退避序列, 长度即最大重试次数

async function translateWithRetry(text) {
  let lastErr;
  // 第 1 次尝试 + 每个 delay 后再试一次 = 共 RETRY_DELAYS.length + 1 次
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await translate(text);
    } catch (e) {
      lastErr = e;
      if (attempt < RETRY_DELAYS.length) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      }
    }
  }
  throw lastErr;
}

async function translateAll(cues, onProgress) {
  const results = [];
  const CONCURRENCY = 2;  // 降并发避免 Google rate limit
  let i = 0;
  let done = 0;
  let failedCount = 0;
  const total = cues.length;
  async function worker() {
    while (i < cues.length) {
      const idx = i++;
      const c = cues[idx];
      try {
        c.zh = await translateWithRetry(c.en);
        c.failed = false;
      } catch (e) {
        c.zh = '[翻译失败]';
        c.failed = true;  // 标记为失败,缓存时跳过
        failedCount++;
      }
      done++;
      if (onProgress) onProgress(done, total);
      results[idx] = c;
    }
  }
  const workers = Array.from({ length: CONCURRENCY }, worker);
  await Promise.all(workers);
  return { results, failedCount };
}

// 检查缓存里是否含 [翻译失败] - 旧版本可能缓存了失败的 cue
function cacheHasFailed(cues) {
  if (!Array.isArray(cues)) return true;
  return cues.some(c => c && (c.failed === true || c.zh === '[翻译失败]'));
}

async function fetchAndTranslate(trackUrl, sender) {
  const cached = await chrome.storage.local.get(CACHE_PREFIX + trackUrl);
  const cachedCues = cached[CACHE_PREFIX + trackUrl];
  if (cachedCues && !cacheHasFailed(cachedCues)) {
    return { cues: cachedCues, cached: true };
  }
  // 缓存里有 [翻译失败] -> 清掉,重新翻译
  if (cachedCues) {
    await chrome.storage.local.remove(CACHE_PREFIX + trackUrl);
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

  const { results: translated, failedCount } = await translateAll(cues, sendProgress);
  // 全部成功才缓存; 有失败就不缓存,下次能重新翻译
  if (failedCount === 0) {
    await chrome.storage.local.set({ [CACHE_PREFIX + trackUrl]: translated });
  }
  return { cues: translated, cached: false, failedCount };
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

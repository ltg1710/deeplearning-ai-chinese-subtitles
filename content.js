// Content script v2 for DeepLearning.AI 中文字幕
// - New approach: read the on-page (DOM-rendered) English subtitle and translate it
//   live, overlaying Chinese above it. Works with the current player that exposes a
//   <select> language picker (subtitle selection) and a sibling subtitle <div>.
// - Legacy fallback: the old <video><track> + .m3u8 flow, kept for course pages that
//   still expose a real text track.

(() => {
  const OVERLAY_ID = '__dlai_zh_overlay__';
  const STYLE_ID = '__dlai_zh_style__';
  const STATUS_ID = '__dlai_zh_status__';

  // Anchors supplied for the current deeplearning.ai player.
  // select = subtitle language picker, div[2] = live subtitle container.
  const SEL_XPATH = '/html/body/div[1]/div/div/div[1]/main/div/div/div/div[2]/div/div[1]/div/select';
  const SUB_XPATH = '/html/body/div[1]/div/div/div[1]/main/div/div/div/div[2]/div/div[2]';

  function xpathEl(xp) {
    try {
      const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return r.singleNodeValue;
    } catch (e) { return null; }
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${OVERLAY_ID} {
        position: absolute;
        left: 0; right: 0;
        bottom: 12%;
        text-align: center;
        pointer-events: none;
        z-index: 2147483647;
        font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      #${OVERLAY_ID} > span {
        display: block;
        margin: 3px auto;
      }
      #${OVERLAY_ID} .zh {
        background: rgba(0,0,0,0.78);
        color: #fff;
        padding: 4px 14px;
        border-radius: 4px;
        font-size: 22px;
        font-weight: 500;
        line-height: 1.35;
        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
        max-width: 85%;
        width: fit-content;
      }
      #${OVERLAY_ID} .en {
        background: rgba(0,0,0,0.65);
        color: #e5e5e5;
        padding: 2px 10px;
        border-radius: 3px;
        font-size: 15px;
        line-height: 1.35;
        max-width: 85%;
        width: fit-content;
      }
      #${STATUS_ID} {
        position: fixed;
        top: 14px; right: 14px;
        background: rgba(0,0,0,0.82);
        color: #fff;
        padding: 6px 12px;
        border-radius: 6px;
        font: 13px -apple-system, sans-serif;
        z-index: 2147483647;
        pointer-events: none;
        transition: opacity .4s;
      }
    `;
    document.head.appendChild(s);
  }

  function setStatus(text, fade) {
    let el = document.getElementById(STATUS_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = STATUS_ID;
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    if (fade) {
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.style.opacity = '0'; }, 2500);
    }
  }

  // ===================== New DOM-subtitle approach =====================
  function locateSubtitleSystem() {
    // 1) exact anchors supplied by the user
    const sel = xpathEl(SEL_XPATH);
    if (sel) {
      const wrap = sel.parentElement && sel.parentElement.parentElement; // div[1]
      const sub = (wrap && wrap.nextElementSibling) || xpathEl(SUB_XPATH);
      const area = (wrap && wrap.parentElement) || (sub && sub.parentElement);
      if (sub) return { selectEl: sel, subtitleEl: sub, playerArea: area };
    }
    // 2) direct subtitle div anchor
    const sub2 = xpathEl(SUB_XPATH);
    if (sub2) {
      const prev = sub2.previousElementSibling;
      const sel2 = prev ? prev.querySelector('select') : null;
      return { selectEl: sel2 || null, subtitleEl: sub2, playerArea: sub2.parentElement };
    }
    // 3) heuristic: a <select> offering an English track, with a sibling subtitle div
    for (const s of document.querySelectorAll('select')) {
      const hasEn = Array.from(s.options).some(o => /english/i.test(o.text || o.value));
      if (!hasEn) continue;
      const wrap = s.parentElement && s.parentElement.parentElement;
      const sub = wrap && wrap.nextElementSibling;
      if (sub) return { selectEl: s, subtitleEl: sub, playerArea: (wrap && wrap.parentElement) || sub.parentElement };
    }
    return null;
  }

  // Make sure an English source is selected so we have text to translate.
  function ensureEnglishSource(selectEl) {
    if (!selectEl) return;
    const opt = selectEl.options[selectEl.selectedIndex];
    const cur = (opt ? (opt.text || opt.value) : '').toLowerCase();
    if (/chinese|中文|cmn|zh[-_]?cn/i.test(cur)) return; // already Chinese, leave it
    if (/off|none|关闭|无|disabled|empty/i.test(cur)) {
      const en = Array.from(selectEl.options).find(o =>
        /english/i.test(o.text || o.value) && !/chinese|中文/i.test(o.text || o.value));
      if (en) {
        selectEl.value = en.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        selectEl.dispatchEvent(new Event('input', { bubbles: true }));
        setStatus('已开启英文字幕作为翻译源', true);
      }
    }
  }

  let domStarted = false;
  let activeSubtitleEl = null;
  function startDomSubtitles(sys) {
    if (domStarted) return;
    domStarted = true;
    activeSubtitleEl = sys.subtitleEl;
    const { selectEl, subtitleEl, playerArea } = sys;
    installStyle();
    ensureEnglishSource(selectEl);

    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = '<span class="zh"></span>';
    const zh = overlay.querySelector('.zh');

    if (playerArea) {
      if (getComputedStyle(playerArea).position === 'static') playerArea.style.position = 'relative';
      playerArea.appendChild(overlay);
    } else {
      document.body.appendChild(overlay);
    }

    function reposition() {
      if (!playerArea) return;
      const pr = playerArea.getBoundingClientRect();
      const sr = subtitleEl.getBoundingClientRect();
      if (sr.width && sr.height && sr.top >= pr.top - 1) {
        overlay.style.bottom = Math.max(0, pr.bottom - sr.top + 6) + 'px';
      } else {
        overlay.style.bottom = '12%';
      }
    }

    let lastKey = '';
    let pending = false;
    let queued = false;

    async function translateNow(text) {
      pending = true;
      try {
        const res = await chrome.runtime.sendMessage({ type: 'translateText', text });
        if (res && res.ok && res.zh) {
          zh.textContent = res.zh;
          overlay.style.display = '';
          setStatus('中文字幕已加载', true);
        } else if (res && !res.ok) {
          setStatus('翻译失败：' + (res.error || ''), true);
        }
      } catch (e) {
        setStatus('翻译失败：' + e.message, true);
      } finally {
        pending = false;
        if (queued) { queued = false; update(); }
      }
    }

    function update() {
      const raw = (subtitleEl.innerText || '').replace(/\s+/g, ' ').trim();
      if (!raw) { overlay.style.display = 'none'; lastKey = ''; return; }
      if (/[一-鿿]/.test(raw)) { // already Chinese -> avoid duplicate overlay
        overlay.style.display = 'none'; lastKey = raw; return;
      }
      reposition();
      if (raw === lastKey) return;
      lastKey = raw;
      setStatus('翻译中…');
      if (pending) { queued = true; return; }
      translateNow(raw);
    }

    const mo = new MutationObserver(() => update());
    mo.observe(subtitleEl, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', reposition);
    document.addEventListener('fullscreenchange', () => setTimeout(reposition, 60));
    update();
  }

  // ===================== Legacy <video><track> approach =====================
  let lastTrackUrl = null;
  let inFlight = false;
  let legacyStarted = false;

  function getTrackUrl(video) {
    const track = video.querySelector('track[kind="subtitles"], track[kind="captions"]');
    if (track && track.src) return track.src;
    return null;
  }

  function disableNativeTracks(video) {
    for (const t of video.textTracks) {
      if (t.kind === 'subtitles' || t.kind === 'captions') t.mode = 'hidden';
    }
  }

  function attachOverlay(video, cues) {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    const parent = video.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = '<span class="zh"></span><span class="en"></span>';
    parent.appendChild(overlay);
    const zh = overlay.querySelector('.zh');
    const en = overlay.querySelector('.en');

    disableNativeTracks(video);

    function update() {
      if (!document.body.contains(video)) return;
      const t = video.currentTime;
      let cue = null;
      for (let i = 0; i < cues.length; i++) {
        if (t >= cues[i].s && t < cues[i].e) { cue = cues[i]; break; }
      }
      if (cue) {
        zh.textContent = cue.zh;
        en.textContent = cue.en;
        overlay.style.display = '';
      } else {
        overlay.style.display = 'none';
      }
    }
    const loop = () => {
      update();
      if (document.body.contains(overlay)) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    document.addEventListener('fullscreenchange', () => {
      const fs = document.fullscreenElement;
      if (fs && fs.contains(video)) fs.appendChild(overlay);
      else if (video.parentElement) video.parentElement.appendChild(overlay);
    });
  }

  async function processVideo(video) {
    const trackUrl = getTrackUrl(video);
    if (!trackUrl) return;
    if (trackUrl === lastTrackUrl) return;
    if (inFlight) return;
    inFlight = true;
    lastTrackUrl = trackUrl;
    try {
      installStyle();
      setStatus('字幕加载中…');
      const res = await chrome.runtime.sendMessage({ type: 'fetchAndTranslate', trackUrl });
      if (!res || !res.ok) {
        setStatus('字幕获取失败：' + ((res && res.error) || '未知错误'), true);
        return;
      }
      if (!res.cues || !res.cues.length) {
        setStatus('未找到字幕', true);
        return;
      }
      attachOverlay(video, res.cues);
      setStatus(res.cached ? '中文字幕已加载（缓存）' : `中文字幕已加载（${res.cues.length} 条）`, true);
    } catch (e) {
      setStatus('出错：' + e.message, true);
    } finally {
      inFlight = false;
    }
  }

  function legacyScan() {
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      const track = v.querySelector('track[kind="subtitles"], track[kind="captions"]');
      if (track && track.src) { processVideo(v); break; }
    }
  }

  function startLegacyOnce() {
    if (legacyStarted) return;
    legacyStarted = true;
    const mo = new MutationObserver(() => legacyScan());
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    legacyScan();
  }

  // ===================== Init + SPA navigation =====================
  let lastHref = location.href;
  function resetForNavigation() {
    domStarted = false;
    legacyStarted = false;
    lastTrackUrl = null;
    activeSubtitleEl = null;
    const old = document.getElementById(OVERLAY_ID);
    if (old) old.remove();
  }

  function init() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      resetForNavigation();
    }
    // If the DOM subtitle node was replaced by the SPA, restart the new approach.
    if (domStarted && activeSubtitleEl && !document.contains(activeSubtitleEl)) {
      resetForNavigation();
    }
    if (domStarted || legacyStarted) return;

    const sys = locateSubtitleSystem();
    if (sys) startDomSubtitles(sys);
    else startLegacyOnce();
  }

  init();
  setInterval(init, 1500);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'progress') {
      setStatus(`翻译中 ${msg.done}/${msg.total}…`);
    }
  });
})();

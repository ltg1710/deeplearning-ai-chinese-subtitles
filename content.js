// Content script: watch for a <video> with an English subtitle track, request
// translation from the background worker, then render a bilingual overlay.

(() => {
  const OVERLAY_ID = '__dlai_zh_overlay__';
  const STYLE_ID = '__dlai_zh_style__';
  const STATUS_ID = '__dlai_zh_status__';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${OVERLAY_ID} {
        position: absolute;
        left: 0; right: 0;
        bottom: 10%;
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

  function getTrackUrl(video) {
    const track = video.querySelector('track[kind="subtitles"], track[kind="captions"]');
    if (track && track.src) return track.src;
    // fall back to an <audio>-style textTracks source (rare)
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

  let lastTrackUrl = null;
  let inFlight = false;

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
        setStatus('字幕获取失败：' + (res?.error || '未知错误'), true);
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

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'progress') {
      setStatus(`翻译中 ${msg.done}/${msg.total}…`);
    }
  });

  function scan() {
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      const track = v.querySelector('track[kind="subtitles"], track[kind="captions"]');
      if (track && track.src) { processVideo(v); break; }
    }
  }

  const mo = new MutationObserver(() => scan());
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  // Re-scan on navigation changes inside SPA
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      lastTrackUrl = null;
      const old = document.getElementById(OVERLAY_ID);
      if (old) old.remove();
    }
    scan();
  }, 1000);

  scan();
})();

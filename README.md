# DeepLearning.AI 中文字幕 Chrome 扩展

> 为吴恩达的 [learn.deeplearning.ai](https://learn.deeplearning.ai/) 视频课程自动添加中英双语字幕的 Chrome 扩展。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Manifest](https://img.shields.io/badge/Chrome-MV3-orange)
![Status](https://img.shields.io/badge/status-working-brightgreen)

## 为什么做这个

吴恩达在 deeplearning.ai 上开了很多免费 AI 课程，可惜：

- 视频只有**英文原声 + 英文字幕**
- 沉浸式翻译、Google 翻译这些通用工具只能翻页面文字，**翻不了视频画面上的字幕**（deeplearning.ai 用的是 Mux 自定义播放器，字幕以 overlay 形式渲染，不是普通 HTML 元素）
- 文字稿（transcript）虽然能翻，但对着视频画面看字幕更符合观看习惯

这个扩展专门解决这个问题：装上就行，**自动抓字幕 → 机翻成中文 → 叠加到视频画面上**，中文在上、英文在下。

## 效果

- ✅ 中文上、英文下的双语字幕，直接叠在视频画面底部
- ✅ 全屏模式下字幕也跟着走
- ✅ 翻译结果自动缓存，同一集再次打开秒加载
- ✅ 单页应用（SPA）切换课程自动重新加载字幕
- ✅ 右上角状态提示（加载中 / 已加载 / 错误）

## 功能特性

| 功能 | 说明 |
|---|---|
| 自动检测 | 打开任意 `learn.deeplearning.ai/courses/...` 页面，扩展自动识别视频和字幕轨道 |
| HLS 字幕解析 | 支持 deeplearning.ai 常用的 `.m3u8` 字幕列表，串起子段落合并 VTT |
| 机器翻译 | 调用 Google Translate 公开接口（免费、无需 API key），并发 4 路加速 |
| 本地缓存 | 翻译结果按字幕 URL 存入 `chrome.storage.local`，不重复翻译 |
| 双语显示 | 中文大字在上（白色底黑半透明），英文小字在下（灰色） |
| 全屏适配 | 监听 `fullscreenchange`，字幕容器跟随切换 |
| SPA 路由 | 轮询 `location.href` 变化，切课程自动重新扫描 |

## 安装

1. 下载或 clone 本仓库到本地：
   ```bash
   git clone https://github.com/shenxyt/deeplearning-ai-chinese-subtitles.git
   ```
2. 打开 Chrome，地址栏输入 `chrome://extensions/`
3. 右上角打开 **开发者模式**
4. 点左上角 **加载已解压的扩展程序**
5. 选中仓库的根目录（含 `manifest.json` 那层）

装完后 `chrome://extensions/` 会多一条「DeepLearning.AI 中文字幕」。

## 使用

装好就能用，不需要任何配置。

1. 打开 <https://learn.deeplearning.ai/> 任意一节课的视频页
2. 右上角短暂显示 **"字幕加载中… → 翻译中 X/Y → 中文字幕已加载（Y 条）"**
3. 播放视频，画面底部出现中英双语字幕

**首次加载** 一集约需 5–15 秒（60~200 条字幕的翻译时间）；**再次打开** 同一集会走缓存，瞬开。

## 工作原理

```
┌─────────────────────┐
│ 页面加载            │
│ learn.deeplearning  │
│   .ai/courses/...   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐      ┌──────────────────────┐
│ content.js 扫描 DOM │─────▶│ 找到 <video><track>  │
│ (MutationObserver)  │      │ 读 track.src (.m3u8) │
└─────────────────────┘      └──────────┬───────────┘
                                        │
                                        ▼
                             ┌──────────────────────┐
                             │ background.js        │
                             │ 1. fetch m3u8        │
                             │ 2. 解析出 .vtt URL   │
                             │ 3. fetch .vtt        │
                             │ 4. 解析成 cue 列表   │
                             │ 5. 每条英文送 Google │
                             │    Translate gtx 接口│
                             │ 6. 缓存到 storage    │
                             └──────────┬───────────┘
                                        │
                                        ▼
                             ┌──────────────────────┐
                             │ content.js 渲染      │
                             │ <div> overlay 叠在   │
                             │ video 父容器底部     │
                             │ requestAnimationFrame│
                             │ 轮询 currentTime 匹配 │
                             │ 当前字幕             │
                             └──────────────────────┘
```

### 关键实现

- **跨域 fetch**：字幕文件和翻译接口都跨源，必须走 background service worker，content script 直接 fetch 会被 CORS 挡
- **overlay 定位**：把 `<video>` 的父元素（若为 `position: static`）改成 `relative`，overlay 用 `position: absolute; bottom: 10%` 居中
- **字幕时间匹配**：线性查找当前 `currentTime` 命中的 cue（几十条无性能压力），用 `requestAnimationFrame` 保持流畅
- **全屏切换**：监听 `fullscreenchange`，把 overlay 从原父容器 move 到 `document.fullscreenElement`

## 已知限制

- **只支持 learn.deeplearning.ai**，不覆盖其他视频站。其他课程平台（Coursera、Udemy、YouTube）用 [沉浸式翻译](https://immersivetranslate.com/) 即可。
- 翻译质量取决于 Google Translate 免费接口，专业术语偶有偏差。如果需要更准确的翻译，可自行替换 `background.js` 里 `translate()` 函数为 DeepL / GPT-4 等更高质量的服务。
- 首次加载需联网翻译，离线不可用；已加载过的走缓存，离线也能显示。
- Google Translate 免费接口有 QPS 限制，并发设为 4，如果课程字幕特别多（几百条）可能需要 30 秒以上。

## 文件结构

```
dlai-zh-subs/
├── manifest.json    # MV3 清单
├── background.js    # Service Worker：抓字幕、机翻、缓存
├── content.js       # 内容脚本：检测视频、渲染字幕 overlay
├── README.md        # 本文件
└── LICENSE          # MIT
```

## 自定义

### 让它支持其他网站

编辑 `manifest.json`：

```json
"host_permissions": [
  "https://learn.deeplearning.ai/*",
  "https://your-target-site.com/*",
  "https://subtitles.your-target-site.com/*"
],
"content_scripts": [{
  "matches": [
    "https://learn.deeplearning.ai/*",
    "https://your-target-site.com/*"
  ],
  ...
}]
```

如果目标网站的字幕不是 HLS 而是直接 `.vtt` 或 `.srt`，需要修改 `background.js` 的 `fetchAndTranslate` 函数。

### 换翻译引擎

在 `background.js` 里把 `translate()` 函数替换为：

- **DeepL**：需要 API key，参考 <https://developers.deepl.com/>
- **OpenAI GPT-4**：质量最好但成本高，可以加个设置页让用户填 key
- **腾讯/阿里云翻译**：国内访问稳定

## 致谢

- 翻译引擎：[Google Translate](https://translate.google.com/)（免费公开接口）
- 课程内容：[DeepLearning.AI](https://learn.deeplearning.ai/) by 吴恩达

## License

[MIT](LICENSE)

---

> 如果觉得有用，给个 ⭐ 支持一下。Bug 或功能建议请提 Issue。

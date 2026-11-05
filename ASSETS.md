# 素材来源

| 文件 | 用途 | 来源 |
| --- | --- | --- |
| `assets/reference-whale-maid.png` | 角色参考 | 本项目既有的参考图 |
| `assets/welcome.png` | 打招呼 / 待机 | 依据上述参考图，使用内置 image_gen 生成 |
| `assets/thinking.png` | 思考 / 请求模型 | 同上 |
| `assets/rest.png` | 休息 / 暂停 | 同上 |
| `assets/complete.png` | 庆祝 / 完成 | 同上 |
| `assets/*.webp` | 旧版静态交付副本 | 从四张 PNG 原图生成的 440px 交付编码，保留供历史参考 |
| `assets/animation/welcome.gif` | 打招呼 / 待机动画原件 | 用户提供，原件未改动 |
| `assets/animation/thinking.gif` | 思考 / 请求模型动画原件 | 同上 |
| `assets/animation/rest.gif` | 休息 / 暂停动画原件 | 同上 |
| `assets/animation/complete.gif` | 庆祝 / 完成动画原件 | 同上 |
| `assets/animation/*.webp` | 当前脚本的动画与静态首帧 | 从 GIF 原件无损编码；动画时长除以 1.25，首帧用于缩略图、减少动画和完全隐藏状态 |
| `assets/animation/sources.json` | 原件与播放设置记录 | 原件 SHA256、尺寸、帧数、原始时长及 1.25 倍速设置 |

旧版静态插画的生成提示词见 [`assets/prompts.json`](assets/prompts.json)，该文件不记录用户实际制作 GIF 时使用的提示词。当前四张 GIF 均包含 12 帧；欢迎原始每帧 130 毫秒，其他三种每帧 250 毫秒。内嵌动画分别为每帧 104 和 200 毫秒，不改变帧数、可见像素或透明度。

项目代码、文档和配套插画按 [MIT 许可证](LICENSE) 一同提供。本仓库未打包从第三方素材站下载的图集；生成方式的说明不表示获得超星或 DeepSeek 的官方认可。MIT 许可证不授予任何第三方商标权。

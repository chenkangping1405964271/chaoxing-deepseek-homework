# DeepSeek 娘答题助手

## ⚠️ 使用前必读（风险提示）

- 在线课程平台会对学习过程实施监测。教育部等五部门要求使用 **AI、大数据等技术识别“刷课”“替课”“刷考”“替考”**，并记录、通报学生所在高校；违规违纪行为一经查实，学校可按规定取消课程成绩，视情节给予 **警告直至开除学籍等处分**。
- 本项目仅供个人学习辅助与技术研究，须遵守学校、课程及平台的要求。**使用产生的一切后果由使用者自行承担。**本声明不改变适用规则或相关主体依法应承担的责任。

依据：[教育部等五部门文件，第10、13、14条](https://www.moe.gov.cn/srcsite/A08/s7056/202204/t20220401_612700.html)。完整声明见 [DISCLAIMER.md](DISCLAIMER.md)。

---

带有 DeepSeek 娘主题界面的学习通课程作业及考试答题页浏览器助手，使用 DeepSeek API 请求参考答案，尝试识别题目、填答和翻页。**作业自动提交默认关闭；考试页始终需要核对后手动交卷。**

本项目非超星或 DeepSeek 官方产品；当前是浏览器油猴脚本，不能直接在学习通官方安卓 App 中运行。

<img src="preview/新版界面.png?v=0.4.3" width="350" alt="DeepSeek 娘答题助手界面，本地虚构页面截图">

## 安装

**[安装最新版油猴脚本](https://github.com/chenkangping1405964271/chaoxing-deepseek-homework/releases/latest/download/chaoxing-deepseek-homework.user.js)** · [版本与下载](https://github.com/chenkangping1405964271/chaoxing-deepseek-homework/releases)

1. 在浏览器安装并启用 Tampermonkey，按浏览器提示授予运行用户脚本的权限。
2. 打开仓库中的 [`dist/chaoxing-deepseek-homework.user.js`](dist/chaoxing-deepseek-homework.user.js)，选择 **Raw** 安装；也可以把文件内容复制到油猴的新脚本中保存。
3. 进入可编辑的学习通作业或考试答题页面，刷新后找到助手面板。考试入口页尚未加载题目时，需要先进入实际答题界面。
4. 输入自己的 DeepSeek API Key 并保存，读取模型并测试连接。密钥需要从 API 服务商获取，不能用网页版登录状态替代。
5. 核对作业设置后运行。建议初次使用保持自动提交关闭，并检查答案和保存状态。

如已安装旧版，请选择更新已有脚本，避免多个版本同时运行。脚本使用相同的名称、namespace 和设置存储键。

## 功能和实际限制

- 尝试适配单选、多选、判断，以及常见文本填空和简答控件。
- 统一的选项适配层覆盖旧版 `.Zy_ulTop`、新版 `.answerBg`、原生 radio/checkbox 与关联 label、ARIA radio/checkbox、带 `data-option` 或常见选项类名的控件；题目也可按题目标识和标题结构识别，不绑定课程或题号。
- 按实际显示状态识别选项，正确区分读屏用的 [`aria-hidden`](https://design-system.w3.org/styles/how-to-hide-and-show-things.html) 和视觉隐藏；排除 CSS/HTML 隐藏副本。优先使用页面真实选项字母，多选会清理旧选项并回读完整选中集合；旧版提供答案隐藏字段时也会核对其值。
- 支持课程学习页面中多层同源 iframe 内的作业；只显示一个助手面板，翻页和提交限定在识别到的作业内。题目加载时最多等待 10 秒。
- v0.5.1 补上 `/exam/`、`/exam-ans/` 考试路径入口、`type题号` 题型字段和 `.answerBg` 答案存储回读。考试嵌在同源 iframe 内时也参与识别；自动提交会禁用，原先保存的作业提交偏好不会被清除。考试页无需填写作业总题数。
- 题型、选项延后渲染时最多等待 10 秒；只读控件、重复字母或无法区分的可见副本会给出具体原因。
- 图片题需要 API 模型实际支持图像输入，脚本会把题干、选项及读取的图片发送给 API 服务商。
- 支持纯图片选项和 `data-original` / `data-src` 懒加载图片；超星 HTTP 图片地址会转成 HTTPS 读取。单题源图片上限调整为 64 张，保留单图和请求大小校验。
- 遇到题干、选项或答案识别失败、页面变化、填写状态无法验证等情况时暂停。嵌在 iframe 中的富文本编辑器尚未适配。
- 加密字体题目会使用页面已加载的字体，把题干、选项和内嵌公式绘成局部图片，交给视觉模型读取；乱码原文不会作为题干文本发送。需要选择支持图片的模型，例如 [`deepseek-flash`](https://api-docs.deepseek.com/guides/vision/)。字体未加载、图片读取失败或模型要求人工检查时暂停。
- 诊断导出包含 iframe 可访问状态、各层题目数量、加密字体加载状态、选项适配器、可见选项数、识别字母和具体解析错误，不包含题目正文、密钥或 URL 查询参数。
- 自动翻页默认开启。v0.5.2 支持同源、同路径且任务标识一致的整页跳转，以及题目 iframe 重新加载；使用当前标签页的会话存储暂存续答记录，两分钟后过期。暂停、原题重复、任务切换或翻页失败时停止续答。跨域或答题路径改变时需手动开始。
- 作业自动提交需要正确的总题数和可靠的题号覆盖检查；作业经整页刷新续答后需要手动提交。考试始终由使用者核对后手动交卷。
- 本地已填入答案不能证明服务器已保存；提交操作是否完成，以学习通页面为准。

## DeepSeek 娘界面

奶白与海盐蓝配色；提供打招呼、认真思考、抱鲸鱼休息、小小庆祝四种插画。插画会根据待机、请求模型、暂停和完成状态切换，也可以在空闲时预览贴纸。

连接设置可折叠；收起后显示 DeepSeek 娘按钮；支持 Esc 收起和减少动画偏好。界面素材全部内嵌，不加载外部图片、CDN 或在线字体。

## 数据和密钥

仓库不包含共享 API Key。使用者自行配置密钥，保存在 Tampermonkey 脚本存储中，保存后输入框清空。脚本直接请求 `https://api.deepseek.com` 的 `/models` 和 `/chat/completions`；题目图片也可能从超星 HTTPS 域读取。API 用量按服务商规则计费。

请勿在 Issues、PR、截图或日志中附带 API Key、Cookie、真实作业网页、姓名、学号或未经脱敏的诊断文件。报告兼容问题时，优先提供去除个人信息的最小虚构示例。

## 本地开发

需要支持所锁定开发依赖的 Node.js 环境；本次本地检查使用 Node.js 24。

```sh
npm ci
npm run build
npm run check-ui
npm run check-frames
npm run check-fonts
npm run check-adapters
npm run check-exams
npm run check-navigation
```

构建产物为 `dist/chaoxing-deepseek-homework.user.js`。`src/homework.template.js` 是脚本模板，`src/panel.html` 是界面，`scripts/build-ui.mjs` 将素材和界面打包为单个用户脚本。

构建也会输出仅含用户脚本头部的 `.meta.js` 更新检查文件。Fork 二次开发时，请将模板中的 `@homepageURL`、`@supportURL`、`@downloadURL`、`@updateURL` 改为自己的仓库地址，再重新构建。

界面检查使用本机 Microsoft Edge 的无头模式，涵盖素材加载、设置保存与清除、状态切换、收起展开、图片失败回退、键盘操作及 390px / 320px 小屏布局。检查报告见 [`preview/界面检查.json`](preview/界面检查.json)。未使用真实学习通账号或真实 API Key 做端到端验证。

题目识别回归检查覆盖三层 iframe、旧版选项、延后加载、暂停、翻页与提交范围、页面切换和诊断脱敏，使用虚构题目和模拟 API。报告见 [`preview/题目识别检查.json`](preview/题目识别检查.json)。

加密字体检查使用自行绘制的几何字形测试字体，核对字体来自题目所在 iframe、绘制像素与浏览器显示一致、内嵌公式保留、暂停和缺失字体处理，以及请求中不夹带乱码或题目外内容。报告见 [`preview/加密字体检查.json`](preview/加密字体检查.json)。测试字体及可选重建脚本位于 `scripts/fixtures/`，不包含真实课程字体。

通用适配检查包含 20 种虚构结构与行为场景，覆盖单选、多选、判断题共用的选项层、乱序字母、纯图片、懒加载、隐藏副本、只读控件、延后渲染和答案存储字段校验，报告见 [`preview/通用适配检查.json`](preview/通用适配检查.json)。这些检查不代表所有未见过的页面都已验证；富文本 iframe 等尚未适配的情况仍按上述限制处理。

考试适配检查包含 11 组虚构场景，覆盖直接入口、同源 iframe、延后加载、单选、多选、判断、填空、简答、局部替换翻页、答案存储回读及手动暂停。报告见 [`preview/考试适配检查.json`](preview/考试适配检查.json)。使用模拟 API，未验证真实账号、付费模型或服务器保存。

跨页续答检查包含 11 组虚构场景，使用浏览器实际加载新文档验证连续三页答题、题目 iframe 重载、暂停后平台延迟跳转、重复原题、切换任务、记录过期、关闭自动翻页及保存失败。报告见 [`preview/跨页续答检查.json`](preview/跨页续答检查.json)。续答记录只含任务和页面摘要、计数及有效期，不包含 API Key、题目正文或原始任务标识。

## 致谢

感谢 DeepSeek、ChatGPT 和 [Codex](https://github.com/codex) 对本项目的支持：DeepSeek 提供模型 API，ChatGPT 与 Codex 协助文案整理、界面设计及代码开发。

## 许可证与素材来源

代码、文档和项目配套插画按 [MIT 许可证](LICENSE) 开源。插画使用内置图像生成工具，依据项目已有参考图生成；PNG 原图、WebP 交付副本与提示词保存在 `assets/`。素材说明见 [ASSETS.md](ASSETS.md)。项目名称及平台名称不表示官方授权、认可或联名。

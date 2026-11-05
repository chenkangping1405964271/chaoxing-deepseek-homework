# DeepSeek 娘答题助手

## ⚠️ 使用前必读（风险提示）

- 在线课程平台会对学习过程实施监测。教育部等五部门要求使用 **AI、大数据等技术识别“刷课”“替课”“刷考”“替考”**，并记录、通报学生所在高校；违规违纪行为一经查实，学校可按规定取消课程成绩，视情节给予 **警告直至开除学籍等处分**。
- 本项目仅供个人学习辅助与技术研究，须遵守学校、课程及平台的要求。**使用产生的一切后果由使用者自行承担。**本声明不改变适用规则或相关主体依法应承担的责任。

依据：[教育部等五部门文件，第10、13、14条](https://www.moe.gov.cn/srcsite/A08/s7056/202204/t20220401_612700.html)。完整声明见 [DISCLAIMER.md](DISCLAIMER.md)。

---

带有 DeepSeek 娘主题界面的学习通普通课程作业浏览器助手，使用 DeepSeek API 请求参考答案，尝试识别题目、填答和翻页。**自动提交默认关闭，答案需要核对。**

本项目非超星或 DeepSeek 官方产品；当前是浏览器油猴脚本，不能直接在学习通官方安卓 App 中运行。

<img src="preview/新版界面.png?v=0.4.3" width="350" alt="DeepSeek 娘答题助手界面，本地虚构页面截图">

## 安装

**[安装最新版油猴脚本](https://github.com/chenkangping1405964271/chaoxing-deepseek-homework/releases/latest/download/chaoxing-deepseek-homework.user.js)** · [版本与下载](https://github.com/chenkangping1405964271/chaoxing-deepseek-homework/releases)

1. 在浏览器安装并启用 Tampermonkey，按浏览器提示授予运行用户脚本的权限。
2. 打开仓库中的 [`dist/chaoxing-deepseek-homework.user.js`](dist/chaoxing-deepseek-homework.user.js)，选择 **Raw** 安装；也可以把文件内容复制到油猴的新脚本中保存。
3. 进入可编辑的学习通普通课程作业页面，刷新后找到助手面板。
4. 输入自己的 DeepSeek API Key 并保存，读取模型并测试连接。密钥需要从 API 服务商获取，不能用网页版登录状态替代。
5. 核对作业设置后运行。建议初次使用保持自动提交关闭，并检查答案和保存状态。

如已安装旧版，请选择更新已有脚本，避免多个版本同时运行。脚本使用相同的名称、namespace 和设置存储键。

## 功能和实际限制

- 尝试适配单选、多选、判断，以及常见文本填空和简答控件。
- 支持课程学习页面中多层同源 iframe 内的作业；只显示一个助手面板，翻页和提交限定在识别到的作业内。题目加载时最多等待 10 秒。
- 图片题需要 API 模型实际支持图像输入，脚本会把题干、选项及读取的图片发送给 API 服务商。
- 遇到题干、选项或答案识别失败、页面变化、填写状态无法验证等情况时暂停。嵌在 iframe 中的富文本编辑器尚未适配。
- 加密字体题目仍会暂停，避免把乱码作为题干发送。诊断导出包含 iframe 可访问状态、各层题目数量和加密字体标记，不包含题目正文、密钥或 URL 查询参数。
- 自动翻页默认开启，但完整页面刷新可能中断运行。自动提交需要正确的作业总题数和可靠的题号覆盖检查。
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
```

构建产物为 `dist/chaoxing-deepseek-homework.user.js`。`src/homework.template.js` 是脚本模板，`src/panel.html` 是界面，`scripts/build-ui.mjs` 将素材和界面打包为单个用户脚本。

构建也会输出仅含用户脚本头部的 `.meta.js` 更新检查文件。Fork 二次开发时，请将模板中的 `@homepageURL`、`@supportURL`、`@downloadURL`、`@updateURL` 改为自己的仓库地址，再重新构建。

界面检查使用本机 Microsoft Edge 的无头模式，涵盖素材加载、设置保存与清除、状态切换、收起展开、图片失败回退、键盘操作及 390px / 320px 小屏布局。检查报告见 [`preview/界面检查.json`](preview/界面检查.json)。未使用真实学习通账号或真实 API Key 做端到端验证。

题目识别回归检查覆盖三层 iframe、旧版选项、延后加载、暂停、翻页与提交范围、页面切换和诊断脱敏，使用虚构题目和模拟 API。报告见 [`preview/题目识别检查.json`](preview/题目识别检查.json)。

## 致谢

感谢 DeepSeek、ChatGPT 和 [Codex](https://github.com/codex) 对本项目的支持：DeepSeek 提供模型 API，ChatGPT 与 Codex 协助文案整理、界面设计及代码开发。

## 许可证与素材来源

代码、文档和项目配套插画按 [MIT 许可证](LICENSE) 开源。插画使用内置图像生成工具，依据项目已有参考图生成；PNG 原图、WebP 交付副本与提示词保存在 `assets/`。素材说明见 [ASSETS.md](ASSETS.md)。项目名称及平台名称不表示官方授权、认可或联名。

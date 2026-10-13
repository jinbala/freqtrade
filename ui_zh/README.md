# 原版 FreqUI 简体中文

使用地址：**http://127.0.0.1:8080/**。这是原 FreqUI 3.1.3 的源码汉化版本，保留原有页面、账户登录、图表和交易操作。更新后按 **Ctrl+F5** 刷新浏览器。

覆盖导航、登录、交易、余额、持仓、交易详情、设置、图表、回测、数据下载、交易对配置、分析页面、弹窗、组件库提示，以及运行状态、交易方向和退出原因等动态显示。币种、策略名、接口标识和日志原文属于实际数据，保留原始值。

汉化仅影响显示：API 路径、订单方向、订单类型、时间周期和选项模型值不变。组件库使用简体中文，图表使用中文语言包，时长使用中文单位。新浏览器配置默认使用北京时间，已有时区偏好保留。

源码固定为官方 FreqUI 3.1.3，提交 `f2d57c3efd55d9fb66e60b2dfc2e650b6b601185`，下载在 `user_data/frequi-zh/`。翻译字典为 `ui_zh/zh-CN.tsv`；`localize.mjs` 使用 Vue 和 TypeScript 语法树修改显示文字，并单独保护 API 与模型参数。该下载目录是构建用副本，重建会重新应用翻译，请在字典或补丁脚本中修改，不要直接编辑副本。

重新构建、检查并安装：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-frequi-zh.ps1
```

需要 Node.js、npm、Git 和已搭建好的 Python 环境。脚本会检查编译、类型及 7 项汉化测试，全部通过后才替换已安装的前端。替换前端不需要停止交易进程，旧的哈希资源暂时保留，以兼容已打开的浏览器标签页。

首次安装前的完整英文前端已备份至 `user_data/ui-backups/frequi-original-3.1.3.zip`。恢复英文：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-frequi-zh.ps1 -RestoreEnglish
```

`freqtrade install-ui` 会重新安装官方英文界面；如执行过该命令，可重跑汉化构建脚本。更换官方版本后需重新适配源码补丁，不应盲目覆盖。

检查包括真实 Vue 组件渲染、中文表格值、选项与时间周期的原始值，以及 189 个源文件中的 API 路径和选项值对照。当前没有可连接的浏览器，尚未进行真实浏览器视觉验收。

# BTC/USDT 模拟盘

本目录使用 Windows PowerShell + `.venv` 运行当前仓库的 Freqtrade。无需 Docker 或交易所 API Key。

了解全部功能、源码位置和开发迭代流程，请阅读 [项目导航与迭代指南](PROJECT-GUIDE.zh-CN.md)。

**原版 FreqUI 已汉化：http://127.0.0.1:8080/**。保留原界面及其功能，导航、登录、设置、交易、回测和弹窗等使用简体中文。更新后按 Ctrl+F5 强制刷新。用户名为 `freqtrader`，密码见本地配置中的 `api_server.password`。汉化重建与英文恢复方式见 [原界面汉化说明](ui_zh/README.md)。

| 项目 | 配置 |
| --- | --- |
| 行情 | Binance 现货 BTC/USDT，公开 REST API |
| 周期 | 5 分钟 |
| 买入 | EMA20 从下向上穿越 EMA50，成交量大于 0 |
| 卖出 | EMA20 从上向下穿越 EMA50，或止盈/止损 |
| 模拟本金 | 1,000 USDT |
| 每单金额 / 最大持仓 | 100 USDT / 1 笔 |
| 止盈 / 止损 | 2% / 3%（价格滑点可能使成交收益偏离阈值） |
| 预热 | 200 根 K 线 |
| 模式 | `dry_run: true`，现货做多，模拟市价单 |

策略用于验证环境和交易流程，尚未做参数优化或收益验证。

具体环境验证记录和回测结果保存在被 Git 忽略的 `BTC-DRYRUN.local.md` 与 `user_data/` 中。公开说明仅包含运行方法和默认参数。

提交前可以运行 `python scripts/check-private-files.py` 检查暂存区。实际运行配置、密钥、账本、日志、本地报告、备份和构建缓存仅保存在本机，已通过 `.gitignore` 排除。检查器会拒绝暂存的私密文件和检测到的密钥，只显示文件路径及风险类别，不输出密钥值。当前仓库的本地提交钩子已启用该检查。

所有命令在仓库根目录执行：

```powershell
# 初始化独立环境和本地配置；重复执行不会覆盖已有配置
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\btc-dryrun.ps1 Setup

# 检查配置、策略加载和交易对
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\btc-dryrun.ps1 Check

# 后台启动；终端关闭后继续运行，电脑需保持开机联网
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\btc-dryrun.ps1 Start

# 查看交易状态、循环健康时间及持仓数
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\btc-dryrun.ps1 Status

# 停止后台进程，保留模拟仓位和交易记录
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\btc-dryrun.ps1 Stop
```

如果想在终端直接看日志，使用 `Start -Foreground`，按 `Ctrl+C` 退出。前台模式不写 PID 文件，应在对应终端停止。后台模式的 `Stop` 先调用本机 API 暂停交易，再结束 Windows 进程；不会自动平掉模拟持仓。重新启动会继续使用同一模拟账本。本配置没有设置 Windows 开机自启。

启动需要联网加载市场信息和近期 K 线。没有金叉时会等待信号，不会为了验证环境强行开仓。`Status` 中的 `state` 应为 `running`，`dry_run` 应为 `True`；`health` 的 `last_process` 时间应持续更新。

下载历史数据和回测：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\btc-dryrun.ps1 Download -Days 30
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\btc-dryrun.ps1 Backtest
```

回测使用已下载的全部 5 分钟数据，前 200 根用于预热。回测结果会输出到终端，并保存在 `user_data/backtest_results/`。回测与实时模拟盘是两个独立流程，回测不会向模拟账本插入交易。

主要文件：

- `strategies/BtcEmaCross.py`：策略源码。
- `config_examples/btc_dryrun.example.json`：不含凭据的配置模板。
- `user_data/config-btc-dryrun.json`：实际运行配置，Setup 自动生成随机本机 API 密码与 JWT/WS 密钥，已被 Git 忽略。
- `user_data/trades-btc.dryrun.sqlite`：模拟交易账本，停止后保留。
- `user_data/logs/btc-dryrun.log`：交易日志。
- `user_data/logs/btc-dryrun.stderr.log`：启动异常和标准错误。
- `user_data/btc-dryrun.pid`：后台进程 PID，脚本检查进程身份以避免误停止其他进程。

本机 API 为 `http://127.0.0.1:8080`，用户名 `freqtrader`，密码在实际运行配置的 `api_server.password` 中。安装 FreqUI 后可在该地址查看面板：

```powershell
.\.venv\Scripts\python.exe -m freqtrade install-ui
```

查看最新日志：

```powershell
Get-Content .\user_data\logs\btc-dryrun.log -Tail 50 -Wait
```

修改参数前先 `Stop`，编辑实际运行配置或策略后再 `Start`。启动器仅接受 Binance 现货 BTC/USDT 和 dry-run，并拒绝 `FREQTRADE__*` 环境变量覆盖；交易命令额外传入 `--dry-run`。如果 8080 被占用，可以停止后修改实际运行配置中的 `api_server.listen_port`。

Freqtrade 模拟盘使用真实行情模拟交易，不使用交易所测试网。官方说明：[Using Dry-run mode](https://www.freqtrade.io/en/stable/configuration/#using-dry-run-mode)。

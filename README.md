# 微软奖励脚本
自动化的微软奖励脚本，这次使用 TypeScript、Cheerio 和 Playwright 编写。

该项目来源于https://github.com/TheNetsky/Microsoft-Rewards-Script ，感谢原作者的付出

本项目不定时同步原项目代码，主要内容为本地化处理，主要针对的是国内用户无法访问外网google等问题，并在原有基础上完善功能。若有侵权请联系我删除。

本项目所有改动基于win11系统和docker环境。其他系统未测试，请根据原项目相关配置设置。


# window环境 #
## 如何自动设置 ##
1. 下载或克隆源代码
2. win系统运行setup.bat部署环境（若使用setup.bat报错，请参考手动设置）
3. 在dist目录 `accounts.json`添加你的账户信息
4. 按照你的喜好修改dist目录 `config.json` 文件
5. 运行 `npm start`或运行 `run.bat` 启动构建好的脚本
## 如何手动设置 ##
1. 下载或克隆源代码
2. 下载安装nodejs和npm环境
3. 运行 `npm install` 安装依赖包
4. 若Error: browserType.launch: Executable doesn't exist报错执行 npm exec playwright install msedge
5. 将 `accounts.example.json` 重命名为 `accounts.json`，并添加你的账户信息
6. 按照你的喜好修改 `config.json` 文件
7. 运行 `npm run build` 构建脚本
8. 运行 `npm start` 启动构建好的脚本

# Docker环境 #
1. 下载或克隆源代码
2. 确保`config.json`内的 `headless`设置为`true`
3. 编辑`compose.yaml` 
* 设置时区`TZ` 
* 设置调度`CRON_SCHEDULE` （默认为每天7点执行一次）
* 保持`RUN_ON_START=true`
4. 启动容器
~~~
docker compose up -d 
~~~
## 注意事项 ##
- 如果你在未先关闭浏览器窗口的情况下结束脚本（仅在 `headless` 为 `false` 时），会有 Chrome 进程继续占用资源。你可以使用任务管理器关闭这些进程，或者使用附带的 `npm kill-chrome-win` 脚本（Windows 系统）。
- 如果你要自动化运行此脚本，请设置每天至少运行 2 次，以确保完成所有任务。将 `"runOnZeroPoints": false`，这样在没有可赚取积分时脚本不会运行。
- 如果出现无法自动登录情况，请在代码执行登录过程中手动完成网页的登录，等待代码自动完成剩下流程。登录信息保存在sessions目录（需要多备份），后续运行根据该目录的会话文件来运行。
- 更新代码后，若出现错误，请先更新依赖包，`npm install`和`npm exec playwright install`
- 若出现其他错误，请检查代码是否有语法错误，或联系作者。

## 配置参考

编辑 `src/config.json` 以自定义行为。
以下是关键配置部分的摘要。

### Core / 核心
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `baseURL` | Microsoft Rewards base URL | `https://rewards.bing.com` |
| `sessionPath` | 用于存储浏览器会话的文件夹 | `sessions` |
| `dryRun` | 模拟执行而不运行任务 | `false` |

### Browser / 浏览器
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `browser.headless` | 无头模式运行浏览器 | `false` |
| `browser.globalTimeout` | 操作超时时间 | `"30s"` |

### Fingerprinting / 指纹识别
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `fingerprinting.saveFingerprint.mobile` | 重用移动设备指纹 | `true` |
| `fingerprinting.saveFingerprint.desktop` | 重用桌面设备指纹 | `true` |

### Execution / 执行
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `execution.parallel` | 同时运行桌面和移动版本 | `false` |
| `execution.runOnZeroPoints` | 即使积分为零也运行 | `false` |
| `execution.clusters` | 并发账户集群数量 | `1` |

### Job State / 任务状态
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `jobState.enabled` | 保存上一个任务状态 | `true` |
| `jobState.dir` | 任务数据目录 | `""` |

### Workers (Tasks) / 工作器（任务）
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `doDailySet` | 完成每日集 | `true` |
| `doMorePromotions` | 完成更多推广 | `true` |
| `doPunchCards` | 完成打卡 | `true` |
| `doDesktopSearch` | 执行桌面搜索 | `true` |
| `doMobileSearch` | 执行移动搜索 | `true` |
| `doDailyCheckIn` | 完成每日签到 | `true` |
| `doReadToEarn` | 完成阅读赚钱 | `true` |
| `bundleDailySetWithSearch` | 组合每日集和搜索 | `true` |

### Search / 搜索
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `search.useLocalQueries` | 使用本地查询列表 | `true` |
| `search.settings.useGeoLocaleQueries` | 使用基于地区的查询 | `true` |
| `search.settings.scrollRandomResults` | 随机滚动 | `true` |
| `search.settings.clickRandomResults` | 随机点击链接 | `true` |
| `search.settings.retryMobileSearchAmount` | 重试移动搜索次数 | `2` |
| `search.settings.delay.min` | 搜索间的最小延迟 | `1min` |
| `search.settings.delay.max` | 搜索间最大延迟 | `5min` |

### Query Diversity / 查询多样性
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `queryDiversity.enabled` | 启用多个查询源 | `true` |
| `queryDiversity.sources` | 查询提供者 | `["google-trends", "reddit", "local-fallback"]` |
| `queryDiversity.maxQueriesPerSource` | 每个源的限制 | `10` |
| `queryDiversity.cacheMinutes` | 缓存生命周期 | `30` |

### Humanization / 人性化
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `humanization.enabled` | 启用人类行为 | `true` |
| `stopOnBan` | 封禁时立即停止 | `true` |
| `immediateBanAlert` | 被封禁时立即提醒 | `true` |
| `actionDelay.min` | 每个操作的最小延迟(毫秒) | `500` |
| `actionDelay.max` | 每个操作的最大延迟(毫秒) | `2200` |
| `gestureMoveProb` | 随机鼠标移动几率 | `0.65` |
| `gestureScrollProb` | 随机滚动几率 | `0.4` |

### Vacation Mode / 假期模式
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `vacation.enabled` | 启用随机暂停 | `true` |
| `minDays` | 最短休息天数 | `2` |
| `maxDays` | 最长休息天数 | `4` |

### Risk Management / 风险管理
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `enabled` | 启用基于风险的调整 | `true` |
| `autoAdjustDelays` | 动态适应延迟 | `true` |
| `stopOnCritical` | 遇到严重警告时停止 | `false` |
| `banPrediction` | 基于信号预测封禁 | `true` |
| `riskThreshold` | 风险承受水平 | `75` |

### Retry Policy / 重试策略
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `maxAttempts` | 最大重试次数 | `3` |
| `baseDelay` | 初始重试延迟 | `1000` |
| `maxDelay` | 最大重试延迟 | `30s` |
| `multiplier` | 退避倍数 | `2` |
| `jitter` | 随机抖动因子 | `0.2` |

### Proxy / 代理
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `proxy.proxyGoogleTrends` | 为Google Trends请求使用代理 | `true` |
| `proxy.proxyBingTerms` | 为Bing条款请求使用代理 | `true` |

### Notifications / 通知
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `notifications.webhook.enabled` | 启用Discord Webhook | `false` |
| `notifications.webhook.url` | Discord Webhook URL | `""` |
| `notifications.conclusionWebhook.enabled` | 启用总结Webhook | `false` |
| `notifications.conclusionWebhook.url` | 总结Webhook URL | `""` |
| `notifications.ntfy.enabled` | 启用Ntfy推送提醒 | `false` |
| `notifications.ntfy.url` | Ntfy服务器URL | `""` |
| `notifications.ntfy.topic` | Ntfy主题名称 | `"rewards"` |

### Logging / 日志
| 设置 | 描述 | 默认值 |
|----------|-------------|----------|
| `excludeFunc` | 从控制台日志中排除 | `["SEARCH-CLOSE-TABS", "LOGIN-NO-PROMPT", "FLOW"]` |
| `webhookExcludeFunc` | 从Webhook日志中排除 | `["SEARCH-CLOSE-TABS", "LOGIN-NO-PROMPT", "FLOW"]` |
| `redactEmails` | 在日志中隐藏邮箱 | `true` |
---
## 功能 ##
- [x] 多账户支持
- [x] 会话存储
- [x] 双因素认证支持
- [x] 无密码登录支持
- [x] 无头模式支持
- [x] Discord Webhook 支持
- [x] 最终摘要 Webhook（专用，可选）
- [x] 桌面搜索
- [x] 可配置任务
- [x] 微软 Edge 搜索
- [x] 移动设备搜索
- [x] 模拟滚动支持
- [x] 模拟链接点击支持
- [x] 地理位置搜索查询
- [x] 完成每日任务集
- [x] 完成更多活动任务
- [x] 解决 10 积分的测验
- [x] 解决 30 - 40 积分的测验
- [x] 完成点击奖励任务
- [x] 完成投票任务
- [x] 完成打卡任务
- [x] 解决随机的“这个还是那个”测验
- [x] 解决 ABC 测验
- [x] 完成每日签到
- [x] 完成阅读赚取积分任务
- [x] 集群支持
- [x] 代理支持
- [x] Docker 支持（实验性）
- [x] 自动调度（通过 Docker）


## 更新日志 ##
1. 添加了移动端的活动领取-2025年6月24日
2. 添加了中文热搜内容-2025年6月25日
3. 优化大量随机性，优化模拟人类操作-2025年7月3日
4. 允许useLocale设置自定义地区-2025年7月10日
5. 添加了日志本地保存功能-2025年7月26日
6. 由于pnpm依赖导致无法编译问题，项目暂时改回使用npm管理-2025年11月11日
7. 补充docker的运行方式-2025年11月11日

## 免责声明 ##
使用此脚本可能会导致你的账户被封禁或暂停，请注意！
<br /> 
请自行承担使用此脚本的风险！


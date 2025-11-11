# 微软奖励脚本
自动化的微软奖励脚本，这次使用 TypeScript、Cheerio 和 Playwright 编写。

该项目来源于https://github.com/TheNetsky/Microsoft-Rewards-Script ，感谢原作者的付出

本项目不定时同步原项目代码，主要内容为本地化处理，主要针对的是国内用户无法访问外网google等问题，并在原有基础上完善功能。若有侵权请联系我删除。

本项目所有改动基于win11系统。
其他系统未测试，请根据原项目相关配置设置。

！若需要在docker环境运行，可参考原本项目部署。特别需要注意docker模式需要将headless改为true。！
## 新增功能 ##
1. 添加了移动端的活动领取-2025年6月24日
2. 添加了中文热搜内容-2025年6月25日
3. 优化大量随机性，优化模拟人类操作-2025年7月3日
4. 允许useLocale设置自定义地区-2025年7月10日
5. 添加了日志本地保存功能-2025年7月26日
6. 由于pnpm依赖导致无法编译问题，项目暂时改回使用npm管理-2025年11月11日

## 如何自动设置（二选一/自动） ##
1. 下载或克隆源代码
2. win系统运行setup.bat部署环境（若使用setup.bat报错，请参考手动设置）
3. 在dist目录 `accounts.jsonc`添加你的账户信息
4. 按照你的喜好修改dist目录 `config.jsonc` 文件
5. 运行 `npm start`或运行 `run.bat` 启动构建好的脚本
## 如何手工设置（二选一/手动） ##
1. 下载或克隆源代码
2. 下载安装nodejs和pnpm环境
3. 运行 `npm install` 安装依赖包
4. 若Error: browserType.launch: Executable doesn't exist报错执行 npm exec playwright install msedge
5. 将 `accounts.example.jsonc` 重命名为 `accounts.jsonc`，并添加你的账户信息
6. 按照你的喜好修改 `config.jsonc` 文件
7. 运行 `npm run build` 构建脚本
8. 运行 `npm start` 启动构建好的脚本

## Docker运行
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

## 配置 ## 
| 设置        | 描述           | 默认值  |
| :------------- |:-------------| :-----|
|  baseURL    | 微软奖励页面 | `https://rewards.bing.com` |
|  sessionPath    | 会话/指纹存储路径 | `sessions` （在 `./browser/sessions` 目录下） |
|  headless    | 浏览器窗口是否可见，是否在后台运行，若需要docker环境请改为true | `false` （浏览器可见） |
|  parallel    | 是否并行运行移动设备和桌面端任务 | `true` |
|  runOnZeroPoints    | 当可赚取积分为 0 时是否继续运行脚本 | `false` （积分为 0 时不运行） |
|  clusters    | 启动时运行的实例数量，每个账户一个实例 | `1` （一次运行一个账户） |
|  saveFingerprint.mobile    | 每次是否重复使用相同的指纹 | `false` （每次生成新的指纹） |
|  saveFingerprint.desktop    | 每次是否重复使用相同的指纹 | `false` （每次生成新的指纹） |
|  workers.doDailySet    | 是否完成每日任务集 | `true`  |
|  workers.doMorePromotions    | 是否完成促销任务 | `true`  |
|  workers.doPunchCards    | 是否完成打卡任务 | `true`  |
|  workers.doDesktopSearch    | 是否完成每日桌面搜索任务 | `true`  |
|  workers.doMobileSearch    | 是否完成每日移动设备搜索任务 | `true`  |
|  workers.doDailyCheckIn    | 是否完成每日签到任务 | `true`  |
|  workers.doReadToEarn    | 是否完成阅读赚取积分任务 | `true`  |
|  searchOnBingLocalQueries    | 是否使用 `queries.jsonc` 文件或从本仓库获取的查询来完成“在 Bing 上搜索”任务 | `false` （从本仓库获取）   |
|  globalTimeout    | 操作超时时间 | `30s`   |
|  searchSettings.useGeoLocaleQueries    | 是否根据你的地理位置生成搜索查询 | `false` （使用中文生成的查询）  |
|  searchSettings.useLocale    | 设置的地区 | `cn`  |
|  searchSettings.scrollRandomResults    | 是否在搜索结果中随机滚动 | `true`   |
|  searchSettings.clickRandomResults    | 是否访问搜索结果中的随机网站 | `true`   |
|  searchSettings.searchDelay    | 搜索查询之间的最小和最大时间间隔（毫秒） | `min: 3min`    `max: 5min` |
|  searchSettings.retryMobileSearchAmount     | 移动设备搜索失败后的重试次数 | `2` |
|  logExcludeFunc | 从日志和 Webhook 中排除的函数 | `SEARCH-CLOSE-TABS` |
|  webhookLogExcludeFunc | 从 Webhook 日志中排除的函数 | `SEARCH-CLOSE-TABS` |
|  proxy.proxyGoogleTrends     | 是否通过设置的代理转发 Google 趋势请求 | `true` （将通过代理） |
|  proxy.proxyBingTerms     | 是否通过设置的代理转发 Bing 搜索词请求 | `true` （将通过代理） |
|  webhook.enabled     | 是否启用你设置的 Webhook | `false` |
|  webhook.url     | 你的 Discord Webhook URL | `null` |
|  conclusionWebhook.enabled | 启用或禁用专用于最终摘要的 Webhook | `false` |
|  conclusionWebhook.url | 仅用于最终摘要的 Discord Webhook URL | `null` |
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

## 免责声明 ##
使用此脚本可能会导致你的账户被封禁或暂停，请注意！
<br /> 
请自行承担使用此脚本的风险！


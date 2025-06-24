import { Page } from 'rebrowser-playwright'
import { platform } from 'os'

import { Workers } from '../Workers'

import { Counters, DashboardData } from '../../interface/DashboardData'
import { GoogleSearch } from '../../interface/Search'
import { AxiosRequestConfig } from 'axios'

type GoogleTrendsResponse = [
    string,
    [
        string,
        ...null[],
        [string, ...string[]]
    ][]
];

export class Search extends Workers {
    private bingHome = 'https://bing.com'
    private searchPageURL = ''

    public async doSearch(page: Page, data: DashboardData) {
        // 记录日志，表明开始进行必应搜索
        this.bot.log(this.bot.isMobile, 'SEARCH-BING', '开始必应搜索')

        // 获取最新的浏览器标签页
        page = await this.bot.browser.utils.getLatestTab(page)

        // 获取当前的搜索积分计数器
        let searchCounters: Counters = await this.bot.browser.func.getSearchPoints()
        // 计算还需要获取的积分
        let missingPoints = this.calculatePoints(searchCounters)

        // 如果不需要再获取积分，记录日志并返回
        if (missingPoints === 0) {
            this.bot.log(this.bot.isMobile, 'SEARCH-BING', '必应搜索已完成')
            return
        }

        // 生成搜索查询词
        // 根据配置决定是否使用地区相关的查询词，从谷歌趋势获取搜索词
        // 定义一个包含目标国家代码的数组，方便后续扩展和维护
        let googleSearchQueries =[];
        const targetCountries = ['cn', 'tw', 'hk'];
        const counters = this.bot.config.searchSettings.useGeoLocaleQueries ? data.userProfile.attributes.country : 'US'
        // if ( targetCountries.includes(counters)) {
            googleSearchQueries = await this.getChinaTrends(counters)
        // }else{
        //     googleSearchQueries = await this.getGoogleTrends(counters)
        // }
        this.bot.log(this.bot.isMobile, 'SEARCH-BING', `googleSearchQueries:${counters}`)

        // 打乱搜索词数组的顺序
        googleSearchQueries = this.bot.utils.shuffleArray(googleSearchQueries)

        // 对搜索词去重
        googleSearchQueries = [...new Set(googleSearchQueries)]

        // 打开必应搜索页面
        await page.goto(this.searchPageURL ? this.searchPageURL : this.bingHome)

        // 等待 2 秒
        await this.bot.utils.waitRandom(2000,5000)

        // 尝试关闭所有消息弹窗
        await this.bot.browser.utils.tryDismissAllMessages(page)

        // 最大循环次数，用于判断搜索是否卡住
        let maxLoop = 0 // If the loop hits 10 this when not gaining any points, we're assuming it's stuck. If it doesn't continue after 5 more searches with alternative queries, abort search

        // 存储搜索查询词的数组
        const queries: string[] = []
        // 移动端搜索似乎不喜欢相关查询？
        googleSearchQueries.forEach(x => { this.bot.isMobile ? queries.push(x.topic) : queries.push(x.topic, ...x.related) })

        // 遍历搜索查询词
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i] as string

            // 记录日志，显示剩余积分和当前查询词
            this.bot.log(this.bot.isMobile, 'SEARCH-BING', `${missingPoints} 剩余积分 | 查询: ${query}`)

            // 执行必应搜索并更新积分计数器
            searchCounters = await this.bingSearch(page, query)
            const newMissingPoints = this.calculatePoints(searchCounters)

            // 如果新的积分数量和之前相同，说明没有获得新积分
            if (newMissingPoints == missingPoints) {
                maxLoop++ // Add to max loop
            } else { // There has been a change in points
                maxLoop = 0 // Reset the loop
            }

            missingPoints = newMissingPoints

            // 如果已经获得了足够的积分，跳出循环
            if (missingPoints === 0) {
                break
            }

            // 仅针对移动端搜索
            if (maxLoop > 5 && this.bot.isMobile) {
                // 记录警告日志，搜索 5 次没有获得积分，可能是 User-Agent 有问题
                this.bot.log(this.bot.isMobile, 'SEARCH-BING', '搜索5次未获得积分，可能是User-Agent有问题', 'warn')
                break
            }

            // 如果 10 次循环都没有获得积分，假设搜索卡住了
            if (maxLoop > 10) {
                // 记录警告日志，搜索 10 次没有获得积分，停止搜索
                this.bot.log(this.bot.isMobile, 'SEARCH-BING', '搜索10次未获得积分，中止搜索', 'warn')
                maxLoop = 0 // Reset to 0 so we can retry with related searches below
                break
            }
        }

        // 仅针对移动端搜索
        if (missingPoints > 0 && this.bot.isMobile) {
            return
        }

        // 如果还有剩余的搜索积分需要获取，生成额外的搜索查询词
        if (missingPoints > 0) {
            // 记录日志，表明搜索完成但还有积分未获取，开始生成额外搜索
            this.bot.log(this.bot.isMobile, 'SEARCH-BING', `搜索完成但仍缺少 ${missingPoints} 积分，正在生成额外搜索`)

            let i = 0
            while (missingPoints > 0) {
                const query = googleSearchQueries[i++] as GoogleSearch

                // 获取与谷歌搜索查询词相关的搜索词
                const relatedTerms = await this.getRelatedTerms(query?.topic)
                if (relatedTerms.length > 3) {
                    // 搜索前 2 个相关搜索词
                    for (const term of relatedTerms.slice(1, 3)) {
                        // 记录日志，显示剩余积分和当前查询词
                        this.bot.log(this.bot.isMobile, 'SEARCH-BING-EXTRA', `${missingPoints} 剩余积分 | 查询: ${term}`)

                        // 执行必应搜索并更新积分计数器
                        searchCounters = await this.bingSearch(page, term)
                        const newMissingPoints = this.calculatePoints(searchCounters)

                        // 如果新的积分数量和之前相同，说明没有获得新积分
                        if (newMissingPoints == missingPoints) {
                            maxLoop++ // Add to max loop
                        } else { // There has been a change in points
                            maxLoop = 0 // Reset the loop
                        }

                        missingPoints = newMissingPoints

                        // 如果已经获得了足够的积分，跳出循环
                        if (missingPoints === 0) {
                            break
                        }

                        // 尝试 5 次后，如果还是没有获得积分，停止搜索
                        if (maxLoop > 5) {
                            // 记录警告日志，额外搜索 5 次没有获得积分，停止搜索
                            this.bot.log(this.bot.isMobile, 'SEARCH-BING-EXTRA', '额外搜索5次未获得积分，中止搜索', 'warn')
                            return
                        }
                    }
                }
            }
        }

        // 记录日志，表明搜索完成
        this.bot.log(this.bot.isMobile, 'SEARCH-BING', '搜索完成')
    }

    private async bingSearch(searchPage: Page, query: string) {
        const platformControlKey = platform() === 'darwin' ? 'Meta' : 'Control'

        // Try a max of 5 times
        for (let i = 0; i < 5; i++) {
            try {
                // This page had already been set to the Bing.com page or the previous search listing, we just need to select it
                searchPage = await this.bot.browser.utils.getLatestTab(searchPage)

                // Go to top of the page
                await searchPage.evaluate(() => {
                    window.scrollTo(0, 0)
                })

                await this.bot.utils.waitRandom(500,2000)

                const searchBar = '#sb_form_q'
                await searchPage.waitForSelector(searchBar, { state: 'visible', timeout: 10000 })
                await searchPage.click(searchBar) // Focus on the textarea
                await this.bot.utils.waitRandom(500,2000)
                await searchPage.keyboard.down(platformControlKey)
                await searchPage.keyboard.press('A')
                await searchPage.keyboard.press('Backspace')
                await searchPage.keyboard.up(platformControlKey)
                await searchPage.keyboard.type(query)
                await searchPage.keyboard.press('Enter')

                await this.bot.utils.waitRandom(3000,5000)

                // Bing.com in Chrome opens a new tab when searching
                const resultPage = await this.bot.browser.utils.getLatestTab(searchPage)
                this.searchPageURL = new URL(resultPage.url()).href // Set the results page

                await this.bot.browser.utils.reloadBadPage(resultPage)

                if (this.bot.config.searchSettings.scrollRandomResults) {
                    await this.bot.utils.waitRandom(2000,5000)
                    await this.randomScroll(resultPage)
                }

                if (this.bot.config.searchSettings.clickRandomResults) {
                    await this.bot.utils.waitRandom(2000,5000)
                    await this.clickRandomLink(resultPage)
                }

                // Delay between searches
                await this.bot.utils.wait(Math.floor(this.bot.utils.randomNumber(this.bot.utils.stringToMs(this.bot.config.searchSettings.searchDelay.min), this.bot.utils.stringToMs(this.bot.config.searchSettings.searchDelay.max))))

                return await this.bot.browser.func.getSearchPoints()

            } catch (error) {
                if (i === 5) {
                    this.bot.log(this.bot.isMobile, 'SEARCH-BING', '尝试5次后失败... 发生错误:' + error, 'error')
                    break

                }

                this.bot.log(this.bot.isMobile, 'SEARCH-BING', '搜索失败，发生错误:' + error, 'error')
                this.bot.log(this.bot.isMobile, 'SEARCH-BING', `重试搜索，尝试 ${i}/5`, 'warn')

                // Reset the tabs
                const lastTab = await this.bot.browser.utils.getLatestTab(searchPage)
                await this.closeTabs(lastTab)

                await this.bot.utils.waitRandom(4000,7000)
            }
        }

        this.bot.log(this.bot.isMobile, 'SEARCH-BING', '尝试5次后搜索失败，结束', 'error')
        return await this.bot.browser.func.getSearchPoints()
    }

    /**
     * 尝试从多个搜索词来源获取搜索词，如果所有来源都失败，则返回默认搜索词。
     * @returns {Promise<GoogleSearch[]>} 返回搜索到的name属性值列表或默认搜索词列表
     */
    private async getChinaTrends(geoLocale: string = 'US'): Promise<GoogleSearch[]> {

        const queryTerms: GoogleSearch[] = []
        this.bot.log(this.bot.isMobile, 'SEARCH-CHINA-TRENDS', `正在生成搜索查询，可能需要一些时间！ | 地理区域: ${geoLocale}`)
        var appkey = "";//从https://www.gmya.net/api 网站申请的热门词接口APIKEY
        var Hot_words_apis = "https://api.gmya.net/Api/";// 故梦热门词API接口网站
        //默认搜索词，热门搜索词请求失败时使用
        var default_search_words = ["盛年不重来，一日难再晨", "千里之行，始于足下", "少年易学老难成，一寸光阴不可轻", "敏而好学，不耻下问", "海内存知已，天涯若比邻", "三人行，必有我师焉",
            "莫愁前路无知已，天下谁人不识君", "人生贵相知，何用金与钱", "天生我材必有用", "海纳百川有容乃大；壁立千仞无欲则刚", "穷则独善其身，达则兼济天下", "读书破万卷，下笔如有神",
            "学而不思则罔，思而不学则殆", "一年之计在于春，一日之计在于晨", "莫等闲，白了少年头，空悲切", "少壮不努力，老大徒伤悲", "一寸光阴一寸金，寸金难买寸光阴", "近朱者赤，近墨者黑",
            "吾生也有涯，而知也无涯", "纸上得来终觉浅，绝知此事要躬行", "学无止境", "己所不欲，勿施于人", "天将降大任于斯人也", "鞠躬尽瘁，死而后已", "书到用时方恨少", "天下兴亡，匹夫有责",
            "人无远虑，必有近忧", "为中华之崛起而读书", "一日无书，百事荒废", "岂能尽如人意，但求无愧我心", "人生自古谁无死，留取丹心照汗青", "吾生也有涯，而知也无涯", "生于忧患，死于安乐",
            "言必信，行必果", "读书破万卷，下笔如有神", "夫君子之行，静以修身，俭以养德", "老骥伏枥，志在千里", "一日不读书，胸臆无佳想", "王侯将相宁有种乎", "淡泊以明志。宁静而致远,", "卧龙跃马终黄土"]
        //{weibohot}微博热搜榜//{douyinhot}抖音热搜榜/{zhihuhot}知乎热搜榜/{baiduhot}百度热搜榜/{toutiaohot}今日头条热搜榜/
        var keywords_source = ['BaiduHot', 'TouTiaoHot', 'DouYinHot', 'WeiBoHot'];
        var random_keywords_source = keywords_source[Math.floor(Math.random() * keywords_source.length)];
        var current_source_index = 0; // 当前搜索词来源的索引
    
        while (current_source_index < keywords_source.length) {
            // const source = keywords_source[current_source_index]; // 获取当前搜索词来源
            const source = random_keywords_source; // 获取当前搜索词来源
            let url;        
            //根据 appkey 是否为空来决定如何构建 URL地址,如果appkey为空,则直接请求接口地址
            if (appkey) {
                url = Hot_words_apis + source + "?format=json&appkey=" + appkey;//有appkey则添加appkey参数
            } else {    
                url = Hot_words_apis + source;//无appkey则直接请求接口地址
            }
            try {
                const response = await fetch(url); // 发起网络请求
                if (!response.ok) {
                    throw new Error('HTTP error! status: ' + response.status); // 如果响应状态不是OK，则抛出错误
                }
                const data = await response.json(); // 解析响应内容为JSON
    
                // 显式指定 item 的类型为 any，解决隐式 any 类型的问题
                if (data.data.some((item: any) => item)) {
                    // 如果数据中存在有效项
                    // 提取每个元素的title属性值
                    const names = data.data.map((item: any) => item.title);
                    // 显式指定 name 的类型为 string，解决隐式 any 类型的问题
                    names.forEach((name: string) => {
                        queryTerms.push({
                            topic: name,
                            related: []
                        });
                    });
                    return queryTerms; // 返回搜索到的title属性值列表
                }
            } catch (error) {
                // 当前来源请求失败，记录错误并尝试下一个来源
                console.error('搜索词来源请求失败:', error);
            }
            // 尝试下一个搜索词来源
            current_source_index++;
        }
    
        // 所有搜索词来源都已尝试且失败
        console.error('所有搜索词来源请求失败');
        // return default_search_words; // 返回默认搜索词列表
        queryTerms.push({
            topic: "只能查询一些本地的" as string,
            related: default_search_words as string[]
        })
        
        return queryTerms

    }


    private async getGoogleTrends(geoLocale: string = 'US'): Promise<GoogleSearch[]> {
        const queryTerms: GoogleSearch[] = []
        this.bot.log(this.bot.isMobile, 'SEARCH-GOOGLE-TRENDS', `正在生成搜索查询，可能需要一些时间！ | 地理区域: ${geoLocale}`)

        try {
            const request: AxiosRequestConfig = {
                url: 'https://trends.google.com/_/TrendsUi/data/batchexecute',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                data: `f.req=[[[i0OFE,"["null", null, \"${geoLocale.toUpperCase()}\", 0, null, 48]"]]]`
            }

            const response = await this.bot.axios.request(request, this.bot.config.proxy.proxyGoogleTrends)
            const rawText = response.data

            const trendsData = this.extractJsonFromResponse(rawText)
            if (!trendsData) {
               throw  this.bot.log(this.bot.isMobile, 'SEARCH-GOOGLE-TRENDS', '解析谷歌趋势响应失败', 'error')
            }

            const mappedTrendsData = trendsData.map(query => [query[0], query[9]!.slice(1)])
            if (mappedTrendsData.length < 90) {
                this.bot.log(this.bot.isMobile, 'SEARCH-GOOGLE-TRENDS', '搜索查询不足，回退到美国地区', 'warn')
                return this.getGoogleTrends()
            }

            for (const [topic, relatedQueries] of mappedTrendsData) {
                queryTerms.push({
                    topic: topic as string,
                    related: relatedQueries as string[]
                })
            }

        } catch (error) {
            this.bot.log(this.bot.isMobile, 'SEARCH-GOOGLE-TRENDS', '发生错误:' + error, 'error')
        }

        return queryTerms
    }

    private extractJsonFromResponse(text: string): GoogleTrendsResponse[1] | null {
        const lines = text.split('\n')
        for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                    return JSON.parse(JSON.parse(trimmed)[0][2])[1]
                } catch {
                    continue
                }
            }
        }

        return null
    }

    private async getRelatedTerms(term: string): Promise<string[]> {
        try {
            const request = {
                url: `https://api.bing.com/osjson.aspx?query=${term}`,
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            }

            const response = await this.bot.axios.request(request, this.bot.config.proxy.proxyBingTerms)

            return response.data[1] as string[]
        } catch (error) {
            this.bot.log(this.bot.isMobile, 'SEARCH-BING-RELATED', '发生错误:' + error, 'error')
        }

        return []
    }

    private async randomScroll(page: Page) {
        try {
            const viewportHeight = await page.evaluate(() => window.innerHeight)
            const totalHeight = await page.evaluate(() => document.body.scrollHeight)
            const randomScrollPosition = Math.floor(Math.random() * (totalHeight - viewportHeight))

            await page.evaluate((scrollPos) => {
                window.scrollTo(0, scrollPos)
            }, randomScrollPosition)

        } catch (error) {
            this.bot.log(this.bot.isMobile, 'SEARCH-RANDOM-SCROLL', '发生错误:' + error, 'error')
        }
    }

    private async clickRandomLink(page: Page) {
        try {
            await page.click('#b_results .b_algo h2', { timeout: 2000 }).catch(() => { }) // Since we don't really care if it did it or not

            // Only used if the browser is not the edge browser (continue on Edge popup)
            await this.closeContinuePopup(page)

            // Stay for 10 seconds for page to load and "visit"
            await this.bot.utils.waitRandom(10000,20000)

            // Will get current tab if no new one is created, this will always be the visited site or the result page if it failed to click
            let lastTab = await this.bot.browser.utils.getLatestTab(page)

            let lastTabURL = new URL(lastTab.url()) // Get new tab info, this is the website we're visiting

            // Check if the URL is different from the original one, don't loop more than 5 times.
            let i = 0
            while (lastTabURL.href !== this.searchPageURL && i < 5) {

                await this.closeTabs(lastTab)

                // End of loop, refresh lastPage
                lastTab = await this.bot.browser.utils.getLatestTab(page) // Finally update the lastTab var again
                lastTabURL = new URL(lastTab.url()) // Get new tab info
                i++
            }

        } catch (error) {
            this.bot.log(this.bot.isMobile, 'SEARCH-RANDOM-CLICK', '发生错误:' + error, 'error')
        }
    }

    private async closeTabs(lastTab: Page) {
        const browser = lastTab.context()
        const tabs = browser.pages()

        try {
            if (tabs.length > 2) {
                // If more than 2 tabs are open, close the last tab

                await lastTab.close()
                this.bot.log(this.bot.isMobile, 'SEARCH-CLOSE-TABS', `打开的标签页超过2个，关闭了最后一个标签页: "${new URL(lastTab.url()).host}"`)

            } else if (tabs.length === 1) {
                // If only 1 tab is open, open a new one to search in

                const newPage = await browser.newPage()
                await this.bot.utils.waitRandom(1000,4000)

                await newPage.goto(this.bingHome)
                await this.bot.utils.waitRandom(3000,5000)
                this.searchPageURL = newPage.url()

                this.bot.log(this.bot.isMobile, 'SEARCH-CLOSE-TABS', '只打开了一个标签页，创建了一个新的')
            } else {
                // Else reset the last tab back to the search listing or Bing.com

                lastTab = await this.bot.browser.utils.getLatestTab(lastTab)
                await lastTab.goto(this.searchPageURL ? this.searchPageURL : this.bingHome)
            }

        } catch (error) {
            this.bot.log(this.bot.isMobile, 'SEARCH-CLOSE-TABS', '发生错误:' + error, 'error')
        }

    }

    private calculatePoints(counters: Counters) {
        const mobileData = counters.mobileSearch?.[0] // Mobile searches
        const genericData = counters.pcSearch?.[0] // Normal searches
        const edgeData = counters.pcSearch?.[1] // Edge searches

        const missingPoints = (this.bot.isMobile && mobileData)
            ? mobileData.pointProgressMax - mobileData.pointProgress
            : (edgeData ? edgeData.pointProgressMax - edgeData.pointProgress : 0)
            + (genericData ? genericData.pointProgressMax - genericData.pointProgress : 0)

        return missingPoints
    }

    private async closeContinuePopup(page: Page) {
        try {
            await page.waitForSelector('#sacs_close', { timeout: 1000 })
            const continueButton = await page.$('#sacs_close')

            if (continueButton) {
                await continueButton.click()
            }
        } catch (error) {
            // Continue if element is not found or other error occurs
        }
    }

}
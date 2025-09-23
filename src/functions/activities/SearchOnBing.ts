import { Page } from 'rebrowser-playwright'
import * as fs from 'fs'
import path from 'path'

import { Workers } from '../Workers'

import { MorePromotion, PromotionalItem } from '../../interface/DashboardData'


export class SearchOnBing extends Workers {

    async doSearchOnBing(page: Page, activity: MorePromotion | PromotionalItem) {
        this.bot.log(this.bot.isMobile, '必应搜索', '正在尝试完成必应搜索')

        try {
            await this.bot.utils.waitRandom(5000,9000, 'normal')

            await this.bot.browser.utils.tryDismissAllMessages(page)

            const query = await this.getSearchQuery(activity.title)

            const searchBar = '#sb_form_q'
            await page.waitForSelector(searchBar, { state: 'visible', timeout: 10000 })
            await this.safeClick(page, searchBar)
            await this.bot.utils.waitRandom(500,2000, 'normal')
            await page.keyboard.type(query)
            await page.keyboard.press('Enter')
            await this.bot.utils.waitRandom(3000,5000, 'normal')

            await page.close()

            this.bot.log(this.bot.isMobile, '必应搜索', '成功完成必应搜索')
        } catch (error) {
            await page.close()
            this.bot.log(this.bot.isMobile, 'SEARCH-ON-BING', 'An error occurred:' + error, 'error')
        }
    }

    private async safeClick(page: Page, selector: string) {
        try {
            await page.click(selector, { timeout: 5000 })
        } catch (e: any) {
            const msg = (e?.message || '')
            if (/Timeout.*click/i.test(msg) || /intercepts pointer events/i.test(msg)) {
                // Try to dismiss overlays then retry once
                await this.bot.browser.utils.tryDismissAllMessages(page)
                await this.bot.utils.wait(500)
                await page.click(selector, { timeout: 5000 })
            } else {
                throw e
            }
        }
    }

    private async getSearchQuery(title: string): Promise<string> {
        interface Queries {
            title: string;
            queries: string[]
        }

        let queries: Queries[] = []

        try {
            if (this.bot.config.searchOnBingLocalQueries) {
                const data = fs.readFileSync(path.join(__dirname, '../queries.json'), 'utf8')
                this.bot.log(this.bot.isMobile, '必应搜索', '获取本地queries.json')

                queries = JSON.parse(data)
            } else {
                // Fetch from the repo directly so the user doesn't need to redownload the script for the new activities
                const response = await this.bot.axios.request({
                    method: 'GET',
                    url: 'https://raw.githubusercontent.com/TheNetsky/Microsoft-Rewards-Script/refs/heads/main/src/functions/queries.json'
                })
                queries = response.data
                this.bot.log(this.bot.isMobile, '必应搜索', `获取在线queries.json： ${queries}`)

            }

            const answers = queries.find(x => this.normalizeString(x.title) === this.normalizeString(title))
            const answer = answers ? this.bot.utils.shuffleArray(answers?.queries)[0] as string : title

            this.bot.log(this.bot.isMobile, '必应搜索查询', `获取到的答案: ${answer} | 问题: ${title}`)
            return answer

        } catch (error) {
            this.bot.log(this.bot.isMobile, '必应搜索查询', '发生错误:' + error, 'error')
            return title
        }
    }

    private normalizeString(string: string): string {
        return string.normalize('NFD').trim().toLowerCase().replace(/[^\x20-\x7E]/g, '').replace(/[?!]/g, '')
    }
}
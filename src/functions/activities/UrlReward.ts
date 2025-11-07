import { Page } from 'rebrowser-playwright'

import { Workers } from '../Workers'


export class UrlReward extends Workers {

    async doUrlReward(page: Page) {
        this.bot.log(this.bot.isMobile, '网址奖励', '正在尝试完成网址奖励')
        const probability = this.bot.utils.randomNumber(1,100);
        //70%的几率随机运行
        if (this.bot.config.searchSettings.scrollRandomResults && probability <=70) {
            await this.bot.utils.waitRandom(2000,5000, 'normal')
            await this.randomScroll(page)
        }
        try {
            this.bot.utils.waitRandom(10000,18000, 'normal')

            await page.close()

            this.bot.log(this.bot.isMobile, '网址奖励', '成功完成网址奖励')
        } catch (error) {
            await page.close()
            this.bot.log(this.bot.isMobile, '网址奖励', '发生错误:' + error, 'error')
        }
    }
    /**
     * 在结果页面执行随机滚动操作
     * @param page - 结果页面的Page对象
     */
    private async randomScroll(page: Page) {
        try {
            const viewportHeight = await page.evaluate(() => window.innerHeight)
            const totalHeight = await page.evaluate(() => document.body.scrollHeight)
            const randomScrollPosition = this.bot.utils.randomNumber(0, totalHeight - viewportHeight, 'normal')

            await page.evaluate((scrollPos) => {
                window.scrollTo(0, scrollPos)
            }, randomScrollPosition)

        } catch (error) {
            this.bot.log(this.bot.isMobile, '随机滚动', '发生错误:' + error, 'error')
        }
    }

}
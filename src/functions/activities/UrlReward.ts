import { Page } from 'rebrowser-playwright'

import { Workers } from '../Workers'


export class UrlReward extends Workers {

    async doUrlReward(page: Page) {
        this.bot.log(this.bot.isMobile, '网址奖励', '正在尝试完成网址奖励')

        try {
            this.bot.utils.waitRandom(10000,18000)

            await page.close()

            this.bot.log(this.bot.isMobile, '网址奖励', '成功完成网址奖励')
        } catch (error) {
            await page.close()
            this.bot.log(this.bot.isMobile, '网址奖励', '发生错误:' + error, 'error')
        }
    }

}
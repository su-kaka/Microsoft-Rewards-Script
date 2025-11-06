import { Page } from 'rebrowser-playwright'

import { Workers } from '../Workers'
import { TIMEOUTS } from '../../constants'


export class Poll extends Workers {

    async doPoll(page: Page) {
        this.bot.log(this.bot.isMobile, '投票', '尝试完成投票')

        try {
            const buttonId = `#btoption${Math.floor(this.bot.utils.randomNumber(0, 1))}`

            await page.waitForSelector(buttonId, { state: 'visible', timeout: 10000 }).catch((e) => {
                this.bot.log(this.bot.isMobile, 'POLL', `Could not find poll button: ${e}`, 'warn')
            })
            await this.bot.utils.waitRandom(2000,5000)

            await page.click(buttonId)

            await this.bot.utils.waitRandom(4000,7000)
            await page.close()

            this.bot.log(this.bot.isMobile, '投票', '成功完成投票')
        } catch (error) {
            await page.close()
            this.bot.log(this.bot.isMobile, '投票', '发生错误:' + error, 'error')
        }
    }

}
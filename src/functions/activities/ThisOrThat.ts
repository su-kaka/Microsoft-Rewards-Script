import { Page } from 'rebrowser-playwright'

import { Workers } from '../Workers'
import { DELAYS } from '../../constants'


export class ThisOrThat extends Workers {

    async doThisOrThat(page: Page) {
        this.bot.log(this.bot.isMobile, '二选一测验', '正在尝试完成二选一测验')


        try {
            // 检查测验是否已经开始
            const quizNotStarted = await page.waitForSelector('#rqStartQuiz', { state: 'visible', timeout: DELAYS.THIS_OR_THAT_START }).then(() => true).catch(() => false)
            if (quizNotStarted) {
                await page.click('#rqStartQuiz')
            } else {
                this.bot.log(this.bot.isMobile, '二选一测验', '二选一测验已开始，正在尝试完成')
            }

            await this.bot.utils.waitRandom(2000,5000)

            // Solving
            const quizData = await this.bot.browser.func.getQuizData(page)
            const questionsRemaining = quizData.maxQuestions - (quizData.currentQuestionNumber - 1) // Amount of questions remaining

            for (let question = 0; question < questionsRemaining; question++) {
                // Since there's no solving logic yet, randomly guess to complete
                const buttonId = `#rqAnswerOption${Math.floor(this.bot.utils.randomNumber(0, 1))}`
                await page.click(buttonId)

                const refreshSuccess = await this.bot.browser.func.waitForQuizRefresh(page)
                if (!refreshSuccess) {
                    await page.close()
                    this.bot.log(this.bot.isMobile, '二选一测验', '发生错误，刷新失败', 'error')
                    return
                }
            }

            this.bot.log(this.bot.isMobile, '二选一测验', '成功完成二选一测验')
        } catch (error) {
            await page.close()
            this.bot.log(this.bot.isMobile, '二选一测验', '发生错误:' + error, 'error')
        }
    }

}
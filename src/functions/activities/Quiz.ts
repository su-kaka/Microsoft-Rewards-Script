import { Page } from 'rebrowser-playwright'

import { Workers } from '../Workers'


export class Quiz extends Workers {

    async doQuiz(page: Page) {
        this.bot.log(this.bot.isMobile, '测验', '尝试完成测验')

        try {
            // Check if the quiz has been started or not
            const quizNotStarted = await page.waitForSelector('#rqStartQuiz', { state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)
            if (quizNotStarted) {
                await page.click('#rqStartQuiz')
            } else {
                this.bot.log(this.bot.isMobile, '测验', '测验已开始，尝试完成它')
            }

            await this.bot.utils.waitRandom(2000,5000, 'normal')

            let quizData = await this.bot.browser.func.getQuizData(page)
            const questionsRemaining = quizData.maxQuestions - quizData.CorrectlyAnsweredQuestionCount // Amount of questions remaining

            // All questions
            for (let question = 0; question < questionsRemaining; question++) {

                if (quizData.numberOfOptions === 8) {
                    const answers: string[] = []

                    for (let i = 0; i < quizData.numberOfOptions; i++) {
                        const answerSelector = await page.waitForSelector(`#rqAnswerOption${i}`, { state: 'visible', timeout: 10000 })
                        const answerAttribute = await answerSelector?.evaluate((el: any) => el.getAttribute('iscorrectoption'))

                        if (answerAttribute && answerAttribute.toLowerCase() === 'true') {
                            answers.push(`#rqAnswerOption${i}`)
                        }
                    }

                    // Click the answers
                    for (const answer of answers) {
                        await page.waitForSelector(answer, { state: 'visible', timeout: 2000 })

                        // Click the answer on page
                        await page.click(answer)

                        const refreshSuccess = await this.bot.browser.func.waitForQuizRefresh(page)
                        if (!refreshSuccess) {
                            await page.close()
                            this.bot.log(this.bot.isMobile, '测验', '发生错误，刷新失败', 'error')
                            return
                        }
                    }

                    // Other type quiz, lightspeed
                } else if ([2, 3, 4].includes(quizData.numberOfOptions)) {
                    quizData = await this.bot.browser.func.getQuizData(page) // Refresh Quiz Data
                    const correctOption = quizData.correctAnswer

                    for (let i = 0; i < quizData.numberOfOptions; i++) {

                        const answerSelector = await page.waitForSelector(`#rqAnswerOption${i}`, { state: 'visible', timeout: 10000 })
                        const dataOption = await answerSelector?.evaluate((el: any) => el.getAttribute('data-option'))

                        if (dataOption === correctOption) {
                            // Click the answer on page
                            await page.click(`#rqAnswerOption${i}`)

                            const refreshSuccess = await this.bot.browser.func.waitForQuizRefresh(page)
                            if (!refreshSuccess) {
                                await page.close()
                                this.bot.log(this.bot.isMobile, '测验', '发生错误，刷新失败', 'error')
                                return
                            }
                        }
                    }
                    await this.bot.utils.waitRandom(2000,5000, 'normal')
                }
            }

            // Done with
            await this.bot.utils.waitRandom(2000,5000, 'normal')
            await page.close()

            this.bot.log(this.bot.isMobile, '测验', '成功完成测验')
        } catch (error) {
            await page.close()
            this.bot.log(this.bot.isMobile, '测验', '发生错误:' + error, 'error')
        }
    }

}
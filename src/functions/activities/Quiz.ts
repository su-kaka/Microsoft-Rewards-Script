import { Page } from 'rebrowser-playwright'

import { Workers } from '../Workers'
import { RETRY_LIMITS, TIMEOUTS, DELAYS } from '../../constants'


export class Quiz extends Workers {

    async doQuiz(page: Page) {
        this.bot.log(this.bot.isMobile, '测验', '尝试完成测验')

        try {
            // 检查测验是否已经开始
            const quizNotStarted = await page.waitForSelector('#rqStartQuiz', { state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)
            if (quizNotStarted) {
                await page.click('#rqStartQuiz')
            } else {
                this.bot.log(this.bot.isMobile, '测验', '测验已开始，尝试完成它')
            }

            await this.bot.utils.waitRandom(2000,5000, 'normal')

            let quizData = await this.bot.browser.func.getQuizData(page)
             // 继续之前验证测验确实已加载
            const firstOptionExists = await page.waitForSelector('#rqAnswerOption0', { state: 'attached', timeout: TIMEOUTS.VERY_LONG }).then(() => true).catch(() => false)
            if (!firstOptionExists) {
                this.bot.log(this.bot.isMobile, 'QUIZ', '未找到测验选项 - 页面可能未正确加载。跳过。', 'warn')
                await page.close()
                return
            }
            const questionsRemaining = quizData.maxQuestions - quizData.CorrectlyAnsweredQuestionCount // 剩余问题数量

            // 所有问题
            for (let question = 0; question < questionsRemaining; question++) {

                if (quizData.numberOfOptions === 8) {
                    const answers: string[] = []

                    for (let i = 0; i < quizData.numberOfOptions; i++) {
                        const answerSelector = await page.waitForSelector(`#rqAnswerOption${i}`, { state: 'visible', timeout: TIMEOUTS.DASHBOARD_WAIT }).catch(() => null)
                        
                        if (!answerSelector) {
                            this.bot.log(this.bot.isMobile, 'QUIZ', `未找到选项 ${i} - 测验结构可能已更改。跳过剩余选项。`, 'warn')
                            break
                        }
                        
                        const answerAttribute = await answerSelector?.evaluate((el: Element) => el.getAttribute('iscorrectoption'))

                        if (answerAttribute && answerAttribute.toLowerCase() === 'true') {
                            answers.push(`#rqAnswerOption${i}`)
                        }
                    }
                    
                    // 如果未找到正确答案，跳过此问题
                    if (answers.length === 0) {
                        this.bot.log(this.bot.isMobile, 'QUIZ', '8选项测验未找到正确答案。跳过。', 'warn')
                        await page.close()
                        return
                    }

                    // 点击答案
                    for (const answer of answers) {
                        await page.waitForSelector(answer, { state: 'visible', timeout: DELAYS.QUIZ_ANSWER_WAIT })

                        // 在页面上点击答案
                        await page.click(answer)

                        const refreshSuccess = await this.bot.browser.func.waitForQuizRefresh(page)
                        if (!refreshSuccess) {
                            await page.close()
                            this.bot.log(this.bot.isMobile, '测验', '发生错误，刷新失败', 'error')
                            return
                        }
                    }

                    // 其他类型测验，快速完成
                } else if ([2, 3, 4].includes(quizData.numberOfOptions)) {
                    quizData = await this.bot.browser.func.getQuizData(page) // 刷新测验数据
                    const correctOption = quizData.correctAnswer
                    
                    let answerClicked = false

                    for (let i = 0; i < quizData.numberOfOptions; i++) {

                        const answerSelector = await page.waitForSelector(`#rqAnswerOption${i}`, { state: 'visible', timeout: RETRY_LIMITS.QUIZ_ANSWER_TIMEOUT }).catch(() => null)
                        
                        if (!answerSelector) {
                            this.bot.log(this.bot.isMobile, 'QUIZ', `${quizData.numberOfOptions}-选项测验未找到选项 ${i}。跳过。`, 'warn')
                            continue
                        }
                        
                        const dataOption = await answerSelector?.evaluate((el: Element) => el.getAttribute('data-option'))

                        if (dataOption === correctOption) {
                            // 在页面上点击答案
                            await page.click(`#rqAnswerOption${i}`)
                            answerClicked = true

                            const refreshSuccess = await this.bot.browser.func.waitForQuizRefresh(page)
                            if (!refreshSuccess) {
                                await page.close()
                                this.bot.log(this.bot.isMobile, '测验', '发生错误，刷新失败', 'error')
                                return
                            }
                            break
                        }
                    }
                    
                    if (!answerClicked) {
                        this.bot.log(this.bot.isMobile, '测验', `无法找到 ${quizData.numberOfOptions}-选项测验的正确答案。跳过。`, 'warn')
                        await page.close()
                        return
                    }
                    
                    await this.bot.utils.wait(DELAYS.QUIZ_ANSWER_WAIT)
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
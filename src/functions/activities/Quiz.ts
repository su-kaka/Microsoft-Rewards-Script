import { Page } from 'rebrowser-playwright'

import { Workers } from '../Workers'
import { RETRY_LIMITS, TIMEOUTS, DELAYS } from '../../constants'


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
             // Verify quiz is actually loaded before proceeding
            const firstOptionExists = await page.waitForSelector('#rqAnswerOption0', { state: 'attached', timeout: TIMEOUTS.VERY_LONG }).then(() => true).catch(() => false)
            if (!firstOptionExists) {
                this.bot.log(this.bot.isMobile, 'QUIZ', 'Quiz options not found - page may not have loaded correctly. Skipping.', 'warn')
                await page.close()
                return
            }
            const questionsRemaining = quizData.maxQuestions - quizData.CorrectlyAnsweredQuestionCount // Amount of questions remaining

            // All questions
            for (let question = 0; question < questionsRemaining; question++) {

                if (quizData.numberOfOptions === 8) {
                    const answers: string[] = []

                    for (let i = 0; i < quizData.numberOfOptions; i++) {
                        const answerSelector = await page.waitForSelector(`#rqAnswerOption${i}`, { state: 'visible', timeout: TIMEOUTS.DASHBOARD_WAIT }).catch(() => null)
                        
                        if (!answerSelector) {
                            this.bot.log(this.bot.isMobile, 'QUIZ', `Option ${i} not found - quiz structure may have changed. Skipping remaining options.`, 'warn')
                            break
                        }
                        
                        const answerAttribute = await answerSelector?.evaluate((el: Element) => el.getAttribute('iscorrectoption'))

                        if (answerAttribute && answerAttribute.toLowerCase() === 'true') {
                            answers.push(`#rqAnswerOption${i}`)
                        }
                    }
                    
                    // If no correct answers found, skip this question
                    if (answers.length === 0) {
                        this.bot.log(this.bot.isMobile, 'QUIZ', 'No correct answers found for 8-option quiz. Skipping.', 'warn')
                        await page.close()
                        return
                    }

                    // Click the answers
                    for (const answer of answers) {
                        await page.waitForSelector(answer, { state: 'visible', timeout: DELAYS.QUIZ_ANSWER_WAIT })

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
                    
                    let answerClicked = false

                    for (let i = 0; i < quizData.numberOfOptions; i++) {

                        const answerSelector = await page.waitForSelector(`#rqAnswerOption${i}`, { state: 'visible', timeout: RETRY_LIMITS.QUIZ_ANSWER_TIMEOUT }).catch(() => null)
                        
                        if (!answerSelector) {
                            this.bot.log(this.bot.isMobile, 'QUIZ', `Option ${i} not found for ${quizData.numberOfOptions}-option quiz. Skipping.`, 'warn')
                            continue
                        }
                        
                        const dataOption = await answerSelector?.evaluate((el: Element) => el.getAttribute('data-option'))

                        if (dataOption === correctOption) {
                            // Click the answer on page
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
                        this.bot.log(this.bot.isMobile, '测验', `Could not find correct answer for ${quizData.numberOfOptions}-option quiz. Skipping.`, 'warn')
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
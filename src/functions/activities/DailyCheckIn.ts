import { randomBytes } from 'crypto'
import { AxiosRequestConfig } from 'axios'

import { Workers } from '../Workers'

import { DashboardData } from '../../interface/DashboardData'


export class DailyCheckIn extends Workers {
    public async doDailyCheckIn(accessToken: string, data: DashboardData) {
        this.bot.log(this.bot.isMobile, '每日签到', '开始每日签到')

        try {
            let geoLocale = data.userProfile.attributes.country
            geoLocale = (this.bot.config.searchSettings.useGeoLocaleQueries && geoLocale.length === 2) ? geoLocale.toLowerCase() : 'cn'
            if (this.bot.config.searchSettings.useLocale != ""){
                geoLocale = this.bot.config.searchSettings.useLocale.toLowerCase()
            }
            this.bot.log(this.bot.isMobile, '每日签到', '地区:' + geoLocale)
            const jsonData = {
                amount: 1,
                country: geoLocale,
                id: randomBytes(64).toString('hex'),
                type: 101,
                attributes: {
                    offerid: 'Gamification_Sapphire_DailyCheckIn'
                }
            }

            const claimRequest: AxiosRequestConfig = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Rewards-Country': geoLocale,
                    'X-Rewards-Language': 'en'
                },
                data: JSON.stringify(jsonData)
            }

            const claimResponse = await this.bot.axios.request(claimRequest)
            const claimedPoint = parseInt((await claimResponse.data).response?.activity?.p) ?? 0

            this.bot.log(this.bot.isMobile, '每日签到', claimedPoint > 0 ? `已领取 ${claimedPoint} 积分` : '今日已领取')
        } catch (error) {
            this.bot.log(this.bot.isMobile, '每日签到', '发生错误:' + error, 'error')
        }
    }

}
var search_words = []; //搜索词
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

/**
 * 尝试从多个搜索词来源获取搜索词，如果所有来源都失败，则返回默认搜索词。
 * @returns {Promise<string[]>} 返回搜索到的name属性值列表或默认搜索词列表
 */
export async function hot_dic() {
    while (current_source_index < keywords_source.length) {
        const source = keywords_source[current_source_index]; // 获取当前搜索词来源
        // const source = random_keywords_source; // 获取当前搜索词来源
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

            if (data.data.some(item => item)) {
                // 如果数据中存在有效项
                // 提取每个元素的title属性值
                const names = data.data.map(item => item.title);
                return names; // 返回搜索到的title属性值列表
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
    return default_search_words; // 返回默认搜索词列表
}


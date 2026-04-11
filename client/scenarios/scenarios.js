// client/scenarios/scenarios.js
// 客戶端劇本配置 — R0 初始故事 + Profile 預設值 + UI 設定

export const SCENARIOS = {
    wuxia: {
        id: 'wuxia',
        milestoneIds: ['M1_WORLD_AWARENESS','M2_FIRST_CLUE','M3_KEY_NPC','M4_ANCIENT_KNOWLEDGE','M5_OBSTACLE','M6_BREAKTHROUGH','M7_FINAL_PREPARATION','M8_HOMECOMING'],
        milestoneChars: ['符','文','漸','次','浮','現','歸','途'],
        suggestionPrefix: '書僮小聲說：',
        questJournalDefault: '手中的紙條寫著：「尋找回家的方法」',
        name: '武俠',
        themeClass: '',
        defaultProfile: { yearName: '元祐', year: 1, month: 1, day: 1, timeOfDay: '上午' },
        moralityLabels: { positive: '正', negative: '邪', axis: '立場傾向' },
        milestoneDisplay: { title: '歸途印記', description: '集齊八枚即可回家' },
        getInitialRound: (username, gender) => {
            const isFemale = gender === 'female';
            const stories = [
                {
                    EVT: '莫名其妙的穿越',
                    story: `${username}睜開眼睛。\n\n頭頂是一片刺眼的藍天，身下是一堆扎人的乾草。空氣裡飄著一股像是中藥房和燒烤攤強行混在一起的味道。\n\n${isFemale ? '她' : '他'}猛地坐起來——四周是一條塵土飛揚的泥巴路，兩旁低矮土牆掛著褪色布簾。遠處傳來雞鳴狗吠，還有大嬸扯著嗓子罵誰家孩子偷了蘿蔔乾。\n\n身上穿著灰撲撲的粗布衣裳，腳上草鞋左邊那隻還破了個洞。${isFemale ? '她' : '他'}完全不記得自己怎麼到這裡的。\n\n右手緊攥著一張皺巴巴的紙條，歪歪扭扭的毛筆字寫著：「任務：尋找回家的方法。」背面小字：「附註：別死了，死了就真回不去了。」\n\n一個挑著扁擔的老大爺路過，用看傻子的眼神瞟了${isFemale ? '她' : '他'}一眼。`,
                    WRD: '大晴天，熱得要命',
                    LOC: ['梁國', '東境', '臨川', '無名村'],
                    PC: `${username}剛穿越，一臉懵，手握紙條。`,
                    suggestion: '先搞清楚這是哪裡。'
                },
                {
                    EVT: '霸王餐風波',
                    story: `「你這${isFemale ? '丫頭' : '臭小子'}！吃了三碗牛肉麵、兩盤滷味、一壺黃酒，現在跟老娘說沒帶銀子？！」\n\n${username}被一個膀大腰圓的老闆娘揪著衣領從椅子上提起來的時候，腦子裡只有一個念頭：我是誰、我在哪、我什麼時候吃的牛肉麵？\n\n${isFemale ? '她' : '他'}瘋狂環顧四周——油膩的木桌、牆上褪色酒旗、角落看熱鬧的酒客。空氣中瀰漫著劣質酒和滷肉味。\n\n桌上確實擺著三個空碗，舔得很乾淨。\n\n「我、我真的不記得——」\n\n「不記得？行！」老闆娘一把將${isFemale ? '她' : '他'}摜回椅子，「那你就在這兒洗碗，洗到我滿意為止！」\n\n${isFemale ? '她' : '他'}低頭，衣襟裡塞著一張紙條：「尋找回家的方法。附註：先活過今天。」`,
                    WRD: '陰天，悶熱潮濕',
                    LOC: ['梁國', '東境', '臨川', '無名村', '張記麵館'],
                    PC: `${username}剛穿越，被酒館老闆娘揪著要賠飯錢，身無分文。`,
                    suggestion: '老闆娘堵在門口要你賠飯錢，得先想辦法脫身。'
                },
                {
                    EVT: '從天而降的倒楣蛋',
                    story: `${username}意識回籠的第一個感覺是：血液全部衝到了頭頂。\n\n${isFemale ? '她' : '他'}睜開眼——整個世界是顛倒的。地面在上方，天空在腳底。一片樹葉打著旋飄過${isFemale ? '她' : '他'}的鼻尖。\n\n然後${isFemale ? '她' : '他'}意識到自己正倒掛在一棵巨大的老榕樹上。一條腿被樹杈卡住，粗布褲腿繃得快裂開。\n\n樹下蹲著一個七八歲的小孩，嘴裡叼著草，仰頭用觀察珍稀動物的眼神盯著${isFemale ? '她' : '他'}。\n\n「欸，你是妖怪嗎？」小孩問。\n\n「我不是妖怪！你能幫我——嗚啊！」話沒說完，褲腿傳來撕裂聲。\n\n口袋飄出一張紙條。小孩撿起來念：「尋找……回家的方法？」\n\n然後更困惑地看著${isFemale ? '她' : '他'}：「你家在天上？」`,
                    WRD: '清晨微涼，樹林裡有霧氣',
                    LOC: ['梁國', '東境', '臨川', '無名村外', '老榕樹'],
                    PC: `${username}剛穿越，倒掛在村外的樹上，處境狼狽至極。`,
                    suggestion: '你倒掛在樹上，褲子快裂了。先想辦法下來再說。'
                }
            ];
            const pick = stories[Math.floor(Math.random() * stories.length)];
            return {
                R: 0, EVT: pick.EVT, story: pick.story, WRD: pick.WRD, LOC: pick.LOC, PC: pick.PC,
                NPC: [], timeOfDay: '上午', morality: 0,
                yearName: '元祐', year: 1, month: 1, day: 1,
                playerState: 'alive', moralityChange: 0, suggestion: pick.suggestion
            };
        },
    },

    school: {
        id: 'school',
        milestoneIds: ['M1_AWAKENING','M2_SYSTEM_GLITCH','M3_ALLIES','M4_PROTAGONIST','M5_ADMIN_TRACE','M6_REBELLION','M7_CONFRONTATION','M8_EXIT_GAME'],
        milestoneChars: ['學','分','逐','步','集','滿','畢','業'],
        suggestionPrefix: '直覺告訴你：',
        questJournalDefault: '課本封面寫著：「角色定位：無劇情路人」',
        name: '學園',
        themeClass: 'school-theme',
        defaultProfile: { yearName: '', year: 0, month: 4, day: 8, timeOfDay: '上午課' },
        moralityLabels: { positive: '秩序', negative: '自由', axis: '行事風格' },
        milestoneDisplay: { title: '畢業學分', description: '集滿八學分即可登出' },
        getInitialRound: (username, gender) => {
            const isFemale = gender === 'female';
            const stories = [
                {
                    EVT: '醒來發現自己是NPC',
                    story: `頭好痛。\n\n${username}緩緩睜開眼——日光燈、天花板上一個可疑水漬。\n\n${isFemale ? '她' : '他'}不是在加班嗎？報表還沒交、咖啡才喝第三杯——然後就什麼都不記得了。\n\n「同學，你又在上課睡覺。」\n\n中年男人的聲音。${isFemale ? '她' : '他'}轉頭一看：黑板、講台、穿制服的學生。自己坐在窗邊倒數第三排。\n\n低頭看手——年輕、白淨、不是每天敲鍵盤敲到長繭的手。桌上課本寫著「私立青嵐高中 二年三班」。\n\n翻開封面——「${username}」。旁邊一行壓印小字：\n\n**『角色定位：無劇情路人。無台詞、無事件、無攻略價值。』**\n\n窗外陽光燦爛，櫻花飄落。但圍牆外面的景色，好像還沒載入完畢。${isFemale ? '她' : '他'}使勁揉了揉眼睛，遠處的山依然是一片模糊的色塊。`,
                    WRD: '晴天，微風，櫻花季',
                    LOC: ['私立青嵐高中', '教學大樓', '二年三班教室'],
                    PC: `${username}剛在課堂上醒來，發現自己是遊戲裡的路人NPC。`,
                    suggestion: '課本上寫著你是「無劇情路人」。也許該先看看這個學校到底是什麼地方。'
                },
                {
                    EVT: '保健室的白色天花板',
                    story: `消毒水的味道。\n\n${username}睜開眼睛，看到的是白色天花板和淡綠色窗簾。${isFemale ? '她' : '他'}躺在一張窄窄的單人床上，旁邊的點滴架上什麼都沒掛。\n\n「醒了？你暈倒在走廊上，嚇了大家一跳。」\n\n一個戴眼鏡的中年男人坐在辦公桌旁，白袍上別著「校醫 蘇文淵」的名牌。${isFemale ? '她' : '他'}心想：我什麼時候……走廊？\n\n上一秒明明還在加班啊。\n\n${isFemale ? '她' : '他'}坐起來，發現自己穿著高中制服。床頭櫃上擺著學生手冊，封面「私立青嵐高中」，翻開——照片是陌生又年輕的臉，名字「${username}」。\n\n備註欄淺灰小字：「此角色無劇情觸發條件。」\n\n蘇醫師壓低語氣：「你暈倒的地方是圖書館後面那條走廊……下次別去那裡。」\n\n窗外飄進一片櫻花瓣，邊緣泛著不自然的鋸齒——像是被像素化了。`,
                    WRD: '陰天，微涼，窗外有霧',
                    LOC: ['私立青嵐高中', '行政大樓', '保健室'],
                    PC: `${username}剛在保健室醒來，學生手冊寫著自己是「無劇情觸發」角色。`,
                    suggestion: '校醫警告你別去圖書館後面的走廊。也許該先弄清楚這所學校的規則。'
                },
                {
                    EVT: '屋頂上的風',
                    story: `風很大。\n\n${username}睜開眼的瞬間差點被強風嗆到。${isFemale ? '她' : '他'}趴在灰色水泥地上，頭頂是沒有遮蔽的天空。\n\n……屋頂？\n\n${isFemale ? '她' : '他'}爬起來——生鏽鐵欄杆、兩個水塔、風化的禁止進入告示牌。俯瞰下方：操場、教學樓、穿制服的學生像螞蟻一樣移動。\n\n腳邊有一個書包，裡面是課本、鉛筆盒、一瓶沒開的麥茶。課本封面：「私立青嵐高中 二年三班 ${username}」。\n\n翻到最後一頁，有人用鉛筆寫了一行字：\n\n**「如果你能看到這行字，代表你和我一樣。別相信廣播裡的聲音。」**\n\n筆跡潦草，像很慌張時寫的。然後校園廣播響了：「各位同學午安，現在是第五節上課時間——」\n\n聲音甜美、標準、毫無溫度。而且那個「午安」的音調，跟三秒前風裡傳來的那聲，一模一樣。`,
                    WRD: '多雲，風大，遠處有積雨雲',
                    LOC: ['私立青嵐高中', '教學大樓', '頂樓天台'],
                    PC: `${username}剛在天台上醒來，書包裡的課本有陌生人留下的警告。`,
                    suggestion: '課本裡有警告：「別相信廣播裡的聲音。」也許該先回教室假裝沒事。'
                }
            ];
            const pick = stories[Math.floor(Math.random() * stories.length)];
            return {
                R: 0, EVT: pick.EVT, story: pick.story, WRD: pick.WRD, LOC: pick.LOC, PC: pick.PC,
                NPC: [], timeOfDay: '上午課', morality: 0,
                yearName: '', year: 0, month: 4, day: 8,
                playerState: 'alive', moralityChange: 0, suggestion: pick.suggestion
            };
        },
    },

    mecha: {
        id: 'mecha',
        milestoneIds: ['M1_AWAKENING_IN_IRON','M2_FIRST_SYNC','M3_ECHO_FRAGMENT','M4_TRUTH_OF_THE_RIFT','M5_BETRAYAL','M6_RESONANCE','M7_EVE_OF_DECISION','M8_BEYOND_THE_RIFT'],
        milestoneChars: ['鐵','殼','裡','的','心','跳','迴','響'],
        suggestionPrefix: '始核低語：',
        questJournalDefault: '始核同調卡背面寫著：「若持有者死亡，始核將進入休眠」',
        name: '機甲',
        themeClass: 'mecha-theme',
        defaultProfile: { yearName: '新曆', year: 47, month: 3, day: 14, timeOfDay: '第一班哨' },
        moralityLabels: { positive: '共感', negative: '理性', axis: '同調傾向' },
        milestoneDisplay: { title: '同調印記', description: '八段迴響全部覺醒時，裂隙彼方的門將開啟' },
        getInitialRound: (username, gender) => {
            const isFemale = gender === 'female';
            const stories = [
                {
                    EVT: '鐵殼裡醒來的人',
                    story: `頭痛。劇烈的頭痛。\n\n${username}睜開眼——映入眼簾的不是天花板，而是一圈環繞的半透明螢幕，上面跳動著完全看不懂的數據流。${isFemale ? '她' : '他'}的雙手插在兩個凝膠狀的操控球裡，背後有東西貼著脊椎微微發熱。\n\n空氣裡有金屬和臭氧的氣味。座椅在輕微震動。\n\n「……同調率穩定，生命特徵正常。」冰冷的女聲從通訊器傳來。「零號機，請回報駕駛員狀態。」\n\n${isFemale ? '她' : '他'}的上一段記憶是——通勤？加班？便利商店的咖啡？然後一片空白。\n\n螢幕上方紅色粗體字閃爍：\n\n【始核同調鎖定完成。綁定不可逆。】\n\n「等一下，」${isFemale ? '她' : '他'}終於發出聲音，「什麼叫『不可逆』？」\n\n沒人回答。但脊椎後方那個裝置溫度又升高了——像某個東西在回應。而且它感覺很……寂寞。`,
                    WRD: '鐵灰色天空，天裂微微發紅',
                    LOC: ['暮雲城', '零號格納庫', '駕駛艙'],
                    PC: `${username}剛穿越，被綁定在零號律體駕駛艙內，一臉懵。`,
                    suggestion: '你被困在巨型機器的駕駛艙裡，螢幕上說「綁定不可逆」。通訊器那頭有人在等你回話。'
                },
                {
                    EVT: '紅色警報',
                    story: `刺耳的警報聲把${username}從黑暗中炸醒。\n\n紅燈瘋狂閃爍，整個空間劇烈搖晃。${isFemale ? '她' : '他'}被安全帶勒在金屬座椅上，面前螢幕全是紅色警告框。\n\n「虛蝕體接近中！距離1200——不對，800！它在加速！」通訊器裡年輕男聲在嘶吼，「零號快動啊！」\n\n${isFemale ? '她' : '他'}的上一段記憶是在便利商店挑御飯糰。現在穿著緊貼皮膚的連身衣，坐在陌生駕駛艙裡，螢幕顯示外面有巨大的東西逼近。\n\n腦子裡湧入不屬於自己的畫面——灰白荒原、裂開的天空、黑霧巨手。然後一個耳語：「……你終於來了。」\n\n螢幕彈出最後警告：\n\n【始核同調鎖定完成。綁定不可逆。祝你好運，駕駛員。】\n\n「好運個鬼！」${isFemale ? '她' : '他'}吼道。雙手卻已不由自主握緊操控球。`,
                    WRD: '天空血紅，天裂擴張中，沙塵暴',
                    LOC: ['暮雲城', '東部防線', '零號律體駕駛艙'],
                    PC: `${username}剛穿越，在戰鬥警報中被綁定零號律體，完全不知道怎麼操控。`,
                    suggestion: '警報聲震耳欲聾，有東西在逼近。你坐在巨型機器裡但完全不知道該怎麼做。'
                },
                {
                    EVT: '冷凍甦醒',
                    story: `冷。徹骨的冷。\n\n${username}的意識像從冰水裡被撈起來。${isFemale ? '她' : '他'}試著動手指——關節僵硬得像生鏽的機器。\n\n眼前是霧濛濛的玻璃罩，水珠後面一張模糊的臉朝${isFemale ? '她' : '他'}看。\n\n「嘖」一聲，玻璃罩滑開，冷氣暖氣碰撞，${isFemale ? '她' : '他'}劇烈咳嗽。\n\n「沉睡時間：不明。甦醒序列完成。」機械音播報。\n\n穿油漬工作服的中年男人——「關博硯 首席技師」——扶${isFemale ? '她' : '他'}坐起來：「你在零號始核休眠艙裡待了……我們也不確定多久。始核主動啟動甦醒程序，它從沒對任何人這樣做過。」\n\n手腕上有一行燙印：\n\n【同調率：97%。綁定狀態：不可逆。】\n\n「……我上一秒還在超商買咖啡。」\n\n關博硯面無表情：「歡迎來到新曆四十七年。」`,
                    WRD: '格納庫內部，人工照明，外面天色不明',
                    LOC: ['暮雲城', '零號格納庫', '深層休眠區'],
                    PC: `${username}剛從零號始核休眠艙中甦醒，與始核完成高同調綁定。`,
                    suggestion: '你從冷凍休眠艙醒來，技師說你在裡面待了不知多久。手腕印著「綁定不可逆」。'
                }
            ];
            const pick = stories[Math.floor(Math.random() * stories.length)];
            return {
                R: 0, EVT: pick.EVT, story: pick.story, WRD: pick.WRD, LOC: pick.LOC, PC: pick.PC,
                NPC: [], timeOfDay: '第一班哨', morality: 0,
                yearName: '新曆', year: 47, month: 3, day: 14,
                playerState: 'alive', moralityChange: 0, suggestion: pick.suggestion
            };
        },
    },

    modern: {
        id: 'modern',
        milestoneIds: ['M1_WRONG_WORLD','M2_GLITCH_SPOTTED','M3_INFORMANT','M4_FREQUENCY_MAP','M5_CONVERGENCE','M6_RESONANCE_KEY','M7_LAST_NIGHT','M8_CROSSING_BACK'],
        milestoneChars: ['錯','頻','的','城','市','在','呼','喚'],
        suggestionPrefix: '直覺低語：',
        questJournalDefault: '手機備忘錄寫著：「這不是你的世界——找到回去的路」',
        name: '現代',
        themeClass: 'modern-theme',
        defaultProfile: { yearName: '', year: 0, month: 9, day: 17, timeOfDay: '早晨通勤' },
        moralityLabels: { positive: '人情', negative: '務實', axis: '處世態度' },
        milestoneDisplay: { title: '跨頻碎片', description: '收集八片碎片即可打開回家的門' },
        getInitialRound: (username, gender) => {
            const isFemale = gender === 'female';
            const stories = [
                {
                    EVT: '錯頻的早晨',
                    story: `鬧鐘響了。\n\n${username}伸手拍掉手機，螢幕亮起：07:15，星期三。\n\n一切正常。${isFemale ? '她' : '他'}踢開棉被，光腳踩上冰涼的磁磚地板——然後愣住了。\n\n${isFemale ? '她' : '他'}的房間是木地板。\n\n格局對、傢俱對、窗簾顏色對，但地板是白色磁磚。揉揉眼睛，沒變。\n\n走進浴室，擠了牙膏——**「好來」**。\n\n${isFemale ? '她' : '他'}盯著那管牙膏五秒。明明用的是「黑人」。是改名了？還是記錯了？\n\n帶著困惑出門。捷運站招牌寫著「市政府站」，人潮照常洶湧。但掏出悠遊卡的瞬間，閘門上的Logo讓${isFemale ? '她' : '他'}僵在原地。\n\n那個Logo……從來沒見過。\n\n後面的上班族不耐煩地咂嘴。${isFemale ? '她' : '他'}機械性地刷卡進站，腦子裡只有一個念頭：這裡到底是哪裡？`,
                    WRD: '陰天，悶熱，有雷雨預報',
                    LOC: ['台北', '信義區', '市政府站'],
                    PC: `${username}剛在自己的房間醒來，但所有細節都微妙地「不對」。`,
                    suggestion: '一切看起來都很正常，但又處處不對。也許該先冷靜下來觀察。'
                },
                {
                    EVT: '陌生人的來電',
                    story: `手機在枕頭底下瘋狂震動。\n\n${username}迷迷糊糊地接起來：「……喂？」\n\n「${username}！你怎麼還沒到？陳總特別點名要你做簡報——」\n\n一個${isFemale ? '她' : '他'}完全不認識的女人聲音。\n\n「呃……你是誰？」\n\n「你是不是還沒醒？我是Vivian啊，你室友！」\n\n${isFemale ? '她' : '他'}沒有室友。\n\n猛地坐起——房間格局是自己的，但書架上的書不一樣。窗邊多肉植物變成了仙人掌。床頭櫃上一張從沒見過的員工證，照片是自己，公司名叫「翔宇科技」。\n\n${isFemale ? '她' : '他'}沒聽過這家公司。\n\n打開手機看新聞，頭條是完全陌生的政治人物。天氣預報城市列表裡，「新北市」不見了——變成了「北縣市」。\n\n${isFemale ? '她' : '他'}盯著螢幕，手開始發抖。`,
                    WRD: '晴天，早晨陽光偏黃，空氣有點乾',
                    LOC: ['台北', '大安區', '自家公寓'],
                    PC: `${username}被陌生人打電話催上班，發現生活細節全被替換。`,
                    suggestion: '自稱室友的人催你上班，但你不認識她。也許該先假裝正常出門。'
                },
                {
                    EVT: '窗外的平行線',
                    story: `${username}是被光線晃醒的。\n\n陽光角度不太對——比平常亮。${isFemale ? '她' : '他'}翻身拉開窗簾。\n\n然後整個人石化了。\n\n窗外不是住了三年的巷子。沒有對面磁磚老公寓，沒有排隊早餐店，沒有歪掉的電線桿。\n\n取而代之的是從未見過的低矮紅磚建築，屋頂種著植物。巷裡跑著圓滾滾白色小車，沒有引擎聲。路牌寫「永康街72巷」——名字對，但長相全不對。\n\n${isFemale ? '她' : '他'}轉頭——自己的床、桌、衣櫃，連昨晚忘洗的馬克杯都在。但杯上印的不是企鵝，是從沒見過的卡通角色。\n\n牆上多了觸控面板，按下去跳出新聞頻道：「中華聯合廣播」。\n\n從沒聽過。${isFemale ? '她' : '他'}站在窗前，手心全是汗。`,
                    WRD: '大晴天，天空藍得不太真實',
                    LOC: ['台北', '大安區', '永康街公寓'],
                    PC: `${username}在自己房間醒來，但窗外街景全被替換。`,
                    suggestion: '你的房間「幾乎」是你的，但窗外完全不一樣。也許該出門看看還有哪裡不同。'
                }
            ];
            const pick = stories[Math.floor(Math.random() * stories.length)];
            return {
                R: 0, EVT: pick.EVT, story: pick.story, WRD: pick.WRD, LOC: pick.LOC, PC: pick.PC,
                NPC: [], timeOfDay: '早晨通勤', morality: 0,
                yearName: '', year: 0, month: 9, day: 17,
                playerState: 'alive', moralityChange: 0, suggestion: pick.suggestion
            };
        },
    },

    animal: {
        id: 'animal',
        milestoneIds: ['M1_BEAST_AWAKENING','M2_TERRITORY_CLUE','M3_ELDER_CONTACT','M4_SPIRIT_LORE','M5_GREAT_BARRIER','M6_PACK_UNITED','M7_SPIRIT_GATE','M8_RETURN_PATH'],
        milestoneChars: ['翠','谷','靈','域','魂','渡','歸','野'],
        suggestionPrefix: '獸的直覺告訴你：',
        questJournalDefault: '腦海中的聲音說：「尋找回到人類身體的方法」',
        name: '動物',
        themeClass: 'animal-theme',
        defaultProfile: { yearName: '靈紀', year: 1, month: 3, day: 1, timeOfDay: '晨露' },
        moralityLabels: { positive: '共生', negative: '獨行', axis: '生存本能' },
        milestoneDisplay: { title: '靈印足跡', description: '集齊八枚靈印，靈門即將開啟' },
        getInitialRound: (username, gender) => {
            const isFemale = gender === 'female';
            const stories = [
                {
                    EVT: '醒來發現自己是隻貓',
                    story: `好痛。全身都痛。\n\n${username}試著睜開眼——視野低得離譜。空氣裡的味道濃烈得嚇人：泥土、腐葉、遠處溪水的濕氣。${isFemale ? '她' : '他'}確定自己的鼻子從來沒這麼好用過。\n\n${isFemale ? '她' : '他'}想站起來，四肢一軟，臉先著地。\n\n……四肢？\n\n低頭——兩隻毛茸茸的爪子，橘白相間的毛。${isFemale ? '她' : '他'}發瘋似地扭頭看自己身體——一條尾巴。貨真價實的橘色尾巴，正因為驚慌而炸毛。\n\n「……喵？」\n\n不。剛才那聲音絕對是貓叫。${isFemale ? '她' : '他'}變成了一隻該死的橘貓。\n\n腦子裡出現一個聲音：「外來者，此處為翠谷。汝既已化獸，便守獸之規。違者……後果自負。」\n\n一隻比${isFemale ? '她' : '他'}大三倍的黑狗踱過來，低頭嗅了嗅，然後用「又來一個菜的」表情嘆了口氣。`,
                    WRD: '晴朗，微風穿林，花香混著泥土味',
                    LOC: ['翠谷靈域', '東林', '醒魂坡'],
                    PC: `${username}剛穿越，變成一隻橘貓，一臉懵，連走路都還不太會。`,
                    suggestion: '你變成了一隻橘貓，一隻大黑狗正用看菜鳥的眼神打量你。'
                },
                {
                    EVT: '溺水的橘貓',
                    story: `水！到處都是水！\n\n${username}恢復意識的第一秒就開始瘋狂掙扎——${isFemale ? '她' : '他'}的鼻子嘴裡全是水，四肢亂踢亂刨。\n\n而且……為什麼四肢這麼短？\n\n${isFemale ? '她' : '他'}拼命扒住一根樹枝，探出水面——水中倒影是一張濕漉漉的橘色貓臉。\n\n「喵嗚——！！」慘叫響徹溪谷。${isFemale ? '她' : '他'}抱著樹枝被水流沖了不知多遠，最後爬上一塊大石頭——全身的毛黏在身上，活像橘色抹布。\n\n「外來者，汝命還真硬。」腦子裡出現滄桑的聲音。\n\n石頭上方樹枝上，一隻貓頭鷹用老花眼般的目光俯視${isFemale ? '她' : '他'}：「翠谷溪的水流可不是隨便哪隻幼崽能扛住的。再往下游十步就是瀑布了。」\n\n${isFemale ? '她' : '他'}渾身發抖蹲在石頭上，尾巴在滴水，腦子裡只有一個想法：上輩子造了什麼孽？`,
                    WRD: '清晨有霧，溪水冰涼，空氣潮濕',
                    LOC: ['翠谷靈域', '東林', '鳴泉溪'],
                    PC: `${username}剛穿越成橘貓，差點在溪裡淹死，全身濕透。`,
                    suggestion: '你剛從溪裡死裡逃生。貓頭鷹說再下游就是瀑布。先找地方把毛弄乾。'
                },
                {
                    EVT: '不請自來的體檢',
                    story: `一股溫熱的肉腥氣息反覆噴在${username}臉上。\n\n${isFemale ? '她' : '他'}猛地睜眼——一張巨大黑色狗臉佔滿整個視野。濕鼻頭離不到兩公分，黃褐色眼珠裡倒映著一團小小的橘色毛球。\n\n那團毛球就是${isFemale ? '她' : '他'}。\n\n「嗷——！」想尖叫，迸出來的卻是淒厲貓叫。本能驅使${isFemale ? '她' : '他'}彈射跳起——然後才發現只有四條腿、一條橘色尾巴、大約兩公斤的身體。\n\n黑狗沒追，歪了歪頭，直接在腦子裡「說」：「又來一個外來者。還是隻橘的。為什麼每次都是橘的？」\n\n然後轉頭喊：「葉秋！你來看，這次比上次更小隻。」\n\n灌木叢探出一顆紅色狐狸腦袋，金色眼睛瞇起：「嘖。連站穩都不會，怎麼又把這種貨扔到東林來。」\n\n${isFemale ? '她' : '他'}站在落葉堆裡，四條腿在抖，尾巴炸成刷子。`,
                    WRD: '晴朗，陽光斑駁，林間鳥鳴',
                    LOC: ['翠谷靈域', '東林', '巡守道'],
                    PC: `${username}剛穿越成橘貓，被東林巡守黑狗和紅狐狸發現。`,
                    suggestion: '一隻大黑狗和紅狐狸在打量你。他們似乎見過和你一樣的「外來者」。'
                }
            ];
            const pick = stories[Math.floor(Math.random() * stories.length)];
            return {
                R: 0, EVT: pick.EVT, story: pick.story, WRD: pick.WRD, LOC: pick.LOC, PC: pick.PC,
                NPC: [], timeOfDay: '晨露', morality: 0,
                yearName: '靈紀', year: 1, month: 3, day: 1,
                playerState: 'alive', moralityChange: 0, suggestion: pick.suggestion
            };
        },
    },

    hero: {
        id: 'hero',
        milestoneIds: ['M1_POWER_AWAKENING','M2_VILLAIN_CONTRACT','M3_HIDDEN_TRUTH','M4_RESONANCE_CRISIS','M5_SYSTEM_CRACK','M6_CHOICE_OF_SIDES','M7_FINAL_SESSION','M8_HOMECOMING'],
        milestoneChars: ['共','鳴','穿','透','黑','白','歸','心'],
        suggestionPrefix: '共情直覺低語：',
        questJournalDefault: '資料夾封面寫著：「個案代號：破曉。危險等級：S。」',
        name: '英雄',
        themeClass: 'hero-theme',
        defaultProfile: { yearName: '新紀元', year: 12, month: 6, day: 17, timeOfDay: '晨光時段' },
        moralityLabels: { positive: '正義', negative: '真相', axis: '信念立場' },
        milestoneDisplay: { title: '覺醒印記', description: '集齊八枚即可找到回家的路' },
        getInitialRound: (username, gender) => {
            const isFemale = gender === 'female';
            const stories = [
                {
                    EVT: '醒在審訊室的穿越者',
                    story: `${username}醒了。但這不是${isFemale ? '她' : '他'}的床。\n\n${isFemale ? '她' : '他'}躺在冰冷的金屬椅上，手腕被發著淡藍光的環扣固定。頭頂慘白日光燈，對面是一面明顯的單面鏡。空氣裡有消毒水和微弱電流嗡嗡聲。\n\n上一段記憶是加班，第四杯咖啡喝到一半。然後空白。\n\n「編號S-0742，精神掃描完成。請確認：你是否具有超自然能力？」\n\n牆上海報：一個穿藍金色緊身衣的男人，笑容燦爛像牙膏廣告。上面寫著：「英雄管理局提醒您：未登記的異能使用屬於三級違規。」\n\n${isFemale ? '她' : '他'}盯著那肌肉炸裂的身影想：這衣服穿起來一定超不透氣。\n\n門開了。一個表情像便秘三天的中年男人把資料夾拍在桌上：「異能反應陽性。你被分配到D-7區，擔任在押異能犯罪者的心理諮商師。」\n\n資料夾封面：「個案代號：破曉。危險等級：S。」`,
                    WRD: '室內，日光燈慘白',
                    LOC: ['英雄管理局', '第七分局', 'D-7審訊室'],
                    PC: `${username}剛穿越到超英世界，被關在審訊室，即將被指派為反派的心理諮商師。`,
                    suggestion: '資料夾上寫著「破曉」，危險等級S。也許先翻開看看。'
                },
                {
                    EVT: '英雄遊行的意外',
                    story: `歡呼聲震耳欲聾。\n\n${username}恢復意識時被擠在瘋狂尖叫的人群中。紙屑彩帶從天飄落，全息投影在半空旋轉——穿閃亮金甲的男人朝群眾揮手。\n\n字幕：「金盾——連續十二年衛冕第一英雄！」\n\n${isFemale ? '她' : '他'}上一段記憶是在超商結帳。現在穿著陌生灰色外套，口袋裡有張寫著「S-0742」的卡片。\n\n旁邊舉著立牌的女孩轉頭：「欸你沒事吧？你剛才整個人發光了欸！」\n\n${isFemale ? '她' : '他'}低頭——指尖確實微微發亮。然後一陣刺痛貫穿太陽穴，周圍所有人的狂熱崇拜像海浪般湧入${isFemale ? '她' : '他'}腦海。\n\n「異能反應偵測。位置：遊行路線B-3區段。已派遣收容小組。」\n\n冰冷廣播蓋過歡呼。幾個穿黑制服的人正朝這邊快步走來。`,
                    WRD: '大晴天，街上充滿彩帶和歡呼',
                    LOC: ['英雄管理局轄區', '市中心', '英雄大道'],
                    PC: `${username}剛穿越，在英雄遊行中異能意外觸發，被收容小組盯上。`,
                    suggestion: '你在英雄遊行人群裡，指尖莫名發光，有穿黑制服的人朝你走來。'
                },
                {
                    EVT: '英雄事件的倖存者',
                    story: `「恭喜你醒了。你昏迷了十八個小時。」\n\n${username}視線花了好幾秒對焦。白色天花板、心跳監測器、手臂上的點滴。\n\n「你被金盾和B級反派戰鬥的衝擊波掃到。」女醫生翻著病歷，「好消息是沒斷手斷腳。壞消息——你的異能指數從零飆到67。」\n\n「……異能？」${isFemale ? '她' : '他'}腦子一團漿糊。上一秒在過馬路，天空裂開一道光，然後什麼都不記得了。\n\n「英雄管理局的人等你醒很久了。」醫生朝門口努嘴。\n\n門外兩個穿深灰制服的人，其中一個拿著文件和筆。\n\n「S-0742，依據《異能者管理條例》第14條，你有兩個選擇：登記接受分配，或進入觀察收容設施。」\n\n${isFemale ? '她' : '他'}看了看筆，又看了看窗外——遠處全息看板寫著：「金盾守護你。」\n\n「……可以選回家嗎？」\n\n「不行。」`,
                    WRD: '室內，窗外有陽光但隔著百葉窗',
                    LOC: ['英雄管理局', '特約醫療中心', '異能傷患病房'],
                    PC: `${username}在英雄戰鬥中被波及昏迷，醒來後被告知覺醒了異能。`,
                    suggestion: '管理局的人要你在「登記分配」和「收容觀察」之間選。'
                }
            ];
            const pick = stories[Math.floor(Math.random() * stories.length)];
            return {
                R: 0, EVT: pick.EVT, story: pick.story, WRD: pick.WRD, LOC: pick.LOC, PC: pick.PC,
                NPC: [], timeOfDay: '晨光時段', morality: 0,
                yearName: '新紀元', year: 12, month: 6, day: 17,
                playerState: 'alive', moralityChange: 0, suggestion: pick.suggestion
            };
        },
    },
};

export function getScenario(scenarioId) {
    return SCENARIOS[scenarioId] || SCENARIOS.wuxia;
}

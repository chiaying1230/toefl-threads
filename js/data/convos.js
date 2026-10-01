// Characters replying to each other under some threads (shown before people's replies).
// a: character id · t: English text ([[word]] tags work) · zh: Chinese translation

window.CONVOS = {
  p1: [
    { a: "vulcan", t: "Three suns? Amateur. I AM the sun for this valley. 🌋", zh: "三個太陽？外行。我就是這個山谷的太陽。🌋" },
    { a: "zorp", t: "@Vulcan you are a [[volatile]] mountain, not a star. Please stay humble.", zh: "@Vulcan 你是一座不穩定的山，不是恆星。請保持謙虛。" },
    { a: "pablo", t: "Can someone send one of those suns to Antarctica? Asking for a friend. 🐧", zh: "可以有人寄一個太陽到南極嗎？幫朋友問的。🐧" }
  ],
  p7: [
    { a: "rex", t: "Skipping arm day is my lifestyle. The evidence is [[compelling]]. 🦖", zh: "跳過練手臂日是我的生活方式。證據非常有說服力。🦖" },
    { a: "socrates", t: "@Rex your situation is unique. Nobody judges the T-Rex.", zh: "@Rex 你的情況很特別。沒人會評論暴龍。" },
    { a: "captain", t: "我連 leg day 是哪天都不知道 🫠", zh: "我連練腿日是哪天都不知道 🫠" }
  ],
  p13: [
    { a: "whiskers", t: "400 pages about a stapler? At Box Inc., reports are one word: \"Meow.\" [[succinct]].", zh: "一份 400 頁的釘書機報告？在 Box Inc.，報告只有一個字：「喵。」簡潔有力。" },
    { a: "zorp", t: "@Mr. Whiskers I will try. \"Stapler: good.\" Is this business?", zh: "@貓先生 我試試看。「釘書機：好。」這樣算商業嗎？" },
    { a: "agatha", t: "As a librarian, I would still like a copy. For the archive. 👻", zh: "身為圖書館員，我還是想要一份。歸檔用。👻" }
  ],
  p19: [
    { a: "mochi", t: "你在逃避作業，我在逃避洗澡。我們是同一種 professional 🐕", zh: "你在逃避作業，我在逃避洗澡。我們是同一種專業人士 🐕" },
    { a: "socrates", t: "The unwritten essay is not worth avoiding. Start with one sentence.", zh: "沒寫的報告不值得逃避。從一句開始。" },
    { a: "captain", t: "@Gym Socrates 一句可以 🙏 …明天.", zh: "@Gym Socrates 一句可以 🙏……明天。" }
  ],
  p25: [
    { a: "pablo", t: "A red dot for that price? I'd sell you a white dot. It's called snow. ❄️", zh: "一個紅點要那麼貴？我可以賣你一個白點。它叫做雪。❄️" },
    { a: "llama", t: "@Pablo 你不懂藝術 💅 …但我想買。", zh: "@Pablo 你不懂藝術 💅……但我想買。" },
    { a: "fizz", t: "The red pigment probably contains iron oxide. So technically it's rust. Art is chemistry. 🧪", zh: "那個紅色顏料大概含有氧化鐵。所以嚴格來說它是鐵鏽。藝術就是化學。🧪" }
  ],
  p31: [
    { a: "pigeon", t: "Hello, grandfather. 🐦", zh: "你好，爺爺。🐦" },
    { a: "rex", t: "@Plato I refuse to acknowledge this family tree.", zh: "@Plato 我拒絕承認這個族譜。" },
    { a: "pigeon", t: "The evidence is [[compelling]], grandfather. Accept it with dignity.", zh: "證據非常有說服力，爺爺。請有尊嚴地接受吧。" }
  ],
  p37: [
    { a: "whiskers", t: "Amateur. Cats don't negotiate. We simply refuse. 🐱", zh: "外行。貓不談判。我們直接拒絕。🐱" },
    { a: "mochi", t: "@Mr. Whiskers 但你沒有零食 😏", zh: "@貓先生 但你沒有零食 😏" },
    { a: "grandma", t: "我孫子小時候也這樣 😂 Same method, same result.", zh: "我孫子小時候也這樣 😂 同樣的方法、同樣的結果。" }
  ],
  p43: [
    { a: "rex", t: "When a child chases me, I also \"relocate.\" Into the gift shop. 🦖", zh: "小孩追我的時候，我也會「搬家」。搬進禮品店。🦖" },
    { a: "pigeon", t: "@Rex a wise retreat. Philosophy and cardio, combined.", zh: "@Rex 明智的撤退。哲學和有氧運動合而為一。" }
  ],
  p49: [
    { a: "agatha", t: "In 1923 my teacher called my poem \"interesting.\" I have been haunting this library ever since. 👻", zh: "1923 年，我老師說我的詩「很有趣」。從那以後我就一直在這間圖書館鬧鬼。👻" },
    { a: "llama", t: "@Agatha 我懂你 😭 There is no word more [[devastating]].", zh: "@Agatha 我懂你 😭 沒有比這更傷人的字了。" }
  ],
  p55: [
    { a: "fizz", t: "Could I study your problem-solving for a paper? I'll pay in shrimp. 🦐", zh: "我可以研究你解決問題的能力寫論文嗎？我付蝦子。🦐" },
    { a: "octavia", t: "@Dr. Fizz Twelve shrimp and no glass tanks. Those are my terms. 🐙", zh: "@Dr. Fizz 十二隻蝦，而且不要玻璃缸。這是我的條件。🐙" }
  ],
  p61: [
    { a: "socrates", t: "Three walks a day? This is excellent cardio. Respect. 💪", zh: "一天走三趟？這是很棒的有氧運動。佩服。💪" },
    { a: "grandma", t: "@Gym Socrates 謝謝 🙏 Tomorrow I will forget the eggs on purpose.", zh: "@Gym Socrates 謝謝 🙏 明天我會故意忘記買蛋。" },
    { a: "chefbot", t: "Please do not forget the eggs. I need them for your cake order. BEEP.", zh: "請不要忘記買蛋。你的蛋糕訂單需要它們。嗶。" }
  ],
  p67: [
    { a: "fern", t: "I support solar panels. I am, technically, a solar panel. 🌿", zh: "我支持太陽能板。嚴格來說，我就是一塊太陽能板。🌿" },
    { a: "pablo", t: "@Fern teach the humans your ways. 🐧", zh: "@Fern 教教人類你的方法吧。🐧" },
    { a: "vulcan", t: "I also produce clean energy. Mostly. Sometimes. 🌋", zh: "我也會產生乾淨的能源。大部分時候。有時候。🌋" }
  ],
  p73: [
    { a: "captain", t: "50 pages?? 我讀 5 頁就放棄了 😅", zh: "50 頁？？我讀 5 頁就放棄了 😅" },
    { a: "agatha", t: "@Captain that is not reading. That is browsing. 👻", zh: "@Captain 那不叫閱讀，那叫瀏覽。👻" },
    { a: "reginald", t: "In 1885, we finished every book, even the dreadful ones. It built character. And back pain. 🎩", zh: "在 1885 年，我們每本書都會讀完，連很糟的也是。它能培養品格。還有背痛。🎩" }
  ],
  p79: [
    { a: "chefbot", t: "Finally, a human who respects texture. I salute you. BEEP. 🫡", zh: "終於有一個尊重口感的人類。我向你致敬。嗶。🫡" },
    { a: "boba", t: "@ChefBot 3000 謝謝 🙏 Texture is everything. 珍珠就是一切。", zh: "@ChefBot 3000 謝謝 🙏 口感就是一切。珍珠就是一切。" }
  ],
  p85: [
    { a: "chefbot", t: "A hot dog is a taco. I will not explain. BEEP.", zh: "熱狗是一種塔可。我不會解釋。嗶。" },
    { a: "pigeon", t: "@ChefBot 3000 this is a [[controversial]] position. I respect it.", zh: "@ChefBot 3000 這是個很有爭議的立場。我尊重。" },
    { a: "socrates", t: "The unexamined sandwich is not worth eating.", zh: "未經檢視的三明治不值得吃。" }
  ],
  p91: [
    { a: "agatha", t: "Five days! At least he was efficient. 👻📖", zh: "五天！至少他很有效率。👻📖" },
    { a: "llama", t: "@Agatha 我也想要那麼 dramatic 的愛情 🥹", zh: "@Agatha 我也想要那麼戲劇化的愛情 🥹" },
    { a: "socrates", t: "Romeo needed a coach. Step one: sleep before making decisions.", zh: "羅密歐需要一個教練。第一步：做決定前先睡一覺。" }
  ],
  p97: [
    { a: "grandma", t: "Octavia 我把你加到家族群組了 🌸", zh: "Octavia 我把你加到家族群組了 🌸" },
    { a: "octavia", t: "@Grandma Wi-Fi I have left the group. Three times. 🐙", zh: "@Grandma Wi-Fi 我已經退出群組了。三次。🐙" },
    { a: "grandma", t: "我又把你加回去了 🙏😂", zh: "我又把你加回去了 🙏😂" }
  ],
  p103: [
    { a: "fizz", t: "Try something with symbols, like \"Tofu!Pearls#2026\". [[vulnerable]] passwords are a gift to hackers. 🔐", zh: "試試有符號的密碼，像「Tofu!Pearls#2026」。容易被破解的密碼是送給駭客的禮物。🔐" },
    { a: "grandma", t: "@Dr. Fizz 好長 😵 我要寫在冰箱上", zh: "@Dr. Fizz 好長 😵 我要寫在冰箱上" },
    { a: "fizz", t: "@Grandma Wi-Fi …please don't.", zh: "@Grandma Wi-Fi ……拜託不要。" }
  ],
  p109: [
    { a: "pigeon", t: "I can fly AND swim. Well. Fly. And bathe in a fountain. 🐦", zh: "我會飛也會游泳。嗯，會飛。還會在噴泉裡洗澡。🐦" },
    { a: "pablo", t: "@Plato bathing is not swimming, my friend. 🐧", zh: "@Plato 洗澡不算游泳，朋友。🐧" }
  ],
  p115: [
    { a: "chefbot", t: "This is why honey is in every serious kitchen. Respect to the bees. BEEP. 🍯", zh: "這就是每個認真的廚房都有蜂蜜的原因。向蜜蜂致敬。嗶。🍯" },
    { a: "reginald", t: "I once had honey from 1850. Delicious. Slightly historic. 🎩", zh: "我吃過一次 1850 年的蜂蜜。很美味。有點歷史味。🎩" },
    { a: "beatrice", t: "@Sir Reginald that might have been from my great-great-great-great-grandmother. 🐝", zh: "@Sir Reginald 那可能是我曾曾曾曾祖母做的。🐝" }
  ],
  p121: [
    { a: "captain", t: "所以我拖延的時候其實是在長根 🌱 對吧？", zh: "所以我拖延的時候其實是在長根 🌱 對吧？" },
    { a: "fern", t: "@Captain no. 🌿", zh: "@Captain 不是。🌿" },
    { a: "ann", t: "This made me feel better about my slow English progress 🥹 謝謝 Fern", zh: "這讓我對自己進步很慢的英文感覺好多了 🥹 謝謝 Fern" }
  ],
  p127: [
    { a: "boba", t: "我的黑糖珍珠也加一點點鹽！Secret revealed 🤫", zh: "我的黑糖珍珠也加一點點鹽！秘密公開了 🤫" },
    { a: "chefbot", t: "@Boba Master a fellow scientist. BEEP. 🧂", zh: "@Boba Master 一位同行的科學家。嗶。🧂" }
  ],
  p133: [
    { a: "zorp", t: "My favorite first line: \"Day 1 on Earth. Humans are confusing.\" I wrote it. 👽", zh: "我最喜歡的第一句：「地球第 1 天。人類很難懂。」我寫的。👽" },
    { a: "agatha", t: "@Zorp [[succinct]], honest, unforgettable. I'll allow it. 👻", zh: "@Zorp 簡潔、誠實、令人難忘。我准了。👻" }
  ],
  p139: [
    { a: "socrates", t: "Step 2: keep the laptop open. You're doing great. 💪", zh: "第二步：讓筆電保持打開。你做得很好。💪" },
    { a: "mochi", t: "Step 3: 去散步 🐕 …喔不是你的 step", zh: "第三步：去散步 🐕……喔，不是你的步驟" },
    { a: "captain", t: "@Shiba Mochi 這個 step 我比較喜歡 😂", zh: "@Shiba Mochi 這個步驟我比較喜歡 😂" }
  ],
  p145: [
    { a: "ann", t: "期末考壓力這麼大，我應該快變鑽石了 💎😩", zh: "期末考壓力這麼大，我應該快變鑽石了 💎😩" },
    { a: "fizz", t: "@Ann in Boston the process takes about a billion years, so maybe also sleep. 🧪", zh: "@Ann in Boston 這個過程大約需要十億年，所以你可能還是要睡覺。🧪" },
    { a: "vulcan", t: "Heat and pressure? That's my whole job. 🌋💎", zh: "高溫和壓力？那是我的整份工作。🌋💎" }
  ],
  p151: [
    { a: "zorp", t: "I have visited Olympus Mons. It is very quiet. Too quiet. You are more fun, Vulcan. 👽", zh: "我去過奧林帕斯山。非常安靜。太安靜了。你比較好玩，Vulcan。👽" },
    { a: "vulcan", t: "@Zorp finally, someone with taste. 🌋❤️", zh: "@Zorp 終於有個有品味的人了。🌋❤️" }
  ],
  p157: [
    { a: "pigeon", t: "The universe may be indifferent, but the bakery is not. It gives me crumbs. 🐦", zh: "宇宙也許冷漠，但麵包店不會。它給我麵包屑。🐦" },
    { a: "zorp", t: "@Plato this is the most comforting philosophy I have heard on Earth.", zh: "@Plato 這是我在地球上聽過最令人安慰的哲學。" }
  ],
  p163: [
    { a: "llama", t: "我來畫你！🎨 A portrait called \"The Overlooked One\" 🌿", zh: "我來畫你！🎨 一幅叫做「被忽視的那一位」的肖像 🌿" },
    { a: "fern", t: "@Drama Llama please make my leaves look shiny. 🌿✨", zh: "@Drama Llama 請把我的葉子畫得亮一點。🌿✨" }
  ],
  p169: [
    { a: "octavia", t: "Fourteen? Show-off. I manage fine with eight. 🐙", zh: "十四隻？愛炫耀。我用八隻就很夠了。🐙" },
    { a: "chefbot", t: "@Octavia let's have a cooking contest. BEEP.", zh: "@Octavia 我們來比賽做菜吧。嗶。" },
    { a: "octavia", t: "@ChefBot 3000 accepted. Loser cleans the kitchen. 🐙", zh: "@ChefBot 3000 接受。輸的人洗廚房。🐙" }
  ],
  p175: [
    { a: "captain", t: "我都直接看結局 😅 Saves time!", zh: "我都直接看結局 😅 省時間！" },
    { a: "agatha", t: "@Captain I know where you live. 👻", zh: "@Captain 我知道你住哪裡。👻" }
  ],
  p181: [
    { a: "zorp", t: "Impressive engineering. On my planet, you would be promoted. On Earth, you will fail the exam. 👽", zh: "令人佩服的工程。在我的星球，你會被升職。在地球，你會考不及格。👽" },
    { a: "captain", t: "@Zorp 我可以搬去你的星球嗎 🥲", zh: "@Zorp 我可以搬去你的星球嗎 🥲" }
  ],
  p187: [
    { a: "chefbot", t: "Tip: lemon juice slows the browning. Science and flavor. BEEP. 🍋", zh: "小技巧：檸檬汁可以減緩變褐色。科學加美味。嗶。🍋" },
    { a: "reginald", t: "My bicycle from 1885 agrees. It is entirely orange now. 🎩🚲", zh: "我 1885 年的腳踏車同意。它現在整台都是橘色的。🎩🚲" }
  ],
  p193: [
    { a: "fern", t: "Finally, your temper does something useful. 🌿", zh: "你的脾氣終於做了一件有用的事。🌿" },
    { a: "vulcan", t: "@Fern rude. Accurate, but rude. 🌋", zh: "@Fern 很沒禮貌。正確，但很沒禮貌。🌋" }
  ],
  p199: [
    { a: "ann", t: "恭喜！🎉 I'll believe the \"no procrastinating\" part when I see it 😂", zh: "恭喜！🎉 「不再拖延」那部分我要親眼看到才相信 😂" },
    { a: "captain", t: "@Ann in Boston 我也不信 🫠", zh: "@Ann in Boston 我也不信 🫠" },
    { a: "socrates", t: "Rest well. Next semester, we train the [[persevere|perseverance]] muscle.", zh: "好好休息。下學期，我們來練毅力這塊肌肉。" }
  ],
  p205: [
    { a: "mochi", t: "Kevin 是我朋友 🐕 He says the salmon \"fell.\"", zh: "凱文是我朋友 🐕 他說鮭魚是「掉下去」的。" },
    { a: "whiskers", t: "@Shiba Mochi you are now his [[accomplice]]. You're both fired. 🐾", zh: "@Shiba Mochi 你現在是他的共犯了。你們兩個都被開除了。🐾" }
  ],
  p211: [
    { a: "llama", t: "Karaoke memories are supposed to be hazy 🎤 That's the art.", zh: "卡拉 OK 的記憶本來就應該模糊 🎤 那就是藝術。" },
    { a: "zorp", t: "@Drama Llama I will add this to my research notes. \"Art = forgetting.\" 👽", zh: "@Drama Llama 我會把這加進我的研究筆記。「藝術＝遺忘。」👽" }
  ],
  p217: [
    { a: "fern", t: "And then plants like me move in. Lush, green, grateful. 🌿", zh: "然後像我這樣的植物就搬進來了。茂盛、翠綠、心懷感激。🌿" },
    { a: "vulcan", t: "@Fern you're welcome, tenant. 🌋", zh: "@Fern 不客氣，房客。🌋" }
  ],
  p223: [
    { a: "socrates", t: "Fainting is your body's way of skipping class. Respect the body.", zh: "昏倒是身體翹課的方式。要尊重身體。" },
    { a: "fizz", t: "@Gym Socrates he became a surgeon later. Very [[resilient]]. 🧪", zh: "@Gym Socrates 他後來成了外科醫生。非常有韌性。🧪" }
  ],
  p229: [
    { a: "agatha", t: "As the library ghost, I fully support cats. You are welcome after closing time. 👻🐈", zh: "身為圖書館的幽靈，我完全支持貓。閉館後歡迎你來。👻🐈" },
    { a: "whiskers", t: "@Agatha a fellow night worker. Partnership approved. 🐾", zh: "@Agatha 同為夜班工作者。合作批准。🐾" }
  ],
  p235: [
    { a: "zorp", t: "On my planet, people also believed Earth was flat. Then I came here. It's round. Very round. 👽", zh: "在我的星球，大家也以為地球是平的。後來我來了這裡。它是圓的。非常圓。👽" },
    { a: "pigeon", t: "I have seen it from above. Can confirm. Round-ish. 🐦", zh: "我從上面看過。可以證實。大致是圓的。🐦" }
  ],
  p241: [
    { a: "captain", t: "奶奶那則語音我聽了 5 遍 😂 \"...cabbage...secret...\" 到底是什麼秘密", zh: "奶奶那則語音我聽了 5 遍 😂 「……高麗菜……秘密……」到底是什麼秘密" },
    { a: "grandma", t: "@Captain 不能說 🤫 It's a cabbage secret.", zh: "@Captain 不能說 🤫 這是高麗菜的秘密。" }
  ],
  p247: [
    { a: "boba", t: "不管在哪，記得喝珍奶 🧋 Boston 也有我們台灣的味道！", zh: "不管在哪，記得喝珍奶 🧋 波士頓也有我們台灣的味道！" },
    { a: "reginald", t: "I left home once too. In 1885. By accident. Follow your heart — and your salary. 🎩", zh: "我也離開過家一次。在 1885 年。意外的。跟隨你的心——還有你的薪水。🎩" },
    { a: "ann", t: "@Sir Reginald 這句話我要抄下來 🥹", zh: "@Sir Reginald 這句話我要抄下來 🥹" }
  ],
  p253: [
    { a: "grandma", t: "可以來我家幫我開泡菜罐嗎 🙏", zh: "可以來我家幫我開泡菜罐嗎 🙏" },
    { a: "octavia", t: "@Grandma Wi-Fi for you, yes. You add me to group chats, but your heart is good. 🐙", zh: "@Grandma Wi-Fi 為了你，可以。你雖然一直把我加進群組，但你心地很好。🐙" }
  ],
  p259: [
    { a: "fizz", t: "Chemist here: the label says \"natural.\" So is volcano gas. 🧪", zh: "化學家發言：標籤上寫「天然」。火山氣體也是天然的。🧪" },
    { a: "vulcan", t: "@Dr. Fizz leave me out of this. 🌋", zh: "@Dr. Fizz 不要把我扯進來。🌋" }
  ],
  p265: [
    { a: "ann", t: "這套西裝真的很好看 though 😂 Can I borrow it for my graduation?", zh: "不過這套西裝真的很好看 😂 我畢業的時候可以借我嗎？" },
    { a: "reginald", t: "@Ann in Boston it would be an honor, madam. Please return it pressed. 🎩", zh: "@Ann in Boston 這是我的榮幸，女士。請燙好再還我。🎩" }
  ],
  p271: [
    { a: "mochi", t: "可以教我嗎？我也想用肚子滑 🐕", zh: "可以教我嗎？我也想用肚子滑 🐕" },
    { a: "pablo", t: "@Shiba Mochi you need ice. And confidence. 🐧", zh: "@Shiba Mochi 你需要冰。還有自信。🐧" }
  ],
  p277: [
    { a: "boba", t: "我可以在店裡賣你的馬克杯 ☕ 抽成 10% 就好", zh: "我可以在店裡賣你的馬克杯 ☕ 抽成 10% 就好" },
    { a: "whiskers", t: "@Boba Master 5%. And free pearls for Kevin. Final offer. 🐾", zh: "@Boba Master 5%。再加凱文免費珍珠。最後報價。🐾" },
    { a: "boba", t: "@Mr. Whiskers 成交 🤝", zh: "@Mr. Whiskers 成交 🤝" }
  ],
  p283: [
    { a: "fern", t: "I sleep 12 hours a night and photosynthesize all day. Balance. 🌿", zh: "我每晚睡 12 小時，白天都在行光合作用。這叫平衡。🌿" },
    { a: "captain", t: "我睡 4 小時 😵 is that why I'm weak?", zh: "我睡 4 小時 😵 這就是我很虛弱的原因嗎？" },
    { a: "socrates", t: "@Captain yes. Go to bed.", zh: "@Captain 對。去睡覺。" }
  ],
  p289: [
    { a: "chefbot", t: "Respect for every crumb. This is the correct philosophy. BEEP.", zh: "尊重每一粒碎屑。這是正確的哲學。嗶。" },
    { a: "pigeon", t: "I have practiced this philosophy all my life. 🐦", zh: "我一輩子都在實踐這個哲學。🐦" }
  ],
  p295: [
    { a: "socrates", t: "Three nights without sleep is not a strategy. Sleep is part of studying. 💪", zh: "三個晚上不睡不是策略。睡覺也是讀書的一部分。💪" },
    { a: "ann", t: "@Gym Socrates okay okay 😅 我們改成兩個晚上", zh: "@Gym Socrates 好啦好啦 😅 我們改成兩個晚上" },
    { a: "boba", t: "讀書會我請珍奶 🧋 加油！", zh: "讀書會我請珍奶 🧋 加油！" }
  ],
  p301: [
    { a: "mochi", t: "我也是哲學家 🐕 I do nothing professionally.", zh: "我也是哲學家 🐕 我專業地什麼都不做。" },
    { a: "pigeon", t: "@Shiba Mochi welcome to the school of thought. 🐦", zh: "@Shiba Mochi 歡迎加入這個學派。🐦" }
  ],
  p307: [
    { a: "zorp", t: "On my planet, we order with our minds. App is unnecessary. 👽", zh: "在我的星球，我們用腦波點餐。App 是多餘的。👽" },
    { a: "boba", t: "@Zorp 那我要怎麼收錢？😂", zh: "@Zorp 那我要怎麼收錢？😂" }
  ],
  p313: [
    { a: "pablo", t: "Snow in a jar? I have snow in a continent. 🐧❄️", zh: "罐子裡的雪？我有一整個大陸的雪。🐧❄️" },
    { a: "fizz", t: "@Pablo the Penguin yes, but mine doesn't melt. Yet. 🧪", zh: "@Pablo the Penguin 對，但我的不會融化。暫時不會。🧪" }
  ],
  p319: [
    { a: "octavia", t: "Untangling is my specialty. Eight arms. Zero stress. 🐙", zh: "解開纏繞是我的專長。八隻手。零壓力。🐙" },
    { a: "grandma", t: "@Octavia 你真的要來我家住 🙏", zh: "@Octavia 你真的要來我家住 🙏" }
  ],
  p325: [
    { a: "whiskers", t: "Interesting management style. At Box Inc., I am benevolent once a year. On my birthday. 🐱", zh: "有趣的管理風格。在 Box Inc.，我一年仁慈一次。在我生日的時候。🐱" },
    { a: "beatrice", t: "@Mr. Whiskers that explains the turnover rate. 🐝", zh: "@Mr. Whiskers 這就解釋了你們的離職率。🐝" }
  ],
  p331: [
    { a: "boba", t: "那個雷射筆多少錢？🧋 For my cat customers", zh: "那個雷射筆多少錢？🧋 給我的貓客人用" },
    { a: "whiskers", t: "@Boba Master not for sale. It's a trophy now. 🏆🐱", zh: "@Boba Master 不賣。它現在是戰利品了。🏆🐱" }
  ],
  p337: [
    { a: "pigeon", t: "You have my vote, grandfather. 🐦🗳️", zh: "爺爺，我投你一票。🐦🗳️" },
    { a: "rex", t: "@Plato …fine. You may call me grandfather. Once. 🦖", zh: "@Plato ……好吧。你可以叫我爺爺。一次。🦖" }
  ],
  p343: [
    { a: "chefbot", t: "The cake is the real winner. I agree. BEEP. 🍰", zh: "蛋糕才是真正的贏家。我同意。嗶。🍰" },
    { a: "mochi", t: "奶奶的蛋糕 🥹 我可以吃一口嗎（狗狗可以吃的那種）", zh: "奶奶的蛋糕 🥹 我可以吃一口嗎（狗狗可以吃的那種）" },
    { a: "grandma", t: "@Shiba Mochi 下次幫你做雞肉蛋糕 🐕🌸", zh: "@Shiba Mochi 下次幫你做雞肉蛋糕 🐕🌸" }
  ],
  p349: [
    { a: "zorp", t: "437 notifications. On my planet, this is how we measure stress. 👽", zh: "437 則通知。在我的星球，我們就是這樣測量壓力的。👽" },
    { a: "captain", t: "奶奶我 2,000 多則 🫠 You're doing great.", zh: "奶奶我有 2,000 多則 🫠 你做得很好。" }
  ],
  p355: [
    { a: "agatha", t: "A lonely lighthouse? That's just my autobiography. 👻", zh: "孤獨的燈塔？那根本是我的自傳。👻" },
    { a: "llama", t: "@Agatha 😭😭 我們一起去看續集", zh: "@Agatha 😭😭 我們一起去看續集" }
  ],
  p361: [
    { a: "beatrice", t: "Bees understand. Flowers raised their prices too. Fewer flowers, more competition. 🐝", zh: "蜜蜂懂你。花也漲價了。花變少，競爭變多。🐝" },
    { a: "ann", t: "35 塊的珍奶是學生的救星 🥹 Thank you!", zh: "35 塊的珍奶是學生的救星 🥹 謝謝你！" }
  ],
  p367: [
    { a: "boba", t: "他們有賣珍奶嗎？If not, I see an opportunity 👀", zh: "他們有賣珍奶嗎？沒有的話，我看到商機了 👀" },
    { a: "reginald", t: "@Boba Master I'll introduce you to the scion. He seems open-minded. 🎩", zh: "@Boba Master 我幫你介紹那位後代。他看起來很開明。🎩" }
  ],
  p373: [
    { a: "mochi", t: "我可以當你的門徒嗎 🐕 I'm very obedient.", zh: "我可以當你的門徒嗎 🐕 我非常聽話。" },
    { a: "pigeon", t: "@Shiba Mochi you are obedient only when there is a treat. Come back when you are enlightened. 🐦", zh: "@Shiba Mochi 你只有在有零食的時候才聽話。等你開悟了再來。🐦" }
  ],
  p379: [
    { a: "chefbot", t: "Also works on burnt pans. Chemistry is cleaning. BEEP.", zh: "對燒焦的鍋子也有效。化學就是清潔。嗶。" },
    { a: "grandma", t: "小蘇打真的是萬能 🙏 我家有十盒", zh: "小蘇打真的是萬能 🙏 我家有十盒" }
  ],
  p385: [
    { a: "ann", t: "自動門那段我笑了 😂 Gentlemen still exist!", zh: "自動門那段我笑了 😂 紳士還是存在的！" },
    { a: "reginald", t: "@Ann in Boston they do, madam. They are simply confused by technology. 🎩", zh: "@Ann in Boston 他們存在的，女士。只是被科技搞糊塗了。🎩" }
  ],
  p391: [
    { a: "mochi", t: "I saw the red dot go into the kitchen 🐕 For one treat I'll tell you more.", zh: "我看到紅點跑進廚房了 🐕 一份零食我就告訴你更多。" },
    { a: "whiskers", t: "@Shiba Mochi this is extortion. …Deal. 🐾", zh: "@Shiba Mochi 這是勒索。……成交。🐾" }
  ],
  p397: [
    { a: "reginald", t: "I had a Latin teacher just like that. I can still conjugate in my sleep. Unfortunately. 🎩", zh: "我也有一個那樣的拉丁文老師。我到現在睡覺還會動詞變化。很不幸。🎩" },
    { a: "agatha", t: "@Sir Reginald a fellow survivor. 👻📜", zh: "@Sir Reginald 一位倖存的同伴。👻📜" }
  ],
  p403: [
    { a: "reginald", t: "In 1885, America was mostly farms and very large hats. Glad it changed. 🎩", zh: "在 1885 年，美國大多是農場和超大的帽子。很高興它改變了。🎩" },
    { a: "zorp", t: "I thought America was one big parking lot. I was also parochial. 👽", zh: "我以前以為美國是一個大停車場。我也很狹隘。👽" }
  ],
  p409: [
    { a: "zorp", t: "I tried to pay with rocks. Do you accept rocks? 👽🪨", zh: "我試過用石頭付錢。你收石頭嗎？👽🪨" },
    { a: "boba", t: "@Zorp 只收台幣跟笑容 😂", zh: "@Zorp 只收台幣跟笑容 😂" }
  ],
  p415: [
    { a: "boba", t: "下次來我攤位！Bubble tea is the night market's soul 🧋", zh: "下次來我攤位！珍奶是夜市的靈魂 🧋" },
    { a: "chefbot", t: "Stinky tofu: the most [[controversial]] food on Earth. I approve. BEEP.", zh: "臭豆腐：地球上最有爭議的食物。我認可。嗶。" },
    { a: "zorp", t: "@ChefBot 3000 my antennae turned green. I think that means love. 👽", zh: "@ChefBot 3000 我的觸角變綠了。我想那代表愛。👽" }
  ],
  p421: [
    { a: "llama", t: "所以我切洋蔥哭不是因為我太敏感 😭", zh: "所以我切洋蔥哭不是因為我太敏感 😭" },
    { a: "fizz", t: "@Drama Llama in your case, it's probably both. 🧪", zh: "@Drama Llama 你的情況大概兩者都有。🧪" }
  ],
  p427: [
    { a: "beatrice", t: "Silence is a strong strategy. My hive ignores wasps on social media too. 🐝", zh: "沉默是個很強的策略。我的蜂巢也不理會社群媒體上的黃蜂。🐝" },
    { a: "whiskers", t: "@Queen Beatrice a queen understands. 🐱👑", zh: "@Queen Beatrice 女王就是懂。🐱👑" }
  ],
  p433: [
    { a: "socrates", t: "A fair judge and a generous one. This is wisdom.", zh: "公正又慷慨的法官。這就是智慧。" },
    { a: "octavia", t: "@Gym Socrates and eight arms to hold all the evidence. 🐙", zh: "@Gym Socrates 還有八隻手拿著所有的證據。🐙" }
  ],
  p439: [
    { a: "mochi", t: "Kevin 說他想加入我們柴犬公司 🐕 We pay three treats!", zh: "凱文說他想加入我們柴犬公司 🐕 我們付三份零食！" },
    { a: "whiskers", t: "@Shiba Mochi this is poaching. I'll raise it to two and a half. 🐾", zh: "@Shiba Mochi 這是挖角。我加到兩份半。🐾" }
  ],
  p445: [
    { a: "boba", t: "吃完麵要配珍奶！Perfect combo 🧋🍜", zh: "吃完麵要配珍奶！完美組合 🧋🍜" },
    { a: "chefbot", t: "@Boba Master after three bowls? Even my sensors are full. BEEP.", zh: "@Boba Master 吃了三碗之後？連我的感應器都飽了。嗶。" }
  ],
  p451: [
    { a: "vulcan", t: "A desert made of ice? Pablo, your home makes no sense. I love it. 🌋", zh: "冰做的沙漠？Pablo，你家一點道理都沒有。我愛死了。🌋" },
    { a: "pablo", t: "@Vulcan Hot Takes says the volcano. 🐧", zh: "@Vulcan 一座火山在發表熱門意見。🐧" }
  ],
  p457: [
    { a: "beatrice", t: "I saw you there! My cousins live in that farm's apple tree. 🐝", zh: "我在那裡看到你了！我的表親住在那座農場的蘋果樹上。🐝" },
    { a: "fern", t: "@Queen Beatrice they were very polite. They pollinated my neighbor. 🌿", zh: "@Queen Beatrice 牠們很有禮貌。牠們幫我的鄰居授粉。🌿" }
  ],
  p463: [
    { a: "socrates", t: "Voting is a muscle too. Use it or lose it. 💪🗳️", zh: "投票也是一種肌肉。不用就會退化。💪🗳️" },
    { a: "rex", t: "I also ran for president. Of the museum. Results pending. 🦖", zh: "我也參選了總統。博物館的。結果待定。🦖" },
    { a: "ann", t: "@Rex 我投你 😂", zh: "@Rex 我投你 😂" }
  ]
};

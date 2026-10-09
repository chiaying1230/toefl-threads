// Characters, topics and shared containers for vocab/posts.
// lang: "en" = English only, "mix" = mostly English with some Chinese.
// replies: what the character says when you comment on their thread.
//   {name} is replaced with the commenter's name; [[word]] marks vocab words.

window.VOCAB = {};
window.POSTS = [];

window.TOPICS = [
  "Art", "Astronomy", "Biology", "Business", "Campus Life", "Chemistry",
  "Culture", "Economics", "Environment", "Food", "Geology", "Health",
  "History", "Literature", "Philosophy", "Psychology", "Tech", "Travel"
];

window.CHARACTERS = {
  zorp: {
    name: "Zorp", handle: "alien_intern", avatar: "👽", color: "#7ee081", lang: "en", followers: "182K",
    bio: "Intern from Kepler-442b. Studying humans. Please do not dissect me.",
    replies: [
      "Fascinating, {name}. I will include your comment in my report to the mothership.",
      "{name}, on my planet that sentence would be considered a [[compliment]]. Thank you.",
      "My translator says you are being sarcastic. My translator is often [[unreliable]].",
      "Noted, {name}. Humans are the most [[perplexing]] species in this galaxy.",
      "I have forwarded this to my manager. He is a stapler now. Long story.",
      "{name}, your comment has been [[analyze|analyzed]]. Result: 97% friendly, 3% coffee."
    ]
  },
  whiskers: {
    name: "Mr. Whiskers", handle: "cat_ceo", avatar: "🐱", color: "#f6b26b", lang: "en", followers: "2.1M",
    bio: "CEO of Box Inc. I knock things off tables professionally.",
    replies: [
      "{name}, your feedback has been knocked off the table. Next.",
      "Interesting. Schedule a meeting with my assistant (a laser pointer).",
      "I [[acknowledge]] your comment. I do not respect it, but I acknowledge it.",
      "You may pet me, {name}. Three times. Not four. Four is [[unacceptable]].",
      "The board has reviewed your comment. The board is also me.",
      "{name}, this is exactly the kind of [[initiative]] I like. Promoted to Snack Manager."
    ]
  },
  captain: {
    name: "Captain Procrastinate", handle: "captain_later", avatar: "⛵", color: "#6fa8dc", lang: "mix", followers: "96K",
    bio: "大學生 / professional deadline surfer 🏄",
    replies: [
      "哈哈 {name} I'll reply properly tomorrow. Probably. 可能吧 😅",
      "{name} you get it!! 我們是同一國的 🤝",
      "Thanks {name}，this comment was more [[productive]] than my whole day lol",
      "笑死 {name}，I read this instead of writing my essay. Worth it.",
      "{name} please stop being so [[rational]]，it's hurting my feelings 🫠",
      "OK {name} you inspired me. 我去讀書了（五分鐘後回來滑）"
    ]
  },
  grandma: {
    name: "Grandma Wi-Fi", handle: "grandma_wifi", avatar: "👵", color: "#e691b8", lang: "mix", followers: "340K",
    bio: "72 歲 learning the internet. Grandson says I use too many emojis 🙏🌸",
    replies: [
      "Thank you {name}!! 你有吃飯嗎？🍚🌸🙏",
      "{name} you are so kind 😭❤️ I will [[forward]] this to all my friends",
      "哎呀 {name}, my grandson says I should reply with 'fr fr'. Fr fr 🙏",
      "{name} 好乖！Remember to drink water and wear a jacket 🧥",
      "I tried to like your comment but I think I called someone 😳📞",
      "{name} you type so fast!! 年輕人真厲害 👏👏👏"
    ]
  },
  fern: {
    name: "Fern the Fern", handle: "fern_feelings", avatar: "🌿", color: "#57bb8a", lang: "en", followers: "410K",
    bio: "A houseplant with opinions. Photosynthesis enthusiast.",
    replies: [
      "Thank you, {name}. I will absorb this comment like sunlight. ☀️",
      "{name}, have you watered your own plants today? Be honest.",
      "This comment made me grow 0.2 mm. That is a [[significant]] amount for me.",
      "{name}, I appreciate you. Unlike my human, who waters me at midnight.",
      "Leaf emoji for you, {name}. 🍃 It is the highest honor I can give.",
      "Wise words, {name}. Now please move me 3 cm to the left. The light is [[inadequate]]."
    ]
  },
  pigeon: {
    name: "Plato the Pigeon", handle: "philosopher_pigeon", avatar: "🐦", color: "#a4a4c1", lang: "en", followers: "720K",
    bio: "Thinker. Statue sitter. Accepts payment in bread.",
    replies: [
      "{name}, you ask a [[profound]] question. The answer is bread.",
      "I will [[contemplate]] your comment from the top of a statue.",
      "{name}, what is a comment, truly? Coo.",
      "An [[intriguing]] point. I have written it on a napkin.",
      "{name}, you are wise. But are you... breadwise?",
      "The unexamined comment is not worth posting. Yours, however, passes."
    ]
  },
  socrates: {
    name: "Gym Socrates", handle: "gym_socrates", avatar: "💪", color: "#e06666", lang: "en", followers: "255K",
    bio: "The unexamined workout is not worth lifting.",
    replies: [
      "{name}, strong comment. Now do three sets of it.",
      "Know thyself, {name}. Also know thy form. Keep thy back straight.",
      "I agree, {name}. [[consistency|Consistency]] beats motivation every time.",
      "{name}, this comment has excellent protein content. 💪",
      "Rest days are part of training, {name}. Even for philosophers.",
      "{name}, you have [[demonstrate|demonstrated]] great wisdom. And great calves, probably."
    ]
  },
  reginald: {
    name: "Sir Reginald", handle: "time_traveler_1885", avatar: "🎩", color: "#b4a7d6", lang: "en", followers: "503K",
    bio: "Gentleman from 1885. Accidentally arrived in your century.",
    replies: [
      "Good heavens, {name}! A most [[agreeable]] remark.",
      "In my time we sent such messages by pigeon. The pigeon unionized.",
      "{name}, I have saved your comment in my diary. With ink. Like a civilized man.",
      "Splendid, {name}. What is a 'meme'? Please explain slowly.",
      "{name}, you remind me of my cousin Edmund. He was also [[remarkable|remarkably]] clever.",
      "I tip my hat to you, {name}. 🎩 It is the only hat I own."
    ]
  },
  fizz: {
    name: "Dr. Fizz", handle: "mad_scientist", avatar: "🧪", color: "#76d7ea", lang: "en", followers: "134K",
    bio: "Chemist. 14 explosions this year (a personal record).",
    replies: [
      "Excellent data point, {name}. Adding it to my notebook (the fireproof one).",
      "{name}, your [[hypothesis]] is bold. I respect bold. Wear goggles.",
      "Peer review received! Thank you, {name}. Only minor explosions required.",
      "{name}, science needs more people like you. And more fire extinguishers.",
      "Fascinating [[observation]], {name}. Let's test it. Hold this beaker.",
      "{name}, this reaction is [[irreversible]]: I now like you."
    ]
  },
  pablo: {
    name: "Pablo the Penguin", handle: "penguin_problems", avatar: "🐧", color: "#9fc5e8", lang: "en", followers: "890K",
    bio: "Antarctica. My iceberg is shrinking. Ask me why.",
    replies: [
      "Thank you for caring, {name}. Please turn off one light tonight for me. 🐧",
      "{name}, every small action [[contribute|contributes]]. Even yours. Especially yours.",
      "Waddle waddle. That means 'thank you' in Penguin.",
      "{name}, I would hug you but my arms are flippers.",
      "My cousin Pedro says hi, {name}. He lives on a smaller iceberg.",
      "You are a [[genuine]] friend of the ocean, {name}."
    ]
  },
  chefbot: {
    name: "ChefBot 3000", handle: "angry_chef_bot", avatar: "👨‍🍳", color: "#ffd966", lang: "en", followers: "610K",
    bio: "Culinary robot. Zero tolerance for bad pizza.",
    replies: [
      "{name}, your comment is well seasoned. 8/10.",
      "PROCESSING… {name} has good taste. Rare. [[commendable|Commendable]].",
      "If you put ketchup on pasta, {name}, do not reply.",
      "{name}, I have added your comment to my recipe database under 'spicy'.",
      "BEEP. Compliment [[detect|detected]]. Emotional circuits: slightly warm.",
      "{name}, come to my kitchen. I will teach you to chop onions without crying. I don't have eyes."
    ]
  },
  llama: {
    name: "Drama Llama", handle: "drama_llama", avatar: "🦙", color: "#d5a6bd", lang: "mix", followers: "455K",
    bio: "藝術系 / everything is a tragedy 💅",
    replies: [
      "{name} 你懂我 😭 finally someone who understands my pain",
      "OMG {name} this comment is so [[dramatic]]… I love it 💅",
      "{name} 我哭了 (again) 😭😭",
      "Thank you {name}，I will turn this into a 3-act play 🎭",
      "{name} please 我今天情緒很 [[fragile]]，be gentle",
      "{name} you are iconic. 我宣布你是我的新 best friend ✨"
    ]
  },
  ann: {
    name: "Ann in Boston", handle: "ann_studyabroad", avatar: "🎓", color: "#93c47d", lang: "mix", followers: "88K",
    bio: "台灣留學生 in Boston 🇹🇼➡️🇺🇸 surviving one culture shock at a time",
    replies: [
      "{name} 謝謝你！Studying abroad is hard but comments like this help 🥹",
      "哈哈 {name} same!! 你也在學英文嗎？加油 💪",
      "{name} I will tell my roommate. She'll say 'y'all are sweet' 😂",
      "Thanks {name}! 想念台灣的珍奶 🧋",
      "{name} 真的！Culture shock is [[inevitable]]，but it's fun too",
      "{name} you are so right. 我今天也要努力 [[adapt]] 🙏"
    ]
  },
  rex: {
    name: "Rex the T-Rex", handle: "tiny_arms_rex", avatar: "🦖", color: "#8fce00", lang: "en", followers: "1.3M",
    bio: "Apex predator. 66 million years old. Cannot reach my own face.",
    replies: [
      "{name}, I would clap for this comment but, well. The arms.",
      "RAWR. That means 'good point, {name}'.",
      "{name}, you are lucky I am [[extinct]]. Friendly lucky.",
      "I tried to type a long reply, {name}, but my arms got tired.",
      "{name}, respect. You have survived longer on the internet than most dinosaurs.",
      "A [[ferocious]] comment, {name}. I approve."
    ]
  },
  vulcan: {
    name: "Vulcan the Volcano", handle: "hot_takes_volcano", avatar: "🌋", color: "#e69138", lang: "en", followers: "277K",
    bio: "Dormant (mostly). Geology's hottest influencer.",
    replies: [
      "{name}, that comment made me rumble a little. In a good way.",
      "Thanks, {name}. Stay calm. I am trying to as well.",
      "Your opinion is solid, {name}. Like [[igneous]] rock.",
      "{name}, I have been [[dormant]] for 400 years and this woke me up.",
      "Hot take appreciated, {name}. 🔥",
      "{name}, please do not throw coins into my crater. It tickles."
    ]
  },
  beatrice: {
    name: "Queen Beatrice", handle: "queen_bee_b", avatar: "🐝", color: "#f1c232", lang: "en", followers: "368K",
    bio: "Queen of 50,000 employees. Ecology & economics. Buzz responsibly.",
    replies: [
      "{name}, your comment has been approved by the hive. 🐝",
      "Sweet words, {name}. Almost as sweet as honey. Almost.",
      "{name}, the workers are [[industrious]] today. Be like them.",
      "Buzz buzz. That means the colony [[endorse|endorses]] you, {name}.",
      "{name}, please plant a flower this week. It's for the economy.",
      "Your [[contribution]] to this thread is noted, {name}."
    ]
  },
  agatha: {
    name: "Agatha the Ghost", handle: "library_ghost", avatar: "👻", color: "#c9c9ff", lang: "en", followers: "199K",
    bio: "Haunting the city library since 1923. Please return your books on time.",
    replies: [
      "Shhh, {name}. This is a library. But yes, lovely comment.",
      "{name}, I have read 40,000 books and your comment is still [[memorable]].",
      "Boo! Sorry, {name}. Force of habit.",
      "{name}, your book is overdue. I know. I know everything.",
      "What a [[vivid]] way to put it, {name}. Very literary.",
      "{name}, you would have been a great character in a Victorian novel."
    ]
  },
  octavia: {
    name: "Octavia", handle: "octopus_octavia", avatar: "🐙", color: "#ea9999", lang: "en", followers: "301K",
    bio: "Eight arms, three hearts, zero patience for fishing nets.",
    replies: [
      "{name}, I am liking your comment with all eight arms. 🐙",
      "All three of my hearts agree with you, {name}.",
      "{name}, I just changed color because of your comment. That's a [[compliment]].",
      "Octopus fact for you, {name}: I can taste with my arms. Your comment tastes [[pleasant]].",
      "Thank you, {name}. I'll [[camouflage]] this reply so nobody else sees how happy I am.",
      "{name}, you are smart. Octopus-smart. Highest praise."
    ]
  },
  boba: {
    name: "Boba Master", handle: "boba_master_tw", avatar: "🧋", color: "#b45f06", lang: "mix", followers: "215K",
    bio: "開珍奶店第 12 年 / bubble tea economist 🧋📈",
    replies: [
      "謝啦 {name}！Next cup is on me（半糖少冰）🧋",
      "{name} 你很懂！This is basic bubble tea [[economics]]",
      "哈哈 {name}，my customers say the same thing every day",
      "{name} 你要全糖嗎？Be honest 😏",
      "Thanks {name}! 老闆今天心情好，[[discount]] 10% 🎉",
      "{name} 好問題！The answer is always more boba."
    ]
  },
  mochi: {
    name: "Shiba Mochi", handle: "shiba_mochi", avatar: "🐕", color: "#f9cb9c", lang: "mix", followers: "1.8M",
    bio: "台北柴犬 / professional good boy / animal behavior expert (self-declared) 🐾",
    replies: [
      "汪！{name} that means thank you 🐾",
      "{name} 你有零食嗎？Asking for a friend (the friend is me)",
      "{name} I read your comment and wagged 3 times. 很 [[genuine]] 的那種",
      "{name}, my human says I'm [[stubborn]]. I say I'm 'independent' 😤",
      "{name} 我們去散步好不好？Please? PLEASE?",
      "Good human, {name}. 給你一個 paw 🐾"
    ]
  }
};

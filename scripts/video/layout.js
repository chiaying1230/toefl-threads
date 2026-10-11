// Canvas zones (1080 × 1920). Every component positions itself from these numbers.
//
//   y   0 – 200   platform top UI (account name, search) – keep empty
//   y 196 – 252   header: series chip + episode number
//   y 330 – 1240  MAIN: thread card, word card, quiz
//   y 1300 – 1560 BOTTOM: mascot slot (left) + subtitle (right of it, or full width without mascot)
//   y 1560 – 1920 platform caption + buttons – keep empty
//   x right of 948: like/comment/share buttons on most platforms – no text there
export const L = {
  W: 1080, H: 1920,
  safe: { top: 220, bottom: 1560, left: 84, right: 948 },
  header: { y: 196 },
  main: { y: 330, h: 910, x: 84, w: 864 },
  bottom: { y: 1300, h: 260 },
  mascot: { x: 84, y: 1318, size: 240 },
  subWithMascot: { x: 360, w: 588 },
  subFull: { x: 84, w: 864 },
};

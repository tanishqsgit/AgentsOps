import type Phaser from 'phaser';

export const floorSize = { width: 720, height: 568 };
export const desks = [[152, 249], [360, 249], [568, 249], [152, 360], [360, 360], [568, 360]];

type Paint = (x: number, y: number, width: number, height: number, color: number, alpha?: number) => void;

export function paint(graphics: Phaser.GameObjects.Graphics): Paint {
  return (x, y, w, h, color, alpha = 1) => { graphics.fillStyle(color, alpha).fillRect(x, y, w, h); };
}

function plants(rect: Paint, x: number, y: number, large = false) {
  const scale = large ? 2 : 1;
  const piece: Paint = (a, b, w, h, color, alpha) => rect(x + a * scale, y + b * scale, w * scale, h * scale, color, alpha);
  piece(-7, 5, 19, 5, 0x432c22, .24);
  piece(-6, 0, 12, 8, 0x6f4429);
  piece(-8, -2, 16, 3, 0xa05c37);
  piece(-4, 2, 7, 4, 0xc77d48);
  piece(-1, -23, 3, 22, 0x3d6233);
  for (const [a, b, w, h] of [[-10, -20, 8, 5], [3, -17, 9, 4], [-12, -11, 10, 4], [2, -9, 10, 4], [-4, -25, 7, 9]]) {
    piece(a, b, w, h, 0x365b39);
    piece(a + 1, b, w - 2, 2, 0x719450);
  }
}

function tileRoom(rect: Paint, x: number, y: number, w: number, h: number, base: number) {
  rect(x + 4, y + 6, w, h, 0x523524, .28);
  rect(x, y, w, h, 0x584438);
  rect(x + 3, y + 3, w - 6, h - 6, base);
  for (let row = 23; row < h - 4; row += 13) {
    rect(x + 4, y + row, w - 8, 1, 0xffeee0, .52);
    for (let col = 11 + (row % 2) * 9; col < w - 5; col += 19) {
      rect(x + col, y + row - 12, 1, 12, 0xffeee0, .42);
    }
  }
  rect(x + 3, y + 3, w - 6, 18, 0xefe3cf);
  rect(x + 3, y + 20, w - 6, 3, 0x998474);
  rect(x + 3, y + 3, 7, h - 6, 0xd4c0a7);
  rect(x + w - 10, y + 3, 7, h - 6, 0xccb99f);
}

function sofa(rect: Paint, x: number, y: number, w: number) {
  rect(x + 2, y + 20, w + 4, 7, 0x523524, .28);
  rect(x, y + 2, w, 21, 0x503c3a);
  rect(x + 3, y, w - 6, 7, 0x8d4750);
  rect(x + 4, y + 7, w - 8, 12, 0xbe6870);
  rect(x + 6, y + 7, w - 12, 2, 0xe3938d);
  rect(x + 4, y + 19, w - 8, 4, 0x8d4750);
  rect(x + (w >> 1), y + 9, 1, 10, 0x96555d);
  rect(x + 2, y + 6, 5, 13, 0xa3545b);
  rect(x + w - 7, y + 6, 5, 13, 0xa3545b);
}

function shelves(rect: Paint, x: number, y: number) {
  rect(x + 3, y + 3, 62, 47, 0x624730, .26);
  rect(x, y, 62, 47, 0x694631);
  rect(x + 4, y + 5, 54, 36, 0x4c372f);
  const books = [0xe0a352, 0x789379, 0xc96956, 0x76a6ae, 0xd2c1a2, 0x9b6853];
  for (const level of [0, 17]) {
    for (let index = 0; index < 9; index++) {
      const h = 6 + (index * 7 + level) % 7;
      const color = books[(index + level) % books.length];
      rect(x + 5 + index * 6, y + level + 18 - h, 4, h, color);
      rect(x + 5 + index * 6, y + level + 16, 4, 1, 0xf7dfb7, .6);
    }
    rect(x + 3, y + level + 18, 56, 4, 0xb77a4e);
    rect(x + 4, y + level + 18, 54, 1, 0xe5ac6d);
  }
}

function desk(rect: Paint, x: number, y: number) {
  rect(x - 55, y + 2, 116, 31, 0x714b30, .23);
  rect(x - 51, y + 16, 6, 15, 0x4b463d);
  rect(x + 46, y + 16, 5, 15, 0x4b463d);
  rect(x - 56, y - 9, 112, 31, 0x744a32);
  rect(x - 53, y - 7, 106, 24, 0xedac6e);
  rect(x - 52, y - 6, 104, 2, 0xffce9d);
  rect(x - 53, y + 17, 106, 3, 0xb8774b);
  rect(x - 16, y - 22, 32, 23, 0x4c4441);
  rect(x - 14, y - 21, 28, 20, 0xe2ded2);
  rect(x - 11, y - 18, 22, 13, 0x304b52);
  rect(x - 8, y - 15, 13, 2, 0x80bab1);
  rect(x - 8, y - 11, 8, 1, 0x5f8b7e);
  rect(x - 4, y - 1, 8, 5, 0x746c62);
  rect(x - 14, y + 7, 27, 7, 0xa79a83);
  rect(x - 12, y + 7, 23, 4, 0xf0e5cc);
  rect(x + 30, y + 2, 11, 10, 0xb77f50);
  rect(x + 30, y + 1, 10, 8, 0xe9d3a0);
  rect(x - 11, y + 44, 23, 12, 0x51564c);
  rect(x - 10, y + 42, 21, 10, 0x698164);
  rect(x - 8, y + 42, 17, 2, 0x9bb27b);
}

export function drawOffice(graphics: Phaser.GameObjects.Graphics) {
  const rect = paint(graphics);
  rect(0, 0, 720, 568, 0x342d2a);
  rect(8, 8, 704, 552, 0x946440);
  rect(15, 15, 690, 536, 0xd49c65);
  for (let y = 68; y < 550; y += 9) {
    rect(16, y, 688, 1, 0xa97149, .58);
    for (let x = 36 + (y % 7) * 16; x < 700; x += 96) {
      rect(x, y, 1, 8, 0xa97149, .6);
      const grain = Math.min(21 + (x % 13), 699 - x);
      if (grain > 0) rect(x + 6, y + 3, grain, 1, 0xf9bc84, .45);
    }
  }
  rect(15, 15, 690, 44, 0x5d6356);
  rect(15, 52, 690, 7, 0x45473e);
  rect(15, 59, 690, 8, 0xb48152);
  rect(15, 67, 690, 3, 0xe0ac75);
  for (const x of [83, 293, 503]) {
    rect(x, 22, 134, 25, 0x3b4d48);
    rect(x + 4, 25, 126, 18, 0x86b7b6);
    rect(x + 4, 25, 126, 5, 0xb1dbd4);
    rect(x + 28, 32, 25, 2, 0xb1dbd4);
    rect(x + 86, 36, 23, 1, 0xc1e2d7);
    rect(x + 65, 25, 3, 18, 0x557f7a);
  }
  for (const x of [260, 470]) {
    graphics.fillStyle(0xffbc66, .16).fillCircle(x, 53, 24);
    graphics.fillStyle(0xffbd63, .22).fillCircle(x, 51, 15);
    rect(x - 1, 15, 2, 17, 0x393d34);
    rect(x - 5, 31, 10, 4, 0x473d30);
    rect(x - 8, 35, 16, 5, 0xb99562);
    rect(x - 6, 40, 12, 5, 0xffdd96);
  }

  tileRoom(rect, 41, 79, 202, 113, 0xb6b1a4);
  tileRoom(rect, 259, 79, 202, 113, 0x9bada5);
  tileRoom(rect, 477, 79, 202, 113, 0xb2a99c);
  sofa(rect, 93, 145, 83);
  rect(117, 116, 43, 18, 0x79654e);
  rect(119, 118, 39, 14, 0xd2d8bd);
  rect(124, 125, 28, 1, 0x668c77);
  shelves(rect, 281, 125);
  shelves(rect, 357, 125);
  rect(532, 138, 93, 39, 0x835239);
  rect(535, 140, 87, 32, 0xd99962);
  rect(535, 140, 87, 3, 0xf5bd83);
  rect(574, 147, 17, 11, 0xe6dfc6);
  rect(578, 150, 9, 1, 0x7e9a92);
  for (const x of [516, 627]) {
    rect(x, 149, 13, 20, 0x6c5c50);
    rect(x + 2, 150, 9, 15, 0x9f7962);
  }
  desks.forEach(([x, y]) => desk(rect, x, y));
  tileRoom(rect, 41, 448, 638, 87, 0xb5aa9a);
  sofa(rect, 112, 488, 93);
  sofa(rect, 517, 488, 93);
  rect(318, 490, 84, 27, 0x865a40);
  rect(320, 489, 80, 22, 0xc08e62);
  rect(320, 489, 80, 2, 0xe0af7e);
  rect(350, 494, 16, 10, 0x718f8c);
  rect(352, 495, 13, 2, 0xb7c6bb);
  for (const [x, y] of [[31, 69], [687, 68], [64, 174], [450, 179], [35, 314], [685, 326], [76, 512], [638, 514]]) {
    plants(rect, x, y, x === 35 || x === 685);
  }
  rect(15, 543, 690, 4, 0xf2ba7d);
  rect(15, 547, 690, 5, 0xa77550);
}

const sprite = [
  '.....dddddd.....', '....dhhhhhhd....', '...dhHHHhhhhd...', '..dhHHhhhhhhhd..',
  '..dhhhhhhsssHd..', '..dhhssssssssd..', '..dsssdsdssssd..', '...dsSdSdSsd....',
  '....dsssssd.....', '.....dSSSd......', '....dCWCWCd.....', '...dCCWCWCCd....',
  '...dsCCCCCCsd...', '....dCCCCCCd....', '.....dd.dd......', '....ddd.ddd.....',
];
const hair = [[0xa86135, 0xeb9d56], [0x33302e, 0x574d45], [0x654235, 0x93654c], [0x584234, 0x956c4d]];
const shirts = [0x4a638c, 0x477b69, 0xac644e, 0x896684, 0x386c83, 0xaa7c4d];
const skin = [[0xd69463, 0xf5c49b], [0xad704f, 0xce936c], [0xb17f56, 0xe1aa79]];

export function drawAvatar(rect: Paint, id: string, x: number, y: number, scale = 2) {
  const seed = Array.from(id).reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 0);
  const [h, H] = hair[seed % hair.length];
  const [s, S] = skin[seed % skin.length];
  const palette: Record<string, number> = { d: 0x382f2d, h, H, s, S, W: 0xe6deca, C: shirts[seed % shirts.length] };
  sprite.forEach((row, dy) => Array.from(row).forEach((key, dx) => {
    const color = palette[key];
    if (color !== undefined) rect(x + dx * scale, y + dy * scale, scale, scale, color);
  }));
}

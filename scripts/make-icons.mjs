// 외부 의존성 없이 미러볼 아이콘 PNG를 생성한다. (node 내장 zlib만 사용)
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// 색상 유틸
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.44;
  const facet = Math.max(2, Math.round(size / 8)); // 타일 격자 크기
  const sparkles = [
    [0.26, 0.24], [0.72, 0.3], [0.3, 0.74], [0.68, 0.7], [0.5, 0.16]
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > R + 0.5) {
        // 바깥: 은은한 광선 글로우
        const glow = Math.max(0, 1 - (dist - R) / (size * 0.16));
        if (glow > 0) {
          px[i] = 150; px[i + 1] = 190; px[i + 2] = 255;
          px[i + 3] = Math.round(70 * glow * glow);
        }
        continue;
      }

      // 구체 내부: 타일 격자 + 좌상단 하이라이트 명암
      const tileX = Math.floor(x / facet);
      const tileY = Math.floor(y / facet);
      const checker = (tileX + tileY) % 2 === 0 ? 1 : 0;
      // 광원(좌상단) 방향 명암
      const nx = dx / R;
      const ny = dy / R;
      const light = Math.max(0, 1 - (nx * 0.6 + ny * 0.6 + 0.55)) * 0.5 + 0.5;

      const base = mix([40, 60, 130], [120, 200, 255], light);
      let col = checker ? mix(base, [255, 255, 255], 0.35) : base;

      // 타일 경계 어둡게
      const inTileX = x % facet;
      const inTileY = y % facet;
      if (inTileX === 0 || inTileY === 0) col = mix(col, [10, 20, 45], 0.55);

      // 스페큘러 하이라이트
      const hlx = cx - R * 0.35;
      const hly = cy - R * 0.35;
      const hlDist = Math.sqrt((x - hlx) ** 2 + (y - hly) ** 2);
      if (hlDist < R * 0.28) col = mix(col, [255, 255, 255], Math.max(0, 1 - hlDist / (R * 0.28)) * 0.8);

      // 컬러 스파클
      for (const [sxr, syr] of sparkles) {
        const sxp = sxr * size;
        const syp = syr * size;
        const sd = Math.sqrt((x - sxp) ** 2 + (y - syp) ** 2);
        if (sd < size * 0.05) {
          const hue = ((sxr + syr) * 3) % 1;
          const tint = hue < 0.33 ? [255, 120, 200] : hue < 0.66 ? [120, 255, 200] : [255, 230, 120];
          col = mix(col, tint, Math.max(0, 1 - sd / (size * 0.05)));
        }
      }

      // 가장자리 안티앨리어싱
      let alpha = 255;
      if (dist > R - 1) alpha = Math.round(255 * Math.max(0, R + 0.5 - dist));

      px[i] = Math.min(255, Math.round(col[0]));
      px[i + 1] = Math.min(255, Math.round(col[1]));
      px[i + 2] = Math.min(255, Math.round(col[2]));
      px[i + 3] = alpha;
    }
  }
  return px;
}

mkdirSync("icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = encodePng(size, drawIcon(size));
  writeFileSync(`icons/icon${size}.png`, png);
  console.log(`icons/icon${size}.png (${png.length} bytes)`);
}

// Renders public/rest-clock.mp4: the clock the floating timer plays. It counts down from
// 15:00 to 0:00, then on in teal from +0:00 to +10:00, at one frame a second. The page
// seeks it to the rest's remaining time and lets it play, so the floating badge keeps
// time on its own: iPhones stop a page's scripts soon after you switch apps, but a
// playing video goes on. Run once after changing the look:
//   FFMPEG=path/to/ffmpeg node scripts/makeRestClock.ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DOWN = 15 * 60; // seconds of countdown; keep in step with src/float.ts
const UP = 10 * 60;
const font = "C\\:/Windows/Fonts/segoeuib.ttf";
const out = fileURLToPath(new URL('../public/rest-clock.mp4', import.meta.url));

const clock = (n: string) => `%{eif\\:floor((${n})/60)\\:d}\\:%{eif\\:mod(${n}\\,60)\\:d\\:2}`;
const text = (t: string, size: number, color: string, y: string) => `drawtext=fontfile='${font}':text='${t}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}`;

const filter = [
  `color=c=0x111615:s=360x200:r=1:d=${DOWN},${text(clock(`${DOWN}-n`), 112, '0xe8ece9', '(h-text_h)/2-18')},${text('Rest', 26, '0x9ba7a2', 'h-46')}[a]`,
  `color=c=0x0f766e:s=360x200:r=1:d=${UP},${text(`+${clock('n')}`, 112, '0xffffff', '(h-text_h)/2-18')},${text('Rest over', 26, '0xffffff', 'h-46')}[b]`,
  `[a][b]concat=n=2:v=1:a=0[v]`,
].join(';');

const r = spawnSync(
  process.env.FFMPEG ?? 'ffmpeg',
  ['-y', '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'stillimage', '-crf', '28', '-g', '10', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-movflags', '+faststart', out],
  { stdio: 'inherit' },
);
process.exit(r.status ?? 1);

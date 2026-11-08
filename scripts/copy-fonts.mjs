import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'site/assets/fonts');
mkdirSync(out, { recursive: true });

const faces = [
  ['pinyon-script', [400]],
  ['cormorant-garamond', [500]],
  ['josefin-sans', [400, 600]],
];

for (const [family, weights] of faces) {
  const pkg = join(root, 'node_modules/@fontsource', family);
  for (const weight of weights) {
    for (const subset of ['latin', 'latin-ext']) {
      copyFileSync(
        join(pkg, 'files', `${family}-${subset}-${weight}-normal.woff2`),
        join(out, `${family}-${weight}-${subset}.woff2`),
      );
    }
  }
  copyFileSync(join(pkg, 'LICENSE'), join(out, `OFL-${family}.txt`));
}
console.log('fonts copied to site/assets/fonts');

// Regenerasi data untuk pembukaan langsung melalui file://.
// Jalankan dari folder mana pun: node scripts/bundle-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(`data/${name}.json`, root), 'utf8'));
const bundle = { reading: read('reading'), listening: read('listening'), exams: read('exams').exams };
for (const skill of ['reading', 'listening']) {
  if (bundle[skill].schemaVersion !== 1 || bundle[skill].skill !== skill || !Array.isArray(bundle[skill].questions)) throw new Error(`Struktur ${skill}.json tidak sesuai.`);
}
const output = new URL('data/banks.js', root);
writeFileSync(output, '// Otomatis dari JSON. Edit data/*.json lalu jalankan scripts/bundle-data.mjs.\nwindow.TOCFL_BUNDLED = ' + JSON.stringify(bundle).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';\n');
console.log(`Data offline diperbarui: ${fileURLToPath(output)} (${bundle.reading.questions.length} reading, ${bundle.listening.questions.length} listening).`);

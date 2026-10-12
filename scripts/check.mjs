// Pemeriksaan data dan logika. Tidak menggantikan pengujian tampilan browser.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const reading = JSON.parse(read('data/reading.json'));
const listening = JSON.parse(read('data/listening.json'));
const exams = JSON.parse(read('data/exams.json')).exams;
// Transkripsi pemeriksaan terpisah dari kelima tabel jawaban yang diunggah.
const keys = [
  'BBACB CACCB BBCCB CAABC CABCC BBCBB CBAAB BAACA BEACF DABCA',
  'CCBAB ACACB BCCAB BAABC BAABC ACAAB CCBBA CACBC ABFDE BDBCA',
  'AABCC CCABA CCCBA BBCCC AABCA CAABB BACAB BEACF FADCB BBDDD',
  'CBCBA ACBCC AABCA BBCCA CAABB AC BAC ACBAB FDBEC ABECF BAABD'.replace('AC BAC','ACBAC'),
  'AAACA ACBCC CACAB CBBAB BBCBA BCBAB BBACB ACBBC CABFD BCDCA'
].map(k => k.replace(/\s/g, ''));
assert.equal(reading.questions.length, 250);
assert.equal(exams.length, 5);
assert.equal(listening.questions.length, 0);
const ids = new Set();
for (let n = 1; n <= 5; n++) {
  const questions = reading.questions.filter(q => q.examId === `band-a-${n}`);
  assert.equal(questions.length, 50);
  assert.equal(keys[n - 1].length, 50, `Kunci pemeriksaan paket ${n}`);
  assert.equal(questions.map(q => q.answer).join(''), keys[n - 1], `Kunci paket ${n}`);
  questions.forEach((q, i) => {
    assert.equal(q.questionNumber, i + 1);
    assert.ok(!ids.has(q.id)); ids.add(q.id);
    const section = i < 15 ? 1 : i < 30 ? 2 : i < ([3, 4].includes(n) ? 35 : 40) ? 3 : i < 45 ? 4 : 5;
    assert.equal(q.section, section);
    assert.equal(q.options.length, section === 4 ? 6 : section === 5 ? 4 : 3);
    assert.ok(q.options.some(o => o.id === q.answer));
    assert.ok(q.images.length > 0);
    for (const path of [...q.images.map(im => im.src), q.source.file, q.source.answerFile]) {
      assert.ok(existsSync(new URL(path, root)), `${q.id}: ${path}`);
      assert.ok(statSync(new URL(path, root)).size > 0);
    }
    if (section >= 4) assert.ok(q.passage.length > 20);
  });
}
for (const groupId of new Set(reading.questions.filter(q => q.section === 4).map(q => q.groupId))) {
  const group = reading.questions.filter(q => q.groupId === groupId);
  assert.equal(group.length, 5); assert.equal(new Set(group.map(q => q.answer)).size, 5);
}
const html = read('index.html');
const htmlIDs = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(htmlIDs.length, new Set(htmlIDs).size, 'ID HTML harus unik');
for (const m of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)) assert.ok(existsSync(new URL(m[1], root)), m[1]);

// DOM minimal hanya untuk menjalankan logika aplikasi dalam Node tanpa dependensi.
const nodes = new Map();
class Element {
  constructor(name = '') { this.name = name; this.value = ''; this.checked = false; this.disabled = false; this.style = {}; this.dataset = {}; this.listeners = {}; this.attrs = {}; this.textContent = ''; this.isConnected = true; this.classes = new Set(); this.classList = { add: (...xs) => xs.forEach(x => this.classes.add(x)), remove: (...xs) => xs.forEach(x => this.classes.delete(x)), contains: x => this.classes.has(x), toggle: (x, force) => { const on = force ?? !this.classes.has(x); on ? this.classes.add(x) : this.classes.delete(x); return on; } }; }
  set innerHTML(v) { this.markup = v; for (const m of v.matchAll(/\bid="([^"]+)"/g)) if (!nodes.has(`#${m[1]}`)) nodes.set(`#${m[1]}`, new Element(m[1])); }
  get innerHTML() { return this.markup || ''; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(name, val) { this.attrs[name] = val; }
  focus() {} scrollIntoView() {} append() {} click() {} remove() {} pause() {}
  querySelector() { return new Element(); } querySelectorAll() { return []; }
}
htmlIDs.forEach(id => nodes.set(`#${id}`, new Element(id)));
const el = selector => {
  if (selector === '#quiz-content audio' || selector === '.modal-backdrop.open') return null;
  if (!nodes.has(selector)) {
    if (/^#[\w-]+$/.test(selector)) throw new Error(`ID HTML tidak ditemukan: ${selector}`);
    nodes.set(selector, new Element(selector));
  }
  return nodes.get(selector);
};
const storage = new Map(); let interval = 0;
const ctx = vm.createContext({
  console, URL, Blob, Date, Intl, Map, Set, JSON, Promise,
  document: { addEventListener() {}, querySelector: el, querySelectorAll: () => [], activeElement: new Element(), body: new Element(), createElement: () => new Element() },
  location: { protocol: 'file:', hash: '#mocks' },
  localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  setTimeout: () => 1, clearTimeout() {}, clearInterval() {}, getComputedStyle: () => ({ visibility: 'visible' }),
  fetch: async path => ({ ok: true, json: async () => JSON.parse(read(path)) }),
  window: { addEventListener() {}, scrollTo() {}, confirm: () => true, setInterval: () => ++interval },
});
vm.runInContext(read('data/banks.js'), ctx);
vm.runInContext(read('app.js'), ctx);
const run = code => vm.runInContext(code, ctx);
await run('init()');
assert.equal(run('state.data.reading.length'), 250);
assert.equal(run('getExams().length'), 5);
assert.ok(el('#mock-library').innerHTML.includes('Mock Test 5'));
assert.equal(run('validateBank(window.TOCFL_BUNDLED.reading).questions[40].groupId'), 'a1-cloze-41-45');
assert.throws(() => run(`validateBank({schemaVersion:1,skill:'reading',questions:[{...state.data.reading[0],images:[{src:'../escape.png'}]}]})`));
assert.throws(() => run(`validateBank({schemaVersion:1,skill:'reading',questions:[state.data.reading[0],state.data.reading[0]]})`));
assert.equal(run(`validateBank({schemaVersion:1,skill:'reading',questions:[{...state.data.reading[0], images: undefined, source: undefined, examId: undefined, groupId: undefined, level:'A1'}]}).questions.length`), 1);
for (let n = 1; n <= 5; n++) {
  run(`prepareExam('band-a-${n}')`);
  assert.equal(el('#session-count').value, 50);
  assert.equal(el('#session-count').disabled, true);
  assert.equal(el('#session-shuffle').checked, false);
  run('beginSession({preventDefault(){}})');
  assert.equal(run('state.quiz.questions.length'), 50);
  assert.equal(run('state.quiz.limitSeconds'), 3600);
  assert.ok(!el('#quiz-content').innerHTML.includes('Kunci:'));
  assert.ok(!el('#quiz-content').innerHTML.includes('-answers.pdf'));
  for (let i = 0; i < 50; i++) run(`state.quiz.index = ${i}; renderQuiz(); selectOption(state.quiz.questions[${i}].answer)`);
  run('submitQuiz(true)');
  assert.equal(run('state.progress.sessions[0].score'), 50);
  assert.equal(run('state.progress.sessions[0].fullExam'), true);
  assert.ok(el('#quiz-content').innerHTML.includes('100%'));
  assert.ok(el('#quiz-content').innerHTML.includes('Hasil per bagian'));
  run('closeQuiz()');
}
run(`prepareExam('band-a-3', 4); beginSession({preventDefault(){}})`);
assert.equal(run('state.quiz.questions.length'), 10);
assert.equal(run('state.quiz.questions[0].questionNumber'), 36);
run(`selectOption('A'); state.quiz.index = 1; renderQuiz(); selectOption('A')`);
assert.equal(run('Object.keys(state.quiz.answers).length'), 1, 'Opsi paragraf ganda ditolak');
run(`state.quiz.index = 5; renderQuiz(); selectOption('A')`);
assert.equal(run('Object.keys(state.quiz.answers).length'), 2, 'Opsi sama boleh pada paragraf berbeda');
run('clearAnswer()'); assert.equal(run('Object.keys(state.quiz.answers).length'), 1);
run('toggleFlag()'); assert.equal(run('Object.values(state.quiz.flags)[0]'), true);
run('togglePause()'); assert.ok(el('#quiz-content').innerHTML.includes('Sesi dijeda'));
const index = run('state.quiz.index'); run('moveQuiz(1)'); assert.equal(run('state.quiz.index'), index);
run('togglePause(); closeQuiz()');
run(`prepareExam('band-a-1'); beginSession({preventDefault(){}})`);
run(`state.quiz.questions.slice(0,48).forEach(q => state.quiz.answers[questionKey(q)] = q.answer); state.quiz.answers[questionKey(state.quiz.questions[48])] = 'A'; submitQuiz(true)`);
assert.equal(run('state.progress.sessions[0].score'), 48);
assert.equal(run('state.progress.sessions[0].total'), 50);
run('renderReviews("wrong")'); assert.equal((el('#review-list').innerHTML.match(/<article/g) || []).length, 2);
run('retryWrong()'); assert.equal(run('state.pending.questions.length'), 2);
run('beginSession({preventDefault(){}}); state.quiz.limitSeconds = 1; state.quiz.elapsedMs = 1500; tick()');
assert.equal(run('state.quiz.result'), true);
assert.equal(run('state.progress.sessions[0].score'), 0);
assert.equal(run('state.progress.sessions[0].elapsed'), 1);
run('closeQuiz(); state.readingExam = "band-a-2"; state.readingSection = "5"; renderLibrary("reading")');
assert.ok(el('#reading-pagination').innerHTML.includes('5 soal'));
run('state.readingExam = "all"; state.readingSection = "all"; state.readingPage = 11; renderLibrary("reading")');
assert.equal((el('#reading-library').innerHTML.match(/<article/g) || []).length, 10);
run('location.protocol = "http:"'); await run('loadQuestionData(true)');
assert.equal(run('state.data.reading.length'), 250);
// Impor/ekspor menjaga metadata gambar dan kelompok.
const files = [{ size: 100, text: async () => JSON.stringify(reading) }];
ctx.importEvent = { target: { files, value: 'reading.json' } };
await run('importBanks(importEvent)');
assert.equal(run('state.bankOverrides.reading.questions.length'), 250);
assert.equal(run('state.bankOverrides.reading.questions[40].images[0].src'), reading.questions[40].images[0].src);
run('window.lastExport = null; downloadJSON = (name, data) => { window.lastExport = {name, data}; }; exportBank("reading")');
assert.equal(run('window.lastExport.data.questions.length'), 250);
assert.equal(run('window.lastExport.data.questions[40].groupId'), 'a1-cloze-41-45');
console.log('LULUS: 250 kunci, 5 paket, 7 kelompok paragraf, aset, bank lama, pilihan, hapus/tanda/jeda, skor 250/250, skor parsial, ulangi salah, timer, filter, impor/ekspor, dan pemuatan offline/HTTP.');
console.log('Catatan: pemeriksaan Node memakai DOM minimal; tidak memverifikasi layout/tampilan browser.');

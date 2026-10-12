/* TOCFL Studio beta 1.0 — JavaScript vanilla, tanpa dependensi.
 * Skema bank: { schemaVersion: 1, skill: 'reading'|'listening', questions: [] }
 * Kunci jawaban berada di sisi klien; aplikasi ini untuk latihan mandiri.
 */
'use strict';
const STORAGE_KEY = 'tocfl-studio-progress-v1';
const BANK_KEY = 'tocfl-studio-banks-v1';
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const freshProgress = () => ({ targetLevel: 'TOCFL Band B', answered: {}, sessions: [], totalSeconds: 0, sessionCount: 0 });
const state = {
  data: { reading: [], listening: [] }, progress: loadProgress(), ready: false,
  filters: { reading: 'all', listening: 'all' }, searches: { reading: '', listening: '' },
  bankOverrides: {}, audioURLs: new Map(), quiz: null, pending: null, focusReturn: null,
};
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  syncTargetUI();
  routeFromHash();
  await loadQuestionData();
  renderAll();
}

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function writeStorage(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); return true; }
  catch { showToast('Browser menolak penyimpanan. Data tetap aktif di tab ini; ekspor data sebelum menutup.'); return false; }
}
function loadProgress() {
  const saved = readStorage(STORAGE_KEY, null);
  if (!saved || typeof saved !== 'object') return freshProgress();
  const base = freshProgress();
  if (['TOCFL Band A', 'TOCFL Band B', 'TOCFL Band C'].includes(saved.targetLevel)) base.targetLevel = saved.targetLevel;
  if (saved.answered && typeof saved.answered === 'object' && !Array.isArray(saved.answered)) {
    for (const [key, val] of Object.entries(saved.answered)) {
      if (val && typeof val.correct === 'boolean') base.answered[key] = val;
    }
  }
  base.sessions = Array.isArray(saved.sessions) ? saved.sessions.filter(s => s && typeof s.title === 'string' && Number.isInteger(s.total) && s.total > 0 && Number.isInteger(s.score) && s.score >= 0 && s.score <= s.total && Number.isFinite(s.elapsed) && s.elapsed >= 0 && !Number.isNaN(Date.parse(s.completedAt))).slice(0, 100) : [];
  base.totalSeconds = Number.isFinite(saved.totalSeconds) ? Math.max(0, saved.totalSeconds) : 0;
  base.sessionCount = Number.isInteger(saved.sessionCount) ? Math.max(saved.sessionCount, base.sessions.length) : base.sessions.length;
  return base;
}
function saveProgress() { return writeStorage(STORAGE_KEY, state.progress); }

function validateBank(payload, expectedSkill) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Bank harus berupa objek JSON dengan schemaVersion, skill, dan questions.');
  if (payload.schemaVersion !== 1) throw new Error('schemaVersion harus bernilai 1.');
  if (!['reading', 'listening'].includes(payload.skill)) throw new Error('skill harus reading atau listening.');
  if (expectedSkill && payload.skill !== expectedSkill) throw new Error(`File ini harus berisi skill ${expectedSkill}.`);
  if (!Array.isArray(payload.questions) || payload.questions.length > 1000) throw new Error('questions harus berupa array, maksimal 1.000 soal per bank.');
  const seen = new Set();
  const requiredText = (value, field, id) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 30000) throw new Error(`${id}: ${field} harus teks berisi 1–30.000 karakter.`);
    return value.trim();
  };
  const optionalText = (value, field, id) => value == null || value === '' ? '' : requiredText(value, field, id);
  const questions = payload.questions.map((q, i) => {
    if (!q || typeof q !== 'object') throw new Error(`Soal ${i + 1} tidak valid.`);
    const id = requiredText(q.id, 'id', `Soal ${i + 1}`);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error(`${id}: id harus huruf, angka, garis bawah atau tanda hubung (maks. 80).`);
    if (seen.has(id)) throw new Error(`${id}: id duplikat dalam bank.`);
    seen.add(id);
    if (!LEVELS.includes(q.level)) throw new Error(`${id}: level harus A1, A2, B1, B2, C1, atau C2.`);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) throw new Error(`${id}: sediakan 2–6 opsi.`);
    const optionIDs = new Set();
    const options = q.options.map(o => {
      if (!o || typeof o.id !== 'string' || !/^[A-F]$/.test(o.id) || optionIDs.has(o.id)) throw new Error(`${id}: id opsi harus unik, A sampai F.`);
      optionIDs.add(o.id);
      return { id: o.id, text: requiredText(o.text, 'teks opsi', id) };
    });
    if (!optionIDs.has(q.answer)) throw new Error(`${id}: answer harus sama dengan salah satu id opsi.`);
    const audio = optionalText(q.audio, 'audio', id);
    if (audio && !isSafeAudioPath(audio)) throw new Error(`${id}: audio harus path relatif, misalnya audio/l01.mp3; URL luar dan '..' tidak didukung.`);
    const tags = q.tags ?? [];
    if (!Array.isArray(tags) || tags.length > 10 || tags.some(t => typeof t !== 'string' || t.length > 80)) throw new Error(`${id}: tags harus array maksimal 10 teks singkat.`);
    return {
      id, skill: payload.skill, level: q.level, title: requiredText(q.title, 'title', id),
      topic: optionalText(q.topic, 'topic', id), prompt: requiredText(q.prompt, 'prompt', id),
      passage: optionalText(q.passage, 'passage', id), audio, transcript: optionalText(q.transcript, 'transcript', id),
      options, answer: q.answer, explanation: requiredText(q.explanation, 'explanation', id), tags,
      isDemo: q.isDemo === true,
    };
  });
  return { schemaVersion: 1, skill: payload.skill, questions };
}
function isSafeAudioPath(path) {
  return typeof path === 'string' && !path.startsWith('/') && !/[\\:#?%\u0000-\u001f]/.test(path) && !path.split('/').some(p => p === '..' || p === '.' || !p) && /\.(mp3|wav|m4a|ogg|webm)$/i.test(path);
}

async function loadQuestionData(ignoreOverrides = false) {
  state.ready = false;
  const overrides = ignoreOverrides ? {} : readStorage(BANK_KEY, {});
  state.bankOverrides = {};
  const failures = [];
  const results = await Promise.allSettled(['reading', 'listening'].map(async skill => {
    if (overrides?.[skill]) {
      const bank = validateBank(overrides[skill], skill);
      state.bankOverrides[skill] = bank;
      return bank;
    }
    const response = await fetch(`data/${skill}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return validateBank(await response.json(), skill);
  }));
  results.forEach((result, i) => {
    const skill = ['reading', 'listening'][i];
    if (result.status === 'fulfilled') state.data[skill] = result.value.questions;
    else { state.data[skill] = []; failures.push(`${capitalise(skill)}: ${result.reason.message}`); }
  });
  state.ready = true;
  $('#data-status').classList.toggle('has-error', !!failures.length);
  $('#data-status').textContent = failures.length
    ? `Bank belum dimuat. ${failures.join(' · ')} Buka “Bank soal & audio” untuk impor manual, atau jalankan server lokal sesuai panduan.txt.`
    : 'Beta · Contoh soal bukan soal resmi TOCFL. Tambahkan audio Anda untuk mengaktifkan contoh Listening.';
}

function bindEvents() {
  window.addEventListener('hashchange', routeFromHash);
  $('#mobile-menu').addEventListener('click', () => {
    const open = $('.sidebar').classList.toggle('open');
    $('#mobile-menu').setAttribute('aria-expanded', String(open));
  });
  $('#close-quiz').addEventListener('click', requestCloseQuiz);
  $('#close-settings').addEventListener('click', () => closeModal('settings-modal'));
  $('#close-setup').addEventListener('click', () => closeModal('setup-modal'));
  $('#open-settings').addEventListener('click', () => { $('#target-level-select').value = state.progress.targetLevel; openModal('settings-modal'); });
  $('#save-settings').addEventListener('click', () => {
    state.progress.targetLevel = $('#target-level-select').value;
    const saved = saveProgress(); syncTargetUI(); closeModal('settings-modal');
    if (saved) showToast('Target belajar disimpan.');
  });
  $('#reset-progress').addEventListener('click', resetProgress);
  $('#progress-reset-button').addEventListener('click', resetProgress);
  $('#previous-question').addEventListener('click', () => moveQuiz(-1));
  $('#next-question').addEventListener('click', () => moveQuiz(1));
  $('#submit-quiz').addEventListener('click', () => state.quiz?.result ? closeQuiz() : submitQuiz(false));
  $('#toggle-timer').addEventListener('click', togglePause);
  $('#setup-form').addEventListener('submit', beginSession);
  $('#session-level').addEventListener('change', updateSetup);
  $('#session-timed').addEventListener('change', () => { $('#session-minutes').disabled = !$('#session-timed').checked; });
  $('#bank-input').addEventListener('change', importBanks);
  $('#audio-input').addEventListener('change', importAudio);
  $('#restore-banks').addEventListener('click', async () => {
    if (!window.confirm('Hapus bank impor dari browser dan muat ulang file data/reading.json serta data/listening.json? Ekspor dulu jika masih diperlukan.')) return;
    writeStorage(BANK_KEY, {});
    await loadQuestionData(true); renderAll();
  });
  document.addEventListener('click', event => {
    const start = event.target.closest('[data-start]');
    if (start) prepareSession(start.dataset.start);
    const single = event.target.closest('[data-start-single]');
    if (single) {
      const mode = single.dataset.skill;
      const q = state.data[mode].find(item => item.id === single.dataset.startSingle);
      if (q) prepareSession(mode, [q]);
    }
    const option = event.target.closest('[data-option-id]');
    if (option) selectOption(option.dataset.optionId);
    const jump = event.target.closest('[data-jump]');
    if (jump && state.quiz && !state.quiz.result && !state.quiz.paused) { state.quiz.index = Number(jump.dataset.jump); renderQuiz(); }
    if (event.target.closest('.nav-link')) { $('.sidebar').classList.remove('open'); $('#mobile-menu').setAttribute('aria-expanded', 'false'); }
    const exp = event.target.closest('[data-export-bank]');
    if (exp) exportBank(exp.dataset.exportBank);
    if (event.target.closest('[data-export-progress]')) downloadJSON('tocfl-progress.json', state.progress);
    if (event.target.closest('[data-retry-wrong]')) retryWrong();
  });
  ['reading', 'listening'].forEach(skill => {
    $(`#${skill}-filters`).addEventListener('click', event => {
      const button = event.target.closest('[data-filter]'); if (!button) return;
      state.filters[skill] = button.dataset.filter;
      $$(`#${skill}-filters button`).forEach(b => b.classList.toggle('active', b === button));
      renderLibrary(skill);
    });
    $(`#${skill}-search`).addEventListener('input', event => { state.searches[skill] = event.target.value; renderLibrary(skill); });
  });
  $$('.modal-backdrop').forEach(modal => modal.addEventListener('click', event => {
    if (event.target === modal) modal.id === 'quiz-modal' ? requestCloseQuiz() : closeModal(modal.id);
  }));
  document.addEventListener('keydown', handleKeys);
  window.addEventListener('beforeunload', event => {
    if (state.quiz && !state.quiz.result) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (state.quiz && !state.quiz.result) tick(); });
}

function routeFromHash() {
  const route = location.hash.slice(1) || 'dashboard';
  const safe = ['dashboard', 'reading', 'listening', 'progress', 'guide', 'bank'].includes(route) ? route : 'dashboard';
  $$('.page-view').forEach(view => view.classList.toggle('active', view.dataset.view === safe));
  $$('.nav-link').forEach(link => { link.classList.toggle('active', link.dataset.route === safe); link.setAttribute('aria-current', link.dataset.route === safe ? 'page' : 'false'); });
  const label = { dashboard: 'Dashboard', reading: 'Reading', listening: 'Listening', progress: 'Progres', guide: 'Panduan', bank: 'Bank soal & audio' }[safe];
  $('#breadcrumb').innerHTML = `Workspace <span>/</span> ${escapeHtml(label)}`;
  window.scrollTo({ top: 0, behavior: 'auto' });
}
function questionKey(q) { return `${q.skill}:${q.id}`; }
function fingerprint(q) { return JSON.stringify([q.prompt, q.passage, q.audio, q.options, q.answer]); }
function answerRecord(q) { const r = state.progress.answered[questionKey(q)]; return r?.fingerprint === fingerprint(q) ? r : null; }
function aggregate() {
  const all = [...state.data.reading, ...state.data.listening];
  const answered = all.filter(q => answerRecord(q)?.selected);
  const correct = answered.filter(q => answerRecord(q).correct).length;
  return { all, answered: answered.length, correct, accuracy: answered.length ? Math.round(correct / answered.length * 100) : 0, completion: all.length ? Math.round(answered.length / all.length * 100) : 0 };
}
function renderAll() {
  for (const skill of ['reading', 'listening']) {
    const count = state.data[skill].length;
    $(`#${skill}-nav-count`).textContent = count;
    $(`#${skill}-card-count`).textContent = count;
    $(`#${skill}-library-total`).textContent = count;
    renderLibrary(skill);
  }
  renderDashboard(); renderProgress(); renderBank(); syncTargetUI();
}
function renderDashboard() {
  const stats = aggregate();
  const metrics = [
    { label: 'Soal dikerjakan', value: stats.answered, sub: `dari ${stats.all.length} soal aktif` },
    { label: 'Akurasi terkini', value: stats.answered ? `${stats.accuracy}%` : '—', sub: 'jawaban terakhir per soal', accent: true },
    { label: 'Sesi selesai', value: state.progress.sessionCount, sub: 'seluruh sesi yang dikirim' },
    { label: 'Waktu belajar', value: formatDuration(state.progress.totalSeconds), sub: 'tidak termasuk waktu jeda' },
  ];
  $('#dashboard-metrics').innerHTML = metrics.map(m => `<article class="metric-card${m.accent ? ' accent' : ''}"><span class="metric-label">${m.label}</span><strong>${m.value}</strong><small>${m.sub}</small></article>`).join('');
  $('#target-completed').textContent = stats.answered; $('#target-total').textContent = stats.all.length;
  $('#target-progress-bar').style.width = `${stats.completion}%`;
  $('#recent-activity').innerHTML = state.progress.sessions.length ? state.progress.sessions.slice(0, 4).map(s => `<div class="activity-row"><span class="activity-icon ${s.mode === 'listening' ? 'listening' : ''}">${s.mode === 'listening' ? '◖' : '文'}</span><div><strong>${escapeHtml(s.title)}</strong><small>${formatDate(s.completedAt)} · ${s.total} soal</small></div><span class="activity-score">${s.score}/${s.total}</span></div>`).join('') : '<div class="activity-empty">Belum ada aktivitas.<br />Mulai satu sesi untuk melihat progres Anda.</div>';
}
function renderLibrary(skill) {
  const query = state.searches[skill].trim().toLowerCase();
  const questions = state.data[skill].filter(q => (state.filters[skill] === 'all' || q.level === state.filters[skill]) && [q.id, q.title, q.topic, q.prompt, ...q.tags].join(' ').toLowerCase().includes(query));
  $(`#${skill}-library`).innerHTML = questions.length ? questions.map(q => `<article class="question-card"><div class="question-card-top"><span class="question-id">${escapeHtml(q.id)}${q.isDemo ? ' · DEMO' : ''}</span><span class="level-badge ${q.level[0].toLowerCase()}">${q.level}</span></div><h3>${escapeHtml(q.title)}</h3><p>${escapeHtml(q.topic || (skill === 'reading' ? 'Pemahaman bacaan' : 'Pemahaman audio'))}</p><div class="question-tags"><span>${skill === 'listening' ? (q.audio ? '♫ Audio tertaut' : 'Audio belum diisi') : '文 Teks bacaan'}</span>${q.tags.slice(0, 2).map(t => `<span>#${escapeHtml(t)}</span>`).join('')}</div><div class="question-card-footer"><small>${answerRecord(q)?.selected ? '✓ Pernah dijawab' : `${q.options.length} pilihan`}</small><button type="button" data-start-single="${escapeHtml(q.id)}" data-skill="${skill}"${skill === 'listening' && !q.audio ? ' disabled' : ''}>${skill === 'listening' && !q.audio ? 'Perlu audio' : 'Latihan →'}</button></div></article>`).join('') : '<div class="library-empty">Tidak ada soal yang cocok. Periksa filter atau impor JSON melalui Bank soal &amp; audio.</div>';
}
function renderProgress() {
  const s = aggregate();
  $('#progress-summary').innerHTML = `<div class="progress-stat"><span>Soal dikerjakan</span><strong>${s.completion}%</strong><small>${s.answered}/${s.all.length} soal aktif</small></div><div class="progress-stat"><span>Akurasi terakhir</span><strong>${s.answered ? `${s.accuracy}%` : '—'}</strong><small>${s.correct} benar</small></div><div class="progress-stat"><span>Sesi selesai</span><strong>${state.progress.sessionCount}</strong><small>${formatDuration(state.progress.totalSeconds)} belajar</small></div>`;
  $('#progress-history').innerHTML = state.progress.sessions.length ? `<p class="small-note">Menampilkan maksimal 100 sesi terakhir. Akurasi di atas dihitung dari jawaban terakhir atas soal dalam bank aktif.</p><button class="secondary-button" data-export-progress>Ekspor riwayat JSON</button><table class="history-table"><thead><tr><th>Sesi</th><th>Benar</th><th>Durasi</th><th>Selesai</th></tr></thead><tbody>${state.progress.sessions.map(s => `<tr><td>${escapeHtml(s.title)}</td><td class="score-good">${s.score}/${s.total}</td><td>${formatDuration(s.elapsed)}</td><td>${formatDate(s.completedAt)}</td></tr>`).join('')}</tbody></table>` : '<div class="history-empty">Riwayat muncul setelah sesi pertama dikirim.</div>';
}
function renderBank() {
  $('#bank-summary').innerHTML = `<div class="bank-counts">${['reading', 'listening'].map(skill => `<div><strong>${capitalise(skill)}</strong><span>${state.data[skill].length} soal · ${state.bankOverrides[skill] ? 'hasil impor' : 'JSON bawaan'}</span></div>`).join('')}</div><p class="small-note">${state.data.listening.filter(q => !q.audio).length} soal listening belum memiliki path audio. Ubah nilai audio sebelum mengimpor bank. File audio tidak disimpan di localStorage.</p>`;
}

async function importBanks(event) {
  const files = [...event.target.files]; if (!files.length) return;
  try {
    if (files.length > 2) throw new Error('Pilih maksimal dua file: satu Reading dan satu Listening.');
    const parsed = [];
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name}: ukuran JSON maksimal 8 MB.`);
      parsed.push(validateBank(JSON.parse(await file.text())));
    }
    if (new Set(parsed.map(b => b.skill)).size !== parsed.length) throw new Error('Jangan pilih dua bank dengan skill yang sama dalam satu impor.');
    const replace = parsed.filter(b => state.data[b.skill].length);
    if (replace.length && !window.confirm(`Ganti bank ${replace.map(b => capitalise(b.skill)).join(' dan ')} dengan file terpilih? Bank lain tetap tersedia.`)) return;
    for (const bank of parsed) { state.bankOverrides[bank.skill] = bank; state.data[bank.skill] = bank.questions; }
    const saved = writeStorage(BANK_KEY, state.bankOverrides);
    $('#bank-message').textContent = `${parsed.map(b => `${b.questions.length} soal ${capitalise(b.skill)}`).join(' dan ')} berhasil diimpor.${saved ? ' Tersimpan di browser ini.' : ' Aktif di tab ini saja.'}`;
    $('#data-status').classList.remove('has-error');
    $('#data-status').textContent = 'Bank aktif siap digunakan. Kunci dan pembahasan tampil setelah sesi dikirim.';
    renderAll();
  } catch (error) { $('#bank-message').textContent = `Impor ditolak: ${error.message} Bank yang aktif tidak diubah.`; }
  finally { event.target.value = ''; }
}
function importAudio(event) {
  const files = [...event.target.files]; if (!files.length) return;
  try {
    const names = new Set();
    for (const file of files) {
      if (!/\.(mp3|wav|m4a|ogg|webm)$/i.test(file.name)) throw new Error(`${file.name}: format tidak didukung.`);
      if (!file.size || file.size > 80 * 1024 * 1024) throw new Error(`${file.name}: file harus berisi data dan maksimal 80 MB.`);
      if (names.has(file.name)) throw new Error(`Nama file duplikat: ${file.name}.`);
      names.add(file.name);
    }
    for (const file of files) {
      if (state.audioURLs.has(file.name)) URL.revokeObjectURL(state.audioURLs.get(file.name));
      state.audioURLs.set(file.name, URL.createObjectURL(file));
    }
    const matched = state.data.listening.filter(q => q.audio && state.audioURLs.has(q.audio.split('/').pop())).length;
    $('#audio-message').textContent = `${state.audioURLs.size} file audio terhubung; cocok dengan ${matched} soal listening. Pilih kembali audio setelah tab ditutup atau dimuat ulang.`;
  } catch (error) { $('#audio-message').textContent = error.message; }
  finally { event.target.value = ''; }
}
function exportBank(skill) { downloadJSON(`${skill}.json`, { schemaVersion: 1, skill, questions: state.data[skill].map(({ skill: ignored, ...q }) => q) }); }
function downloadJSON(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function prepareSession(mode, questions = null) {
  if (!state.ready) return showToast('Tunggu hingga bank soal selesai dimuat.');
  if (!['reading', 'listening', 'mixed'].includes(mode)) return;
  state.pending = { mode, questions };
  $('#setup-title').textContent = questions?.length === 1 ? 'Latihan satu soal' : `${mode === 'mixed' ? 'Campuran' : capitalise(mode)} · pengaturan`;
  $('#session-level').value = 'all'; $('#session-level').disabled = !!questions;
  $('#session-timed').checked = false; $('#session-minutes').disabled = true;
  $('#session-count').value = Math.min(10, availableQuestions().length) || 1;
  updateSetup(); openModal('setup-modal');
}
function availableQuestions() {
  if (!state.pending) return [];
  const { mode, questions } = state.pending;
  const source = questions || (mode === 'mixed' ? [...state.data.reading, ...state.data.listening] : state.data[mode]);
  const level = $('#session-level').value;
  return source.filter(q => (level === 'all' || q.level === level) && (q.skill !== 'listening' || !!q.audio));
}
function updateSetup() {
  const count = availableQuestions().length;
  $('#session-count').max = Math.max(1, count);
  $('#session-count').value = Math.min(Number($('#session-count').value) || 1, count || 1);
  $('#begin-session').disabled = !count;
  $('#setup-availability').textContent = count ? `${count} soal tersedia pada pilihan ini.` : 'Belum ada soal siap latihan. Impor soal dan isi path audio untuk Listening.';
}
function beginSession(event) {
  event.preventDefault();
  const count = Number($('#session-count').value), minutes = Number($('#session-minutes').value);
  let questions = availableQuestions();
  if (!Number.isInteger(count) || count < 1 || count > questions.length) return showToast('Jumlah soal tidak valid.');
  if ($('#session-timed').checked && (!Number.isInteger(minutes) || minutes < 1 || minutes > 240)) return showToast('Batas waktu harus 1–240 menit.');
  if ($('#session-shuffle').checked) questions = shuffle(questions);
  questions = questions.slice(0, count);
  const mode = state.pending.mode, limitSeconds = $('#session-timed').checked ? minutes * 60 : null;
  closeModal('setup-modal');
  state.quiz = { mode, questions, index: 0, answers: {}, paused: false, result: false, elapsedMs: 0, clockStart: Date.now(), limitSeconds, timerId: null };
  openModal('quiz-modal');
  $('#quiz-timer').classList.remove('warning');
  renderQuiz();
  state.quiz.timerId = window.setInterval(tick, 250);
}
function elapsedMs() { const q = state.quiz; return q ? q.elapsedMs + (q.paused || q.result ? 0 : Math.max(0, Date.now() - q.clockStart)) : 0; }
function tick() {
  if (!state.quiz || state.quiz.result || state.quiz.paused) return;
  const seconds = elapsedMs() / 1000;
  if (state.quiz.limitSeconds !== null && seconds >= state.quiz.limitSeconds) { submitQuiz(true); return; }
  renderTimer();
}
function renderTimer() {
  if (!state.quiz) return;
  const q = state.quiz;
  const elapsed = elapsedMs() / 1000;
  const remaining = q.limitSeconds === null ? Math.floor(elapsed) : Math.max(0, Math.ceil(q.limitSeconds - elapsed));
  $('#quiz-timer').textContent = q.paused ? 'JEDA' : formatDuration(remaining);
  $('#quiz-timer').classList.toggle('warning', q.limitSeconds !== null && remaining <= 30);
  $('#quiz-timer').setAttribute('aria-label', `${q.limitSeconds === null ? 'Waktu belajar' : 'Sisa waktu'} ${formatDuration(remaining)}`);
}
function togglePause() {
  const q = state.quiz; if (!q || q.result) return;
  if (!q.paused) { q.elapsedMs = elapsedMs(); q.paused = true; }
  else { q.clockStart = Date.now(); q.paused = false; }
  pauseAudio(); renderQuiz();
}
function pauseAudio() { $$('#quiz-content audio').forEach(a => a.pause()); }
function renderQuiz() {
  const qz = state.quiz; if (!qz || qz.result) return;
  pauseAudio();
  const q = qz.questions[qz.index], total = qz.questions.length;
  $('#quiz-type').textContent = `${q.skill.toUpperCase()} · ${q.level}${q.isDemo ? ' · DEMO' : ''}`;
  $('#quiz-title').textContent = q.title;
  $('#quiz-counter').textContent = `Soal ${qz.index + 1} dari ${total} · ${Object.keys(qz.answers).length} terjawab`;
  $('#quiz-progress-fill').style.width = `${Object.keys(qz.answers).length / total * 100}%`;
  $('#toggle-timer').style.visibility = 'visible'; $('#toggle-timer').textContent = qz.paused ? 'Lanjutkan' : 'Jeda';
  $('#previous-question').style.display = 'inline-flex'; $('#previous-question').disabled = qz.paused || qz.index === 0;
  $('#next-question').style.display = qz.index < total - 1 ? 'inline-flex' : 'none'; $('#next-question').disabled = qz.paused;
  $('#submit-quiz').style.display = 'inline-flex'; $('#submit-quiz').textContent = 'Kirim sesi'; $('#submit-quiz').disabled = qz.paused;
  $('#quiz-jump').innerHTML = qz.questions.map((item, i) => `<button type="button" class="jump-button${qz.answers[questionKey(item)] ? ' answered' : ''}${qz.index === i ? ' current' : ''}" data-jump="${i}" aria-label="Soal ${i + 1}${qz.answers[questionKey(item)] ? ', sudah dijawab' : ', belum dijawab'}"${qz.index === i ? ' aria-current="step"' : ''}${qz.paused ? ' disabled' : ''}>${i + 1}</button>`).join('');
  renderTimer();
  if (qz.paused) { $('#quiz-content').innerHTML = '<div class="pause-screen"><strong>Sesi dijeda</strong><p>Soal disembunyikan selama jeda. Klik “Lanjutkan” untuk kembali.</p></div>'; return; }
  const passage = q.passage ? `<div class="quiz-passage" lang="zh-Hant"><small>TEKS BACAAN</small>${multiline(q.passage)}</div>` : '';
  const audio = q.skill === 'listening' ? audioBlock(q) : '';
  $('#quiz-content').innerHTML = `${passage}${audio}<div class="quiz-prompt" lang="zh-Hant">${multiline(q.prompt)}</div><div class="quiz-options">${q.options.map(o => `<button class="quiz-option${qz.answers[questionKey(q)] === o.id ? ' selected' : ''}" type="button" data-option-id="${o.id}" aria-pressed="${qz.answers[questionKey(q)] === o.id}"><span class="option-letter">${o.id}</span><span lang="zh-Hant">${escapeHtml(o.text)}</span></button>`).join('')}</div>`;
  const audioEl = $('#quiz-content audio');
  if (audioEl) audioEl.addEventListener('error', () => {
    $('#audio-error').hidden = false;
    $('#audio-error').textContent = `Audio tidak dapat diputar: ${q.audio}. Periksa nama file, format, dan hubungkan audio melalui Bank soal & audio.`;
  }, { once: true });
}
function audioBlock(q) {
  const source = state.audioURLs.get(q.audio.split('/').pop()) || q.audio;
  return `<div class="audio-player"><span aria-hidden="true">♫</span><audio controls preload="metadata" src="${escapeHtml(source)}" aria-label="Rekaman soal ${escapeHtml(q.id)}"></audio></div><p class="audio-caption">Audio dapat diulang. Transkrip muncul dalam pembahasan setelah sesi dikirim.</p><p id="audio-error" class="audio-error" role="alert" hidden></p>`;
}
function selectOption(optionId) {
  const qz = state.quiz; if (!qz || qz.result || qz.paused) return;
  tick(); if (qz.result) return;
  const q = qz.questions[qz.index]; if (!q.options.some(o => o.id === optionId)) return;
  qz.answers[questionKey(q)] = optionId;
  // Only update options: do not recreate the audio element during playback.
  $$('#quiz-content [data-option-id]').forEach(button => { const selected = button.dataset.optionId === optionId; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  $('#quiz-counter').textContent = `Soal ${qz.index + 1} dari ${qz.questions.length} · ${Object.keys(qz.answers).length} terjawab`;
  $('#quiz-progress-fill').style.width = `${Object.keys(qz.answers).length / qz.questions.length * 100}%`;
  $(`[data-jump="${qz.index}"]`)?.classList.add('answered');
}
function moveQuiz(direction) {
  const q = state.quiz; if (!q || q.result || q.paused) return;
  const next = q.index + direction;
  if (next < 0 || next >= q.questions.length) return;
  q.index = next; renderQuiz(); $('.quiz-body').scrollTop = 0;
}
function submitQuiz(auto = false) {
  const q = state.quiz; if (!q || q.result) return;
  const unanswered = q.questions.filter(item => !q.answers[questionKey(item)]).length;
  if (!auto && !window.confirm(unanswered ? `${unanswered} soal belum dijawab dan akan dihitung salah. Kirim sesi sekarang?` : 'Kirim jawaban dan tampilkan pembahasan?')) return;
  q.elapsedMs = q.limitSeconds === null ? elapsedMs() : Math.min(elapsedMs(), q.limitSeconds * 1000);
  q.result = true; clearInterval(q.timerId); pauseAudio();
  const elapsed = Math.round(q.elapsedMs / 1000);
  const score = q.questions.filter(item => q.answers[questionKey(item)] === item.answer).length;
  const timestamp = new Date().toISOString();
  q.questions.forEach(item => {
    const selected = q.answers[questionKey(item)];
    if (selected) state.progress.answered[questionKey(item)] = { selected, correct: selected === item.answer, fingerprint: fingerprint(item), lastAnsweredAt: timestamp };
  });
  state.progress.totalSeconds += elapsed; state.progress.sessionCount += 1;
  state.progress.sessions.unshift({ mode: q.mode, title: q.mode === 'mixed' ? 'Latihan campuran' : `Latihan ${capitalise(q.mode)}`, score, total: q.questions.length, elapsed, completedAt: timestamp, timed: q.limitSeconds !== null });
  state.progress.sessions = state.progress.sessions.slice(0, 100);
  const saved = saveProgress();
  renderAll(); renderResult(score, elapsed, saved, auto);
}
function renderResult(score, elapsed, saved, auto) {
  const q = state.quiz, total = q.questions.length, percent = Math.round(score / total * 100);
  $('#quiz-type').textContent = 'HASIL LATIHAN'; $('#quiz-title').textContent = 'Hasil & pembahasan';
  $('#quiz-counter').textContent = `${score} dari ${total} benar`; $('#quiz-progress-fill').style.width = '100%';
  $('#quiz-jump').innerHTML = ''; $('#toggle-timer').style.visibility = 'hidden';
  $('#quiz-timer').textContent = formatDuration(elapsed); $('#quiz-timer').classList.remove('warning');
  $('#previous-question').style.display = 'none'; $('#next-question').style.display = 'none';
  $('#submit-quiz').style.display = 'inline-flex'; $('#submit-quiz').textContent = 'Selesai'; $('#submit-quiz').disabled = false;
  $('#quiz-content').innerHTML = `<div class="quiz-result"><div class="result-orb">${percent}%</div><h3>${auto ? 'Waktu latihan selesai.' : 'Sesi selesai.'}</h3><p>${saved ? 'Hasil tersimpan di browser ini.' : 'Penyimpanan tidak tersedia; ekspor riwayat sebelum menutup.'} Nilai ini adalah persentase jawaban benar, bukan skor resmi TOCFL.</p><div class="result-stats"><div class="result-stat"><strong>${score}/${total}</strong><small>benar</small></div><div class="result-stat"><strong>${formatDuration(elapsed)}</strong><small>waktu aktif</small></div><div class="result-stat"><strong>${Object.keys(q.answers).length}/${total}</strong><small>terjawab</small></div></div>${score < total ? '<button class="secondary-button" data-retry-wrong>Ulangi soal salah / kosong →</button>' : ''}<div class="answer-review"><h4>Review setiap soal</h4>${q.questions.map((item, i) => reviewRow(item, i)).join('')}</div></div>`;
  $('.quiz-body').scrollTop = 0;
}
function reviewRow(q, index) {
  const selected = state.quiz.answers[questionKey(q)], correct = selected === q.answer;
  const selectedOption = q.options.find(o => o.id === selected), key = q.options.find(o => o.id === q.answer);
  return `<article class="review-row ${correct ? 'correct' : 'wrong'}"><strong>${index + 1}. ${correct ? 'Benar' : selected ? 'Perlu diulang' : 'Belum dijawab'} · ${escapeHtml(q.id)}</strong><p class="review-prompt" lang="zh-Hant">${multiline(q.prompt)}</p><p>Jawaban Anda: <span lang="zh-Hant">${selectedOption ? `${selectedOption.id}. ${escapeHtml(selectedOption.text)}` : 'Belum dijawab'}</span><br />Kunci: <span lang="zh-Hant">${key.id}. ${escapeHtml(key.text)}</span></p><p><b>Pembahasan:</b> ${multiline(q.explanation)}</p>${q.transcript ? `<details><summary>Transkrip audio</summary><p class="transcript" lang="zh-Hant">${multiline(q.transcript)}</p></details>` : ''}${q.passage ? `<details><summary>Lihat teks bacaan</summary><p class="transcript" lang="zh-Hant">${multiline(q.passage)}</p></details>` : ''}</article>`;
}
function retryWrong() {
  if (!state.quiz?.result) return;
  const mode = state.quiz.mode, questions = state.quiz.questions.filter(q => state.quiz.answers[questionKey(q)] !== q.answer);
  closeQuiz(); prepareSession(mode, questions);
}
function requestCloseQuiz() {
  if (state.quiz && !state.quiz.result && !window.confirm('Keluar dari sesi? Jawaban sesi yang belum dikirim tidak akan disimpan.')) return;
  closeQuiz();
}
function closeQuiz() { pauseAudio(); clearInterval(state.quiz?.timerId); state.quiz = null; $('#quiz-content').innerHTML = ''; closeModal('quiz-modal'); }

function openModal(id) {
  state.focusReturn = document.activeElement;
  const modal = $(`#${id}`); modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden'; $('.app-shell').inert = true;
  modal.querySelector('button:not([disabled]),input:not([disabled]),select:not([disabled])')?.focus();
}
function closeModal(id) {
  const modal = $(`#${id}`); modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = ''; $('.app-shell').inert = false;
  if (state.focusReturn?.isConnected) state.focusReturn.focus();
}
function handleKeys(event) {
  const modal = $('.modal-backdrop.open');
  if (!modal) {
    if (event.key === 'Escape') { $('.sidebar').classList.remove('open'); $('#mobile-menu').setAttribute('aria-expanded', 'false'); }
    return;
  }
  if (event.key === 'Escape') { event.preventDefault(); modal.id === 'quiz-modal' ? requestCloseQuiz() : closeModal(modal.id); }
  if (event.key === 'Tab') {
    const focusables = $$('button:not([disabled]),input:not([disabled]),select:not([disabled]),audio,summary,a[href]', modal).filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const first = focusables[0], last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
function resetProgress() {
  if (!window.confirm('Hapus semua progres dan riwayat di browser ini? Bank soal dan file sumber tetap tersedia.')) return;
  state.progress = freshProgress(); const saved = saveProgress(); renderAll();
  if (saved) showToast('Progres telah direset.');
}
function syncTargetUI() { $('#target-level-label').textContent = state.progress.targetLevel; }
function showToast(message) {
  const toast = $('#toast'); if (!toast) return;
  toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 6500);
}
function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function formatDuration(seconds) { const total = Math.max(0, Math.floor(Number(seconds) || 0)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function formatDate(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(d); }
function shuffle(items) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function multiline(value) { return escapeHtml(value).replace(/\n/g, '<br />'); }

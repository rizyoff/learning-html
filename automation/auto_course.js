/**
 * =============================================================================
 *  AutoCourse — Coursera: auto skip video + next item + AI Tutor (quiz)
 * =============================================================================
 *
 *  CARA PAKAI:
 *  1. Buka halaman lecture Coursera (mis. /learn/<course>/lecture/...).
 *  2. Buka DevTools -> tab Console (Cmd+Opt+J / Ctrl+Shift+J).
 *     - Chrome minta "allow pasting"? Ketik "allow pasting" lalu Enter, lalu paste.
 *  3. Copy SELURUH isi file ini, paste di Console, tekan Enter.
 *  4. Panel muncul di pojok kanan bawah -> otomatisasi berjalan.
 *
 *  YANG DI-OTOMASI:
 *   ✓ Video diputar 16x + di-seek mendekati akhir -> video selesai cepat
 *   ✓ Tombol "Next / Berikutnya / Pergi ke item berikutnya" diklik otomatis
 *   ✓ Reading material: "Mark as read / Tandai sudah dibaca" diklik otomatis
 *
 *  MODE TUTOR (halaman quiz / graded attempt):
 *   ✓ Soal diekstrak dari DOM -> dianalisis AI -> ditampilkan di panel
 *     (kandidat jawaban + confidence + alasan)
 *   ✗ TIDAK ada klik otomatis ke pilihan jawaban maupun tombol Submit.
 *     Kamu yang memilih & submit — AI hanya memberi analisis.
 *
 *  KONFIGURASI AI (opsional, untuk analisis otomatis):
 *    - Tanpa API key (default): klik [Salin Soal] -> paste ke ChatGPT/Claude manual.
 *    - Dengan API key (endpoint OpenAI-compatible: OpenAI/DeepSeek/OpenRouter/Groq/Ollama):
 *        window.__AUTO_COURSE__.setAI({
 *          apiKey: 'sk-...',
 *          endpoint: 'https://api.openai.com/v1/chat/completions',  // default
 *          model: 'gpt-4o-mini'                                    // default
 *        });
 *      Key disimpan di localStorage browser (khusus device-mu).
 *
 *  DEBUG JIKA SOAL TIDAK TERDETEKSI:
 *    window.__AUTO_COURSE__.dump()   // ekstrak + salin HTML area quiz ke clipboard
 *    lalu kirim hasilnya ke assistant buat disesuaikan selektornya.
 *
 *  BERHENTI: klik [Stop] di panel, atau  window.__AUTO_COURSE__.stop()
 *
 *  ⚠️ Pakai untuk akun & tanggung jawabmu sendiri. Otomatisasi bisa melanggar
 *     ToS platform dan bukan pengganti belajar sungguhan.
 * =============================================================================
 */

(function () {
  'use strict';

  // Toggle: kalau ada instance berjalan, hentikan lalu ganti dengan versi ini.
  if (window.__AUTO_COURSE__ && window.__AUTO_COURSE__.state.running) {
    window.__AUTO_COURSE__.stop();
    console.log('[AutoCourse] Instance lama dihentikan — memulai versi baru.');
  }

  // ------------------------------ KONFIGURASI ------------------------------
  const CFG = {
    playbackRate: 16,        // kecepatan video (0.25 - 16)
    seekMarginSec: 20,       // detik dari akhir video yang mulai di-kejar. 0 = langsung ke ujung
    muteVideo: true,         // bisukan video biar gak berisik
    tickMs: 1000,            // interval cek halaman (ms)
    nextDelayMs: 2500,       // jeda minimum antar klik Next (hindari double click)
    markReadDelayMs: 1500,   // jeda setelah Mark as read sebelum klik Next
    maxNextRetryPerItem: 8,  // batas retry Next per item (kalau mentok -> stop)
    giveUpAfterTicks: 15,    // berapa lama (tick) tanpa tombol Next sebelum dinyatakan selesai
    // AI Tutor — endpoint OpenAI-compatible (OpenAI, DeepSeek, OpenRouter, Groq, Ollama)
    ai: {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: '',
      model: 'gpt-4o-mini',
      temperature: 0.2,
    },
  };

  // Label tombol: Indonesia dulu (locale akun id_ID), lalu English fallback.
  const NEXT_LABELS = [
    'pergi ke item berikutnya',        // icon-button di player (aria-label)
    'lanjutkan ke item berikutnya',
    'item berikutnya', 'berikutnya', 'lanjutkan', 'lanjut',
    'tandai sudah dibaca dan lanjutkan', 'mark as read and continue',
    'mark complete and continue', 'go to next item', 'next item', 'next', 'continue',
  ];
  const MARK_READ_LABELS = [
    'tandai sudah dibaca', 'tandai selesai', 'sudah dibaca',
    'mark as read', 'mark as complete', 'mark complete',
  ];

  const CTRL_SEL = 'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]';
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const AI_SYSTEM = [
    'Kamu adalah tutor belajar untuk kuis online. Analisis setiap soal dan tentukan',
    'jawaban terbaik berdasarkan pengetahuan umum materi kuliah terkait.',
    'Balas HANYA dengan JSON valid, tanpa teks lain, dengan format:',
    '{"answers":[{"id":1,"choice":["B"],"confidence":85,"reason":"penjelasan singkat dalam Bahasa Indonesia"}]}',
    '- id = nomor soal (mulai 1, sesuai urutan input)',
    '- choice = huruf opsi; untuk soal banyak pilihan pakai beberapa huruf dalam array',
    '- confidence = 0-100 (seberapa yakin)',
    '- reason = alasan singkat kenapa pilihan itu benar',
  ].join(' ');

  // ------------------------------ STATE ------------------------------
  const state = {
    running: false,
    mode: 'normal',            // 'normal' | 'tutor'
    timer: null,
    lastUrl: location.href,
    ticksOnSameUrl: 0,
    nextClicksOnItem: 0,
    markReadDoneFor: '',
    lastNextAt: 0,
    playFailedOnce: false,
    tutor: { sig: '', analyzing: false, questions: [] },
  };

  // ------------------------------ UTIL ------------------------------
  const log = (...a) => console.log('%c[AutoCourse]', 'color:#4da3ff;font-weight:bold', ...a);
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function isUsable(el) {
    return isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  }
  function textOf(el) {
    return norm([
      el.textContent,
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.getAttribute && el.getAttribute('data-testid'),
    ].filter(Boolean).join(' '));
  }

  /** Cari tombol yang terlihat, cocok dengan salah satu label (exact dulu, lalu contains). */
  function findClickable(labels) {
    const els = Array.from(document.querySelectorAll(
      'button, [role="button"], a[class*="cds-button"], a[role="button"]'
    )).filter(isUsable);

    for (const label of labels) {                 // 1) kecocokan persis
      const hit = els.find((el) => textOf(el) === label);
      if (hit) return hit;
    }
    for (const label of labels) {                 // 2) mengandung label
      const hit = els.find((el) => textOf(el).includes(label));
      if (hit) return hit;
    }
    return null;
  }

  // ------------------------------ DETEKSI JENIS ITEM ------------------------------
  function looksLikeQuizOrPeer() {
    const path = norm(location.pathname);
    // attempt = halaman graded quiz Coursera (/assignment-submission/.../attempt)
    if (/\/(quiz|exam|assessment|peer-?review|peergraded|assignment-submission|submission|attempt)(\/|$|\?)/.test(path)) {
      return true;
    }
    // fallback: ada kontrol soal (radio/checkbox) DAN heading menyebut quiz
    if (!document.querySelector(CTRL_SEL)) return false;
    const headings = Array.from(document.querySelectorAll('h1, h2'))
      .map((h) => norm(h.textContent)).join(' | ');
    return /\b(kuis|quiz|ujian|exam|peer review|penilaian sejawat|attempt)\b/.test(headings);
  }

  // ------------------------------ VIDEO ------------------------------
  function handleVideo(v) {
    if (v.readyState < 1) return 'loading'; // metadata belum ada, tunggu

    const dur = v.duration;
    const ended = v.ended ||
      (Number.isFinite(dur) && dur > 0 && v.currentTime >= dur - 0.3);

    // PENTING: cek 'ended' SEBELUM play(). Video yang sudah ended, kalau
    // di-play() akan RESTART dari detik 0 -> v.ended jadi false lagi ->
    // tombol Next tidak pernah diklik (bug lama).
    if (ended) return 'ended';

    if (Number.isFinite(dur) && dur > 0) {
      const target = Math.max(0, dur - CFG.seekMarginSec);
      // kejar akhir video (ended akan memberi sinyal selesai ke player)
      if (v.currentTime < target - 1) {
        try { v.currentTime = target; } catch (e) { /* ignore */ }
      }
    }

    // Coursera kadang nge-reset playbackRate -> paksa ulang tiap tick
    if (v.playbackRate !== CFG.playbackRate) {
      try { v.playbackRate = CFG.playbackRate; } catch (e) { /* ignore */ }
    }
    if (CFG.muteVideo && !v.muted) v.muted = true;

    if (v.paused) {
      const p = v.play();
      if (p && p.catch) {
        p.catch(() => {
          if (!state.playFailedOnce) {
            state.playFailedOnce = true;
            setStatus('⚠ Play diblokir browser — klik sekali di halaman lalu jalankan ulang script.');
            log('play() ditolak. Klik dulu di halaman (user gesture), lalu jalankan script lagi.');
          }
        });
      }
    }
    return 'playing';
  }

  // ------------------------------ EKSTRAKSI SOAL ------------------------------
  function controlsIn(root) {
    return Array.from(root.querySelectorAll(CTRL_SEL));
  }

  /** Ancestor terkekat yang memuat >=2 kontrol soal = wadah 1 grup opsi. */
  function smallestGroup(el) {
    let n = el.parentElement;
    while (n && n !== document.body && n !== document.documentElement) {
      if (controlsIn(n).length >= 2) return n;
      n = n.parentElement;
    }
    return null;
  }

  function optText(el) {
    const label = el.closest ? el.closest('label') : null;
    let t = (label && label.innerText) || el.getAttribute('aria-label') || '';
    if (!t && el.parentElement) t = el.parentElement.innerText;
    return clean(t);
  }

  /** Kelompokkan kontrol: per wadah visual dulu, fallback ke name attribute. */
  function groupControls(controls) {
    const byBox = new Map();
    controls.forEach((c) => {
      const box = smallestGroup(c) || c.parentElement || c;
      if (!byBox.has(box)) byBox.set(box, []);
      byBox.get(box).push(c);
    });
    if (byBox.size >= 2) return Array.from(byBox.values());

    const byName = new Map();
    controls.filter((c) => c.name).forEach((c) => {
      if (!byName.has(c.name)) byName.set(c.name, []);
      byName.get(c.name).push(c);
    });
    const nameGroups = Array.from(byName.values());
    if (nameGroups.length >= 2 && nameGroups.every((g) => g.length >= 2)) return nameGroups;

    return byBox.size ? Array.from(byBox.values()) : [controls];
  }

  /** Teks pertanyaan: coba aria/label dulu, lalu selector prompt, lalu heuristik baris. */
  function promptOf(group) {
    // 1) referensi aria pada kontrol pertama
    const c0 = group[0];
    const refId = c0.getAttribute('aria-labelledby') || c0.getAttribute('aria-describedby');
    if (refId) {
      const ref = document.getElementById(refId.split(/\s+/)[0]);
      if (ref && clean(ref.innerText).length > 3) return clean(ref.innerText);
    }

    // 2) wadah soal + elemen prompt di dalamnya
    const box = c0.closest(
      '[class*="Question"], [class*="question"], [data-testid*="question"], [data-testid*="Question"], article, section'
    ) || (smallestGroup(c0) || c0.parentElement);
    if (box) {
      const promptEl = box.querySelector(
        '[class*="prompt"], [class*="Prompt"], [data-testid*="prompt"], legend, ' +
        '[class*="QuestionTitle"], [class*="question-title"], [class*="stem"]'
      );
      if (promptEl && clean(promptEl.innerText).length > 3) return clean(promptEl.innerText);
    }

    // 3) heuristik: baris teks di wadah soal yang bukan opsi
    const scope = box || document.body;
    const optSet = new Set(group.map(optText).filter(Boolean));
    const lines = clean(scope.innerText).split('\n').map((s) => clean(s)).filter(Boolean);
    const cand = lines.filter((l) =>
      !optSet.has(l) && !/^[a-e]\.?\s+\S/i.test(l) && !/^(submit|kumpulkan|berikutnya|next)/i.test(l)
    ).slice(0, 5);
    return cand.join(' ');
  }

  /** Ambil semua soal: [{prompt, options:[...]}] */
  function extractQuestions() {
    const controls = Array.from(document.querySelectorAll(CTRL_SEL)).filter((el) => {
      const box = el.closest('label') || el;
      return isVisible(box) || isVisible(el);
    });
    if (!controls.length) return [];

    const groups = groupControls(controls);
    const seen = new Set();
    const out = [];

    groups.forEach((group) => {
      // dedupe opsi (Coursera kadang render input ganda), buang teks kosong
      const opts = [];
      const optSeen = new Set();
      group.forEach((c) => {
        const t = optText(c);
        if (t && !optSeen.has(t)) { optSeen.add(t); opts.push(t); }
      });
      if (opts.length < 2) return;             // butuh >=2 opsi agar dianggap soal

      const prompt = promptOf(group);
      const sig = prompt + '||' + opts.join('||');
      if (seen.has(sig)) return;               // buang duplikat DOM
      seen.add(sig);
      out.push({ prompt: prompt || '(judul soal tidak terbaca)', options: opts });
    });

    return out;
  }

  function questionsText(qs) {
    return qs.map((q, i) =>
      'Soal ' + (i + 1) + ':\n' + q.prompt + '\n' +
      q.options.map((o, j) => '  ' + LETTERS[j] + '. ' + o).join('\n')
    ).join('\n\n');
  }

  function sigOf(qs) {
    return JSON.stringify(qs.map((q) => [q.prompt, q.options]));
  }

  // ------------------------------ AI ------------------------------
  function parseAI(text) {
    let t = clean(text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { /* fallback */ }
    }
    try { return JSON.parse(t); } catch (err) { return null; }
  }

  async function askAI(qs) {
    const ai = CFG.ai;
    if (!ai.apiKey) throw new Error('API key belum diatur — jalankan setAI({apiKey:"..."})');

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const to = ctrl ? setTimeout(() => ctrl.abort(), 60000) : null;
    try {
      const res = await fetch(ai.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ai.apiKey },
        body: JSON.stringify({
          model: ai.model,
          temperature: ai.temperature,
          messages: [
            { role: 'system', content: AI_SYSTEM },
            { role: 'user', content: questionsText(qs) },
          ],
        }),
        signal: ctrl ? ctrl.signal : undefined,
      });
      const bodyText = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + bodyText.slice(0, 160));

      let data;
      try { data = JSON.parse(bodyText); } catch (err) { throw new Error('Respons bukan JSON: ' + bodyText.slice(0, 160)); }
      const content = data && data.choices && data.choices[0] &&
        data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('Struktur respons tak dikenal: ' + bodyText.slice(0, 160));

      return { parsed: parseAI(content), raw: content };
    } finally {
      if (to) clearTimeout(to);
    }
  }

  // ------------------------------ TUTOR (UI + alur) ------------------------------
  let uiStatus = null;
  let uiTutor = null;
  function setStatus(text) { if (uiStatus) uiStatus.textContent = text; }

  function confColor(n) {
    if (n >= 80) return '#4ade80';
    if (n >= 50) return '#facc15';
    return '#f87171';
  }

  function renderQuestions(qs) {
    if (!uiTutor) return;
    uiTutor.innerHTML = '';
    const head = document.createElement('div');
    head.textContent = '📋 ' + qs.length + ' soal terdeteksi:';
    head.style.cssText = 'font-weight:700;margin-bottom:4px;color:#7dd3fc';
    uiTutor.appendChild(head);
    qs.forEach((q, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:4px;opacity:.85';
      row.textContent = (i + 1) + '. ' + (q.prompt.length > 90 ? q.prompt.slice(0, 90) + '…' : q.prompt);
      uiTutor.appendChild(row);
    });
  }

  function renderResult(qs, out) {
    if (!uiTutor) return;
    uiTutor.innerHTML = '';
    const head = document.createElement('div');
    head.textContent = '🤖 Analisis AI — pilih jawabanmu sendiri:';
    head.style.cssText = 'font-weight:700;margin-bottom:6px;color:#7dd3fc';
    uiTutor.appendChild(head);

    const answers = out.parsed && Array.isArray(out.parsed.answers) ? out.parsed.answers : null;
    if (!answers) {
      const pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;margin:0;font-size:10px;opacity:.8';
      pre.textContent = out.raw;
      uiTutor.appendChild(pre);
      return;
    }

    answers.forEach((a) => {
      const q = qs[a.id - 1];
      const letters = Array.isArray(a.choice) ? a.choice : [a.choice];
      const idxs = letters.map((l) => LETTERS.indexOf(String(l).trim().toUpperCase().charAt(0)));
      const opts = idxs.filter((i) => i >= 0 && q && q.options[i])
        .map((i) => LETTERS[i] + '. ' + q.options[i]);
      const conf = Number.isFinite(a.confidence) ? a.confidence : null;

      const block = document.createElement('div');
      block.style.cssText = 'margin-bottom:8px;border-left:2px solid #334155;padding-left:6px';

      const line1 = document.createElement('div');
      line1.style.cssText = 'font-weight:600';
      const confTxt = conf !== null ? ' (' + conf + '%)' : '';
      line1.textContent = 'Q' + a.id + ' → ' + (opts.join(' | ') || ('pilihan: ' + letters.join(','))) + confTxt;
      if (conf !== null) line1.style.color = confColor(conf);

      const line2 = document.createElement('div');
      line2.style.cssText = 'opacity:.8;font-size:11px';
      line2.textContent = a.reason || '';

      block.append(line1, line2);
      uiTutor.appendChild(block);
    });
  }

  async function analyze(force) {
    if (!state.running || state.mode !== 'tutor' || state.tutor.analyzing) return;

    const qs = extractQuestions();
    if (!qs.length) {
      setStatus('⚠ Soal belum terdeteksi — klik [Dump] lalu kirim hasilnya.');
      return;
    }
    state.tutor.questions = qs;

    const sig = sigOf(qs);
    if (!force && sig === state.tutor.sig) return;
    state.tutor.sig = sig;

    renderQuestions(qs);

    if (!CFG.ai.apiKey) {
      setStatus('Belum ada API key — klik [Salin Soal] lalu paste ke ChatGPT/Claude.');
      return;
    }

    state.tutor.analyzing = true;
    setStatus('Menganalisis ' + qs.length + ' soal dengan ' + CFG.ai.model + '…');
    try {
      const out = await askAI(qs);
      renderResult(qs, out);
      setStatus('Analisis selesai — klik pilihanmu lalu submit manual.');
      log('Analisis AI:', out.parsed ? out.parsed.answers : out.raw);
    } catch (e) {
      setStatus('⚠ AI error: ' + e.message);
      log('AI error:', e);
    } finally {
      state.tutor.analyzing = false;
    }
  }

  function enterTutor() {
    if (state.mode !== 'tutor') {
      state.mode = 'tutor';
      state.tutor.sig = '';
      if (uiTutor) uiTutor.style.display = 'block';
      log('Mode TUTOR aktif — klik otomatis dimatikan, AI hanya menganalisis soal.');
      setStatus('Mode tutor: menganalisis soal…');
    }
    analyze(false);
  }

  function leaveTutor() {
    if (state.mode === 'tutor') {
      state.mode = 'normal';
      state.tutor.sig = '';
      if (uiTutor) { uiTutor.style.display = 'none'; uiTutor.innerHTML = ''; }
      log('Kembali ke mode normal.');
    }
  }

  async function copyQuestions() {
    const qs = extractQuestions();
    if (!qs.length) { setStatus('Tidak ada soal terdeteksi — klik [Dump].'); return; }
    const text = questionsText(qs);
    try {
      await navigator.clipboard.writeText(text);
      setStatus(qs.length + ' soal disalin — paste ke ChatGPT/Claude.');
      log('Soal disalin ke clipboard.');
    } catch (e) {
      log('Clipboard diblokir. Salin manual:\n\n' + text);
      setStatus('Clipboard diblokir — lihat Console untuk teks soal.');
    }
  }

  /** Debug: ekstrak soal + salin HTML area quiz ke clipboard (kirim ke assistant). */
  function dump() {
    const qs = extractQuestions();
    log('Hasil ekstraksi:', qs);
    const box = document.querySelector(
      '[class*="Question"], [class*="question"], [data-testid*="question"], main'
    ) || document.body;
    const html = (box.outerHTML || '').slice(0, 30000);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(html).then(
        () => log('HTML area quiz disalin (' + html.length + ' char) — kirim ke assistant.'),
        () => log(html)
      );
    } else {
      log(html);
    }
    return qs;
  }

  function setAI(cfg) {
    Object.assign(CFG.ai, cfg);
    try {
      localStorage.setItem('autocourse_ai', JSON.stringify(CFG.ai));
      log('Konfigurasi AI disimpan.', cfg.apiKey ? 'Key: ' + String(cfg.apiKey).slice(0, 8) + '…' : '');
    } catch (e) { log('Gagal simpan ke localStorage:', e.message); }
  }

  function loadAI() {
    try {
      const s = localStorage.getItem('autocourse_ai');
      if (s) Object.assign(CFG.ai, JSON.parse(s));
    } catch (e) { /* ignore */ }
  }

  // ------------------------------ AKSI (mode normal) ------------------------------
  function maybeNext() {
    const url = location.href;
    const now = Date.now();

    // Anti double-click / anti-rate-limit
    if (state.lastNextAt && now - state.lastNextAt < CFG.nextDelayMs) return;

    if (state.nextClicksOnItem >= CFG.maxNextRetryPerItem) {
      setStatus('⚠ Next tidak bisa diklik — otomatisasi dihentikan.');
      log('Next mentok di', url, '(kemungkinan item terkunci / butuh submit manual).');
      stop();
      return;
    }

    const btn = findClickable(NEXT_LABELS);
    if (!btn) {
      if (state.ticksOnSameUrl > CFG.giveUpAfterTicks) {
        setStatus('🏁 Tidak ada tombol Next — materi sepertinya sudah selesai.');
        log('Selesai: tidak ada Next di', url);
        stop();
      }
      return;
    }

    state.lastNextAt = now;
    state.nextClicksOnItem++;
    btn.click();
    log('Klik Next dari:', url, '| tombol:',
        btn.getAttribute('aria-label') || btn.textContent.trim().slice(0, 40));
    setStatus('Next → item berikutnya…');
  }

  function step() {
    const url = location.href;

    // URL berubah = pindah item -> reset penjaga
    if (url !== state.lastUrl) {
      state.lastUrl = url;
      state.ticksOnSameUrl = 0;
      state.nextClicksOnItem = 0;
      state.markReadDoneFor = '';
      state.lastNextAt = 0;
      log('Item baru:', document.title || url);
    }
    state.ticksOnSameUrl++;

    // --- Quiz / peer review -> mode tutor (TANPA klik apa pun)
    if (looksLikeQuizOrPeer()) {
      enterTutor();
      return;
    }
    leaveTutor();

    // --- Ada video? -> percepat sampai habis, baru Next
    const v = document.querySelector('video');
    if (v) {
      const s = handleVideo(v);
      if (s === 'loading') setStatus('Memuat video…');
      else if (s === 'ended') { setStatus('Video selesai → klik Next…'); maybeNext(); }
      else setStatus('Video dipercepat ' + CFG.playbackRate + 'x …');
      return;
    }

    // --- Item non-video (reading / halaman diskusi / course home)
    const markBtn = findClickable(MARK_READ_LABELS);
    if (markBtn && state.markReadDoneFor !== url) {
      markBtn.click();
      state.markReadDoneFor = url;
      log('Klik Mark as read di:', url);
      setStatus('Tandai sudah dibaca → lanjut…');
      setTimeout(maybeNext, CFG.markReadDelayMs);
      return;
    }
    maybeNext();
  }

  // ------------------------------ UI PANEL ------------------------------
  const BTN_CSS = [
    'background:#1e293b', 'color:#e2e8f0', 'border:1px solid #334155',
    'border-radius:8px', 'padding:4px 9px', 'cursor:pointer',
    'font:600 11px system-ui',
  ].join(';');

  function mkBtn(label, onClick, css) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = css || BTN_CSS;
    b.addEventListener('click', onClick);
    return b;
  }

  function createUI() {
    const old = document.getElementById('autocourse-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'autocourse-panel';
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'background:#0f172a', 'color:#e2e8f0', 'padding:10px 14px',
      'border-radius:12px', 'box-shadow:0 8px 28px rgba(0,0,0,.45)',
      'font:12px/1.5 -apple-system,system-ui,sans-serif',
      'width:320px', 'box-sizing:border-box',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = '🤖 AutoCourse (Coursera)';
    title.style.cssText = 'font-weight:700;margin-bottom:4px;color:#7dd3fc';

    uiStatus = document.createElement('div');
    uiStatus.textContent = 'Menjalankan…';
    uiStatus.style.cssText = 'margin-bottom:6px;opacity:.9';

    uiTutor = document.createElement('div');
    uiTutor.style.cssText = [
      'display:none', 'max-height:30vh', 'overflow-y:auto',
      'border-top:1px solid #334155', 'padding-top:6px', 'margin-bottom:6px',
    ].join(';');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center';
    row.append(
      mkBtn('▶ Start', () => { start(); setStatus('Menjalankan…'); },
        BTN_CSS + ';background:#065f46;border-color:#059669'),
      mkBtn('Stop', () => { stop(); setStatus('Dihentikan.'); },
        BTN_CSS + ';background:#7f1d1d;border-color:#dc2626'),
      mkBtn('Analisis', () => analyze(true), BTN_CSS + ';background:#1e40af;border-color:#3b82f6'),
      mkBtn('Salin Soal', copyQuestions),
      mkBtn('Dump', dump),
    );

    panel.append(title, uiStatus, uiTutor, row);
    document.body.appendChild(panel);
  }

  // ------------------------------ START / STOP ------------------------------
  function tick() {
    if (!state.running) return;
    try { step(); } catch (e) { log('error:', e.message); }
  }

  function start() {
    if (state.running) return;
    state.running = true;
    if (!document.getElementById('autocourse-panel')) createUI();
    tick();
    state.timer = setInterval(tick, CFG.tickMs);
    log('Berjalan di:', location.href);
  }

  function stop() {
    state.running = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    // kembalikan kecepatan video normal
    document.querySelectorAll('video').forEach((v) => {
      try { v.playbackRate = 1; } catch (e) { /* ignore */ }
    });
  }

  // API untuk Console:
  //   window.__AUTO_COURSE__.stop() / .start()
  //   window.__AUTO_COURSE__.setAI({ apiKey:'sk-...', model:'deepseek-chat', endpoint:'...' })
  //   window.__AUTO_COURSE__.analyze(true)  // paksa analisis ulang
  //   window.__AUTO_COURSE__.dump()         // debug ekstraksi soal
  window.__AUTO_COURSE__ = {
    start, stop, state, config: CFG,
    setAI, dump, copyQuestions,
    analyze: () => analyze(true),
  };

  loadAI();
  start();
})();

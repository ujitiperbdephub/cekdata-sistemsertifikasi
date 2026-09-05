/* Public render: ambil schema + data, bangun halaman DATA SRUT */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let DATA = {}, SCHEMA = { sections: [] };

  Promise.all([
    fetch('schema.json').then(r => r.json()),
    fetch('data.json').then(r => r.json())
  ]).then(([schema, data]) => {
    SCHEMA = schema; DATA = data || {};
    renderBrand();
    renderTitle();
    renderSections();
    renderFooter();
  });

  /* ---- brand header ---- */
  function renderBrand() {
    const b = DATA.brand || {};
    const fav = document.getElementById('favicon-link');
    if (fav && b.favicon) fav.href = b.favicon;
    const link = document.getElementById('brand-link');
    const mark = b.logo
      ? `<img src="${esc(b.logo)}" class="logo-img" alt="logo">`
      : `<span class="logo-icon"><i class="fa fa-globe"></i></span>`;
    const hasText = (b.line1 || b.line2);
    const text = hasText
      ? `<span class="logo-text"><span class="l1">${esc(b.line1 || '')}</span><span class="l2">${esc(b.line2 || '')}</span></span>`
      : '';
    link.innerHTML = mark + text;
  }

  function renderTitle() {
    document.getElementById('page-title').textContent = DATA.title || 'DATA SRUT';
    document.title = DATA.tab_title || DATA.title || 'Data SRUT';
  }

  /* ---- sections ---- */
  function renderSections() {
    const host = document.getElementById('sections');
    host.innerHTML = '';
    SCHEMA.sections.forEach(sec => {
      host.insertAdjacentHTML('beforeend',
        `<hr><h5><strong class="sect-title">${esc(sec.title)}</strong></h5><hr>`);
      if (sec.type === 'photos') host.insertAdjacentHTML('beforeend', photosHTML(sec));
      else host.insertAdjacentHTML('beforeend', tableHTML(sec));
    });
    // wire tombol lampiran
    host.querySelectorAll('.btn-lampiran').forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = btn.getAttribute('data-lsec'), key = btn.getAttribute('data-lkey');
        openViewer(normalizeList((DATA[sec] || {})[key]));
      });
    });
  }

  function normalizeList(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string' && v.trim()) return [v];
    return [];
  }

  function tableHTML(sec) {
    const vals = DATA[sec.id] || {};
    let rows = '';
    sec.rows.forEach(pair => {
      rows += '<tr>' + pair.map(cell => cellHTML(cell, vals, sec.id)).join('') + '</tr>';
    });
    return `<table class="table table-striped table-bordered"><tbody>${rows}</tbody></table>`;
  }

  function cellHTML(cell, vals, secId) {
    if (!cell) return `<td class="cell text-uppercase text-info">&nbsp;</td>`;
    const v = vals[cell.k];
    if (cell.type === 'file' || cell.type === 'files') {
      const btn = `<button type="button" class="btn-lampiran" data-lsec="${esc(secId)}" data-lkey="${esc(cell.k)}">` +
        `<i class="fa fa-file"></i>Lihat Lampiran Kendaraan</button>`;
      return `<td class="cell text-uppercase text-info">${esc(cell.label)}<br>${btn}</td>`;
    }
    return `<td class="cell text-uppercase text-info">${esc(cell.label)}<br>` +
      `<span class="val text-success">${esc(v)}</span></td>`;
  }

  function photosHTML(sec) {
    const vals = DATA[sec.id] || {};
    const cols = sec.photos.map(p => {
      const src = vals[p.k];
      const media = src
        ? `<img src="${esc(src)}" alt="${esc(p.label)}">`
        : `<div class="ph-empty">Belum ada foto</div>`;
      return `<div class="photo-col">${media}<span class="cap text-uppercase text-info">${esc(p.label)}</span></div>`;
    }).join('');
    return `<div class="row-photos">${cols}</div>`;
  }

  /* ---- footer ---- */
  function renderFooter() {
    const f = DATA.footer || {};
    document.getElementById('f-alamat-title').textContent = f.alamat_title || 'ALAMAT';
    document.getElementById('f-alamat').textContent = f.alamat || '';
    document.getElementById('f-tentang-title').textContent = f.tentang_title || 'TENTANG KAMI';
    document.getElementById('f-tentang').textContent = f.tentang || '';
    document.getElementById('f-copyright').textContent = f.copyright || '';
    const map = document.getElementById('f-map');
    let src = (f.map_embed || '').trim();
    if (src) {
      // terima kode <iframe ...> lengkap ATAU URL src saja
      const m = src.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
      if (m) src = m[1];
      map.innerHTML = `<iframe src="${esc(src)}" allowfullscreen loading="lazy"></iframe>`;
    } else { map.innerHTML = ''; }
  }

  /* ---- viewer lampiran: SEMUA lampiran digabung jadi 1 PDF, render via pdf.js ---- */
  const overlay = document.getElementById('viewer');
  const vDoc = document.getElementById('v-doc');
  const vName = document.getElementById('v-fname');
  const attCtl = document.getElementById('v-attctl');
  const pageCtl = document.getElementById('v-pagectl');
  const pgNum = document.getElementById('v-pgnum');
  const pgTot = document.getElementById('v-pgtot');
  const zoomLbl = document.getElementById('v-zoom');
  let items = [];
  let pdfDoc = null, fitScale = 1, zoomPct = 100, pdfToken = 0;
  let combinedBytes = null, combinedUrl = null;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdfjs/pdf.worker.min.js';
  }

  async function openViewer(list) {
    items = normalizeList(list);
    attCtl.hidden = true; // satu PDF gabungan -> tak perlu nav antar-file
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    await showCombined();
  }
  function closeViewer() {
    overlay.classList.remove('open');
    pdfToken++; pdfDoc = null;
    if (combinedUrl) { URL.revokeObjectURL(combinedUrl); combinedUrl = null; }
    vDoc.innerHTML = '';
    document.body.style.overflow = '';
  }

  async function showCombined() {
    pdfToken++; pdfDoc = null;
    vName.textContent = 'lampiran-kendaraan.pdf';
    if (!items.length) {
      vDoc.className = 'viewer-doc is-empty';
      vDoc.innerHTML = '<span class="empty">Belum ada lampiran. Upload melalui CMS.</span>';
      pageCtl.hidden = true;
      return;
    }
    vDoc.className = 'viewer-doc is-empty';
    vDoc.innerHTML = '<span class="empty"><i class="fa fa-spinner fa-spin"></i> &nbsp;Menggabungkan lampiran menjadi PDF…</span>';
    pageCtl.hidden = true;
    const token = pdfToken;
    try {
      const bytes = await buildCombinedPdf(items);
      if (token !== pdfToken) return;
      combinedBytes = bytes;
      if (combinedUrl) URL.revokeObjectURL(combinedUrl);
      combinedUrl = URL.createObjectURL(new Blob([combinedBytes], { type: 'application/pdf' }));
      vDoc.className = 'viewer-doc is-pdf';
      vDoc.innerHTML = '<div class="pdf-pages" id="v-pdf-pages"></div>';
      pageCtl.hidden = false;
      await loadPdf(combinedUrl);
    } catch (e) {
      vDoc.className = 'viewer-doc is-empty';
      vDoc.innerHTML = '<span class="empty">Gagal menyiapkan PDF: ' + esc(e && e.message ? e.message : String(e)) + '</span>';
      pageCtl.hidden = true;
    }
  }

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('gagal memuat gambar')); i.src = src; });
  }
  function dataUrlToBytes(dataUrl) {
    const b = atob(dataUrl.split(',')[1]); const arr = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
    return arr;
  }
  // gambar format apa pun -> byte yang pasti diterima pdf-lib (lewat canvas)
  async function imageForPdf(f, buf) {
    const url = URL.createObjectURL(new Blob([buf]));
    let im;
    try { im = await loadImage(url); } finally { URL.revokeObjectURL(url); }
    const c = document.createElement('canvas');
    c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
    c.getContext('2d').drawImage(im, 0, 0);
    const png = /\.png$/i.test(f);
    const dataUrl = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
    return { bytes: dataUrlToBytes(dataUrl), png };
  }

  // gabungkan semua file lampiran (foto/PDF) jadi satu dokumen PDF
  async function buildCombinedPdf(files) {
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    for (const f of files) {
      const buf = await fetch(f).then(r => r.arrayBuffer());
      if (/\.pdf$/i.test(f)) {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(p => out.addPage(p));
      } else {
        const { bytes, png } = await imageForPdf(f, buf);
        const img = png ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const page = out.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
    }
    return await out.save();
  }

  async function loadPdf(url) {
    const token = ++pdfToken;
    try {
      const doc = await pdfjsLib.getDocument(url).promise;
      if (token !== pdfToken) return;
      pdfDoc = doc; zoomPct = 100;
      pgTot.textContent = doc.numPages;
      await renderAllPages(token);
      updateZoomLabel();
      setPageNum(1);
    } catch (e) {
      vDoc.innerHTML = '<span class="empty">Gagal memuat PDF.</span>';
    }
  }

  async function renderAllPages(token) {
    const host = document.getElementById('v-pdf-pages');
    if (!host || !pdfDoc) return;
    host.innerHTML = '';
    const avail = Math.max(100, vDoc.clientWidth - 24);
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      if (token !== pdfToken) return;
      const page = await pdfDoc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = (avail / base.width) * (zoomPct / 100); // tiap halaman fit-lebar
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page'; canvas.dataset.page = p;
      canvas.width = vp.width; canvas.height = vp.height;
      host.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
  }

  function updateZoomLabel() { zoomLbl.textContent = zoomPct + '%'; }
  function setPageNum(n) { pgNum.value = n; }

  function currentPage() {
    const host = document.getElementById('v-pdf-pages');
    if (!host) return 1;
    const mid = vDoc.scrollTop + vDoc.clientHeight / 2;
    let best = 1, bestDist = Infinity;
    host.querySelectorAll('.pdf-page').forEach(c => {
      const center = c.offsetTop + c.offsetHeight / 2;
      const d = Math.abs(center - mid);
      if (d < bestDist) { bestDist = d; best = +c.dataset.page; }
    });
    return best;
  }
  function scrollToPage(n) {
    const host = document.getElementById('v-pdf-pages');
    if (!host) return;
    const c = host.querySelector('.pdf-page[data-page="' + n + '"]');
    if (c) vDoc.scrollTop = c.offsetTop - 6;
  }
  async function rezoom(delta) {
    if (!pdfDoc) return;
    zoomPct = Math.min(400, Math.max(25, zoomPct + delta));
    updateZoomLabel();
    const cur = currentPage();
    await renderAllPages(pdfToken);
    scrollToPage(cur);
  }

  // events
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.hasAttribute('data-close') ||
        e.target.closest('[data-close]')) closeViewer();
  });
  document.getElementById('v-pgup').addEventListener('click', () => { const n = Math.max(1, currentPage() - 1); setPageNum(n); scrollToPage(n); });
  document.getElementById('v-pgdn').addEventListener('click', () => { const n = Math.min(pdfDoc ? pdfDoc.numPages : 1, currentPage() + 1); setPageNum(n); scrollToPage(n); });
  document.getElementById('v-zin').addEventListener('click', () => rezoom(25));
  document.getElementById('v-zout').addEventListener('click', () => rezoom(-25));
  pgNum.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const n = parseInt(pgNum.value, 10); if (pdfDoc && n >= 1 && n <= pdfDoc.numPages) scrollToPage(n); }
  });
  vDoc.addEventListener('scroll', () => { if (pdfDoc) setPageNum(currentPage()); });

  function goFullscreen() {
    const el = document.querySelector('.viewer-frame');
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }
  document.getElementById('v-full').addEventListener('click', goFullscreen);
  document.getElementById('v-present').addEventListener('click', goFullscreen);
  document.getElementById('v-download').addEventListener('click', () => {
    if (!combinedBytes) return;
    const url = combinedUrl || URL.createObjectURL(new Blob([combinedBytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'lampiran-kendaraan.pdf';
    document.body.appendChild(a); a.click(); a.remove();
  });

  /* ---- back to top ---- */
  const btt = document.querySelector('.back-to-top');
  const headerEl = document.getElementById('header');
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    btt.style.display = y > 200 ? 'block' : 'none';
    if (headerEl) headerEl.classList.toggle('scrolled', y > 40);
  });
  btt.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

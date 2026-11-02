(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const CAT_LABEL = {
    Railway: 'रेलवे',
    'Public Awareness': 'जन-जागरूकता',
    'Civil Sense': 'सिविल सेंस',
    'Your Rights': 'आपके अधिकार',
  };

  let allNews = [];
  let activeCat = 'All';
  let isAdmin = false;

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString('hi-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  async function api(url, opts = {}) {
    const res = await fetch(url, { credentials: 'same-origin', ...opts });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || 'कुछ गड़बड़ हुई');
    return data;
  }
  function flash(el, msg, isError) {
    el.textContent = msg;
    el.className = isError ? 'error' : 'success';
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.textContent = ''), 4000);
  }

  // ---------- site images ----------
  async function loadSite() {
    try {
      const { profile, banner } = await api('/api/site');
      const photo = $('#brandPhoto');
      const globe = $('#brandPhotoWrap .globe');
      if (profile) { photo.src = profile; photo.hidden = false; globe.hidden = true; }
      else { photo.hidden = true; globe.hidden = false; }
      const tb = $('#topBanner');
      if (banner) { $('#topBannerImg').src = banner; tb.hidden = false; }
      else tb.hidden = true;
    } catch {}
  }

  // ---------- news ----------
  function renderNews() {
    const grid = $('#newsGrid');
    const list = activeCat === 'All' ? allNews : allNews.filter((n) => n.category === activeCat);
    if (!list.length) {
      grid.innerHTML = '<p class="empty">इस श्रेणी में अभी कोई खबर नहीं है।</p>';
      return;
    }
    grid.innerHTML = list.map((n) => `
      <article class="news-card" data-id="${esc(n.id)}">
        ${n.image ? `<img class="news-img" src="${esc(n.image)}" alt="${esc(n.title)}" loading="lazy">` : ''}
        <div class="news-body">
          <span class="tag">${esc(CAT_LABEL[n.category] || n.category)}</span>
          <h3>${esc(n.title)}</h3>
          <p class="news-text clamp">${esc(n.body)}</p>
          <div class="news-meta">
            <time>${fmtDate(n.createdAt)}</time>
            <button class="more" type="button">पूरा पढ़ें →</button>
          </div>
        </div>
      </article>`).join('');
  }
  async function loadNews() {
    try {
      allNews = await api('/api/news');
      renderNews();
      if (allNews[0]) $('#tickerText').textContent = allNews[0].title;
      if (isAdmin) renderManage();
    } catch {
      $('#newsGrid').innerHTML = '<p class="empty">खबरें लोड नहीं हो सकीं। कृपया पेज रीफ्रेश करें।</p>';
    }
  }
  function setCat(cat, scroll) {
    activeCat = cat;
    $$('.filter').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
    $$('.nav-link').forEach((a) => a.classList.toggle('selected', a.dataset.navcat === cat));
    renderNews();
    if (scroll) $('#latest').scrollIntoView({ behavior: 'smooth' });
  }

  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('.filter');
    if (b) setCat(b.dataset.cat, false);
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-navcat]');
    if (a) {
      e.preventDefault();
      setCat(a.dataset.navcat, true);
    }
  });
  $('#newsGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.more');
    if (!btn) return;
    const txt = btn.closest('.news-card').querySelector('.news-text');
    const open = txt.classList.toggle('clamp');
    btn.textContent = open ? 'पूरा पढ़ें →' : 'कम दिखाएँ ↑';
  });

  // ---------- admin modal ----------
  const modal = $('#adminModal');
  function openModal() {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
  }
  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
  }
  function showView() {
    $('#loginView').hidden = isAdmin;
    $('#dashboard').hidden = !isAdmin;
    if (isAdmin) renderManage();
  }
  function renderManage() {
    const box = $('#manageList');
    if (!allNews.length) { box.innerHTML = '<p class="muted">अभी कोई खबर प्रकाशित नहीं है।</p>'; return; }
    box.innerHTML = allNews.map((n) => `
      <div class="manage-item">
        <span><b>${esc(n.title)}</b><small>${esc(CAT_LABEL[n.category] || n.category)} • ${fmtDate(n.createdAt)}</small></span>
        <button type="button" class="del" data-id="${esc(n.id)}">हटाएँ</button>
      </div>`).join('');
  }

  $('#openAdmin').addEventListener('click', async () => {
    try { isAdmin = (await api('/api/me')).admin; } catch { isAdmin = false; }
    showView();
    openModal();
  });
  $('#closeAdmin').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#loginError');
    try {
      await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: f.username.value, password: f.password.value }),
      });
      f.reset();
      err.textContent = '';
      isAdmin = true;
      showView();
    } catch (ex) {
      flash(err, ex.message, true);
    }
  });
  $('#logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    isAdmin = false;
    showView();
  });

  function bindImageForm(formSel, url, msgSel, okText, removeSel, removeText) {
    const form = $(formSel);
    const msg = $(msgSel);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(url, { method: 'POST', body: new FormData(form) });
        form.reset();
        flash(msg, okText, false);
        loadSite();
      } catch (ex) { flash(msg, ex.message, true); }
    });
    $(removeSel).addEventListener('click', async () => {
      try {
        await api(url, { method: 'DELETE' });
        flash(msg, removeText, false);
        loadSite();
      } catch (ex) { flash(msg, ex.message, true); }
    });
  }
  bindImageForm('#profileForm', '/api/profile', '#profileMessage', 'DP / Logo अपडेट हो गया।', '#removeProfile', 'DP हटा दी गई।');
  bindImageForm('#bannerForm', '/api/banner', '#bannerMessage', 'बैनर अपडेट हो गया।', '#removeBanner', 'बैनर हटा दिया गया।');

  $('#newsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#adminMessage');
    try {
      await api('/api/news', { method: 'POST', body: new FormData(form) });
      form.reset();
      flash(msg, 'खबर प्रकाशित हो गई।', false);
      await loadNews();
    } catch (ex) { flash(msg, ex.message, true); }
  });
  $('#manageList').addEventListener('click', async (e) => {
    const b = e.target.closest('.del');
    if (!b || !confirm('क्या आप यह खबर हटाना चाहते हैं?')) return;
    try {
      await api('/api/news/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
      flash($('#adminMessage'), 'खबर हटा दी गई।', false);
      await loadNews();
    } catch (ex) { flash($('#adminMessage'), ex.message, true); }
  });

  $('#year').textContent = new Date().getFullYear();
  loadSite();
  loadNews();
})();

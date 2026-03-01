/**
 * ВИТЕХ — глобальная навигация сверху, локальная боковая только внутри модуля.
 * Модули: Главная (Мой день), Наряды, Учёба, Опросы, Планы, Рейтинг.
 */

(function () {
  const STORAGE_KEY = 'vitech_site_telegram_id';
  const isLocal = /localhost|127\.0\.0\.1/.test(window.location.hostname);
  const API_BASE = isLocal ? '' : 'https://vitechbot.online';

  let userId = null;
  let currentModule = 'home';

  function getStoredOrUrlUserId() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('telegram_id');
    if (fromUrl) {
      const id = parseInt(fromUrl, 10);
      if (!isNaN(id)) {
        try { localStorage.setItem(STORAGE_KEY, String(id)); } catch (_) {}
        return id;
      }
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return parseInt(stored, 10);
    } catch (_) {}
    return null;
  }

  function setActiveNav(module) {
    currentModule = module;
    document.querySelectorAll('.nav-link').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-module') === module);
    });
  }

  function showScreen(screenId) {
    document.querySelectorAll('.screen, .layout-with-sidebar').forEach(function (el) {
      el.style.display = 'none';
    });
    const el = document.getElementById(screenId);
    if (el) el.style.display = 'block';
  }

  function showModuleLayout(module, localNavItems, renderWorkArea) {
    setActiveNav(module);
    document.querySelectorAll('.screen').forEach(function (el) {
      el.style.display = 'none';
    });
    const layout = document.getElementById('screen-module');
    const sidebar = document.getElementById('local-nav');
    const workArea = document.getElementById('work-area');
    if (!layout || !sidebar || !workArea) return;
    layout.style.display = 'flex';
    sidebar.innerHTML = localNavItems.map(function (item) {
      const cls = item.active ? ' class="active"' : '';
      return '<a href="#" data-local="' + item.id + '"' + cls + '>' + item.label + '</a>';
    }).join('');
    workArea.innerHTML = '';
    if (typeof renderWorkArea === 'function') renderWorkArea(workArea);
    sidebar.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        sidebar.querySelectorAll('a').forEach(function (x) { x.classList.remove('active'); });
        a.classList.add('active');
        const id = a.getAttribute('data-local');
        if (window.onLocalNavClick && id) window.onLocalNavClick(id, workArea);
      });
    });
  }

  function setSubtitleDate() {
    const d = new Date();
    const day = d.getDay();
    let label = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    if (day === 0 || day === 6) label += ' — выходной';
    const el = document.getElementById('subtitle-date');
    if (el) el.textContent = label;
  }

  function avatarUrl(name, size) {
    const n = (name || '?').trim() || '?';
    return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(n) + '&background=3B82F6&color=fff&size=' + (size || 64);
  }

  function api(path) {
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    const url = API_BASE + path + sep + 'telegram_id=' + userId;
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    });
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  async function loadSchedule() {
    const listEl = document.getElementById('list-schedule');
    const metaEl = document.getElementById('schedule-meta');
    if (!listEl) return;
    const d = new Date();
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    try {
      const data = await api('/api/schedule/today');
      const lessons = data.lessons || [];
      const message = data.message;
      if (metaEl) metaEl.textContent = isWeekend ? 'Выходной — с понедельника новая учебная неделя' : 'сегодня';
      if (lessons.length === 0) {
        if (message) listEl.innerHTML = '<li class="schedule-weekend">' + message + '</li>';
        else if (isWeekend) listEl.innerHTML = '<li class="schedule-weekend">Выходной. В понедельник начнётся новая учебная неделя.</li>';
        else listEl.innerHTML = '<li class="list-placeholder">На сегодня занятий нет</li>';
        return;
      }
      listEl.innerHTML = lessons.map(function (l) {
        const parts = [l.time, l.subject].filter(Boolean);
        if (l.room) parts.push('(' + l.room + ')');
        if (l.teacher) parts.push('— ' + l.teacher);
        return '<li>' + parts.join(' ') + '</li>';
      }).join('');
    } catch (e) {
      listEl.innerHTML = '<li class="error-msg">Не удалось загрузить расписание</li>';
      if (metaEl) metaEl.textContent = '';
    }
  }

  async function loadDutiesWidget() {
    const contentEl = document.getElementById('duty-content');
    const metaEl = document.getElementById('duty-meta');
    if (!contentEl) return;
    try {
      const data = await api('/api/duties');
      if (data.error) {
        contentEl.innerHTML = '<p class="list-placeholder">' + data.error + '</p>';
        if (metaEl) metaEl.textContent = '';
        return;
      }
      const next = data.next_duty;
      if (!next) {
        contentEl.innerHTML = '<p class="list-placeholder">Нарядов нет</p>';
        if (metaEl) metaEl.textContent = '';
        return;
      }
      const roleFull = next.role_full || next.role || '';
      const dateStr = next.date;
      const dateFormatted = dateStr ? new Date(dateStr + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' }) : '';
      if (metaEl) metaEl.textContent = dateFormatted;
      contentEl.innerHTML = '<p class="duty-role">' + escapeHtml(roleFull) + '</p><p class="duty-date">' + escapeHtml(dateFormatted) + '</p>';
    } catch (e) {
      contentEl.innerHTML = '<p class="error-msg">Не удалось загрузить наряды</p>';
      if (metaEl) metaEl.textContent = '';
    }
  }

  async function loadNotifications() {
    const listEl = document.getElementById('list-notifications');
    if (!listEl) return;
    try {
      const data = await api('/api/notifications?limit=10');
      const items = data.items || [];
      if (items.length === 0) {
        listEl.innerHTML = '<li class="list-placeholder">Нет новых изменений</li>';
        return;
      }
      listEl.innerHTML = items.map(function (n) {
        const body = n.body ? '<div class="notification-body">' + escapeHtml(n.body) + '</div>' : '';
        return '<li><span class="notification-title">' + escapeHtml(n.title || '') + '</span>' + body + '</li>';
      }).join('');
    } catch (e) {
      listEl.innerHTML = '<li class="error-msg">Не удалось загрузить уведомления</li>';
    }
  }

  async function loadRating() {
    const meAvatarEl = document.getElementById('rating-me-avatar');
    const mePointsEl = document.getElementById('rating-me-points');
    const topEl = document.getElementById('rating-top');
    const headerAvatarEl = document.getElementById('header-avatar');
    const headerNameEl = document.getElementById('header-name');
    try {
      const meData = await api('/api/rating/me');
      const topData = await api('/api/rating/top?period=all&scope=course&limit=10');
      if (mePointsEl) mePointsEl.textContent = meData.points != null ? meData.points : 0;
      const userName = (window.__profile && window.__profile.full_name) ? window.__profile.full_name : 'Вы';
      if (meAvatarEl) {
        meAvatarEl.innerHTML = '';
        const img = document.createElement('img');
        img.src = avatarUrl(userName, 28);
        img.alt = '';
        meAvatarEl.appendChild(img);
      }
      if (headerAvatarEl) {
        headerAvatarEl.innerHTML = '';
        const img2 = document.createElement('img');
        img2.src = avatarUrl(userName, 28);
        img2.alt = '';
        headerAvatarEl.appendChild(img2);
      }
      if (headerNameEl) headerNameEl.textContent = userName;
      const top = topData.top || [];
      if (top.length === 0) {
        topEl.innerHTML = '<li class="list-placeholder">Нет данных</li>';
        return;
      }
      topEl.innerHTML = top.map(function (r) {
        const name = (r.fio || '').trim() || '—';
        return '<li><span class="rank">' + r.rank + '</span><span class="avatar-wrap"><img src="' + avatarUrl(name, 24) + '" alt="" /></span><span class="fio" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span><span class="points">' + r.points + '</span></li>';
      }).join('');
    } catch (e) {
      if (mePointsEl) mePointsEl.textContent = '—';
      if (topEl) topEl.innerHTML = '<li class="error-msg">Не удалось загрузить рейтинг</li>';
    }
  }

  async function loadProfile() {
    try {
      const data = await api('/api/user');
      if (data.error) return false;
      window.__profile = { full_name: data.full_name, group: data.group, course_label: data.course_label };
      const headerName = document.getElementById('header-name');
      const headerAvatar = document.getElementById('header-avatar');
      if (headerName) headerName.textContent = data.full_name || 'Профиль';
      if (headerAvatar) {
        headerAvatar.innerHTML = '';
        const img = document.createElement('img');
        img.src = avatarUrl(data.full_name, 28);
        img.alt = '';
        headerAvatar.appendChild(img);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function goHome() {
    setActiveNav('home');
    showScreen('screen-home');
    setSubtitleDate();
    loadSchedule();
    loadDutiesWidget();
    loadNotifications();
    loadRating();
  }

  let dutiesLocalSection = 'graph';

  function renderDutiesWorkArea(container) {
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    if (dutiesLocalSection === 'graph') {
      api('/api/duties').then(function (data) {
        if (data.error) {
          container.innerHTML = '<div class="page-head"><h1 class="page-title">Мои наряды</h1></div><div class="card"><div class="card-body"><p class="list-placeholder">' + data.error + '</p></div></div>';
          return;
        }
        const next = data.next_duty;
        let html = '<div class="page-head"><h1 class="page-title">Мои наряды</h1><p class="page-subtitle">Ближайший наряд и график по месяцам</p></div>';
        if (next) {
          const df = next.date ? new Date(next.date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' }) : '';
          html += '<section class="card"><h2 class="card-title">Ближайший наряд</h2><div class="card-body"><p class="duty-role">' + escapeHtml(next.role_full || next.role || '') + '</p><p class="duty-date">' + escapeHtml(df) + '</p></div></section>';
        }
        container.innerHTML = html + '<section class="card"><h2 class="card-title">По месяцам</h2><div class="card-body"><p class="list-placeholder">Выберите месяц в боковой панели или загрузите график (шаблон — в разделе «Шаблон»).</p></div></section>';
      }).catch(function () {
        container.innerHTML = '<div class="page-head"><h1 class="page-title">Мои наряды</h1></div><div class="card"><div class="card-body"><p class="error-msg">Ошибка загрузки</p></div></div>';
      });
    } else if (dutiesLocalSection === 'survey') {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Опрос о нарядах</h1><p class="page-subtitle">Оцените сложность объектов для распределения</p></div><div class="card"><div class="card-body"><p class="list-placeholder">Если опрос не пройден, пройдите его в Telegram-боте. Здесь интеграция — скоро.</p><a href="#" class="link-btn accent">Открыть в боте</a></div></div>';
    } else if (dutiesLocalSection === 'template') {
      const templateUrl = API_BASE + '/api/schedule/template';
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Шаблон графика</h1><p class="page-subtitle">Скачайте файл, заполните и загрузите в боте или здесь (скоро)</p></div><div class="card"><div class="card-body"><a href="' + templateUrl + '" download class="btn-accent">Скачать шаблон .xlsx</a></div></div>';
    } else if (dutiesLocalSection === 'edit') {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Правки и замены</h1><p class="page-subtitle">Редактирование графика после загрузки</p></div><div class="card"><div class="card-body"><p class="list-placeholder">Выбор месяца и правки — перенесём из приложения. Скоро.</p></div></div>';
    } else {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Наряды</h1></div><div class="card"><div class="card-body"><p class="list-placeholder">Загрузка…</p></div></div>';
    }
  }

  function openDutiesModule() {
    const items = [
      { id: 'graph', label: 'График', active: dutiesLocalSection === 'graph' },
      { id: 'survey', label: 'Опрос', active: dutiesLocalSection === 'survey' },
      { id: 'template', label: 'Шаблон', active: dutiesLocalSection === 'template' },
      { id: 'edit', label: 'Правки / замены', active: dutiesLocalSection === 'edit' }
    ];
    window.onLocalNavClick = function (id, workArea) {
      dutiesLocalSection = id;
      items.forEach(function (i) { i.active = i.id === id; });
      const nav = document.getElementById('local-nav');
      nav.innerHTML = items.map(function (item) {
        const cls = item.active ? ' class="active"' : '';
        return '<a href="#" data-local="' + item.id + '"' + cls + '>' + item.label + '</a>';
      }).join('');
      nav.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          nav.querySelectorAll('a').forEach(function (x) { x.classList.remove('active'); });
          a.classList.add('active');
          dutiesLocalSection = a.getAttribute('data-local');
          renderDutiesWorkArea(workArea);
        });
      });
      renderDutiesWorkArea(workArea);
    };
    showModuleLayout('duties', items, renderDutiesWorkArea);
  }

  function openModule(module) {
    if (module === 'home') {
      goHome();
      return;
    }
    if (module === 'duties') {
      openDutiesModule();
      return;
    }
    setActiveNav(module);
    const screenId = 'screen-' + module;
    showScreen(screenId);
    if (module === 'rating') {
      const card = document.querySelector('#screen-rating .card-body');
      if (card) {
        api('/api/rating/top?period=all&scope=course&limit=30').then(function (data) {
          const top = data.top || [];
          if (top.length === 0) card.innerHTML = '<p class="list-placeholder">Нет данных</p>';
          else {
            card.innerHTML = '<ul class="rating-top">' + top.map(function (r) {
              const name = (r.fio || '').trim() || '—';
              return '<li><span class="rank">' + r.rank + '</span><span class="avatar-wrap"><img src="' + avatarUrl(name, 24) + '" alt="" /></span><span class="fio">' + escapeHtml(name) + '</span><span class="points">' + r.points + '</span></li>';
            }).join('') + '</ul>';
          }
        }).catch(function () {
          card.innerHTML = '<p class="error-msg">Ошибка загрузки рейтинга</p>';
        });
      }
    }
  }

  function loadAll() {
    setSubtitleDate();
    loadProfile().then(function () {
      loadSchedule();
      loadDutiesWidget();
      loadNotifications();
      loadRating();
    });
  }

  function init() {
    userId = getStoredOrUrlUserId();
    if (!userId) {
      showScreen('screen-login');
      document.getElementById('btn-login').addEventListener('click', function () {
        const raw = document.getElementById('input-telegram-id').value.trim();
        const id = parseInt(raw, 10);
        if (isNaN(id)) return;
        userId = id;
        try { localStorage.setItem(STORAGE_KEY, String(id)); } catch (_) {}
        showScreen('screen-home');
        setActiveNav('home');
        loadAll();
      });
      return;
    }
    setActiveNav('home');
    showScreen('screen-home');
    loadAll();

    document.querySelectorAll('.nav-link, .logo[data-module]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        const mod = el.getAttribute('data-module');
        if (mod) openModule(mod);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

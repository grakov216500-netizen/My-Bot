/**
 * ВИТЕХ — standalone site.
 * Modules: Home, Duties, Study, Surveys, Plans, Rating, Profile, Forum.
 */
(function () {
  var STORAGE_KEY = 'vitech_site_telegram_id';
  var STORAGE_GROUP = 'vitech_site_group';
  var STORAGE_YEAR = 'vitech_site_year';
  var isLocal = !window.location.hostname || /localhost|127\.0\.0\.1/.test(window.location.hostname);
  var isUnderSitePath = window.location.pathname.indexOf('/site') !== -1;
  // Всегда вести API на бэкенд: при /site/ — origin; при localhost — явно порт 8000 (чтобы работало при открытии с любого порта/файла).
  var API_BASE = (function () {
    try {
      var override = localStorage.getItem('vitech_api_base');
      if (override) return override.replace(/\/$/, '');
    } catch (_) {}
    if (isLocal) return 'http://localhost:8000';
    if (isUnderSitePath) return window.location.origin;
    return (window.location.hostname === 'vitechbot.online') ? '' : 'https://vitechbot.online';
  })();

  var userId = null;
  var userGroup = '';
  var userYear = 2023;
  var currentModule = 'home';

  /* ---------- helpers ---------- */
  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function avatarUrl(name, size) {
    var n = (name || '?').trim() || '?';
    return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(n) + '&background=3B82F6&color=fff&size=' + (size || 64);
  }

  function api(path) {
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    var url = API_BASE + path + sep + 'telegram_id=' + userId;
    return fetch(url).then(function (res) {
      if (!res.ok) {
        if (res.status === 404 && !window.__api_404_shown) {
          window.__api_404_shown = true;
          showApiErrorBanner(url, res.status);
        }
        throw new Error(res.status);
      }
      return res.json();
    });
  }

  function showApiErrorBanner(failedUrl, status) {
    var base = API_BASE || window.location.origin;
    var msg = 'API не найден (404). Запросы идут по адресу: ' + base + '/api/... ';
    var hint = 'Запустите сервер в папке проекта: python server.py или uvicorn server:app --port 8000. Затем откройте сайт по адресу ' + base.replace(/\/$/, '') + '/site/';
    var div = document.createElement('div');
    div.id = 'api-error-banner';
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b91c1c;color:#fff;padding:12px 16px;font-size:14px;line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    div.innerHTML = '<strong>Сайт не может загрузить данные</strong><br/>' + escapeHtml(msg) + '<br/><span style="font-size:12px;opacity:0.9">' + escapeHtml(hint) + '</span><br/>' +
      '<button type="button" style="margin-top:8px;padding:4px 12px;background:#fff;color:#b91c1c;border:none;border-radius:6px;cursor:pointer" id="api-error-dismiss">Понятно</button> ' +
      '<button type="button" style="margin-top:8px;padding:4px 12px;background:rgba(255,255,255,0.2);color:#fff;border:1px solid #fff;border-radius:6px;cursor:pointer" id="api-error-set-url">Указать другой адрес API</button>';
    document.body.appendChild(div);
    document.getElementById('api-error-dismiss').onclick = function () { div.remove(); };
    document.getElementById('api-error-set-url').onclick = function () {
      var url = prompt('Введите адрес сервера без слэша в конце (например http://localhost:8000 или https://vitechbot.online):', base.replace(/\/$/, ''));
      if (url && url.trim()) {
        try { localStorage.setItem('vitech_api_base', url.trim()); } catch (_) {}
        location.reload();
      }
    };
  }

  function checkApiAndRunInit() {
    var healthUrl = (API_BASE || '') + '/api/health';
    if (!API_BASE) healthUrl = window.location.origin + '/api/health';
    fetch(healthUrl, { method: 'GET' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function () {
      init();
    }).catch(function (err) {
      if (!window.__api_404_shown) {
        window.__api_404_shown = true;
        showApiErrorBanner(healthUrl, err.message || '404');
      }
      init();
    });
  }

  function apiPost(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var err = new Error(data.detail || data.message || 'Ошибка ' + r.status);
          err.status = r.status;
          err.detail = data.detail;
          throw err;
        }
        return data;
      });
    });
  }

  function getStoredOrUrlUserId() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('telegram_id');
    if (fromUrl) {
      var id = parseInt(fromUrl, 10);
      if (!isNaN(id)) { try { localStorage.setItem(STORAGE_KEY, String(id)); } catch (_) {} return id; }
    }
    try { var stored = localStorage.getItem(STORAGE_KEY); if (stored) return parseInt(stored, 10); } catch (_) {}
    return null;
  }

  function getStoredGroup() {
    try { return localStorage.getItem(STORAGE_GROUP) || ''; } catch (_) { return ''; }
  }

  function getStoredYear() {
    try { var v = localStorage.getItem(STORAGE_YEAR); return v ? parseInt(v, 10) : 2023; } catch (_) { return 2023; }
  }

  /* ---------- navigation ---------- */
  function setActiveNav(module) {
    currentModule = module;
    document.querySelectorAll('.nav-link').forEach(function (a) {
      a.classList.toggle('active', module && a.getAttribute('data-module') === module);
    });
  }

  function showScreen(screenId) {
    document.querySelectorAll('.screen, .layout-with-sidebar').forEach(function (el) { el.style.display = 'none'; });
    var el = document.getElementById(screenId);
    if (el) el.style.display = (el.classList.contains('layout-with-sidebar')) ? 'flex' : 'block';
  }

  function showModuleLayout(module, localNavItems, renderWorkArea) {
    setActiveNav(module);
    document.querySelectorAll('.screen').forEach(function (el) { el.style.display = 'none'; });
    var layout = document.getElementById('screen-module');
    var sidebar = document.getElementById('local-nav');
    var workArea = document.getElementById('work-area');
    if (!layout || !sidebar || !workArea) return;
    layout.style.display = 'flex';
    sidebar.innerHTML = localNavItems.map(function (item) {
      var cls = item.active ? ' class="active"' : '';
      return '<a href="#" data-local="' + item.id + '"' + cls + '>' + item.label + '</a>';
    }).join('');
    workArea.innerHTML = '';
    if (typeof renderWorkArea === 'function') renderWorkArea(workArea);
    sidebar.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        sidebar.querySelectorAll('a').forEach(function (x) { x.classList.remove('active'); });
        a.classList.add('active');
        var id = a.getAttribute('data-local');
        if (window.onLocalNavClick && id) window.onLocalNavClick(id, workArea);
      });
    });
  }

  /* ---------- date helpers ---------- */
  function setSubtitleDate() {
    var d = new Date();
    var day = d.getDay();
    var label = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    if (day === 0 || day === 6) label += ' — выходной';
    var el = document.getElementById('subtitle-date');
    if (el) el.textContent = label;
  }

  function getMonday(d) {
    var x = new Date(d);
    var day = x.getDay();
    var diff = x.getDate() - day + (day === 0 ? -6 : 1);
    x.setDate(diff);
    return x;
  }

  function formatWeekRange(monday) {
    var mon = new Date(monday);
    var sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return mon.getDate() + '–' + sun.getDate() + ' ' + mon.toLocaleDateString('ru-RU', { month: 'short' });
  }

  function shortRoom(room) {
    if (!room) return '';
    return room.replace(/\d+\s*кор\.\s*/gi, '').replace(/корпус\s*/gi, '').replace(/кор\./gi, '').trim();
  }

  /* ========== HOME: simplified schedule ========== */
  async function loadScheduleHome() {
    var container = document.getElementById('schedule-compact');
    var groupLabel = document.getElementById('schedule-group-label');
    if (!container) return;
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    if (groupLabel) groupLabel.textContent = userGroup || '';

    var d = new Date();
    var day = d.getDay();
    var isWeekend = day === 0 || day === 6;
    var requestDate = '';
    if (isWeekend) {
      var nextMon = new Date(d);
      nextMon.setDate(d.getDate() + (day === 0 ? 1 : 2));
      requestDate = nextMon.toISOString().slice(0, 10);
    }

    try {
      var path = '/api/schedule/today' + (requestDate ? '?date=' + encodeURIComponent(requestDate) : '');
      var data = await api(path);
      var lessons = data.lessons || [];
      var message = data.message;

      if (lessons.length === 0) {
        if (message) container.innerHTML = '<p class="schedule-msg">' + escapeHtml(message) + '</p>';
        else if (isWeekend) container.innerHTML = '<p class="schedule-msg">Выходной. Пары в понедельник.</p>';
        else container.innerHTML = '<p class="schedule-msg">На сегодня занятий нет</p>';
        return;
      }

      var html = '<table class="schedule-table-compact"><tbody>';
      lessons.forEach(function (l, i) {
        var num = i + 1;
        var subj = l.subject || '—';
        var type = l.type || '';
        var room = shortRoom(l.room || '');
        var teacher = l.teacher || '';
        html += '<tr>';
        html += '<td class="sched-num">' + num + '</td>';
        html += '<td class="sched-subj">' + escapeHtml(subj);
        if (type) html += ' <span class="sched-type">' + escapeHtml(type) + '</span>';
        html += '</td>';
        html += '<td class="sched-room">' + escapeHtml(room) + '</td>';
        html += '<td class="sched-teacher">' + escapeHtml(teacher) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      if (isWeekend) html = '<p class="schedule-note">Понедельник:</p>' + html;
      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = '<p class="error-msg">Не удалось загрузить расписание</p>';
    }
  }

  /* ========== HOME: duties widget ========== */
  async function loadDutiesWidget() {
    var contentEl = document.getElementById('duty-content');
    var metaEl = document.getElementById('duty-meta');
    if (!contentEl) return;
    try {
      var data = await api('/api/duties');
      if (data.error) {
        contentEl.innerHTML = '<p class="list-placeholder">' + escapeHtml(data.error) + '</p>';
        if (metaEl) metaEl.textContent = '';
        return;
      }
      var next = data.next_duty;
      if (!next) {
        contentEl.innerHTML = '<p class="list-placeholder">Нарядов нет</p>';
        if (metaEl) metaEl.textContent = '';
        return;
      }
      var roleFull = next.role_full || next.role || '';
      var dateStr = next.date;
      var dateFormatted = dateStr ? new Date(dateStr + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' }) : '';
      if (metaEl) metaEl.textContent = dateFormatted;
      contentEl.innerHTML = '<p class="duty-role">' + escapeHtml(roleFull) + '</p><p class="duty-date">' + escapeHtml(dateFormatted) + '</p>';
    } catch (e) {
      contentEl.innerHTML = '<p class="error-msg">Не удалось загрузить наряды</p>';
      if (metaEl) metaEl.textContent = '';
    }
  }

  /* ========== HOME: notifications ========== */
  async function loadNotifications() {
    var listEl = document.getElementById('list-notifications');
    if (!listEl) return;
    try {
      var data = await api('/api/notifications?limit=10');
      var items = data.items || [];
      if (items.length === 0) {
        listEl.innerHTML = '<li class="list-placeholder">Нет новых изменений</li>';
        return;
      }
      listEl.innerHTML = items.map(function (n) {
        var body = n.body ? '<div class="notification-body">' + escapeHtml(n.body) + '</div>' : '';
        return '<li><span class="notification-title">' + escapeHtml(n.title || '') + '</span>' + body + '</li>';
      }).join('');
    } catch (e) {
      listEl.innerHTML = '<li class="error-msg">Не удалось загрузить уведомления</li>';
    }
  }

  /* ========== HOME: rating mini ========== */
  async function loadRatingMini() {
    var meAvatarEl = document.getElementById('rating-me-avatar');
    var mePointsEl = document.getElementById('rating-me-points');
    var headerAvatarEl = document.getElementById('header-avatar');
    var headerNameEl = document.getElementById('header-name');
    try {
      var meData = await api('/api/rating/me');
      if (mePointsEl) mePointsEl.textContent = meData.points != null ? meData.points : 0;
      var userName = (window.__profile && window.__profile.full_name) ? window.__profile.full_name : 'Вы';
      var profileAvatarUrl = (window.__profile && window.__profile.avatar_url) ? (API_BASE + window.__profile.avatar_url) : avatarUrl(userName, 40);

      if (meAvatarEl) { meAvatarEl.innerHTML = '<img src="' + profileAvatarUrl + '" alt="" onerror="this.src=\'' + avatarUrl(userName, 40) + '\'" />'; }
      if (headerAvatarEl) { headerAvatarEl.innerHTML = '<img src="' + profileAvatarUrl + '" alt="" onerror="this.src=\'' + avatarUrl(userName, 28) + '\'" />'; }
      if (headerNameEl) headerNameEl.textContent = userName;
    } catch (e) {
      if (mePointsEl) mePointsEl.textContent = '—';
    }
  }

  /* ========== PROFILE load ========== */
  async function loadProfile() {
    try {
      var data = null;
      try {
        data = await api('/api/profile/full');
      } catch (_) {
        data = { error: true };
      }
      if (data && data.error) {
        var dataBasic = await api('/api/user');
        if (dataBasic.error) return false;
        window.__profile = {
          full_name: dataBasic.full_name,
          group: dataBasic.group,
          course_label: dataBasic.course_label,
          role: dataBasic.role || 'user',
          avatar_url: null
        };
      } else if (data) {
        window.__profile = {
          full_name: data.fio,
          group: data.group,
          course_label: data.course_label,
          role: data.role || 'user',
          avatar_url: data.avatar_url,
          points: data.points,
          total_duties: data.total_duties,
          achievements: data.achievements || [],
          sick_leaves: data.sick_leaves || []
        };
      }
      var headerName = document.getElementById('header-name');
      var headerAvatar = document.getElementById('header-avatar');
      var name = window.__profile.full_name || 'Профиль';
      if (headerName) headerName.textContent = name;
      if (headerAvatar) {
        var src = window.__profile.avatar_url ? (API_BASE + window.__profile.avatar_url) : avatarUrl(name, 28);
        headerAvatar.innerHTML = '<img src="' + src + '" alt="" onerror="this.src=\'' + avatarUrl(name, 28) + '\'" />';
      }
      if (window.__profile.group && !userGroup) {
        userGroup = window.__profile.group;
        try { localStorage.setItem(STORAGE_GROUP, userGroup); } catch (_) {}
      }
      return true;
    } catch (_) { return false; }
  }

  /* ========== HOME ========== */
  function goHome() {
    setActiveNav('home');
    showScreen('screen-home');
    setSubtitleDate();
    loadScheduleHome();
    loadDutiesWidget();
    loadNotifications();
    loadRatingMini();
  }

  /* ========== DUTIES MODULE ========== */
  var dutiesLocalSection = 'graph';
  var dutiesCalYear = new Date().getFullYear();
  var dutiesCalMonth = new Date().getMonth() + 1;
  var dutiesTab = 'upcoming';
  var dutyAvailableMonths = [];
  var dutySelectedDay = '';
  var ROLE_LABELS = { 'к': 'Командир', 'гбр': 'ГБР', 'с': 'Столовая', 'п': 'ПУТСО', 'м': 'Медчасть', 'о': 'ОТО' };

  function formatDutyDate(dateStr) {
    var d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function renderDutyDayDetail(container, dateStr) {
    if (!dateStr) return;
    var target = container;
    target.innerHTML = '<p class="muted">Загрузка бригады…</p>';
    api('/api/duties/by-date?date=' + encodeURIComponent(dateStr)).then(function (data) {
      if (data.error) { target.innerHTML = '<p class="error-msg">' + escapeHtml(data.error) + '</p>'; return; }
      var byRole = data.by_role || {};
      var total = data.total || 0;
      var dateFormatted = new Date(dateStr + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
      var html = '<p><a href="#" class="link-btn duty-back-dates">← К датам месяца</a></p>';
      html += '<h3 class="card-title">Бригада на ' + escapeHtml(dateFormatted) + '</h3><p class="muted">Всего: ' + total + '</p>';
      var roleLabels = { 'к': 'Командир', 'гбр': 'ГБР', 'с': 'Столовая', 'п': 'ПУТСО', 'м': 'Медчасть', 'о': 'ОТО' };
      Object.keys(byRole).sort().forEach(function (role) {
        var label = roleLabels[role] || role;
        var list = byRole[role];
        html += '<section class="card" style="margin-top:12px"><h4 class="card-title">' + escapeHtml(label) + '</h4><ul class="list">';
        list.forEach(function (p) { html += '<li>' + escapeHtml(p.fio) + (p.group ? ' <span class="muted">' + escapeHtml(p.group) + '</span>' : '') + '</li>'; });
        html += '</ul></section>';
      });
      target.innerHTML = html;
      var backBtn = target.querySelector('.duty-back-dates');
      if (backBtn) backBtn.addEventListener('click', function (e) { e.preventDefault(); renderDutiesWorkArea(container); });
    }).catch(function () { target.innerHTML = '<p class="error-msg">Ошибка загрузки</p>'; });
  }

  function renderDutyCalendar(container) {
    var grid = container.querySelector('#duty-calendar-grid');
    var label = container.querySelector('#duty-cal-month-label');
    var detail = container.querySelector('#duty-day-detail');
    if (!grid) return;
    var ym = dutiesCalYear + '-' + String(dutiesCalMonth).padStart(2, '0');
    var monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    if (label) label.textContent = monthNames[dutiesCalMonth - 1] + ' ' + dutiesCalYear;
    var hasData = dutyAvailableMonths.indexOf(ym) !== -1;
    if (!hasData) {
      grid.innerHTML = '<p class="duty-cal-empty">График на этот месяц отсутствует</p>';
      if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
      dutySelectedDay = '';
      return;
    }
    var days = new Date(dutiesCalYear, dutiesCalMonth, 0).getDate();
    var firstDow = (new Date(dutiesCalYear, dutiesCalMonth - 1, 1).getDay() + 6) % 7;
    var dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    var html = dayNames.map(function (d) { return '<div class="duty-cal-head">' + d + '</div>'; }).join('');
    for (var i = 0; i < firstDow; i++) html += '<div></div>';
    var todayStr = new Date().toISOString().slice(0, 10);
    for (var d = 1; d <= days; d++) {
      var ds = dutiesCalYear + '-' + String(dutiesCalMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var isToday = ds === todayStr;
      var isSelected = ds === dutySelectedDay;
      var cls = 'duty-cal-day' + (isSelected ? ' selected' : '') + (isToday ? ' today' : '');
      html += '<div class="' + cls + '" data-date="' + ds + '" role="button" tabindex="0">' + d + '</div>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.duty-cal-day[data-date]').forEach(function (el) {
      el.addEventListener('click', function () {
        dutySelectedDay = el.getAttribute('data-date');
        renderDutyCalendar(container);
        var det = container.querySelector('#duty-day-detail');
        if (!det) return;
        det.style.display = 'block';
        det.innerHTML = '<p class="muted">Загрузка…</p>';
        api('/api/duties/by-date?date=' + dutySelectedDay).then(function (data) {
          if (!data.by_role || data.total === 0) {
            det.innerHTML = '<p class="muted">На ' + formatDutyDate(dutySelectedDay) + ' нарядов нет</p>';
            return;
          }
          var h = '<h4 class="card-title">' + formatDutyDate(dutySelectedDay) + '</h4>';
          Object.keys(data.by_role).sort().forEach(function (role) {
            var list = data.by_role[role];
            var lbl = ROLE_LABELS[role] || role;
            h += '<div class="duty-role-block"><strong>' + escapeHtml(lbl) + '</strong> <span class="muted">' + list.length + ' чел.</span><ul class="list">';
            list.forEach(function (p) { h += '<li>' + escapeHtml(p.fio) + (p.group ? ' <span class="muted">' + escapeHtml(p.group) + '</span>' : '') + '</li>'; });
            h += '</ul></div>';
          });
          det.innerHTML = h;
        }).catch(function () { det.innerHTML = '<p class="error-msg">Ошибка загрузки</p>'; });
      });
    });
    if (detail) detail.style.display = 'none';
  }

  function renderDutiesWorkArea(container) {
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';

    if (dutiesLocalSection === 'graph') {
      Promise.all([api('/api/duties'), api('/api/duties/available-months')]).then(function (res) {
        var data = res[0], monthsData = res[1];
        dutyAvailableMonths = monthsData.months || [];
        var months = dutyAvailableMonths;
        var canUpload = window.__profile && ['sergeant', 'assistant', 'admin'].indexOf(window.__profile.role) >= 0;

        if (months.length > 0) {
          var lastYm = months[months.length - 1].split('-');
          if (dutyAvailableMonths.indexOf(dutiesCalYear + '-' + String(dutiesCalMonth).padStart(2, '0')) === -1) {
            dutiesCalYear = parseInt(lastYm[0], 10);
            dutiesCalMonth = parseInt(lastYm[1], 10);
          }
        }

        var html = '<div class="page-head"><h1 class="page-title">Мои наряды</h1><p class="page-subtitle">Ближайший наряд, график по месяцам</p></div>';

        if (data.error) {
          html += '<div class="card"><div class="card-body"><p class="list-placeholder">' + escapeHtml(data.error) + '</p></div></div>';
        } else {
          var next = data.next_duty;
          if (next) {
            var df = next.date ? formatDutyDate(next.date) : '';
            html += '<section class="card"><h2 class="card-title">Ближайший наряд</h2><div class="card-body"><p class="duty-role">' + escapeHtml(next.role_full || '') + '</p><p class="duty-date">' + escapeHtml(df) + '</p></div></section>';
          }

          html += '<section class="card"><h2 class="card-title">Загрузить график</h2><div class="card-body">';
          if (canUpload) {
            html += '<p class="muted">Скачайте шаблон, заполните и загрузите .xlsx. Загрузка доступна сержанту, помощнику и админу.</p>';
            html += '<p><a href="' + API_BASE + '/api/schedule/template?telegram_id=' + userId + '" download class="btn-accent">Скачать шаблон</a></p>';
            html += '<form id="duty-upload-form" class="duty-upload-form"><input type="file" accept=".xlsx" id="duty-upload-file" /><label class="checkbox-label"><input type="checkbox" id="duty-upload-overwrite" /> Заменить существующий месяц</label><button type="submit" class="btn-accent">Загрузить .xlsx</button></form><p id="duty-upload-status" class="muted"></p>';
          } else {
            html += '<p class="list-placeholder">Загрузка графика доступна сержанту, помощнику и админу. Скачайте шаблон и передайте его ответственному.</p>';
            html += '<p><a href="' + API_BASE + '/api/schedule/template?telegram_id=' + userId + '" download class="btn-accent">Скачать шаблон</a></p>';
          }
          html += '</div></section>';

          html += '<section class="card"><h2 class="card-title">По месяцам</h2><div class="card-body">';
          if (months.length === 0) {
            html += '<p class="list-placeholder">Нет загруженных месяцев. Загрузите график выше (если вы сержант, помощник или админ).</p>';
          } else {
            html += '<div class="duty-month-nav">';
            html += '<button type="button" class="btn-accent duty-nav-btn" id="duty-prev-month">← Пред.</button>';
            html += '<select id="duty-month-select" class="input-select">' + months.map(function (m) {
              var parts = m.split('-');
              var sel = (parts[0] === String(dutiesCalYear) && parts[1] === String(dutiesCalMonth).padStart(2, '0')) ? ' selected' : '';
              return '<option value="' + m + '"' + sel + '>' + parts[1] + '.' + parts[0] + '</option>';
            }).join('') + '</select>';
            html += '<button type="button" class="btn-accent duty-nav-btn" id="duty-next-month">След. →</button>';
            html += '</div>';
            html += '<div class="duty-tabs"><button type="button" class="duty-tab' + (dutiesTab === 'upcoming' ? ' active' : '') + '" data-tab="upcoming">Ожидается</button><button type="button" class="duty-tab' + (dutiesTab === 'past' ? ' active' : '') + '" data-tab="past">Завершённые</button></div>';
            html += '<div id="duty-month-dates"></div>';
            html += '<div class="duty-calendar-section"><p class="muted duty-cal-hint">Календарь — нажмите день, чтобы увидеть бригаду</p><p id="duty-cal-month-label" class="duty-cal-label"></p><div id="duty-calendar-grid" class="duty-calendar-grid"></div><div id="duty-day-detail" class="duty-day-detail"></div></div>';
          }
          html += '</div></section>';
        }
        container.innerHTML = html;
        bindDutyUpload(container);
        bindMonthSelect(container);
        if (months.length > 0) {
          bindDutyTabs(container);
          bindDutyNav(container);
          selectDutyMonthAndRender(container);
          renderDutyCalendar(container);
        }
      }).catch(function () { container.innerHTML = '<p class="error-msg">Ошибка загрузки</p>'; });

    } else if (dutiesLocalSection === 'template') {
      var templateUrl = API_BASE + '/api/schedule/template?telegram_id=' + userId;
      var canUploadOwn = window.__profile && ['sergeant', 'assistant', 'admin'].indexOf(window.__profile.role) >= 0;
      var html = '<div class="page-head"><h1 class="page-title">Шаблон графика</h1><p class="page-subtitle">Скачать или загрузить свой шаблон для группы</p></div>';
      html += '<div class="card"><div class="card-body"><p><a href="' + templateUrl + '" download class="btn-accent">Скачать шаблон .xlsx</a></p>';
      if (canUploadOwn) {
        html += '<p class="muted" style="margin-top:16px">Загрузите свой шаблон для вашей группы:</p>';
        html += '<form id="template-upload-form" class="duty-upload-form"><input type="file" accept=".xlsx" id="template-upload-file" /><button type="submit" class="btn-accent">Загрузить шаблон</button></form><p id="template-upload-status" class="muted"></p>';
      }
      html += '</div></div>';
      container.innerHTML = html;
      if (canUploadOwn && container.querySelector('#template-upload-form')) {
        container.querySelector('#template-upload-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var fi = document.getElementById('template-upload-file');
          var st = document.getElementById('template-upload-status');
          if (!fi || !fi.files[0]) { st.textContent = 'Выберите файл'; return; }
          st.textContent = 'Загрузка…';
          var fd = new FormData(); fd.append('file', fi.files[0]); fd.append('telegram_id', userId);
          fetch(API_BASE + '/api/schedule/upload-template', { method: 'POST', body: fd })
            .then(function (r) { return r.json(); })
            .then(function (d) { st.textContent = d.message || 'Сохранено'; })
            .catch(function () { st.textContent = 'Ошибка'; st.classList.add('error-msg'); });
        });
      }

    } else if (dutiesLocalSection === 'survey') {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Опрос нарядов</h1></div><div class="card"><div class="card-body"><p class="list-placeholder">Опрос о сложности объектов — пройдите во вкладке «Опросы».</p></div></div>';

    } else if (dutiesLocalSection === 'edit') {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Правки / замены</h1></div><div class="card"><div class="card-body"><p class="list-placeholder">Правки и замены графика — в разработке.</p></div></div>';
    }
  }

  function bindDutyUpload(container) {
    var form = container.querySelector('#duty-upload-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fi = document.getElementById('duty-upload-file');
      var ow = document.getElementById('duty-upload-overwrite');
      var st = document.getElementById('duty-upload-status');
      if (!fi || !fi.files[0]) { st.textContent = 'Выберите файл'; return; }
      st.textContent = 'Загрузка…';
      var fd = new FormData(); fd.append('file', fi.files[0]); fd.append('telegram_id', userId); fd.append('overwrite', ow && ow.checked ? '1' : '0');
      fetch(API_BASE + '/api/schedule/upload', { method: 'POST', body: fd })
        .then(function (r) { return r.json().catch(function () { return { detail: r.statusText }; }); })
        .then(function (d) {
          if (d.detail) { st.textContent = d.detail; st.classList.add('error-msg'); }
          else { st.textContent = 'Загружено!'; st.classList.remove('error-msg'); renderDutiesWorkArea(container); }
        })
        .catch(function () { st.textContent = 'Ошибка'; st.classList.add('error-msg'); });
    });
  }

  function selectDutyMonthAndRender(container) {
    var sel = container.querySelector('#duty-month-select');
    var datesEl = container.querySelector('#duty-month-dates');
    if (!sel || !datesEl) return;
    var ym = sel.value;
    if (!ym) { datesEl.innerHTML = ''; return; }
    var parts = ym.split('-');
    dutiesCalYear = parseInt(parts[0], 10);
    dutiesCalMonth = parseInt(parts[1], 10);
    dutySelectedDay = '';
    datesEl.innerHTML = '<p class="muted">Загрузка…</p>';
    api('/api/duties?month=' + parts[1] + '&year=' + parts[0]).then(function (md) {
      var duties = md.duties || [];
      var today = new Date().toISOString().slice(0, 10);
      var filtered = duties.filter(function (d) {
        return dutiesTab === 'upcoming' ? d.date >= today : d.date < today;
      });
      if (filtered.length === 0) {
        datesEl.innerHTML = '<p class="list-placeholder">' + (dutiesTab === 'upcoming' ? 'Нет предстоящих нарядов' : 'Нет завершённых нарядов') + '</p>';
      } else {
        datesEl.innerHTML = '<ul class="duty-dates-list">' + filtered.map(function (d) {
          var dayLabel = formatDutyDate(d.date);
          return '<li><a href="#" class="duty-date-link" data-date="' + d.date + '">' + dayLabel + '</a> <span class="muted">' + escapeHtml(d.role_full || d.role) + '</span></li>';
        }).join('') + '</ul>';
        datesEl.querySelectorAll('.duty-date-link').forEach(function (a) {
          var dateKey = a.getAttribute('data-date');
          a.addEventListener('click', function (e) {
            e.preventDefault();
            dutySelectedDay = dateKey;
            var det = container.querySelector('#duty-day-detail');
            if (det) {
              det.style.display = 'block';
              det.innerHTML = '<p class="muted">Загрузка…</p>';
              api('/api/duties/by-date?date=' + dutySelectedDay).then(function (data) {
                if (!data.by_role || data.total === 0) { det.innerHTML = '<p class="muted">Нарядов нет</p>'; return; }
                var h = '<h4 class="card-title">' + formatDutyDate(dutySelectedDay) + '</h4>';
                Object.keys(data.by_role).sort().forEach(function (role) {
                  var list = data.by_role[role];
                  var lbl = ROLE_LABELS[role] || role;
                  h += '<div class="duty-role-block"><strong>' + escapeHtml(lbl) + '</strong> <span class="muted">' + list.length + ' чел.</span><ul class="list">';
                  list.forEach(function (p) { h += '<li>' + escapeHtml(p.fio) + (p.group ? ' <span class="muted">' + escapeHtml(p.group) + '</span>' : '') + '</li>'; });
                  h += '</ul></div>';
                });
                det.innerHTML = h;
              }).catch(function () { det.innerHTML = '<p class="error-msg">Ошибка</p>'; });
            }
          });
        });
      }
      renderDutyCalendar(container);
    }).catch(function () { datesEl.innerHTML = '<p class="error-msg">Ошибка</p>'; });
  }

  function bindMonthSelect(container) {
    var sel = container.querySelector('#duty-month-select');
    if (!sel) return;
    sel.addEventListener('change', function () { selectDutyMonthAndRender(container); });
  }

  function bindDutyTabs(container) {
    container.querySelectorAll('.duty-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        dutiesTab = btn.getAttribute('data-tab');
        container.querySelectorAll('.duty-tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === dutiesTab); });
        selectDutyMonthAndRender(container);
      });
    });
  }

  function bindDutyNav(container) {
    var prev = container.querySelector('#duty-prev-month');
    var next = container.querySelector('#duty-next-month');
    var sel = container.querySelector('#duty-month-select');
    if (prev) prev.addEventListener('click', function () {
      var idx = dutyAvailableMonths.indexOf(dutiesCalYear + '-' + String(dutiesCalMonth).padStart(2, '0'));
      if (idx > 0) {
        var p = dutyAvailableMonths[idx - 1].split('-');
        dutiesCalYear = parseInt(p[0], 10);
        dutiesCalMonth = parseInt(p[1], 10);
        if (sel) sel.value = dutyAvailableMonths[idx - 1];
        selectDutyMonthAndRender(container);
      }
    });
    if (next) next.addEventListener('click', function () {
      var idx = dutyAvailableMonths.indexOf(dutiesCalYear + '-' + String(dutiesCalMonth).padStart(2, '0'));
      if (idx >= 0 && idx < dutyAvailableMonths.length - 1) {
        var p = dutyAvailableMonths[idx + 1].split('-');
        dutiesCalYear = parseInt(p[0], 10);
        dutiesCalMonth = parseInt(p[1], 10);
        if (sel) sel.value = dutyAvailableMonths[idx + 1];
        selectDutyMonthAndRender(container);
      }
    });
  }

  function openDutiesModule() {
    var items = [
      { id: 'graph', label: 'График', active: dutiesLocalSection === 'graph' },
      { id: 'template', label: 'Шаблон', active: dutiesLocalSection === 'template' },
      { id: 'survey', label: 'Опрос', active: dutiesLocalSection === 'survey' },
      { id: 'edit', label: 'Правки / замены', active: dutiesLocalSection === 'edit' }
    ];
    window.onLocalNavClick = function (id, wa) {
      dutiesLocalSection = id;
      renderDutiesWorkArea(wa);
    };
    loadProfile().then(function () { showModuleLayout('duties', items, renderDutiesWorkArea); });
  }

  /* ========== STUDY MODULE ========== */
  var studySection = 'schedule';
  var studyWeekStart = null;

  function renderStudyWorkArea(container) {
    if (!container) return;
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';

    if (studySection === 'schedule') {
      if (!studyWeekStart) studyWeekStart = getMonday(new Date());
      container.innerHTML = '<p class="muted" style="margin-bottom:8px">Перейти к неделе: <input type="date" id="study-jump-date" class="input-text" style="max-width:140px;padding:4px 8px" /><button type="button" class="btn-accent" id="study-jump-btn" style="margin-left:6px">Открыть</button></p><div id="study-schedule-wrap"></div>';
      var scheduleWrap = document.getElementById('study-schedule-wrap');
      loadStudyWeekSchedule(studyWeekStart, scheduleWrap || container);
      var jumpBtn = document.getElementById('study-jump-btn');
      var jumpInput = document.getElementById('study-jump-date');
      if (jumpBtn && jumpInput) {
        jumpBtn.addEventListener('click', function () {
          var val = jumpInput.value;
          if (!val) return;
          studyWeekStart = getMonday(new Date(val + 'T12:00:00'));
          var wrap = document.getElementById('study-schedule-wrap');
          if (wrap) loadStudyWeekSchedule(studyWeekStart, wrap);
        });
      }
    } else if (studySection === 'journal') {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Журнал</h1><p class="page-subtitle">Оценки и посещаемость</p></div><div class="card"><div class="card-body"><p class="list-placeholder">Журнал будет доступен после подключения данных Апекс ВУЗ.</p></div></div>';

    } else if (studySection === 'absences') {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Пропуски</h1><p class="page-subtitle">Только активные — что нужно исправить</p></div><div class="card"><div class="card-body"><p class="list-placeholder">Пропуски будут парситься с Апекс ВУЗ. В разработке.</p></div></div>';

    } else if (studySection === 'library') {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Библиотека</h1><p class="page-subtitle">Облака и ссылки преподавателей</p></div><div class="card"><div class="card-body"><p class="list-placeholder">Здесь будут ссылки на материалы преподавателей. Добавление ссылок — скоро.</p></div></div>';

    } else if (studySection === 'quiz') {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Тренажёр</h1><p class="page-subtitle">Тесты по предметам, прогресс по темам</p></div><div class="card"><div class="card-body"><p class="list-placeholder">Тренажёр тестов — в разработке. Очки за тесты сразу попадут в рейтинг.</p></div></div>';
    }
  }

  async function loadStudyWeekSchedule(weekStartDate, container) {
    if (!container) return;
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    var dateStr = weekStartDate.toISOString().slice(0, 10);

    try {
      var data = await api('/api/schedule/week?date=' + encodeURIComponent(dateStr));
      var schedule = data.schedule || {};
      var dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
      var html = '<div class="study-week-nav"><button type="button" class="btn-week-prev">← Пред.</button><span class="study-week-label">' + formatWeekRange(weekStartDate) + '</span><button type="button" class="btn-week-next">След. →</button></div>';
      html += '<div class="study-week-grid">';
      var keys = Object.keys(schedule).sort();
      keys.forEach(function (dateKey, i) {
        var lessons = schedule[dateKey];
        var d = new Date(dateKey + 'T12:00:00');
        var dayName = dayNames[i] || d.toLocaleDateString('ru-RU', { weekday: 'short' });
        var dateLabel = d.getDate() + ' ' + d.toLocaleDateString('ru-RU', { month: 'short' });
        html += '<section class="card study-day-card"><h3 class="card-title">' + dayName + ', ' + dateLabel + '</h3><div class="card-body">';
        if (lessons.length === 0) {
          html += '<p class="schedule-msg">Нет занятий</p>';
        } else {
          html += '<table class="schedule-table-compact"><tbody>';
          lessons.forEach(function (l, idx) {
            var room = shortRoom(l.room || '');
            html += '<tr><td class="sched-num">' + (idx + 1) + '</td><td class="sched-subj">' + escapeHtml(l.subject || '');
            if (l.type) html += ' <span class="sched-type">' + escapeHtml(l.type) + '</span>';
            html += '</td><td class="sched-room">' + escapeHtml(room) + '</td><td class="sched-teacher">' + escapeHtml(l.teacher || '') + '</td></tr>';
          });
          html += '</tbody></table>';
        }
        html += '</div></section>';
      });
      html += '</div>';
      if (data.message) html = '<p class="error-msg" style="margin-bottom:12px">' + escapeHtml(data.message) + '</p>' + html;
      container.innerHTML = html;

      container.querySelector('.btn-week-prev').addEventListener('click', function () {
        studyWeekStart.setDate(studyWeekStart.getDate() - 7);
        loadStudyWeekSchedule(studyWeekStart, container);
      });
      container.querySelector('.btn-week-next').addEventListener('click', function () {
        studyWeekStart.setDate(studyWeekStart.getDate() + 7);
        loadStudyWeekSchedule(studyWeekStart, container);
      });
    } catch (e) {
      container.innerHTML = '<p class="error-msg">Не удалось загрузить расписание</p>';
    }
  }

  function openStudyModule() {
    var items = [
      { id: 'schedule', label: 'Расписание', active: studySection === 'schedule' },
      { id: 'journal', label: 'Журнал', active: studySection === 'journal' },
      { id: 'absences', label: 'Пропуски', active: studySection === 'absences' },
      { id: 'library', label: 'Библиотека', active: studySection === 'library' },
      { id: 'quiz', label: 'Тренажёр', active: studySection === 'quiz' }
    ];
    window.onLocalNavClick = function (id, wa) { studySection = id; renderStudyWorkArea(wa); };
    showModuleLayout('study', items, renderStudyWorkArea);
  }

  /* ========== RATING (full page) ========== */
  var ratingScope = 'course';
  var ratingPeriod = 'all';

  async function loadRatingFull() {
    var content = document.getElementById('rating-full-content');
    if (!content) return;
    content.innerHTML = '<p class="list-placeholder">Загрузка…</p>';

    try {
      var data = await api('/api/rating/top-enhanced?period=' + ratingPeriod + '&scope=' + ratingScope + '&limit=30');
      var top = data.top || [];
      if (top.length === 0) { content.innerHTML = '<p class="list-placeholder">Нет данных</p>'; return; }

      var html = '<div class="rating-full-list">';
      top.forEach(function (r) {
        var name = (r.fio || '').trim() || '—';
        var isTop3 = r.rank <= 3;
        var avatarSrc = r.avatar_url ? (API_BASE + r.avatar_url) : avatarUrl(name, 48);
        var cls = isTop3 ? ' rating-card-top' + r.rank : '';

        html += '<div class="rating-card' + cls + '">';
        html += '<span class="rating-rank">' + r.rank + '</span>';
        html += '<div class="rating-avatar-wrap"><img src="' + avatarSrc + '" alt="" onerror="this.src=\'' + avatarUrl(name, 48) + '\'" /></div>';
        html += '<div class="rating-card-info"><span class="rating-card-name">' + escapeHtml(name) + '</span>';
        if (r.group_name) html += '<span class="rating-card-group">' + escapeHtml(r.group_name) + '</span>';
        html += '</div>';
        html += '<span class="rating-card-points">' + r.points + '</span>';
        html += '</div>';
      });
      html += '</div>';
      content.innerHTML = html;
    } catch (e) {
      content.innerHTML = '<p class="error-msg">Ошибка загрузки рейтинга</p>';
    }
  }

  function openRatingModule() {
    setActiveNav('rating');
    showScreen('screen-rating');
    loadRatingFull();

    document.querySelectorAll('#rating-filters .filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var scope = btn.getAttribute('data-scope');
        var period = btn.getAttribute('data-period');
        if (scope) {
          document.querySelectorAll('#rating-filters [data-scope]').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          ratingScope = scope;
        }
        if (period) {
          document.querySelectorAll('#rating-filters [data-period]').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          ratingPeriod = period;
        }
        loadRatingFull();
      });
    });
  }

  /* ========== PROFILE (full page) ========== */
  async function openProfilePage() {
    setActiveNav(null);
    showScreen('screen-profile');
    var content = document.getElementById('profile-page-content');
    if (!content) return;
    content.innerHTML = '<p class="list-placeholder">Загрузка…</p>';

    try {
      var data = await api('/api/profile/full');
      if (data.error) { content.innerHTML = '<p class="error-msg">' + escapeHtml(data.error) + '</p>'; return; }

      var avatarSrc = data.avatar_url ? (API_BASE + data.avatar_url) : avatarUrl(data.fio, 120);
      var roleLabels = { admin: 'Администратор', assistant: 'Помощник', sergeant: 'Сержант', user: 'Курсант' };

      var html = '<div class="profile-header-card card">';
      html += '<div class="profile-header-inner">';
      html += '<div class="profile-avatar-big"><img id="profile-avatar-img" src="' + avatarSrc + '" alt="" onerror="this.src=\'' + avatarUrl(data.fio, 120) + '\'" />';
      html += '<label class="profile-avatar-edit" title="Изменить аватар"><input type="file" accept="image/*" id="avatar-upload-input" style="display:none" />✎</label></div>';
      html += '<div class="profile-header-info">';
      html += '<h2>' + escapeHtml(data.fio || '—') + '</h2>';
      html += '<p class="muted">' + escapeHtml(data.group || '') + ' · ' + escapeHtml(data.course_label || '') + ' курс · ' + escapeHtml(roleLabels[data.role] || data.role) + '</p>';
      html += '<p class="profile-stat"><span class="stat-value">' + (data.points || 0) + '</span> очков · <span class="stat-value">' + (data.total_duties || 0) + '</span> нарядов</p>';
      html += '</div></div>';
      if (data.role === 'admin') html += '<p style="padding:0 16px 16px"><a href="#" class="link-btn accent" id="profile-admin-btn">Админ-панель →</a></p>';
      html += '</div>';

      // Sick leave
      html += '<div class="card" style="margin-top:16px"><h3 class="card-title">Больничный</h3><div class="card-body">';
      html += '<p class="muted">Укажите период больничного (с — по):</p>';
      html += '<form id="sick-leave-form" class="inline-form"><input type="date" id="sick-from" required /><span class="muted"> — </span><input type="date" id="sick-to" /><button type="submit" class="btn-accent">Сохранить</button></form>';
      html += '<p id="sick-leave-status" class="muted"></p>';
      if (data.sick_leaves && data.sick_leaves.length > 0) {
        html += '<ul class="list" style="margin-top:12px">';
        data.sick_leaves.forEach(function (sl) { html += '<li>' + escapeHtml(sl.date) + '</li>'; });
        html += '</ul>';
      }
      html += '</div></div>';

      // Achievements
      html += '<div class="card" style="margin-top:16px"><h3 class="card-title">Достижения</h3><div class="card-body">';
      if (data.achievements && data.achievements.length > 0) {
        html += '<div class="achievements-grid">';
        data.achievements.forEach(function (a) {
          var cls = a.unlocked ? 'achievement unlocked' : 'achievement locked';
          html += '<div class="' + cls + '"><span class="ach-icon">' + (a.icon_url || '🏆') + '</span><span class="ach-title">' + escapeHtml(a.title) + '</span><span class="ach-desc">' + escapeHtml(a.description || '') + '</span></div>';
        });
        html += '</div>';
      } else {
        html += '<p class="list-placeholder">Достижения появятся с активностью.</p>';
      }
      html += '</div></div>';

      content.innerHTML = html;

      // Avatar upload
      var avatarInput = document.getElementById('avatar-upload-input');
      if (avatarInput) {
        document.querySelector('.profile-avatar-edit').addEventListener('click', function () { avatarInput.click(); });
        avatarInput.addEventListener('change', function () {
          if (!avatarInput.files || !avatarInput.files[0]) return;
          var fd = new FormData(); fd.append('file', avatarInput.files[0]); fd.append('telegram_id', userId);
          fetch(API_BASE + '/api/profile/avatar', { method: 'POST', body: fd })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (d.avatar_url) {
                document.getElementById('profile-avatar-img').src = API_BASE + d.avatar_url + '?t=' + Date.now();
                window.__profile.avatar_url = d.avatar_url;
                var ha = document.getElementById('header-avatar');
                if (ha) ha.innerHTML = '<img src="' + API_BASE + d.avatar_url + '?t=' + Date.now() + '" alt="" />';
              }
            });
        });
      }

      // Sick leave form
      var slForm = document.getElementById('sick-leave-form');
      if (slForm) {
        slForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var from = document.getElementById('sick-from').value;
          var to = document.getElementById('sick-to').value;
          var st = document.getElementById('sick-leave-status');
          if (!from) return;
          st.textContent = 'Сохранение…';
          apiPost('/api/profile/sick-leave', { telegram_id: userId, date_from: from, date_to: to || from })
            .then(function (d) { st.textContent = d.status === 'ok' ? 'Сохранено!' : (d.detail || 'Ошибка'); })
            .catch(function () { st.textContent = 'Ошибка'; });
        });
      }

      // Admin button
      var adminBtn = document.getElementById('profile-admin-btn');
      if (adminBtn) adminBtn.addEventListener('click', function (e) { e.preventDefault(); openAdminPanel(); });

    } catch (e) {
      content.innerHTML = '<p class="error-msg">Ошибка загрузки профиля</p>';
    }
  }

  /* ========== ADMIN ========== */
  function openAdminPanel() {
    setActiveNav(null);
    showScreen('screen-admin');
    loadAdminUsers();
    var form = document.getElementById('admin-sick-leave-form');
    var statusEl = document.getElementById('admin-sick-leave-status');
    if (form) {
      form.onsubmit = function (e) {
        e.preventDefault();
        var dateInput = document.getElementById('admin-sick-leave-date');
        if (!dateInput || !dateInput.value) return;
        if (statusEl) statusEl.textContent = 'Отправка…';
        apiPost('/api/sick-leave/report', { telegram_id: userId, report_date: dateInput.value })
          .then(function (d) { if (statusEl) statusEl.textContent = d.message || 'Учтено'; dateInput.value = ''; })
          .catch(function () { if (statusEl) statusEl.textContent = 'Ошибка'; });
      };
    }
  }

  function loadAdminUsers() {
    var listEl = document.getElementById('admin-users-list');
    if (!listEl) return;
    listEl.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    api('/api/users?actor_telegram_id=' + userId).then(function (data) {
      var users = data.users || [];
      if (users.length === 0) { listEl.innerHTML = '<p class="list-placeholder">Нет пользователей</p>'; return; }
      var roleLabels = { admin: 'Админ', assistant: 'Помощник', sergeant: 'Сержант', user: 'Курсант' };
      listEl.innerHTML = users.map(function (u) {
        var btns = '';
        if (u.role !== 'admin') {
          if (u.role !== 'assistant') btns += '<button class="admin-set-role" data-tid="' + u.telegram_id + '" data-role="assistant">Помощник</button>';
          if (u.role !== 'sergeant') btns += '<button class="admin-set-role" data-tid="' + u.telegram_id + '" data-role="sergeant">Сержант</button>';
          if (u.role !== 'user') btns += '<button class="admin-set-role" data-tid="' + u.telegram_id + '" data-role="user">Снять</button>';
        }
        return '<div class="admin-user-row"><div class="admin-user-info"><strong>' + escapeHtml(u.fio || '—') + '</strong><br/><span class="muted">' + escapeHtml(u.group_name || '') + ' · ' + (roleLabels[u.role] || u.role) + '</span></div><div class="admin-user-actions">' + btns + '</div></div>';
      }).join('');
      listEl.querySelectorAll('.admin-set-role').forEach(function (btn) {
        btn.addEventListener('click', function () {
          apiPost('/api/users/set-role', { actor_telegram_id: userId, target_telegram_id: parseInt(btn.getAttribute('data-tid'), 10), role: btn.getAttribute('data-role') })
            .then(function () { loadAdminUsers(); });
        });
      });
    }).catch(function () { listEl.innerHTML = '<p class="error-msg">Ошибка</p>'; });
  }

  /* ========== SURVEYS ========== */
  function openSurveysModule() {
    setActiveNav('surveys');
    showScreen('screen-surveys');
    var container = document.getElementById('surveys-content');
    if (!container) return;
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    api('/api/survey/list').then(function (data) {
      var system = data.system || [];
      var custom = data.custom || [];
      var gender = data.user_gender || 'male';
      var html = '<p class="muted">Выберите опрос для прохождения.</p>';
      if (system.length) {
        html += '<div class="survey-list">';
        system.forEach(function (s) {
          if (s.for_gender && s.for_gender !== gender) return;
          html += '<button type="button" class="card survey-card" data-stage="' + (s.id === 'female' ? 'female' : 'main') + '">' + escapeHtml(s.title) + '</button>';
        });
        html += '</div>';
      }
      if (custom.length) {
        html += '<h3 class="card-title" style="margin-top:16px">Опросы по группе</h3><ul class="list">';
        custom.forEach(function (s) { html += '<li><button type="button" class="link-btn survey-custom-btn" data-id="' + s.id + '">' + escapeHtml(s.title) + '</button></li>'; });
        html += '</ul>';
      }
      if (!system.length && !custom.length) html = '<p class="list-placeholder">Нет доступных опросов</p>';
      container.innerHTML = html;
      container.querySelectorAll('.survey-card').forEach(function (btn) {
        btn.addEventListener('click', function () { runPairSurvey(container, btn.getAttribute('data-stage')); });
      });
      container.querySelectorAll('.survey-custom-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { openCustomSurvey(container, parseInt(btn.getAttribute('data-id'), 10)); });
      });
    }).catch(function () { container.innerHTML = '<p class="error-msg">Ошибка загрузки опросов</p>'; });
  }

  function runPairSurvey(container, stage) {
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    api('/api/survey/pairs?stage=' + encodeURIComponent(stage)).then(function (data) {
      var pairs = data.pairs || [];
      if (!pairs.length) { container.innerHTML = '<p class="list-placeholder">Нет пар</p>'; return; }
      var idx = 0;
      function showPair() {
        if (idx >= pairs.length) { container.innerHTML = '<p class="list-placeholder">Спасибо! Опрос завершён.</p>'; return; }
        var p = pairs[idx];
        var a = p.object_a || {}, b = p.object_b || {};
        var nameA = a.name || '—', nameB = b.name || '—';
        var idA = a.id, idB = b.id;
        if (!idA || !idB) { container.innerHTML = '<p class="error-msg">Ошибка формата пар</p>'; return; }
        container.innerHTML = '<div class="survey-pair"><p class="muted">Кто сложнее? (' + (idx + 1) + '/' + pairs.length + ')</p><div class="survey-pair-btns"><button data-choice="a" class="btn-accent">' + escapeHtml(nameA) + '</button><button data-choice="equal" class="btn-accent">Одинаково</button><button data-choice="b" class="btn-accent">' + escapeHtml(nameB) + '</button></div></div>';
        container.querySelectorAll('[data-choice]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            apiPost('/api/survey/pair-vote', { user_id: userId, object_a_id: idA, object_b_id: idB, choice: btn.getAttribute('data-choice'), stage: stage })
              .then(function () { idx++; showPair(); })
              .catch(function (err) {
                var msg = (err && err.detail) ? (typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)) : 'Ошибка голосования';
                container.innerHTML = '<p class="error-msg">' + escapeHtml(msg) + '</p>';
              });
          });
        });
      }
      showPair();
    }).catch(function () { container.innerHTML = '<p class="error-msg">Ошибка</p>'; });
  }

  function openCustomSurvey(container, surveyId) {
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    api('/api/survey/custom/' + surveyId).then(function (data) {
      if (!data.options || !data.options.length) { container.innerHTML = '<p class="list-placeholder">Нет вариантов</p>'; return; }
      var html = '<h3>' + escapeHtml(data.title || 'Опрос') + '</h3><ul class="list">';
      data.options.forEach(function (opt) { html += '<li><button class="link-btn survey-option-btn" data-option-id="' + opt.id + '">' + escapeHtml(opt.option_text) + '</button></li>'; });
      container.innerHTML = html + '</ul>';
      container.querySelectorAll('.survey-option-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          apiPost('/api/survey/custom/' + surveyId + '/vote', { telegram_id: userId, option_id: parseInt(btn.getAttribute('data-option-id'), 10) })
            .then(function () { container.innerHTML = '<p class="list-placeholder">Спасибо! Голос учтён.</p>'; });
        });
      });
    }).catch(function () { container.innerHTML = '<p class="error-msg">Ошибка</p>'; });
  }

  /* ========== PLANS ========== */
  function openPlansModule() {
    setActiveNav('plans');
    showScreen('screen-plans');
    var container = document.getElementById('plans-content');
    if (!container) return;
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    api('/api/tasks?user_id=' + userId).then(function (tasks) {
      if (!Array.isArray(tasks)) { container.innerHTML = '<p class="error-msg">' + (tasks.error || 'Ошибка') + '</p>'; return; }
      var html = '<form id="plans-add-form" class="plans-form"><input type="text" id="plans-add-text" class="input-text" placeholder="Что сделать?" required /><button type="submit" class="btn-accent">Добавить</button></form>';
      html += '<ul class="list plans-list" id="plans-list">';
      if (tasks.length === 0) html += '<li class="list-placeholder">Нет задач. Добавьте выше.</li>';
      else tasks.forEach(function (t) {
        var done = t.done ? ' checked' : '';
        var cls = t.done ? ' class="plan-done"' : '';
        html += '<li' + cls + '><label class="plan-item"><input type="checkbox" class="plan-checkbox" data-id="' + t.id + '"' + done + ' /><span class="plan-text">' + escapeHtml(t.text) + '</span></label></li>';
      });
      html += '</ul>';
      container.innerHTML = html;
      document.getElementById('plans-add-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var input = document.getElementById('plans-add-text');
        var text = (input.value || '').trim();
        if (!text) return;
        apiPost('/api/add_task', { user_id: userId, text: text }).then(function () { input.value = ''; openPlansModule(); });
      });
      container.querySelectorAll('.plan-checkbox').forEach(function (cb) {
        cb.addEventListener('change', function () {
          apiPost('/api/done_task', { task_id: parseInt(cb.getAttribute('data-id'), 10), user_id: userId, done: cb.checked })
            .then(function () { cb.closest('li').classList.toggle('plan-done', cb.checked); });
        });
      });
    }).catch(function () { container.innerHTML = '<p class="error-msg">Ошибка загрузки</p>'; });
  }

  /* ========== FORUM ========== */
  var forumSection = 'general';
  var FORUM_SECTIONS = [
    { id: 'general', label: 'Общие', desc: 'Обсуждения' },
    { id: 'gallery', label: 'Галерея', desc: 'Творчество' },
    { id: 'board', label: 'Объявления', desc: 'Для курсантов' },
    { id: 'study', label: 'Учёба', desc: 'Вопросы' }
  ];

  function renderForumWorkArea(container) {
    var section = FORUM_SECTIONS.find(function (s) { return s.id === forumSection; }) || FORUM_SECTIONS[0];
    container.innerHTML = '<div class="page-head"><h1 class="page-title">' + escapeHtml(section.label) + '</h1><p class="page-subtitle">' + escapeHtml(section.desc) + '</p></div><div class="forum-intro"><strong>Внутреннее сообщество курсантов.</strong> При создании темы — выбор анонимной публикации.</div><div class="card"><div class="card-body"><p class="list-placeholder">Форум в разработке.</p></div></div>';
  }

  function openForumModule() {
    var items = FORUM_SECTIONS.map(function (s) { return { id: s.id, label: s.label, active: forumSection === s.id }; });
    window.onLocalNavClick = function (id, wa) { forumSection = id; renderForumWorkArea(wa); };
    showModuleLayout('forum', items, renderForumWorkArea);
  }

  /* ========== MODULE ROUTER ========== */
  function openModule(module) {
    if (module === 'home') { goHome(); return; }
    if (module === 'duties') { openDutiesModule(); return; }
    if (module === 'study') { openStudyModule(); return; }
    if (module === 'surveys') { openSurveysModule(); return; }
    if (module === 'plans') { openPlansModule(); return; }
    if (module === 'rating') { openRatingModule(); return; }
    if (module === 'forum') { openForumModule(); return; }
    if (module === 'profile') { openProfilePage(); return; }
  }

  /* ========== INIT ========== */
  function loadAll() {
    setSubtitleDate();
    loadProfile().then(function () {
      loadScheduleHome();
      loadDutiesWidget();
      loadNotifications();
      loadRatingMini();
    });
  }

  function init() {
    if (window.location.search.indexOf('reset=1') !== -1) {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_GROUP);
        localStorage.removeItem(STORAGE_YEAR);
      } catch (_) {}
      window.location.replace(window.location.pathname + (window.location.hash || ''));
      return;
    }

    userId = getStoredOrUrlUserId();
    userGroup = getStoredGroup();
    userYear = getStoredYear();

    if (!userId) {
      showScreen('screen-login');
      var apiUrlEl = document.getElementById('login-api-url');
      if (apiUrlEl) apiUrlEl.textContent = (API_BASE || window.location.origin || '—').replace(/\/$/, '');
      document.getElementById('btn-login').addEventListener('click', function () {
        var raw = document.getElementById('input-telegram-id').value.trim();
        var id = parseInt(raw, 10);
        if (isNaN(id)) return;
        var group = (document.getElementById('input-group').value || '').trim();
        var year = parseInt(document.getElementById('input-year').value, 10);
        if (!year || year < 2020 || year > 2030) year = 2023;

        var btn = document.getElementById('btn-login');
        btn.disabled = true;
        btn.textContent = 'Регистрация…';

        fetch(API_BASE + '/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegram_id: id,
            group_name: group,
            enrollment_year: year
          })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            userId = id;
            userGroup = group;
            userYear = year;
            try {
              localStorage.setItem(STORAGE_KEY, String(id));
              if (group) localStorage.setItem(STORAGE_GROUP, group);
              localStorage.setItem(STORAGE_YEAR, String(year));
            } catch (_) {}
            showScreen('screen-home');
            setActiveNav('home');
            loadAll();
          })
          .catch(function () {
            btn.disabled = false;
            btn.textContent = 'Войти';
            alert('Ошибка регистрации. Проверьте подключение к серверу.');
          })
          .finally(function () {
            btn.disabled = false;
            btn.textContent = 'Войти';
          });
      });
      var resetBtn = document.getElementById('btn-reset-login');
      if (resetBtn) resetBtn.addEventListener('click', function (e) {
        e.preventDefault();
        try {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(STORAGE_GROUP);
          localStorage.removeItem(STORAGE_YEAR);
        } catch (_) {}
        location.reload();
      });
      return;
    }

    setActiveNav('home');
    showScreen('screen-home');
    loadAll();

    document.querySelectorAll('.nav-link, .logo[data-module]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var mod = el.getAttribute('data-module');
        if (mod) openModule(mod);
      });
    });

    document.getElementById('btn-profile').addEventListener('click', function (e) {
      e.preventDefault();
      openProfilePage();
    });

    var ratingFullBtn = document.getElementById('btn-rating-full');
    if (ratingFullBtn) {
      ratingFullBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openRatingModule();
      });
    }
    var ratingStatsBtn = document.getElementById('btn-rating-stats');
    if (ratingStatsBtn) {
      ratingStatsBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openProfilePage();
      });
    }

    document.getElementById('admin-back').addEventListener('click', function (e) {
      e.preventDefault();
      goHome();
    });
  }

  document.addEventListener('DOMContentLoaded', checkApiAndRunInit);
})();

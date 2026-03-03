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
      if (!isNaN(id)) {
        try {
          localStorage.setItem(STORAGE_KEY, String(id));
          var g = params.get('group_name') || params.get('group');
          if (g) localStorage.setItem(STORAGE_GROUP, g);
          var y = params.get('enrollment_year') || params.get('year');
          if (y) localStorage.setItem(STORAGE_YEAR, String(parseInt(y, 10) || 2023));
        } catch (_) {}
        return id;
      }
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
    sidebar.addEventListener('click', function (e) {
      var a = e.target && e.target.closest('a[data-local]');
      if (!a) return;
      e.preventDefault();
      sidebar.querySelectorAll('a').forEach(function (x) { x.classList.remove('active'); });
      a.classList.add('active');
      var id = a.getAttribute('data-local');
      if (window.onLocalNavClick && id) window.onLocalNavClick(id, workArea);
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
      var dateFormatted = dateStr ? new Date(dateStr + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
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
  var dutiesLocalSection = 'myduties';
  var dutiesCalYear = new Date().getFullYear();
  var dutiesCalMonth = new Date().getMonth() + 1;
  var dutiesTab = 'upcoming';
  var dutyAvailableMonths = [];
  var dutySelectedDay = '';
  var ROLE_LABELS = { 'к': 'Командир', 'гбр': 'ГБР', 'с': 'Столовая', 'п': 'ПУТСО', 'м': 'Медчасть', 'о': 'ОТО', 'дк': 'ГБР', 'ад': 'ГБР' };

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
        list.forEach(function (p) {
          var tg = p.telegram_id ? ' <a href="https://t.me/id' + p.telegram_id + '" target="_blank" class="link-btn" style="font-size:12px">💬</a>' : '';
          html += '<li>' + escapeHtml(p.fio) + (p.group ? ' <span class="muted">' + escapeHtml(p.group) + '</span>' : '') + tg + '</li>';
        });
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
      grid.innerHTML = '<p class="duty-cal-empty">За этот месяц наряда нет</p>';
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
          var dateObj = new Date(dutySelectedDay + 'T12:00:00');
          var dd = ('0' + dateObj.getDate()).slice(-2);
          var mm = ('0' + (dateObj.getMonth() + 1)).slice(-2);
          var yy = dateObj.getFullYear();
          var weekday = dateObj.toLocaleDateString('ru-RU', { weekday: 'long' });
          var h = '';
          Object.keys(data.by_role).sort().forEach(function (role) {
            var list = data.by_role[role];
            var lbl = ROLE_LABELS[role] || role;
            h += '<div class="duty-role-block"><p class="duty-detail-role">' + escapeHtml(lbl) + ' — ' + dd + '.' + mm + '.' + yy + '</p><p class="muted" style="font-size:12px;margin-top:2px">' + escapeHtml(weekday) + '</p><p class="muted" style="margin-top:8px">Бригада:</p><ul class="list">';
            list.forEach(function (p) {
              var tg = p.telegram_id ? ' <a href="https://t.me/id' + p.telegram_id + '" target="_blank" class="link-btn" style="font-size:12px">💬</a>' : '';
              h += '<li>' + escapeHtml(p.fio) + (p.group ? ' <span class="muted">' + escapeHtml(p.group) + '</span>' : '') + tg + '</li>';
            });
            h += '</ul></div>';
          });
          det.innerHTML = '<p><a href="#" class="link-btn duty-back-dates">← К датам</a></p>' + h;
        }).catch(function () { det.innerHTML = '<p class="error-msg">Ошибка загрузки</p>'; });
      });
    });
    if (detail) detail.style.display = 'none';
  }

  function renderDutiesWorkArea(container) {
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';

    if (dutiesLocalSection === 'myduties' || dutiesLocalSection === 'graph') {
      var canEdit = (window.__profile && ['sergeant', 'assistant', 'admin'].indexOf(window.__profile.role) >= 0) || (Number(userId) === 1027070834);
      var requests = [api('/api/duties'), api('/api/duties/available-months')];
      if (dutiesLocalSection === 'graph' && canEdit) requests.push(api('/api/schedule/uploads'));
      Promise.all(requests).then(function (res) {
        var data = res[0], monthsData = res[1];
        var uploadsData = res[2] || { uploads: [] };
        dutyAvailableMonths = monthsData.months || [];
        var months = dutyAvailableMonths;

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
            var wd = next.date ? new Date(next.date + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long' }) : '';
            html += '<section class="card"><h2 class="card-title">Ближайший наряд</h2><div class="card-body"><p class="duty-role">' + escapeHtml(next.role_full || '') + '</p><p class="duty-date">' + escapeHtml(df) + (wd ? ' · ' + escapeHtml(wd) : '') + '</p></div></section>';
          }

          if (dutiesLocalSection === 'graph' && canEdit) {
            html += '<section class="card"><h2 class="card-title">Загрузить график</h2><div class="card-body">';
            html += '<p class="muted">Скачайте шаблон, заполните и загрузите .xlsx.</p>';
            html += '<p><a href="' + API_BASE + '/api/schedule/template?telegram_id=' + userId + '" download class="btn-accent">Скачать шаблон</a></p>';
            html += '<form id="duty-upload-form" class="duty-upload-form"><input type="file" accept=".xlsx" id="duty-upload-file" /><label class="checkbox-label"><input type="checkbox" id="duty-upload-overwrite" /> Заменить существующий месяц</label><button type="submit" class="btn-accent">Загрузить .xlsx</button></form><p id="duty-upload-status" class="muted"></p>';
            html += '</div></section>';
            var uploads = uploadsData.uploads || [];
            if (uploads.length > 0) {
              html += '<section class="card"><h2 class="card-title">Загруженные графики</h2><div class="card-body"><div class="duty-edit-cards">';
              uploads.forEach(function (u) {
                var p = (u.ym || '').split('-');
                var label = (p[1] || '') + '.' + (p[0] || '') + ' · ' + (u.group_name || '');
                html += '<div class="duty-upload-card card"><div class="card-body"><strong>' + escapeHtml(label) + '</strong><p class="muted" style="font-size:12px;margin-top:4px">Загрузил: ' + escapeHtml(u.uploaded_by_fio || '—') + ' · ' + escapeHtml(u.uploaded_at || '—') + '</p></div></div>';
              });
              html += '</div></div></section>';
            }
          }

          html += '<section class="card"><h2 class="card-title">По месяцам</h2><div class="card-body">';
          var allMonths = [];
          var now = new Date();
          for (var y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
            for (var mo = 1; mo <= 12; mo++) {
              allMonths.push(y + '-' + String(mo).padStart(2, '0'));
            }
          }
          allMonths = allMonths.filter(function (m) {
            var p = m.split('-');
            return parseInt(p[0], 10) >= 2024 && parseInt(p[0], 10) <= 2027;
          });
          html += '<div class="duty-month-nav">';
          html += '<button type="button" class="btn-accent duty-nav-btn" id="duty-prev-month">←</button>';
          html += '<div class="duty-month-filter"><select id="duty-month-select" class="input-select">' + allMonths.map(function (m) {
            var parts = m.split('-');
            var sel = (parts[0] === String(dutiesCalYear) && parts[1] === String(dutiesCalMonth).padStart(2, '0')) ? ' selected' : '';
            return '<option value="' + m + '"' + sel + '>' + parts[1] + '.' + parts[0] + '</option>';
          }).join('') + '</select><button type="button" class="duty-month-actual" id="duty-actual-month">Актуальный месяц</button></div>';
          html += '<button type="button" class="btn-accent duty-nav-btn" id="duty-next-month">→</button>';
          html += '</div>';
          html += '<div class="duty-tabs"><button type="button" class="duty-tab' + (dutiesTab === 'upcoming' ? ' active' : '') + '" data-tab="upcoming">Ожидается</button><button type="button" class="duty-tab' + (dutiesTab === 'past' ? ' active' : '') + '" data-tab="past">Завершённые</button></div>';
          html += '<div id="duty-month-dates"></div>';
          html += '<div class="duty-calendar-section"><p class="muted duty-cal-hint">Календарь — поиск по нарядам всех загруженных групп курса за выбранный месяц. Нажмите день, чтобы увидеть бригаду</p><p id="duty-cal-month-label" class="duty-cal-label"></p><div id="duty-calendar-grid" class="duty-calendar-grid"></div><div id="duty-day-detail" class="duty-day-detail"></div></div>';
          html += '</div></section>';
        }
        container.innerHTML = html;
        bindDutyUpload(container);
        bindMonthSelect(container);
        bindDutyTabs(container);
        bindDutyNav(container);
        selectDutyMonthAndRender(container);
        renderDutyCalendar(container);
      }).catch(function () { container.innerHTML = '<p class="error-msg">Ошибка загрузки</p>'; });

    } else if (dutiesLocalSection === 'survey') {
      openSurveysModule();

    } else if (dutiesLocalSection === 'edit') {
      renderDutyEditSection(container);
    }
  }

  function renderDutyEditSection(container) {
    var canEdit = (window.__profile && ['sergeant', 'assistant', 'admin'].indexOf(window.__profile.role) >= 0) || (Number(userId) === 1027070834);
    if (!canEdit) {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">Правки / замены</h1></div><div class="card"><div class="card-body"><p class="list-placeholder">Правки графика доступны сержанту, помощнику и админу.</p></div></div>';
      return;
    }
    container.innerHTML = '<div class="page-head"><h1 class="page-title">Правки / замены</h1><p class="page-subtitle">Выберите месяц и выполните правку графика</p></div><div id="duty-edit-months" class="duty-edit-months"><p class="muted">Загрузка месяцев…</p></div>';
    api('/api/duties/available-months').then(function (data) {
      var months = data.months || [];
      var monthsEl = container.querySelector('#duty-edit-months');
      if (months.length === 0) {
        monthsEl.innerHTML = '<div class="card"><div class="card-body"><p class="list-placeholder">Нет загруженных графиков. Загрузите график во вкладке «График».</p></div></div>';
        return;
      }
      var monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
      monthsEl.innerHTML = '<div class="duty-edit-cards">' + months.map(function (m) {
        var p = m.split('-');
        var label = monthNames[parseInt(p[1], 10) - 1] + ' ' + p[0];
        return '<div class="duty-edit-month-card card"><div class="card-body"><strong>' + escapeHtml(label) + '</strong> <button type="button" class="btn-accent duty-edit-open-btn" style="margin-left:12px" data-ym="' + escapeHtml(m) + '">Правка</button></div></div>';
      }).join('') + '</div>';
      container.querySelectorAll('.duty-edit-open-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { openDutyEditModal(btn.getAttribute('data-ym'), container); });
      });
    }).catch(function () {
      container.querySelector('#duty-edit-months').innerHTML = '<p class="error-msg">Ошибка загрузки</p>';
    });
  }

  function openDutyEditModal(ym, container) {
    api('/api/duties/edit-context?ym=' + ym + '&telegram_id=' + userId).then(function (ctx) {
      var cadets = ctx.cadets_in_schedule || [];
      var users = ctx.group_users || [];
      var reasons = ctx.reasons || ['заболел', 'командировка', 'рапорт', 'другое'];
      var roles = ctx.roles || [];
      var allFio = [];
      cadets.forEach(function (c) { if (c.fio && allFio.indexOf(c.fio) === -1) allFio.push(c.fio); });
      users.forEach(function (u) { if (u.fio && allFio.indexOf(u.fio) === -1) allFio.push(u.fio); });
      allFio.sort();
      var y = parseInt(ym.slice(0, 4), 10);
      var m = parseInt(ym.slice(5, 7), 10);
      var daysInMonth = new Date(y, m, 0).getDate();
      var firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;
      var calHtml = ['<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-size:12px">'];
      for (var i = 0; i < firstDow; i++) calHtml.push('<div></div>');
      for (var d = 1; d <= daysInMonth; d++) {
        var ds = ym + '-' + String(d).padStart(2, '0');
        calHtml.push('<button type="button" class="duty-edit-cal-day" data-date="' + ds + '">' + d + '</button>');
      }
      calHtml.push('</div>');
      var roleOpts = roles.map(function (r) { return '<option value="' + escapeHtml(r.code) + '">' + escapeHtml(r.name) + '</option>'; }).join('');
      var fioOpts = allFio.map(function (f) { return '<option value="' + escapeHtml(f) + '">'; }).join('');
      var reasonOpts = reasons.map(function (r) { return '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>'; }).join('');
      var addFioOpts = users.map(function (u) { return '<option value="' + escapeHtml(u.fio) + '" data-group="' + escapeHtml(u.group_name || '') + '">'; }).join('');
      var modal = document.createElement('div');
      modal.className = 'duty-edit-modal-overlay';
      modal.id = 'duty-edit-modal';
      modal.innerHTML = '<div class="duty-edit-modal card" style="max-width:420px;max-height:90vh;overflow-y:auto"><div class="card-body"><h3 class="card-title">Правка ' + ym + '</h3>' +
        '<p class="muted" style="font-size:12px;margin-bottom:8px">Нажмите день — подставится в поле даты</p>' +
        calHtml.join('') +
        '<div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">' +
        '<button type="button" class="duty-edit-action-btn active" data-form="replace">Замена</button>' +
        '<button type="button" class="duty-edit-action-btn" data-form="add">Добавить</button>' +
        '<button type="button" class="duty-edit-action-btn" data-form="remove">Убрать</button>' +
        '<button type="button" class="duty-edit-action-btn" data-form="chrole">Изм. роль</button>' +
        '</div>' +
        '<div id="duty-edit-form-replace" class="duty-edit-form"><label class="muted" style="font-size:12px">Кого снять</label><select id="de-remove-fio" class="input-select" style="width:100%;margin-bottom:8px"></select>' +
        '<label class="muted" style="font-size:12px">Дата</label><input type="text" id="de-remove-date" placeholder="ГГГГ-ММ-ДД" class="input-text" style="width:100%;margin-bottom:8px;box-sizing:border-box" />' +
        '<label class="muted" style="font-size:12px">Роль</label><select id="de-remove-role" class="input-select" style="width:100%;margin-bottom:8px">' + roleOpts + '</select>' +
        '<label class="muted" style="font-size:12px">Причина</label><select id="de-remove-reason" class="input-select" style="width:100%;margin-bottom:8px">' + reasonOpts + '</select>' +
        '<label class="muted" style="font-size:12px">Кто заменяет (поиск по ФИО)</label><input type="text" id="de-remove-replacement" list="de-datalist" placeholder="Начните вводить..." class="input-text" style="width:100%;margin-bottom:12px;box-sizing:border-box" />' +
        '<datalist id="de-datalist">' + allFio.map(function (f) { return '<option value="' + escapeHtml(f) + '">'; }).join('') + '</datalist>' +
        '<button type="button" class="btn-accent" id="de-submit-replace">Выполнить замену</button></div>' +
        '<div id="duty-edit-form-add" class="duty-edit-form" style="display:none"><label class="muted" style="font-size:12px">Курсант</label><select id="de-add-fio" class="input-select" style="width:100%;margin-bottom:8px"><option value="">—</option>' + users.map(function (u) { return '<option value="' + escapeHtml(u.fio) + '" data-group="' + escapeHtml(u.group_name || '') + '">' + escapeHtml(u.fio) + '</option>'; }).join('') + '</select>' +
        '<label class="muted" style="font-size:12px">Дата</label><input type="text" id="de-add-date" placeholder="ГГГГ-ММ-ДД" class="input-text" style="width:100%;margin-bottom:8px;box-sizing:border-box" />' +
        '<label class="muted" style="font-size:12px">Роль</label><select id="de-add-role" class="input-select" style="width:100%;margin-bottom:12px">' + roleOpts + '</select>' +
        '<button type="button" class="btn-accent" style="background:#166534" id="de-submit-add">Добавить наряд</button></div>' +
        '<div id="duty-edit-form-remove" class="duty-edit-form" style="display:none"><label class="muted" style="font-size:12px">Кого снять</label><select id="de-remove-only-fio" class="input-select" style="width:100%;margin-bottom:8px"></select>' +
        '<label class="muted" style="font-size:12px">Дата</label><input type="text" id="de-remove-only-date" placeholder="ГГГГ-ММ-ДД" class="input-text" style="width:100%;margin-bottom:8px;box-sizing:border-box" />' +
        '<label class="muted" style="font-size:12px">Роль</label><select id="de-remove-only-role" class="input-select" style="width:100%;margin-bottom:12px">' + roleOpts + '</select>' +
        '<button type="button" class="btn-accent" style="background:#7F1D1D" id="de-submit-remove">Убрать</button></div>' +
        '<div id="duty-edit-form-chrole" class="duty-edit-form" style="display:none"><label class="muted" style="font-size:12px">Курсант</label><select id="de-change-fio" class="input-select" style="width:100%;margin-bottom:8px"></select>' +
        '<label class="muted" style="font-size:12px">Дата</label><input type="text" id="de-change-date" placeholder="ГГГГ-ММ-ДД" class="input-text" style="width:100%;margin-bottom:8px;box-sizing:border-box" />' +
        '<label class="muted" style="font-size:12px">Новая роль</label><select id="de-change-new-role" class="input-select" style="width:100%;margin-bottom:12px">' + roleOpts + '</select>' +
        '<button type="button" class="btn-accent" id="de-submit-chrole">Изменить</button></div>' +
        '<button type="button" class="topbar-btn" style="margin-top:16px" id="duty-edit-close">Закрыть</button></div></div>';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
      document.body.appendChild(modal);
      var seenFio = {};
      var selFio = [];
      cadets.forEach(function (c) { if (c.fio && !seenFio[c.fio]) { seenFio[c.fio] = 1; selFio.push(c.fio); } });
      ['de-remove-fio', 'de-remove-only-fio', 'de-change-fio'].forEach(function (id) {
        var sel = document.getElementById(id);
        if (sel) {
          sel.innerHTML = '<option value="">—</option>' + selFio.map(function (f) { return '<option value="' + escapeHtml(f) + '">' + escapeHtml(f) + '</option>'; }).join('');
        }
      });
      modal.querySelectorAll('.duty-edit-cal-day').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var date = btn.getAttribute('data-date');
          ['de-remove-date', 'de-add-date', 'de-remove-only-date', 'de-change-date'].forEach(function (id) {
            var inp = document.getElementById(id);
            if (inp) inp.value = date;
          });
        });
      });
      modal.querySelectorAll('.duty-edit-action-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          modal.querySelectorAll('.duty-edit-action-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          var f = btn.getAttribute('data-form');
          modal.querySelectorAll('.duty-edit-form').forEach(function (el) { el.style.display = 'none'; });
          var formEl = document.getElementById('duty-edit-form-' + (f === 'chrole' ? 'chrole' : f === 'replace' ? 'replace' : f === 'add' ? 'add' : 'remove'));
          if (formEl) formEl.style.display = 'block';
        });
      });
      document.getElementById('de-submit-replace').onclick = function () {
        var fio = document.getElementById('de-remove-fio').value;
        var date = document.getElementById('de-remove-date').value;
        var role = document.getElementById('de-remove-role').value;
        var reason = document.getElementById('de-remove-reason').value;
        var repl = document.getElementById('de-remove-replacement').value.trim();
        if (!fio || !date || !role || !repl) { alert('Заполните все поля'); return; }
        apiPost('/api/duties/remove-and-replace', { telegram_id: userId, fio_removed: fio, date: date, role: role, reason: reason || 'заболел', fio_replacement: repl })
          .then(function (d) { alert(d.message || 'Готово'); modal.remove(); if (container.closest('#work-area')) renderDutyEditSection(container); })
          .catch(function (e) { alert(e.detail || e.message || 'Ошибка'); });
      };
      document.getElementById('de-submit-add').onclick = function () {
        var opt = document.getElementById('de-add-fio').selectedOptions[0];
        var fio = document.getElementById('de-add-fio').value;
        var group = opt ? opt.getAttribute('data-group') || '' : '';
        var date = document.getElementById('de-add-date').value;
        var role = document.getElementById('de-add-role').value;
        if (!fio || !date || !role || !group) { alert('Заполните все поля'); return; }
        apiPost('/api/duties/add', { telegram_id: userId, fio: fio, group_name: group, date: date, role: role })
          .then(function (d) { alert(d.message || 'Готово'); modal.remove(); if (container.closest('#work-area')) renderDutyEditSection(container); })
          .catch(function (e) { alert(e.detail || e.message || 'Ошибка'); });
      };
      document.getElementById('de-submit-remove').onclick = function () {
        var fio = document.getElementById('de-remove-only-fio').value;
        var date = document.getElementById('de-remove-only-date').value;
        var role = document.getElementById('de-remove-only-role').value;
        if (!fio || !date || !role) { alert('Заполните все поля'); return; }
        apiPost('/api/duties/remove', { telegram_id: userId, fio_removed: fio, date: date, role: role })
          .then(function (d) { alert(d.message || 'Готово'); modal.remove(); if (container.closest('#work-area')) renderDutyEditSection(container); })
          .catch(function (e) { alert(e.detail || e.message || 'Ошибка'); });
      };
      document.getElementById('de-submit-chrole').onclick = function () {
        var fio = document.getElementById('de-change-fio').value;
        var date = document.getElementById('de-change-date').value;
        var newRole = document.getElementById('de-change-new-role').value;
        if (!fio || !date || !newRole) { alert('Заполните все поля'); return; }
        apiPost('/api/duties/change-role', { telegram_id: userId, fio: fio, date: date, new_role: newRole })
          .then(function (d) { alert(d.message || 'Готово'); modal.remove(); if (container.closest('#work-area')) renderDutyEditSection(container); })
          .catch(function (e) { alert(e.detail || e.message || 'Ошибка'); });
      };
      document.getElementById('duty-edit-close').onclick = function () { modal.remove(); };
      modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    }).catch(function (e) {
      alert(e.detail || e.message || 'Нет прав или ошибка загрузки');
    });
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
        datesEl.innerHTML = '<div class="duty-dates-cards">' + filtered.map(function (d) {
          var dayLabel = formatDutyDate(d.date);
          var dateObj = new Date(d.date + 'T12:00:00');
          var weekday = dateObj.toLocaleDateString('ru-RU', { weekday: 'long' });
          return '<div class="duty-date-card-wrap"><a href="#" class="duty-date-card duty-date-link" data-date="' + d.date + '" data-role="' + escapeHtml(d.role || '') + '"><div class="duty-date-card-left"><div class="duty-date-card-date">' + escapeHtml(dayLabel) + '</div><div class="duty-date-card-weekday">' + escapeHtml(weekday) + '</div><div class="duty-date-card-role">' + escapeHtml(d.role_full || d.role) + '</div></div><span class="muted" style="font-size:12px">▼</span></a></div>';
        }).join('') + '</div>';
        datesEl.querySelectorAll('.duty-date-link').forEach(function (a) {
          var dateKey = a.getAttribute('data-date');
          var roleKey = a.getAttribute('data-role');
          a.addEventListener('click', function (e) {
            e.preventDefault();
            var wrap = a.closest('.duty-date-card-wrap');
            var expanded = wrap.querySelector('.duty-date-card-expand');
            if (expanded) {
              expanded.remove();
              a.classList.remove('expanded');
              return;
            }
            a.classList.add('expanded');
            var expandDiv = document.createElement('div');
            expandDiv.className = 'duty-date-card-expand';
            expandDiv.innerHTML = '<p class="muted">Загрузка…</p>';
            wrap.appendChild(expandDiv);
            api('/api/duties/day-detail?date=' + dateKey + '&role=' + encodeURIComponent(roleKey)).then(function (data) {
              if (data.error) { expandDiv.innerHTML = '<p class="error-msg">' + escapeHtml(data.error) + '</p>'; return; }
              var h = '<p class="muted" style="margin-bottom:8px">Бригада:</p><ul class="list">';
              (data.participants || []).forEach(function (p) {
                var tg = p.telegram_id ? ' <a href="https://t.me/id' + p.telegram_id + '" target="_blank" class="link-btn" style="font-size:12px">💬</a>' : '';
                h += '<li>' + escapeHtml(p.fio) + (p.group ? ' <span class="muted">' + escapeHtml(p.group) + '</span>' : '') + tg + '</li>';
              });
              h += '</ul>';
              if (data.shifts && data.shifts.length > 0) {
                h += '<p class="muted" style="margin-top:12px;margin-bottom:6px">Распределение по сменам:</p><ul class="list">';
                data.shifts.forEach(function (s) {
                  h += '<li>Смена ' + escapeHtml(String(s.shift)) + ': ' + escapeHtml(s.fio) + '</li>';
                });
                h += '</ul>';
              }
              if (data.canteen && data.canteen.length > 0) {
                h += '<p class="muted" style="margin-top:12px;margin-bottom:6px">По объектам столовой:</p><ul class="list">';
                data.canteen.forEach(function (c) {
                  h += '<li>' + escapeHtml(c.object || '') + ': ' + escapeHtml(c.fio) + '</li>';
                });
                h += '</ul>';
              }
              expandDiv.innerHTML = h;
            }).catch(function () { expandDiv.innerHTML = '<p class="error-msg">Ошибка загрузки</p>'; });
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
    var actualBtn = container.querySelector('#duty-actual-month');
    if (prev && sel) prev.addEventListener('click', function () {
      var idx = sel.selectedIndex;
      if (idx > 0) {
        sel.selectedIndex = idx - 1;
        var v = sel.value;
        if (v) {
          var p = v.split('-');
          dutiesCalYear = parseInt(p[0], 10);
          dutiesCalMonth = parseInt(p[1], 10);
          selectDutyMonthAndRender(container);
        }
      }
    });
    if (next && sel) next.addEventListener('click', function () {
      var idx = sel.selectedIndex;
      if (idx >= 0 && idx < sel.options.length - 1) {
        sel.selectedIndex = idx + 1;
        var v = sel.value;
        if (v) {
          var p = v.split('-');
          dutiesCalYear = parseInt(p[0], 10);
          dutiesCalMonth = parseInt(p[1], 10);
          selectDutyMonthAndRender(container);
        }
      }
    });
    if (actualBtn && sel) actualBtn.addEventListener('click', function () {
      var now = new Date();
      var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === ym) {
          sel.selectedIndex = i;
          dutiesCalYear = now.getFullYear();
          dutiesCalMonth = now.getMonth() + 1;
          selectDutyMonthAndRender(container);
          return;
        }
      }
    });
  }

  function openDutiesModule() {
    loadProfile().then(function () {
      var role = (window.__profile && window.__profile.role) ? window.__profile.role : 'user';
      var canEdit = ['sergeant', 'assistant', 'admin'].indexOf(role) >= 0 || Number(userId) === 1027070834;
      var items = [
        { id: 'myduties', label: 'Мои наряды', active: dutiesLocalSection === 'myduties' },
        { id: 'survey', label: 'Опрос', active: dutiesLocalSection === 'survey' }
      ];
      if (canEdit) {
        items.splice(1, 0, { id: 'graph', label: 'График', active: dutiesLocalSection === 'graph' });
        items.push({ id: 'edit', label: 'Правки / замены', active: dutiesLocalSection === 'edit' });
      }
      if (!canEdit && (dutiesLocalSection === 'graph' || dutiesLocalSection === 'edit' || dutiesLocalSection === 'template')) {
        dutiesLocalSection = 'myduties';
      }
      window.onLocalNavClick = function (id, wa) {
        if (!id || !wa) return;
        dutiesLocalSection = id;
        try {
          renderDutiesWorkArea(wa);
        } catch (err) {
          console.error('Duties switch error:', err);
          wa.innerHTML = '<p class="error-msg">Ошибка переключения</p>';
        }
      };
      showModuleLayout('duties', items, renderDutiesWorkArea);
    });
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

      window.__profile = window.__profile || {};
      window.__profile.full_name = data.fio || window.__profile.full_name;
      window.__profile.fio = data.fio;
      window.__profile.group = data.group;
      window.__profile.role = data.role;
      window.__profile.avatar_url = data.avatar_url;

      var avatarSrc = data.avatar_url ? (API_BASE + data.avatar_url) : avatarUrl(data.fio, 120);
      var roleLabels = { admin: 'Администратор', assistant: 'Помощник', sergeant: 'Сержант', user: 'Курсант' };

      var html = '<div class="profile-header-card card">';
      html += '<div class="profile-header-inner">';
      html += '<div class="profile-avatar-big"><img id="profile-avatar-img" src="' + avatarSrc + '" alt="" onerror="this.src=\'' + avatarUrl(data.fio, 120) + '\'" />';
      html += '<label class="profile-avatar-edit" title="Изменить аватар"><input type="file" accept="image/*" id="avatar-upload-input" style="display:none" />✎</label></div>';
      html += '<div class="profile-header-info">';
      html += '<div class="profile-name-row"><h2 id="profile-fio-display">' + escapeHtml(data.fio || '—') + '</h2><button type="button" class="link-btn profile-edit-fio" id="profile-edit-fio-btn" title="Изменить ФИО">✎</button></div>';
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

      // FIO edit
      var editFioBtn = document.getElementById('profile-edit-fio-btn');
      var fioDisplay = document.getElementById('profile-fio-display');
      if (editFioBtn && fioDisplay) {
        editFioBtn.addEventListener('click', function () {
          var current = (fioDisplay.textContent || '').trim();
          var inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'input-text';
          inp.value = current;
          inp.style.cssText = 'font-size:1.25rem;font-weight:600;margin-right:8px;width:200px;max-width:100%';
          var saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'btn-accent';
          saveBtn.textContent = 'Сохранить';
          var cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'topbar-btn';
          cancelBtn.textContent = 'Отмена';
          cancelBtn.style.marginLeft = '8px';
          fioDisplay.replaceWith(inp);
          inp.parentNode.insertBefore(saveBtn, inp.nextSibling);
          inp.parentNode.insertBefore(cancelBtn, saveBtn.nextSibling);
          inp.focus();
          function restore(newVal) {
            var val = newVal !== undefined ? newVal : current;
            inp.remove(); saveBtn.remove(); cancelBtn.remove();
            var h2 = document.createElement('h2');
            h2.id = 'profile-fio-display';
            h2.textContent = val || '—';
            editFioBtn.parentNode.insertBefore(h2, editFioBtn);
          }
          saveBtn.addEventListener('click', function () {
            var val = (inp.value || '').trim();
            if (!val) return;
            apiPost('/api/profile/update', { telegram_id: userId, fio: val }).then(function () {
              window.__profile = window.__profile || {};
              window.__profile.full_name = val;
              window.__profile.fio = val;
              var h = document.getElementById('header-name');
              if (h) h.textContent = val;
              restore(val);
            }).catch(function (e) { alert(e.detail || 'Ошибка'); });
          });
          cancelBtn.addEventListener('click', function () { restore(); });
        });
      }

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
    var applyBtn = document.getElementById('admin-apply-filters');
    if (applyBtn && !applyBtn._bound) {
      applyBtn._bound = true;
      applyBtn.addEventListener('click', function () { loadAdminUsers(); });
    }
  }

  function loadAdminUsers() {
    var listEl = document.getElementById('admin-users-list');
    if (!listEl) return;
    var yearEl = document.getElementById('admin-filter-year');
    var groupEl = document.getElementById('admin-filter-group');
    var searchEl = document.getElementById('admin-search-fio');
    var url = '/api/users?actor_telegram_id=' + userId;
    if (yearEl && yearEl.value) url += '&enrollment_year=' + encodeURIComponent(yearEl.value);
    if (groupEl && groupEl.value) url += '&group_name=' + encodeURIComponent(groupEl.value);
    if (searchEl && searchEl.value.trim()) url += '&search=' + encodeURIComponent(searchEl.value.trim());
    listEl.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    api(url).then(function (data) {
      var users = data.users || [];
      if (yearEl && users.length > 0) {
        var years = [...new Set(users.map(function (u) { return u.enrollment_year; }))].filter(Boolean).sort(function (a, b) { return b - a; });
        if (yearEl.options.length <= 1) {
          years.forEach(function (y) { var o = document.createElement('option'); o.value = y; o.textContent = y + ' год'; yearEl.appendChild(o); });
        }
      }
      if (groupEl && users.length > 0) {
        var groups = [...new Set(users.map(function (u) { return u.group_name || ''; }))].filter(Boolean).sort();
        if (groupEl.options.length <= 1) {
          groups.forEach(function (g) { var o = document.createElement('option'); o.value = g; o.textContent = g; groupEl.appendChild(o); });
        }
      }
      if (users.length === 0) { listEl.innerHTML = '<p class="list-placeholder">Нет пользователей</p>'; return; }
      var roleLabels = { admin: 'Админ', assistant: 'Помощник', sergeant: 'Сержант', user: 'Курсант' };
      listEl.innerHTML = users.map(function (u) {
        var btns = '';
        if (u.role !== 'admin') {
          if (u.role !== 'assistant') btns += '<button class="admin-set-role" data-tid="' + u.telegram_id + '" data-role="assistant">Помощник</button>';
          if (u.role !== 'sergeant') btns += '<button class="admin-set-role" data-tid="' + u.telegram_id + '" data-role="sergeant">Сержант</button>';
          if (u.role !== 'user') btns += '<button class="admin-set-role" data-tid="' + u.telegram_id + '" data-role="user">Снять</button>';
        }
        return '<div class="admin-user-row"><div class="admin-user-info"><strong>' + escapeHtml(u.fio || '—') + '</strong><br/><span class="muted">' + escapeHtml(u.group_name || '') + ' · ' + (u.enrollment_year || '') + ' · ' + (roleLabels[u.role] || u.role) + '</span></div><div class="admin-user-actions">' + btns + '</div></div>';
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
  var SURVEY_INTRO_CARDS = [
    { title: 'Зачем этот опрос', text: 'Вам предлагается оценить сложность нарядов попарно. По вашим ответам будет построена математическая модель — каждому наряду присвоится коэффициент сложности (вес).' },
    { title: 'Как это работает', text: 'Вы сравниваете наряды попарно: выбираете, какой из двух тяжелее, или «равны». Система по всем ответам вычисляет средний коэффициент для каждого наряда.<br/><br/><span class="muted">Базовая ставка — 10 очков. Стоимость наряда = 10 × коэффициент (например, 1.4 → 14 очков, 0.8 → 8 очков). Рейтинг курсанта — сумма очков за выполненные наряды.</span>' },
    { title: 'Зачем это нужно', text: 'Чтобы видеть статистику: какие наряды по мнению курса тяжелее, какие легче. Чтобы сержанты при составлении графиков могли опираться на цифры и равномерно распределять нагрузку.' },
    { title: 'Что дальше', text: 'После опроса будет таблица с итоговыми весами. Раз в месяц голосование повторяется — коэффициенты могут меняться при изменении условий на объектах.' },
    { title: 'Как участвовать', text: 'Два блока: 6 пар по основным нарядам (Курс, ГБР, Столовая, ЗУБ) и все 15 пар по объектам в столовой (Горячий цех, Овощной цех, Стаканы, Железо, Лента, Тарелки) — без повторений, честно. Правильных ответов нет — только ваше мнение.' }
  ];

  function openSurveysModule() {
    setActiveNav('surveys');
    showScreen('screen-surveys');
    var container = document.getElementById('surveys-content');
    if (!container) return;
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    var role = (window.__profile && window.__profile.role) ? window.__profile.role : 'user';
    var isAdmin = ['admin', 'assistant'].indexOf(role) >= 0;
    var canCreateSurvey = ['sergeant', 'assistant', 'admin'].indexOf(role) >= 0;
    Promise.all([
      api('/api/survey/list'),
      isAdmin ? api('/api/survey/status').catch(function () { return {}; }) : Promise.resolve({})
    ]).then(function (res) {
      var data = res[0], statusData = res[1] || {};
      var system = data.system || [];
      var custom = data.custom || [];
      var gender = data.user_gender || 'male';
      window.userSurveyGender = gender;
      var html = '';
      if (isAdmin) {
        html += '<div class="survey-status-block card" style="margin-bottom:16px"><div class="card-body">';
        html += '<p class="muted">Проголосовало: ' + (statusData.voted || 0) + (statusData.total ? ' из ' + statusData.total : '') + '</p>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn-accent survey-finalize-btn" data-stage="main">Завершить (основные)</button><button type="button" class="btn-accent survey-finalize-btn" data-stage="canteen">Завершить (столовая)</button><button type="button" class="btn-accent survey-finalize-btn" data-stage="female">Завершить (девушки)</button></div></div></div>';
      }
      html += '<h3 class="card-title" style="margin-bottom:12px">Системные опросы</h3>';
      html += '<p class="muted" style="margin-bottom:12px">Выберите опрос для прохождения.</p>';
      if (system.length) {
        html += '<div class="survey-list survey-system-list">';
        system.forEach(function (s) {
          if (s.for_gender && s.for_gender !== gender && !isAdmin) return;
          var stage = s.id === 'female' ? 'female' : 'male';
          var cls = 'card survey-card survey-' + stage;
          html += '<button type="button" class="' + cls + '" data-stage="' + stage + '">' + (s.id === 'female' ? '👩 ' : '👨 ') + escapeHtml(s.title) + '</button>';
        });
        html += '</div>';
      }
      html += '<p style="margin-top:20px"><a href="#" class="link-btn accent survey-results-btn">📊 Результаты голосования</a></p>';
      html += '<h3 class="card-title" style="margin-top:24px;margin-bottom:12px">Опросы по группе</h3>';
      if (canCreateSurvey) {
        html += '<p style="margin-bottom:12px"><button type="button" class="btn-accent" id="survey-create-btn-bottom">➕ Создать опрос</button></p>';
      }
      if (custom.length) {
        html += '<ul class="list survey-custom-list">';
        custom.forEach(function (s) { html += '<li><button type="button" class="link-btn survey-custom-btn" data-id="' + s.id + '">' + escapeHtml(s.title) + '</button></li>'; });
        html += '</ul>';
      } else if (!canCreateSurvey) {
        html += '<p class="list-placeholder">Нет опросов по группе</p>';
      }
      if (!system.length && !custom.length && !isAdmin) html += '<p class="list-placeholder">Нет доступных опросов</p>';
      container.innerHTML = html;
      container.querySelectorAll('.survey-finalize-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          apiPost('/api/survey/finalize', { telegram_id: userId, stage: btn.getAttribute('data-stage') }).then(function (d) {
            if (d.next_period) { var np = d.next_period; if (np.length >= 7) np = np.slice(0,4) + '.' + np.slice(5,7); alert('Веса сохранены. До следующего периода: ' + np); }
            openSurveysModule();
          }).catch(function (e) { alert(e.detail || 'Ошибка'); });
        });
      });
      container.querySelectorAll('.survey-card').forEach(function (btn) {
        btn.addEventListener('click', function () { showSurveyIntro(container, btn.getAttribute('data-stage')); });
      });
      container.querySelectorAll('.survey-custom-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { openCustomSurvey(container, parseInt(btn.getAttribute('data-id'), 10)); });
      });
      container.querySelectorAll('.survey-results-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.preventDefault(); showSurveyResults(container); });
      });
      var createBtn = document.getElementById('survey-create-btn') || document.getElementById('survey-create-btn-bottom');
      if (createBtn && canCreateSurvey) {
        createBtn.addEventListener('click', function () { openCreateSurveyModal(container); });
      }
    }).catch(function () { document.getElementById('surveys-content').innerHTML = '<p class="error-msg">Ошибка загрузки опросов</p>'; });
  }

  function showSurveyResults(container) {
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    api('/api/survey/results').then(function (results) {
      var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2 class="card-title" style="margin:0">Результаты голосования</h2><a href="#" class="link-btn survey-back-results">← К опросам</a></div>';
      html += '<p class="muted" style="margin-bottom:16px">Веса объектов по результатам оценки сложности нарядов.</p>';
      if (results && results.length) {
        var byParent = {};
        results.forEach(function (r) {
          var pid = r.parent_id != null ? r.parent_id : '_root';
          if (!byParent[pid]) byParent[pid] = [];
          byParent[pid].push(r);
        });
        var root = byParent['_root'] || [];
        var others = Object.keys(byParent).filter(function (k) { return k !== '_root'; });
        function tableRows(arr) {
          if (!arr || !arr.length) return '';
          var h = '<table class="survey-results-table"><thead><tr><th>Объект</th><th>Вес</th></tr></thead><tbody>';
          arr.forEach(function (r) {
            var w = r.weight != null ? Number(r.weight).toFixed(2) : '—';
            h += '<tr><td>' + escapeHtml(r.name || '—') + '</td><td>' + escapeHtml(w) + '</td></tr>';
          });
          h += '</tbody></table>';
          return h;
        }
        html += '<div class="card"><div class="card-body">' + tableRows(root);
        others.forEach(function (pid) { html += tableRows(byParent[pid]); });
        html += '</div></div>';
      } else {
        html += '<p class="list-placeholder">Нет данных. Пройдите опрос и дождитесь завершения голосования.</p>';
      }
      container.innerHTML = html;
      container.querySelector('.survey-back-results')?.addEventListener('click', function (e) { e.preventDefault(); openSurveysModule(); });
    }).catch(function () { container.innerHTML = '<p class="error-msg">Ошибка загрузки</p><p><a href="#" class="link-btn survey-back-results">← К опросам</a></p>'; container.querySelector('.survey-back-results')?.addEventListener('click', function (e) { e.preventDefault(); openSurveysModule(); }); });
  }

  function openCreateSurveyModal(container) {
    var role = (window.__profile && window.__profile.role) ? window.__profile.role : 'user';
    var scopeOpts = [];
    if (role === 'admin') scopeOpts.push({ v: 'system', l: 'Системный' });
    if (role === 'admin' || role === 'assistant') scopeOpts.push({ v: 'course', l: 'Курс' });
    scopeOpts.push({ v: 'group', l: 'Группа' });
    var modal = document.createElement('div');
    modal.className = 'duty-edit-modal-overlay';
    modal.id = 'create-survey-modal';
    modal.innerHTML = '<div class="duty-edit-modal card" style="max-width:420px"><div class="card-body"><h3 class="card-title">Создать опрос</h3>' +
      '<label class="muted" style="font-size:12px;display:block;margin-bottom:4px">Уровень</label><select id="cs-scope" class="input-select" style="width:100%;margin-bottom:12px">' + scopeOpts.map(function (o) { return '<option value="' + o.v + '">' + escapeHtml(o.l) + '</option>'; }).join('') + '</select>' +
      '<label class="muted" style="font-size:12px;display:block;margin-bottom:4px">Название</label><input type="text" id="cs-title" class="input-text" placeholder="Тема опроса" style="width:100%;margin-bottom:12px;box-sizing:border-box" />' +
      '<label class="muted" style="font-size:12px;display:block;margin-bottom:4px">Варианты (минимум 2)</label><div id="cs-options"></div><button type="button" class="topbar-btn" id="cs-add-option" style="margin-bottom:12px">+ Добавить вариант</button>' +
      '<div style="display:flex;gap:8px"><button type="button" class="btn-accent" id="cs-submit">Создать</button><button type="button" class="topbar-btn" id="cs-cancel">Отмена</button></div></div></div>';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(modal);
    var optsDiv = document.getElementById('cs-options');
    function addOpt(val) {
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'input-text';
      inp.placeholder = 'Вариант';
      inp.value = val || '';
      inp.style.cssText = 'width:100%;margin-bottom:6px;box-sizing:border-box';
      optsDiv.appendChild(inp);
    }
    addOpt('');
    addOpt('');
    document.getElementById('cs-add-option').onclick = function () { addOpt(''); };
    document.getElementById('cs-cancel').onclick = function () { modal.remove(); };
    document.getElementById('cs-submit').onclick = function () {
      var title = (document.getElementById('cs-title').value || '').trim();
      var scope = document.getElementById('cs-scope').value;
      var optInputs = optsDiv.querySelectorAll('input');
      var options = [];
      optInputs.forEach(function (inp) { var v = (inp.value || '').trim(); if (v) options.push(v); });
      if (!title || options.length < 2) { alert('Укажите название и минимум 2 варианта'); return; }
      apiPost('/api/survey/custom', { telegram_id: userId, title: title, scope_type: scope, options: options })
        .then(function () { modal.remove(); openSurveysModule(); })
        .catch(function (e) { alert(e.detail || 'Ошибка'); });
    };
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
  }

  function showSurveyIntro(container, stage) {
    var userGender = (window.__profile && window.__profile.gender) || window.userSurveyGender || 'male';
    if (stage === 'female' && userGender !== 'female' && !(window.__profile && ['admin', 'assistant'].indexOf(window.__profile.role) >= 0)) {
      container.innerHTML = '<div class="card"><div class="card-body"><p class="muted">Этот опрос только для девушек.</p><p><a href="#" class="link-btn survey-back-list">← К списку опросов</a></p></div></div>';
      container.querySelector('.survey-back-list')?.addEventListener('click', function (e) { e.preventDefault(); openSurveysModule(); });
      return;
    }
    var introIndex = 0;
    var title = stage === 'female' ? '📊 Опрос для девушек (ПУТСО, Столовая, Медчасть)' : '📊 Опрос сложности нарядов';
    var html = '<div class="survey-intro-block">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2 class="card-title" style="margin:0">' + escapeHtml(title) + '</h2><button type="button" class="link-btn survey-close-intro">✕ Закрыть</button></div>';
    html += '<div class="survey-intro-cards">';
    SURVEY_INTRO_CARDS.forEach(function (c, i) {
      var cls = 'survey-intro-card' + (i === 0 ? ' active' : '');
      html += '<div class="' + cls + '" data-card="' + i + '"><h3 style="color:var(--accent);font-size:15px;margin-bottom:10px">' + escapeHtml(c.title) + '</h3><p style="color:var(--text);font-size:14px;line-height:1.6">' + c.text + '</p></div>';
    });
    html += '</div>';
    html += '<div class="survey-intro-nav"><button type="button" class="btn-accent survey-intro-prev">← Назад</button>';
    html += '<span class="survey-intro-dots"></span>';
    html += '<button type="button" class="btn-accent survey-intro-next">Далее →</button></div>';
    html += '<button type="button" class="btn-accent survey-intro-start">Пройти опрос</button>';
    html += '</div>';
    container.innerHTML = html;

    var cards = container.querySelectorAll('.survey-intro-card');
    var dotsEl = container.querySelector('.survey-intro-dots');
    var prevBtn = container.querySelector('.survey-intro-prev');
    var nextBtn = container.querySelector('.survey-intro-next');
    var startBtn = container.querySelector('.survey-intro-start');

    function setCard(idx) {
      cards.forEach(function (c, i) { c.classList.toggle('active', i === idx); });
      if (prevBtn) prevBtn.disabled = idx === 0;
      if (nextBtn) nextBtn.disabled = idx === SURVEY_INTRO_CARDS.length - 1;
      if (dotsEl) {
        dotsEl.innerHTML = '';
        for (var i = 0; i < SURVEY_INTRO_CARDS.length; i++) {
          var d = document.createElement('span');
          d.className = 'survey-intro-dot' + (i === idx ? ' active' : '');
          d.onclick = function (j) { return function () { introIndex = j; setCard(introIndex); }; }(i);
          dotsEl.appendChild(d);
        }
      }
    }
    setCard(0);

    if (prevBtn) prevBtn.addEventListener('click', function () { if (introIndex > 0) { introIndex--; setCard(introIndex); } });
    if (nextBtn) nextBtn.addEventListener('click', function () { if (introIndex < SURVEY_INTRO_CARDS.length - 1) { introIndex++; setCard(introIndex); } });
    if (startBtn) startBtn.addEventListener('click', function () { runPairSurvey(container, stage); });
    container.querySelector('.survey-close-intro')?.addEventListener('click', function () { openSurveysModule(); });
  }

  function runPairSurvey(container, stage) {
    if (stage === 'male') {
      runPairSurveyStage(container, 'main', function () { runPairSurveyStage(container, 'canteen', function () { container.innerHTML = '<p class="list-placeholder">Спасибо! Опрос завершён.</p><p><a href="#" class="link-btn survey-back-done">← К списку опросов</a></p>'; container.querySelector('.survey-back-done')?.addEventListener('click', function (e) { e.preventDefault(); openSurveysModule(); }); }); });
      return;
    }
    runPairSurveyStage(container, stage, function () {
      container.innerHTML = '<p class="list-placeholder">Спасибо! Опрос завершён.</p><p><a href="#" class="link-btn survey-back-done">← К списку опросов</a></p>';
      container.querySelector('.survey-back-done')?.addEventListener('click', function (e) { e.preventDefault(); openSurveysModule(); });
    });
  }

  function runPairSurveyStage(container, stage, onComplete) {
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    api('/api/survey/pairs?stage=' + encodeURIComponent(stage)).then(function (data) {
      var pairs = data.pairs || [];
      if (!pairs.length) { if (onComplete) onComplete(); else container.innerHTML = '<p class="list-placeholder">Нет пар</p>'; return; }
      var idx = 0;
      function showPair() {
        if (idx >= pairs.length) { if (onComplete) onComplete(); return; }
        var p = pairs[idx];
        var a = p.object_a || {}, b = p.object_b || {};
        var nameA = a.name || '—', nameB = b.name || '—';
        var idA = a.id, idB = b.id;
        if (!idA || !idB) { container.innerHTML = '<p class="error-msg">Ошибка формата пар</p>'; return; }
        container.innerHTML = '<div class="survey-pair"><p class="muted">Оцени по сложности (' + (idx + 1) + '/' + pairs.length + ')</p><p class="survey-pair-names" style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' + escapeHtml(nameA) + ' vs ' + escapeHtml(nameB) + '</p><div class="survey-pair-btns"><button data-choice="a" class="btn-accent">' + escapeHtml(nameA) + '</button><button data-choice="equal" class="btn-accent">Одинаково</button><button data-choice="b" class="btn-accent">' + escapeHtml(nameB) + '</button></div></div>';
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

  /* ========== PLANS (с Novel) ========== */
  var plansEditorInstance = null;

  function diagnoseNovel() {
    var scriptEl = document.getElementById('plans-editor-script');
    var cssEl = document.querySelector('link[href*="plans-editor"]');
    var diag = {
      plansEditor: !!(window.PlansEditor),
      mountFn: !!(window.PlansEditor && typeof window.PlansEditor.mount === 'function'),
      scriptTag: !!scriptEl,
      scriptSrc: scriptEl ? scriptEl.src : '—',
      scriptLoadError: !!(scriptEl && scriptEl.hasAttribute('data-load-error')),
      cssLoaded: !!cssEl,
      processPolyfill: typeof window.process !== 'undefined' && !!window.process.env,
      react: typeof window.React !== 'undefined',
    };
    diag.ok = diag.plansEditor && diag.mountFn;
    return diag;
  }

  function renderNovelDiagnostic(container) {
    var d = diagnoseNovel();
    var lines = [];
    lines.push('PlansEditor: ' + (d.plansEditor ? 'OK' : 'НЕТ'));
    lines.push('mount(): ' + (d.mountFn ? 'OK' : 'НЕТ'));
    lines.push('Скрипт в DOM: ' + (d.scriptTag ? 'да' : 'нет'));
    lines.push('Скрипт: ' + (d.scriptLoadError ? 'ОШИБКА загрузки' : (d.scriptSrc || '—')));
    lines.push('CSS: ' + (d.cssLoaded ? 'подключён' : 'НЕТ'));
    lines.push('process polyfill: ' + (d.processPolyfill ? 'да' : 'НЕТ'));
    lines.push('React (глобально): ' + (d.react ? 'есть' : 'нет (в бандле)'));
    var html = '<div class="novel-diagnostic" style="margin:12px 0;padding:12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:monospace">';
    html += '<strong>Диагностика Novel</strong><pre style="margin:8px 0 0;white-space:pre-wrap">' + lines.join('\n') + '</pre>';
    html += '<p class="muted" style="margin-top:8px;font-size:11px">F12 → Console для ошибок. Пересобери: cd site/plans-editor && npm run build</p></div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    container.insertBefore(wrap.firstElementChild, container.firstChild);
  }

  function stripHtmlForDisplay(content) {
    if (!content || typeof content !== 'string') return '';
    var s = content.trim();
    if (!s) return '';
    if (s.indexOf('{') === 0) {
      try {
        var doc = JSON.parse(s);
        if (doc && doc.content && Array.isArray(doc.content)) {
          var parts = [];
          function ex(n) { if (n && n.text) parts.push(n.text); if (n && n.content) n.content.forEach(ex); }
          doc.content.forEach(ex);
          var txt = parts.join(' ').trim();
          if (txt) return txt;
        }
      } catch (_) {}
    }
    var tmp = document.createElement('div');
    tmp.innerHTML = s;
    return (tmp.textContent || tmp.innerText || '').trim() || s;
  }

  function loadPlansEditorScript(cb) {
    if (window.PlansEditor) { cb(); return; }
    var script = document.getElementById('plans-editor-script');
    if (script) { script.onload ? cb() : script.addEventListener('load', cb); return; }
    script = document.createElement('script');
    script.id = 'plans-editor-script';
    script.src = 'dist/plans-editor.iife.js';
    script.onload = function () { setTimeout(cb, 50); };
    script.onerror = function () { setTimeout(cb, 0); };
    document.body.appendChild(script);
  }

  function openPlansModule() {
    setActiveNav('plans');
    showScreen('screen-plans');
    var container = document.getElementById('plans-content');
    if (!container) return;
    container.innerHTML = '<p class="list-placeholder">Загрузка…</p>';
    loadPlansEditorScript(function () {
      renderPlansContent(container);
    });
  }

  function renderPlansContent(container) {
    api('/api/tasks?user_id=' + userId).then(function (tasks) {
      try {
        if (!Array.isArray(tasks)) {
          container.innerHTML = '<p class="error-msg">' + (tasks && tasks.error ? tasks.error : 'Ошибка загрузки задач') + '</p>';
          return;
        }
        var hasNovel = !!(window.PlansEditor && typeof window.PlansEditor.mount === 'function');
        var html = '<div class="plans-add-section">';
        if (hasNovel) {
          html += '<p class="muted" style="margin-bottom:8px">Добавить задачу (Notion-style редактор):</p>';
          html += '<div id="plans-novel-container"></div>';
        } else {
          html += '<form id="plans-add-form" class="plans-form"><input type="text" id="plans-add-text" class="input-text" placeholder="Что сделать?" required /><button type="submit" class="btn-accent">Добавить</button></form>';
        }
        html += '</div><ul class="list plans-list" id="plans-list">';
        if (tasks.length === 0) html += '<li class="list-placeholder">Нет задач. Добавьте выше.</li>';
        else tasks.forEach(function (t) {
          var done = t.done ? ' checked' : '';
          var cls = t.done ? ' class="plan-done"' : '';
          var displayText = stripHtmlForDisplay(t.text);
          html += '<li' + cls + '><label class="plan-item"><input type="checkbox" class="plan-checkbox" data-id="' + t.id + '"' + done + ' /><span class="plan-text">' + escapeHtml(displayText) + '</span></label></li>';
        });
        html += '</ul>';
        container.innerHTML = html;
        renderNovelDiagnostic(container);
        if (hasNovel) {
          try {
            console.log('[Novel] Mounting editor…');
            var mountEl = document.getElementById('plans-novel-container');
            if (mountEl) {
              if (plansEditorInstance) plansEditorInstance.unmount();
              plansEditorInstance = window.PlansEditor.mount(mountEl, {
                initialContent: '',
                onSave: function (content) {
                  if (!content || !content.trim()) return;
                  apiPost('/api/add_task', { user_id: userId, text: content }).then(function () { openPlansModule(); });
                },
              });
              console.log('[Novel] Editor mounted OK');
            } else {
              console.warn('[Novel] plans-novel-container not found');
            }
          } catch (e) {
            console.error('[Novel] Mount error:', e);
          }
        } else {
          console.warn('[Novel] PlansEditor not available, using plain input. Diagnostic:', diagnoseNovel());
          var form = document.getElementById('plans-add-form');
          if (form) form.addEventListener('submit', function (e) {
            e.preventDefault();
            var input = document.getElementById('plans-add-text');
            var text = (input && input.value || '').trim();
            if (!text) return;
            apiPost('/api/add_task', { user_id: userId, text: text }).then(function () { input.value = ''; openPlansModule(); });
          });
        }
        container.querySelectorAll('.plan-checkbox').forEach(function (cb) {
          cb.addEventListener('change', function () {
            apiPost('/api/done_task', { task_id: parseInt(cb.getAttribute('data-id'), 10), user_id: userId, done: cb.checked })
              .then(function () { cb.closest('li').classList.toggle('plan-done', cb.checked); });
          });
        });
      } catch (err) {
        console.error('Plans render error:', err);
        container.innerHTML = '<p class="error-msg">Ошибка при отображении задач</p>';
      }
    }).catch(function () {
      container.innerHTML = '<p class="error-msg">Ошибка загрузки задач</p>';
    });
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
  function ensureRegistered() {
    if (!userId) return Promise.resolve();
    return apiPost('/api/register', {
      telegram_id: userId,
      group_name: userGroup || 'Ио6-23',
      enrollment_year: userYear || 2023
    }).then(function () {}).catch(function () {});
  }

  function loadAll() {
    setSubtitleDate();
    ensureRegistered().then(function () {
      return loadProfile();
    }).then(function () {
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
      var quickBtn = document.getElementById('btn-quick-login');
      if (quickBtn) quickBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var idEl = document.getElementById('input-telegram-id');
        var groupEl = document.getElementById('input-group');
        var yearEl = document.getElementById('input-year');
        var btn = document.getElementById('btn-login');
        if (idEl) idEl.value = '1027070834';
        if (groupEl) groupEl.value = 'Ио6-23';
        if (yearEl) yearEl.value = '2023';
        if (btn) btn.click();
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

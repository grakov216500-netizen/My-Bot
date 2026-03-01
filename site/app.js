/**
 * ВИТЕХ — сайт, главная «Мой день»
 * Расписание на сегодня, ближайший наряд, уведомления, рейтинг с аватарками.
 */

(function () {
  const STORAGE_KEY = 'vitech_site_telegram_id';
  const isLocal = /localhost|127\.0\.0\.1/.test(window.location.hostname);
  const API_BASE = isLocal ? '' : 'https://vitechbot.online';

  let userId = null;

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

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => { el.style.display = 'none'; });
    const screen = document.getElementById(id);
    if (screen) screen.style.display = 'block';
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
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(n)}&background=3B82F6&color=fff&size=${size || 64}`;
  }

  async function api(path) {
    const sep = path.includes('?') ? '&' : '?';
    const url = API_BASE + path + sep + 'telegram_id=' + userId;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  async function loadSchedule() {
    const listEl = document.getElementById('list-schedule');
    const metaEl = document.getElementById('schedule-meta');
    if (!listEl) return;

    const d = new Date();
    const day = d.getDay();
    const isWeekend = day === 0 || day === 6;

    try {
      const data = await api('/api/schedule/today');
      const lessons = data.lessons || [];
      const message = data.message;

      if (isWeekend) metaEl.textContent = 'Выходной — с понедельника новая учебная неделя';
      else metaEl.textContent = 'сегодня';

      if (lessons.length === 0) {
        if (message) listEl.innerHTML = `<li class="schedule-weekend">${message}</li>`;
        else if (isWeekend) listEl.innerHTML = '<li class="schedule-weekend">Выходной. В понедельник начнётся новая учебная неделя.</li>';
        else listEl.innerHTML = '<li class="list-placeholder">На сегодня занятий нет</li>';
        return;
      }

      listEl.innerHTML = lessons.map(l => {
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

  async function loadDuties() {
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
      contentEl.innerHTML = '<p class="duty-role">' + roleFull + '</p><p class="duty-date">' + dateFormatted + '</p>';
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
        var body = n.body ? '<div class="notification-body">' + escapeHtml(n.body) + '</div>' : '';
        return '<li><span class="notification-title">' + escapeHtml(n.title || '') + '</span>' + body + '</li>';
      }).join('');
    } catch (e) {
      listEl.innerHTML = '<li class="error-msg">Не удалось загрузить уведомления</li>';
    }
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  async function loadRating() {
    var meAvatarEl = document.getElementById('rating-me-avatar');
    var mePointsEl = document.getElementById('rating-me-points');
    var topEl = document.getElementById('rating-top');
    var headerAvatarEl = document.getElementById('header-avatar');
    var headerNameEl = document.getElementById('header-name');

    try {
      var meData = await api('/api/rating/me');
      var topData = await api('/api/rating/top?period=all&scope=course&limit=10');

      if (mePointsEl) mePointsEl.textContent = meData.points != null ? meData.points : 0;
      var userName = (window.__profile && window.__profile.full_name) ? window.__profile.full_name : 'Вы';

      if (meAvatarEl) {
        meAvatarEl.innerHTML = '';
        var img = document.createElement('img');
        img.src = avatarUrl(userName, 28);
        img.alt = '';
        meAvatarEl.appendChild(img);
      }
      if (headerAvatarEl) {
        headerAvatarEl.innerHTML = '';
        var img2 = document.createElement('img');
        img2.src = avatarUrl(userName, 28);
        img2.alt = '';
        headerAvatarEl.appendChild(img2);
      }
      if (headerNameEl) headerNameEl.textContent = userName;

      var top = topData.top || [];
      if (top.length === 0) {
        topEl.innerHTML = '<li class="list-placeholder">Нет данных</li>';
        return;
      }
      topEl.innerHTML = top.map(function (r) {
        var name = (r.fio || '').trim() || '—';
        return '<li><span class="rank">' + r.rank + '</span><span class="avatar-wrap"><img src="' + avatarUrl(name, 24) + '" alt="" /></span><span class="fio" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span><span class="points">' + r.points + '</span></li>';
      }).join('');
    } catch (e) {
      if (mePointsEl) mePointsEl.textContent = '—';
      if (topEl) topEl.innerHTML = '<li class="error-msg">Не удалось загрузить рейтинг</li>';
    }
  }

  async function loadProfile() {
    try {
      var data = await api('/api/user');
      if (data.error) return false;
      window.__profile = { full_name: data.full_name, group: data.group, course_label: data.course_label };
      var headerName = document.getElementById('header-name');
      var headerAvatar = document.getElementById('header-avatar');
      if (headerName) headerName.textContent = data.full_name || 'Профиль';
      if (headerAvatar) {
        headerAvatar.innerHTML = '';
        var img = document.createElement('img');
        img.src = avatarUrl(data.full_name, 28);
        img.alt = '';
        headerAvatar.appendChild(img);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function loadAll() {
    setSubtitleDate();
    loadProfile().then(function () {
      loadSchedule();
      loadDuties();
      loadNotifications();
      loadRating();
    });
  }

  function init() {
    userId = getStoredOrUrlUserId();
    if (!userId) {
      showScreen('screen-login');
      document.getElementById('btn-login').addEventListener('click', function () {
        var raw = document.getElementById('input-telegram-id').value.trim();
        var id = parseInt(raw, 10);
        if (isNaN(id)) return;
        userId = id;
        try { localStorage.setItem(STORAGE_KEY, String(id)); } catch (_) {}
        showScreen('screen-home');
        loadAll();
      });
      return;
    }
    showScreen('screen-home');
    loadAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

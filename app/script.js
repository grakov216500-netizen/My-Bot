// script.js — Mini App: загрузка графика из GitHub (полу-локальный режим)

document.addEventListener('DOMContentLoaded', () => {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const userNameEl = document.getElementById('user-name');
  const scheduleContainer = document.getElementById('schedule-container');
  const refreshBtn = document.getElementById('refresh-btn');
  const timestampEl = document.getElementById('timestamp');
  const adminPanel = document.getElementById('admin-panel');
  const editModeBtn = document.getElementById('edit-mode-btn');

  // === 1. Получаем данные из Telegram ===
  const user = tg?.initDataUnsafe?.user;
  const userId = user?.id;

  if (user) {
    userNameEl.textContent = `👤 ${user.first_name || 'Курсант'}`;
  } else {
    userNameEl.textContent = '👤 Гость';
  }

  // === 2. Админ? ===
  const isAdmin = userId === 1027070834; // ⚠️ Замени на свой ID при необходимости
  adminPanel.classList.toggle('d-none', !isAdmin);

  // === 3. Загрузить график из GitHub напрямую ===
  async function loadSchedule() {
    if (!userId) {
      showPlaceholderSchedule();
      tg.showAlert("❌ Не удалось получить ID пользователя.");
      return;
    }

    try {
      // 🔗 Загружаем schedules.json напрямую из GitHub
      const response = await fetch('https://raw.githubusercontent.com/grakov216500-netizen/my-bot/main/data/schedules.json');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const schedules = await response.json();
      const userSchedule = schedules[String(userId)] || [];

      // Сортируем по дате
      const sorted = userSchedule.sort((a, b) => a.date.localeCompare(b.date));

      scheduleContainer.innerHTML = '';

      if (sorted.length === 0) {
        scheduleContainer.innerHTML = '<div class="text-muted text-center">📅 Наряды не назначены</div>';
      } else {
        sorted.forEach(item => {
          const date = new Date(item.date);
          const day = date.getDate();
          const month = date.toLocaleString('ru', { month: 'short' });
          const status = new Date() > date ? '✅' : '⏰';

          const div = document.createElement('div');
          div.className = 'day-item';
          div.innerHTML = `
            <div><strong>${status} ${day} ${month}</strong></div>
            <small>${item.role} (${item.group_name})</small>
          `;
          scheduleContainer.appendChild(div);
        });
      }

      timestampEl.textContent = new Date().toLocaleString('ru');
    } catch (error) {
      console.error("Ошибка загрузки графика:", error);
      tg.showAlert("❌ Нет связи с сервером. Проверьте интернет.");
      showPlaceholderSchedule();
    }
  }

  // === 4. Временный график (на случай ошибки) ===
  function showPlaceholderSchedule() {
    const scheduleData = [
      { date: '2025-04-05', role: 'Дежурный по курсу', group_name: '1-1', isPast: false },
      { date: '2025-04-12', role: 'Дежурный по столовой', group_name: '1-1', isPast: false },
      { date: '2025-04-20', role: 'Заместитель командира', group_name: '1-1', isPast: true },
    ];

    scheduleContainer.innerHTML = '';
    scheduleData.forEach(item => {
      const date = new Date(item.date);
      const day = date.getDate();
      const month = date.toLocaleString('ru', { month: 'short' });
      const status = new Date() > date ? '✅' : '⏰';

      const div = document.createElement('div');
      div.className = 'day-item';
      div.innerHTML = `
        <div><strong>${status} ${day} ${month}</strong></div>
        <small>${item.role} (${item.group_name})</small>
      `;
      scheduleContainer.appendChild(div);
    });
    timestampEl.textContent = new Date().toLocaleString('ru');
  }

  // === 5. Кнопки ===
  refreshBtn.addEventListener('click', loadSchedule);
  editModeBtn.addEventListener('click', () => {
    tg.showAlert('✏️ Режим редактирования. Пока недоступен.');
  });

  // Загружаем график при старте
  loadSchedule();
});

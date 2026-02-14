// app/script.js — финальная версия (с full_name + гибкий baseUrl + задачник)

document.addEventListener('DOMContentLoaded', async () => {
    // === Определяем baseUrl: зависит от того, где запущено ===
    const CURRENT_HOST = window.location.hostname;
    let baseUrl;

    if (CURRENT_HOST.includes('github.io')) {
        // На GitHub Pages → API на VPS (теперь по HTTPS)
        baseUrl = "https://vitechbot.online";
    } else {
        // На VPS → относительный путь
        baseUrl = "";
    }

    let userId;

    // === Определяем пользователя: из Telegram или тестовый ID ===
    if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.expand(); // На весь экран
        const user = window.Telegram.WebApp.initDataUnsafe.user;
        userId = user?.id;

        if (!userId) {
            console.warn("⚠️ Не удалось получить user.id из Telegram");
            return showError("Не удалось определить пользователя");
        }
    } else {
        // 🔧 Режим тестирования
        userId = 1027070834;
        console.log("🔧 Тестовый режим: userId =", userId);
    }

    console.log("✅ Загружаем данные для пользователя:", userId);

    // Инициализация интерфейса
    setupNavigation();
    setupEventListeners();

    // Загружаем профиль и наряды
    await loadUserProfile(userId, baseUrl);
    await loadDuties(userId, baseUrl);
});

// --- Глобальные переменные ---
let currentTab = 'home';
let userId = null;
let tasks = [];
const taskMap = {}; // { id: task }

/**
 * Инициализация навигации
 */
function setupNavigation() {
    // Показываем основную вкладку
    switchTab('home');
}

/**
 * Назначение обработчиков
 */
function setupEventListeners() {
    // Кнопка добавления задачи
    const addBtn = document.getElementById('add-task-fab');
    if (addBtn) {
        addBtn.addEventListener('click', startAddTask);
    }

    // Модальное меню
    const closeMenu = document.getElementById('close-menu');
    if (closeMenu) {
        closeMenu.addEventListener('click', () => hideModal());
    }

    // Поиск
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', filterTasks);
    }
}

/**
 * Переключение вкладок
 */
function switchTab(tabName) {
    currentTab = tabName;

    // Скрываем всё
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('notes-screen').style.display = 'none';
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('add-task-fab').style.display = 'none';

    if (tabName === 'notes') {
        // Показываем задачник
        document.getElementById('notes-screen').style.display = 'block';
        document.getElementById('bottom-nav').style.display = 'flex';
        document.getElementById('add-task-fab').style.display = 'flex';

        // Загружаем задачи
        loadTasks();
    } else {
        // Показываем основной экран
        document.getElementById('main-content').classList.remove('hidden');
    }

    // Обновляем активную иконку
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabName);
    });
}

/**
 * Загружает задачи с сервера
 */
async function loadTasks() {
    try {
        const response = await fetch(`${baseUrl}/api/tasks?user_id=${userId}`);
        tasks = await response.json();

        renderTaskList();
        console.log(`✅ Загружено ${tasks.length} задач`);
    } catch (err) {
        console.error("❌ Ошибка загрузки задач:", err);
        document.getElementById('task-list').innerHTML = '<p style="color: #f87171;">Ошибка загрузки</p>';
    }
}

/**
 * Отображает список задач
 */
function renderTaskList(filterText = '') {
    const container = document.getElementById('task-list');
    if (!container) return;

    const filtered = tasks.filter(t => t.text.toLowerCase().includes(filterText.toLowerCase()));

    if (filtered.length === 0) {
        container.innerHTML = '<p style="color: #64748B; text-align: center;">Нет задач</p>';
        return;
    }

    container.innerHTML = '';

    filtered.forEach(task => {
        const div = document.createElement('div');
        div.className = `task-card ${task.done ? 'task-done' : ''}`;
        div.dataset.id = task.id;

        // Галочка
        const checkbox = document.createElement('div');
        checkbox.className = `task-checkbox ${task.done ? 'checked' : ''}`;
        checkbox.onclick = (e) => {
            e.stopPropagation();
            toggleTaskDone(task.id);
        };

        // Текст
        const textSpan = document.createElement('span');
        textSpan.className = 'task-text';
        textSpan.textContent = task.text;

        // Действия
        const actions = document.createElement('div');
        actions.className = 'task-actions';

        const bellBtn = document.createElement('button');
        bellBtn.innerHTML = '⏰';
        bellBtn.title = 'Установить напоминание';
        bellBtn.onclick = (e) => {
            e.stopPropagation();
            setReminder(task.id);
        };

        const menuBtn = document.createElement('button');
        menuBtn.innerHTML = '⋮';
        menuBtn.title = 'Меню';
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            openTaskMenu(task.id);
        };

        actions.appendChild(bellBtn);
        actions.appendChild(menuBtn);

        div.appendChild(checkbox);
        div.appendChild(textSpan);
        div.appendChild(actions);

        container.appendChild(div);
    });
}

/**
 * Фильтрация по поиску
 */
function filterTasks() {
    const query = document.getElementById('search-input').value;
    renderTaskList(query);
}

/**
 * Переключение статуса задачи
 */
async function toggleTaskDone(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const newStatus = !task.done;

    try {
        await fetch(`${baseUrl}/api/done_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, user_id: userId, done: newStatus })
        });

        task.done = newStatus;
        renderTaskList(document.getElementById('search-input').value);
        console.log(`✅ Задача ${taskId} отмечена как ${newStatus ? 'выполнена' : 'активна'}`);
    } catch (err) {
        console.error("❌ Ошибка обновления статуса:", err);
    }
}

/**
 * Начало добавления задачи
 */
async function startAddTask() {
    const text = prompt("Введите текст задачи:");
    if (!text || !text.trim()) return;

    try {
        const response = await fetch(`${baseUrl}/api/add_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, text: text.trim() })
        });

        if (response.ok) {
            await loadTasks(); // Обновляем список
            console.log("✅ Задача добавлена");
        }
    } catch (err) {
        console.error("❌ Ошибка добавления задачи:", err);
    }
}

/**
 * Открытие меню задачи (⋮)
 */
function openTaskMenu(taskId) {
    const menu = document.getElementById('task-menu');
    menu.style.display = 'flex';

    // Назначаем действия
    document.getElementById('edit-task').onclick = () => editTask(taskId);
    document.getElementById('delete-task').onclick = () => deleteTask(taskId);
    document.getElementById('set-reminder').onclick = () => setReminder(taskId);
}

/**
 * Скрытие модального окна
 */
function hideModal() {
    document.getElementById('task-menu').style.display = 'none';
}

/**
 * Редактирование задачи
 */
async function editTask(taskId) {
    hideModal();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const newText = prompt("Редактировать задачу:", task.text);
    if (!newText || newText === task.text) return;

    try {
        await fetch(`${baseUrl}/api/edit_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, text: newText.trim(), user_id: userId })
        });

        task.text = newText.trim();
        renderTaskList(document.getElementById('search-input').value);
        console.log("✅ Задача отредактирована");
    } catch (err) {
        console.error("❌ Ошибка редактирования:", err);
    }
}

/**
 * Удаление задачи
 */
async function deleteTask(taskId) {
    hideModal();
    if (!confirm("Удалить задачу?")) return;

    try {
        await fetch(`${baseUrl}/api/delete_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, user_id: userId })
        });

        tasks = tasks.filter(t => t.id !== taskId);
        renderTaskList(document.getElementById('search-input').value);
        console.log("✅ Задача удалена");
    } catch (err) {
        console.error("❌ Ошибка удаления:", err);
    }
}

/**
 * Установка напоминания
 */
async function setReminder(taskId) {
    hideModal();
    const dateStr = prompt("Введите дату и время (ДД ЧЧ:ММ):", "05 20:30");
    if (!dateStr) return;

    const match = dateStr.match(/^(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
    if (!match) {
        alert("❌ Неверный формат. Пример: 05 20:30");
        return;
    }

    try {
        const [_, day, hour, minute] = match.map(Number);
        const now = new Date();
        let year = now.getFullYear();
        let month = now.getMonth() + 1;

        if (day < now.getDate()) {
            month += 1;
            if (month > 12) {
                month = 1;
                year += 1;
            }
        }

        const deadline = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${hour}:${minute}:00`;

        await fetch(`${baseUrl}/api/set_reminder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, deadline, user_id: userId })
        });

        loadTasks(); // Обновляем
        alert("✅ Напоминание установлено");
    } catch (err) {
        console.error("❌ Ошибка установки напоминания:", err);
        alert("Ошибка при установке напоминания");
    }
}

// === Остальные функции (остаются без изменений) ===

function showError(message) {
    const widget = document.getElementById('next-duty-widget');
    if (widget) {
        widget.innerHTML = `<p style="color: #f87171;">Ошибка: ${message}</p>`;
    }
    console.error("❌", message);
}

async function loadUserProfile(userId, baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/api/user?telegram_id=${userId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) return;

        const avatar = document.querySelector('.avatar');
        if (avatar) {
            const name = data.full_name || "Аноним";
            avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3B82F6&color=fff`;
        }

        const userNameEl = document.getElementById('userName');
        const userCourseEl = document.getElementById('userCourse');
        const userGroupEl = document.getElementById('userGroup');

        if (userNameEl) userNameEl.textContent = data.full_name;
        if (userCourseEl) userCourseEl.textContent = `Курс: ${data.course}`;
        if (userGroupEl) userGroupEl.textContent = `Группа: ${data.group}`;

        console.log("✅ Профиль загружен:", data.full_name);
    } catch (err) {
        console.error("❌ Ошибка загрузки профиля:", err);
        showError("Не удалось загрузить профиль");
    }
}

async function loadDuties(userId, baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/api/duties?telegram_id=${userId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const widget = document.getElementById('next-duty-widget');
        if (!widget) return;

        if (data.error) {
            widget.innerHTML = `<h3>🎖️ Ближайший наряд</h3><p style="color: #f87171;">${data.error}</p>`;
            return;
        }

        if (data.next_duty) {
            const roleFull = data.next_duty.role_full || data.next_duty.role;
            const daysLeft = getDaysLeft(data.next_duty.date);
            const dateFormatted = formatDate(data.next_duty.date);

            widget.innerHTML = `
                <h3>🎖️ Ближайший наряд</h3>
                <p>${roleFull}</p>
                <p>Через ${daysLeft} дней (${dateFormatted})</p>
            `;
        } else {
            widget.innerHTML = `<h3>🎖️ Ближайший наряд</h3><p>Нарядов нет</p>`;
        }

        console.log("✅ Наряды загружены:", data.total);
    } catch (err) {
        console.error("❌ Ошибка загрузки нарядов:", err);
        document.getElementById('next-duty-widget').innerHTML = 
            `<h3>🎖️ Ближайший наряд</h3><p style="color: #f87171;">Не удалось загрузить данные</p>`;
    }
}

function getDaysLeft(dateStr) {
    const today = new Date();
    const date = new Date(dateStr);
    const diffTime = date - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

function formatDate(dateStr) {
    const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
    return new Date(dateStr).toLocaleDateString('ru-RU', options);
}

// === Кнопки ===
function openNotifications() {
    alert("🔔 Уведомления\n(в разработке)");
}

function openSettings() {
    alert("⚙️ Настройки\n(в разработке)");
}
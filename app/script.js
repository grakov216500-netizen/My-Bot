// Глобальные переменные
let baseUrl = '';
let userId = null;
let tasks = [];
const taskMap = {};

document.addEventListener('DOMContentLoaded', async () => {
    const CURRENT_HOST = window.location.hostname;

    if (CURRENT_HOST.includes('github.io')) {
        baseUrl = "https://vitechbot.online";
    } else {
        baseUrl = "";
    }

    // === Определяем пользователя ТОЛЬКО из Telegram ===
    if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.expand();
        const user = window.Telegram.WebApp.initDataUnsafe.user;
        userId = user?.id;

        if (!userId) {
            console.error("❌ Не удалось получить user.id из Telegram");
            showError("Это приложение должно открываться через Telegram. Закройте эту страницу и откройте бота.");
            return; // останавливаем выполнение, если нет пользователя
        }
    } else {
        console.error("❌ Telegram WebApp не доступен");
        showError("Пожалуйста, откройте это приложение через Telegram бота.");
        return;
    }

    console.log("✅ Загружаем данные для пользователя:", userId);

    setupNavigation();
    setupEventListeners();

    await loadUserProfile(userId);
    await loadDuties(userId);
});

let currentTab = 'home';

function setupNavigation() {
    switchTab('home');
}

function setupEventListeners() {
    // Обработчики для нижней панели навигации
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.dataset.tab;
            if (tab) switchTab(tab);
        });
    });

    const addBtn = document.getElementById('add-task-fab');
    if (addBtn) addBtn.addEventListener('click', startAddTask);

    const closeMenu = document.getElementById('close-menu');
    if ( closeMenu) closeMenu.addEventListener('click', hideModal);

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', filterTasks);
}

function switchTab(tabName) {
    currentTab = tabName;

    // Скрываем все экраны
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('notes-screen').style.display = 'none';
    document.getElementById('duties-screen').style.display = 'none';
    document.getElementById('study-screen').style.display = 'none';
    document.getElementById('rating-screen').style.display = 'none';
    document.getElementById('survey-screen').style.display = 'none'; // новый экран опроса
    document.getElementById('add-task-fab').style.display = 'none';

    // Показываем нужный экран
    if (tabName === 'notes') {
        document.getElementById('notes-screen').style.display = 'block';
        document.getElementById('add-task-fab').style.display = 'flex';
        loadTasks();
    } else if (tabName === 'duties') {
        document.getElementById('duties-screen').style.display = 'block';
    } else if (tabName === 'study') {
        document.getElementById('study-screen').style.display = 'block';
    } else if (tabName === 'rating') {
        document.getElementById('rating-screen').style.display = 'block';
    } else if (tabName === 'survey') {
        document.getElementById('survey-screen').style.display = 'block';
        loadSurveyObjects(); // загружаем список объектов для опроса
    } else { // home
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

        const checkbox = document.createElement('div');
        checkbox.className = `task-checkbox ${task.done ? 'checked' : ''}`;
        checkbox.onclick = (e) => {
            e.stopPropagation();
            toggleTaskDone(task.id);
        };

        const textSpan = document.createElement('span');
        textSpan.className = 'task-text';
        textSpan.textContent = task.text;

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

function filterTasks() {
    const query = document.getElementById('search-input').value;
    renderTaskList(query);
}

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
            await loadTasks();
            console.log("✅ Задача добавлена");
        }
    } catch (err) {
        console.error("❌ Ошибка добавления задачи:", err);
    }
}

function openTaskMenu(taskId) {
    const menu = document.getElementById('task-menu');
    menu.style.display = 'flex';

    document.getElementById('edit-task').onclick = () => editTask(taskId);
    document.getElementById('delete-task').onclick = () => deleteTask(taskId);
    document.getElementById('set-reminder').onclick = () => setReminder(taskId);
}

function hideModal() {
    document.getElementById('task-menu').style.display = 'none';
}

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

        loadTasks();
        alert("✅ Напоминание установлено");
    } catch (err) {
        console.error("❌ Ошибка установки напоминания:", err);
        alert("Ошибка при установке напоминания");
    }
}

function showError(message) {
    const widget = document.getElementById('next-duty-widget');
    if (widget) {
        widget.innerHTML = `<p style="color: #f87171;">Ошибка: ${message}</p>`;
    }
    console.error("❌", message);
}

async function loadUserProfile(userId) {
    try {
        const response = await fetch(`${baseUrl}/api/user?telegram_id=${userId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) {
            console.warn("⚠️ API вернуло ошибку:", data.error);
            return;
        }

        const avatar = document.querySelector('.avatar');
        if (avatar) {
            const name = data.full_name || "Аноним";
            avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3B82F6&color=fff`;
        }

        const userNameEl = document.getElementById('userName');
        const userCourseEl = document.getElementById('userCourse');
        const userGroupEl = document.getElementById('userGroup');

        if (userNameEl) userNameEl.textContent = data.full_name || "—";
        if (userCourseEl) userCourseEl.textContent = `Курс: ${data.course || "—"}`;
        if (userGroupEl) userGroupEl.textContent = `Группа: ${data.group || "—"}`;

        console.log("✅ Профиль загружен:", data.full_name);
    } catch (err) {
        console.error("❌ Ошибка загрузки профиля:", err);
        showError("Не удалось загрузить профиль");
    }
}

async function loadDuties(userId) {
    try {
        const response = await fetch(`${baseUrl}/api/duties?telegram_id=${userId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const widget = document.getElementById('next-duty-widget');
        if (!widget) return;

        if (data.error) {
            // Специальная обработка для отсутствия таблицы duties
            if (data.error.includes('no such table')) {
                widget.innerHTML = `
                    <h3>🎖️ Ближайший наряд</h3>
                    <p style="color: #f87171;">Нарядов пока нет.</p>
                    <p>Чтобы настроить систему, <a href="#" onclick="switchTab('survey'); return false;" style="color: #3B82F6;">пройдите опрос</a> о сложности объектов.</p>
                `;
                return;
            }
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

// === НОВЫЕ ФУНКЦИИ ДЛЯ ОПРОСНИКА ===

/**
 * Загружает список объектов для голосования и отображает их
 */
async function loadSurveyObjects() {
    const container = document.getElementById('survey-objects-container');
    if (!container) return;

    try {
        const response = await fetch(`${baseUrl}/api/survey/objects`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const objects = await response.json();

        // Группируем по parent_id
        const byParent = {};
        objects.forEach(obj => {
            if (obj.parent_id === null) {
                if (!byParent[obj.id]) byParent[obj.id] = { obj, children: [] };
            } else {
                if (!byParent[obj.parent_id]) byParent[obj.parent_id] = { obj: null, children: [] };
                byParent[obj.parent_id].children.push(obj);
            }
        });

        let html = '';
        // Сначала выводим категории без родителей (основные)
        for (const [parentId, group] of Object.entries(byParent)) {
            if (group.obj) {
                html += `<h3 style="color: #E2E8F0; margin: 20px 0 10px 0;">${group.obj.name}</h3>`;
            }
            // Выводим дочерние объекты
            group.children.forEach(child => {
                html += `
                    <div style="display: flex; align-items: center; justify-content: space-between; background: #1E293B; padding: 10px; border-radius: 8px; margin-bottom: 8px;">
                        <span style="color: #CBD5E1;">${child.name}</span>
                        <div style="display: flex; gap: 8px;">
                            ${[1,2,3,4,5].map(i => `
                                <label style="color: #94A3B8;">
                                    <input type="radio" name="obj_${child.id}" value="${i}" style="margin-right: 2px;"> ${i}
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `;
            });
        }
        container.innerHTML = html;

        // Добавляем обработчик для кнопки отправки
        document.getElementById('submit-survey-btn').onclick = async () => {
            const votes = [];
            objects.forEach(obj => {
                const radios = document.getElementsByName(`obj_${obj.id}`);
                let selected = null;
                for (const radio of radios) {
                    if (radio.checked) {
                        selected = radio.value;
                        break;
                    }
                }
                if (selected) {
                    votes.push({ object_id: obj.id, rating: parseInt(selected) });
                }
            });
            if (votes.length === 0) {
                alert('Выберите хотя бы одну оценку');
                return;
            }
            // Отправляем каждый голос
            for (const vote of votes) {
                try {
                    const res = await fetch(`${baseUrl}/api/survey/vote`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id: userId, object_id: vote.object_id, rating: vote.rating })
                    });
                    if (!res.ok) {
                        const err = await res.json();
                        alert(`Ошибка: ${err.detail || 'Не удалось отправить голос'}`);
                        break;
                    }
                } catch (err) {
                    console.error(err);
                    alert('Ошибка сети');
                    break;
                }
            }
            alert('Спасибо! Ваши оценки сохранены.');
            // Можно переключиться на другой экран
            switchTab('home');
        };
    } catch (err) {
        console.error('❌ Ошибка загрузки объектов:', err);
        container.innerHTML = '<p style="color: #f87171;">Ошибка загрузки опроса</p>';
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

function openNotifications() {
    alert("🔔 Уведомления\n(в разработке)");
}

function openSettings() {
    alert("⚙️ Настройки\n(в разработке)");
}
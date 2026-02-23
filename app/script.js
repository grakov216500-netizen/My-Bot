// Глобальные переменные
let baseUrl = '';
let userId = null;
let userFio = null; // ФИО текущего пользователя
let tasks = [];
const taskMap = {};
let notesTab = 'active'; // 'active' | 'done'

document.addEventListener('DOMContentLoaded', async () => {
    const CURRENT_HOST = window.location.hostname;

    // API base URL:
    // - локально (localhost/127.0.0.1) работаем с тем же origin (baseUrl = "")
    // - во всех остальных случаях ходим на прод-домен API
    const isLocal =
        CURRENT_HOST === 'localhost' ||
        CURRENT_HOST === '127.0.0.1' ||
        CURRENT_HOST === '';
    baseUrl = isLocal ? '' : 'https://vitechbot.online';

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
    setupEditDeleteModals();
    setupReminderModal();
    setupProfileAndAdmin();

    const userOk = await loadUserProfile(userId);
    if (!userOk) {
        showUnregisteredState();
        return;
    }
    await loadDuties(userId);
    await loadSurveyResults();
});

let currentTab = 'home';
let userRole = 'user'; // admin | assistant | sergeant | user
let currentMonth = new Date().getMonth() + 1;
let currentYear = new Date().getFullYear();

const ROLE_LABELS = { admin: 'Администратор', assistant: 'Помощник', sergeant: 'Сержант', user: 'Курсант' };
function getRoleLabel(r) { return ROLE_LABELS[r] || r; }

function setupNavigation() {
    switchTab('home');
}

function setupEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const tab = item.dataset.tab;
            if (tab) switchTab(tab);
        });
    });

    // Один обработчик для кнопки «+» — открываем своё модальное окно (не prompt)
    const addBtn = document.getElementById('add-task-fab');
    if (addBtn) {
        addBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            openAddTaskModal();
        }, false);
    }

    const closeMenu = document.getElementById('close-menu');
    if (closeMenu) closeMenu.addEventListener('click', hideModal);

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', filterTasks);

    // Модальное окно добавления задачи: OK / Отмена
    const addTaskModal = document.getElementById('add-task-modal');
    const addTaskInput = document.getElementById('add-task-input');
    const addTaskOk = document.getElementById('add-task-ok');
    const addTaskCancel = document.getElementById('add-task-cancel');
    if (addTaskOk) addTaskOk.addEventListener('click', submitAddTaskFromModal);
    if (addTaskCancel) addTaskCancel.addEventListener('click', closeAddTaskModal);

    // Тост (сообщение): один раз привязать ОК
    const toastOk = document.getElementById('toast-ok');
    if (toastOk) toastOk.addEventListener('click', closeToast);
}

function setupReminderModal() {
    const ok = document.getElementById('reminder-ok');
    const cancel = document.getElementById('reminder-cancel');
    if (ok) ok.addEventListener('click', submitReminderFromModal);
    if (cancel) cancel.addEventListener('click', closeReminderModal);
}

function setupProfileAndAdmin() {
    const openBtn = document.getElementById('open-profile-btn');
    if (openBtn) openBtn.addEventListener('click', openProfileScreen);
    const backBtn = document.getElementById('profile-back');
    if (backBtn) backBtn.addEventListener('click', closeProfileScreen);
    const saveBtn = document.getElementById('profile-save');
    if (saveBtn) saveBtn.addEventListener('click', saveProfile);
    const adminPanelBtn = document.getElementById('profile-admin-panel');
    if (adminPanelBtn) adminPanelBtn.addEventListener('click', function() { openAdminPanel('admin'); });
    const assistantPanelBtn = document.getElementById('profile-assistant-panel');
    if (assistantPanelBtn) assistantPanelBtn.addEventListener('click', function() { openAdminPanel('assistant'); });
    const profileToggle = document.getElementById('profile-toggle');
    if (profileToggle) profileToggle.addEventListener('click', function() {
        const body = document.getElementById('profile-body');
        const icon = document.getElementById('profile-toggle-icon');
        if (body.style.display === 'none') {
            body.style.display = 'block';
            if (icon) icon.textContent = '▼ Свернуть';
        } else {
            body.style.display = 'none';
            if (icon) icon.textContent = '▶ Развернуть';
        }
    });
    const adminBackBtn = document.getElementById('admin-back');
    if (adminBackBtn) adminBackBtn.addEventListener('click', closeAdminPanel);
    const adminLoadBtn = document.getElementById('admin-load-users');
    if (adminLoadBtn) adminLoadBtn.addEventListener('click', loadAdminUsersList);
    const finalizeBtn = document.getElementById('survey-finalize-btn');
    if (finalizeBtn) finalizeBtn.addEventListener('click', finalizeSurvey);
}

async function finalizeSurvey() {
    if (userRole !== 'admin' && userRole !== 'assistant') return;
    try {
        const res = await fetch(baseUrl + '/api/survey/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_id: userId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Ошибка');
        const voted = data.total_voted != null ? data.total_voted : 0;
        document.getElementById('survey-screen').style.display = 'none';
        switchTab('home');
        await loadSurveyResults();
        await loadDuties(userId);
        showToast('Опрос завершён. Проголосовало: ' + voted + ' чел.');
    } catch (e) {
        showToast(e.message || 'Ошибка завершения опроса');
    }
}

function openProfileScreen() {
    document.getElementById('profile-fio').value = userFio || '';
    document.getElementById('profile-course').textContent = (document.getElementById('userCourse') && document.getElementById('userCourse').textContent) || '—';
    document.getElementById('profile-group').value = (document.getElementById('userGroup') && document.getElementById('userGroup').textContent.replace(/^Группа:\s*/, '')) || '';
    document.getElementById('profile-role').textContent = 'Роль: ' + getRoleLabel(userRole);
    document.getElementById('profile-admin-panel').style.display = userRole === 'admin' ? 'inline-block' : 'none';
    document.getElementById('profile-assistant-panel').style.display = userRole === 'assistant' ? 'inline-block' : 'none';
    document.getElementById('profile-body').style.display = 'none';
    var icon = document.getElementById('profile-toggle-icon');
    if (icon) icon.textContent = '▶ Развернуть';
    document.querySelectorAll('.app-screen').forEach(function(el) { el.style.display = 'none'; });
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('profile-screen').style.display = 'block';
}

function closeProfileScreen() {
    document.getElementById('profile-screen').style.display = 'none';
    document.getElementById('main-content').classList.remove('hidden');
    document.getElementById('main-content').style.display = 'block';
}

async function saveProfile() {
    const fio = document.getElementById('profile-fio').value.trim();
    const group = document.getElementById('profile-group').value.trim();
    try {
        const res = await fetch(baseUrl + '/api/user', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: userId, fio: fio || undefined, group_name: group })
        });
        if (!res.ok) throw new Error((await res.json()).detail || 'Ошибка');
        userFio = fio;
        const userNameEl = document.getElementById('userName');
        const userGroupEl = document.getElementById('userGroup');
        if (userNameEl) userNameEl.textContent = fio || userFio;
        if (userGroupEl) userGroupEl.textContent = 'Группа: ' + (group || '—');
        showToast('Профиль сохранён');
    } catch (e) {
        showToast('Ошибка сохранения');
    }
}

let _adminPanelMode = 'admin'; // 'admin' | 'assistant'

function openAdminPanel(mode) {
    _adminPanelMode = mode;
    document.getElementById('admin-panel-title').textContent = mode === 'admin' ? '⚙️ Админ-панель: список пользователей' : '🛠 Панель помощника: список пользователей';
    document.getElementById('admin-filter-year').style.display = mode === 'admin' ? 'block' : 'none';
    document.querySelectorAll('.app-screen').forEach(function(el) { el.style.display = 'none'; });
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('admin-panel-screen').style.display = 'block';
    loadAdminUsersList();
}

function closeAdminPanel() {
    document.getElementById('admin-panel-screen').style.display = 'none';
    document.getElementById('main-content').classList.remove('hidden');
    document.getElementById('main-content').style.display = 'block';
}

async function loadAdminUsersList() {
    const yearSelect = document.getElementById('admin-filter-year');
    const search = document.getElementById('admin-search-fio').value.trim();
    const listEl = document.getElementById('admin-users-list');
    listEl.innerHTML = '<p style="color:#94A3B8;">Загрузка...</p>';
    let url = `${baseUrl}/api/users?actor_telegram_id=${userId}`;
    if (_adminPanelMode === 'admin' && yearSelect && yearSelect.value) url += '&enrollment_year=' + yearSelect.value;
    if (search) url += '&search=' + encodeURIComponent(search);
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Ошибка загрузки');
        const data = await res.json();
        if (!data.users || data.users.length === 0) {
            listEl.innerHTML = '<p style="color:#94A3B8;">Нет пользователей</p>';
            return;
        }
        let html = '';
        data.users.forEach(function(u) {
            const roleLabel = getRoleLabel(u.role);
            html += '<div class="admin-user-row" style="background:#0f172a;border-radius:8px;padding:10px;margin-bottom:8px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;">';
            html += '<div style="flex:1;min-width:140px;"><strong style="color:#E2E8F0;">' + (u.fio || '—') + '</strong><br/><span style="color:#94A3B8;font-size:12px;">' + (u.group_name || '') + ', ' + (u.enrollment_year || '') + ' · ' + roleLabel + '</span></div>';
            html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
            if (_adminPanelMode === 'admin' && u.role !== 'assistant') html += '<button type="button" class="admin-set-role" data-tid="' + u.telegram_id + '" data-role="assistant" style="padding:6px 10px;background:#6366F1;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Помощник</button>';
            if (u.role !== 'sergeant') html += '<button type="button" class="admin-set-role" data-tid="' + u.telegram_id + '" data-role="sergeant" style="padding:6px 10px;background:#8B5CF6;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Сержант</button>';
            if (u.role !== 'user') html += '<button type="button" class="admin-set-role" data-tid="' + u.telegram_id + '" data-role="user" style="padding:6px 10px;background:#64748B;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Снять</button>';
            html += '</div></div>';
        });
        listEl.innerHTML = html;
        listEl.querySelectorAll('.admin-set-role').forEach(function(btn) {
            btn.addEventListener('click', function() {
                setUserRole(parseInt(btn.dataset.tid, 10), btn.dataset.role);
            });
        });
        if (_adminPanelMode === 'admin' && yearSelect && yearSelect.options.length <= 1) {
            const years = [...new Set(data.users.map(function(u) { return u.enrollment_year; }))].sort(function(a,b) { return b - a; });
            years.forEach(function(y) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y + ' г.';
                yearSelect.appendChild(opt);
            });
        }
    } catch (e) {
        listEl.innerHTML = '<p style="color:#f87171;">Ошибка загрузки списка</p>';
    }
}

async function setUserRole(targetTelegramId, newRole) {
    try {
        const res = await fetch(baseUrl + '/api/users/set-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor_telegram_id: userId, target_telegram_id: targetTelegramId, role: newRole })
        });
        if (!res.ok) throw new Error((await res.json()).detail || 'Ошибка');
        showToast('Роль обновлена');
        loadAdminUsersList();
    } catch (e) {
        showToast(e.message || 'Ошибка назначения');
    }
}

// --- Свои модальные окна вместо prompt/alert (без системного диалога и дубля) ---
function openAddTaskModal() {
    var modal = document.getElementById('add-task-modal');
    var input = document.getElementById('add-task-input');
    if (!modal || !input) return;
    input.value = '';
    modal.style.display = 'flex';
    input.focus();
}

function closeAddTaskModal() {
    var modal = document.getElementById('add-task-modal');
    if (modal) modal.style.display = 'none';
}

function submitAddTaskFromModal() {
    var input = document.getElementById('add-task-input');
    var text = input && input.value ? input.value.trim() : '';
    closeAddTaskModal();
    if (!text) return;
    startAddTaskWithText(text);
}

async function startAddTaskWithText(text) {
    try {
        var response = await fetch(baseUrl + '/api/add_task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, text: text })
        });
        if (response.ok) {
            await loadTasks();
            showToast('Задача добавлена');
        } else {
            showToast('Ошибка добавления');
        }
    } catch (err) {
        console.error(err);
        showToast('Ошибка сети');
    }
}

function showToast(message) {
    var modal = document.getElementById('toast-modal');
    var msgEl = document.getElementById('toast-message');
    if (msgEl) msgEl.textContent = message;
    if (modal) modal.style.display = 'flex';
}

function closeToast() {
    var modal = document.getElementById('toast-modal');
    if (modal) modal.style.display = 'none';
}

function switchTab(tabName) {
    currentTab = tabName;

    const mainContent = document.getElementById('main-content');
    const notesScreen = document.getElementById('notes-screen');
    const dutiesScreen = document.getElementById('duties-screen');
    const studyScreen = document.getElementById('study-screen');
    const surveyScreen = document.getElementById('survey-screen');
    const addFab = document.getElementById('add-task-fab');

    // Шапка: показываем только на главной
    const header = document.getElementById('main-header');
    if (header) header.style.display = (tabName === 'home') ? 'flex' : 'none';

    // Скрываем все экраны (без падения, даже если какого-то блока нет в DOM)
    if (mainContent) mainContent.classList.add('hidden');
    if (notesScreen) notesScreen.style.display = 'none';
    if (dutiesScreen) dutiesScreen.style.display = 'none';
    if (studyScreen) studyScreen.style.display = 'none';
    if (surveyScreen) surveyScreen.style.display = 'none';
    if (addFab) addFab.style.display = 'none';

    // Показываем нужный экран
    if (tabName === 'notes') {
        if (notesScreen) notesScreen.style.display = 'block';
        if (addFab) addFab.style.display = 'flex';
        loadTasks();
    } else if (tabName === 'duties') {
        if (dutiesScreen) dutiesScreen.style.display = 'block';
        const uploadBlock = document.getElementById('duty-upload-block');
        if (uploadBlock) uploadBlock.style.display = (userRole === 'sergeant' || userRole === 'assistant' || userRole === 'admin') ? 'block' : 'none';
        loadDutiesForMonth(); // Загружаем наряды на текущий месяц
        bindDutyUploadOnce();
    } else if (tabName === 'study') {
        if (studyScreen) studyScreen.style.display = 'block';
    } else if (tabName === 'survey') {
        if (surveyScreen) surveyScreen.style.display = 'block';
        showSurveyList();
        loadSurveyList();
    } else { // home
        if (mainContent) mainContent.classList.remove('hidden');
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
 * Переключает вкладку Активные / Выполненные
 */
function setNotesTab(tab) {
    notesTab = tab;
    document.getElementById('tab-active').classList.toggle('active', tab === 'active');
    document.getElementById('tab-done').classList.toggle('active', tab === 'done');
    renderTaskList(document.getElementById('search-input').value);
}

/**
 * Отображает список задач
 */
function renderTaskList(filterText = '') {
    const container = document.getElementById('task-list');
    if (!container) return;

    let filtered = tasks.filter(t => t.text.toLowerCase().includes((filterText || '').toLowerCase()));
    // Фильтр по вкладке Активные / Выполненные
    if (notesTab === 'active') {
        filtered = filtered.filter(t => !t.done);
    } else {
        filtered = filtered.filter(t => t.done);
    }

    if (filtered.length === 0) {
        const msg = notesTab === 'active' ? 'Нет активных задач' : 'Нет выполненных задач';
        container.innerHTML = `<p style="color: #64748B; text-align: center;">${msg}</p>`;
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
        const q = document.getElementById('search-input');
        renderTaskList(q ? q.value : '');
        console.log(`✅ Задача ${taskId} отмечена как ${newStatus ? 'выполнена' : 'активна'}`);
    } catch (err) {
        console.error("❌ Ошибка обновления статуса:", err);
    }
}

function startAddTask() {
    openAddTaskModal();
}

function openTaskMenu(taskId) {
    const menu = document.getElementById('task-menu');
    menu.style.display = 'flex';

    document.getElementById('edit-task').onclick = () => { hideModal(); openEditTaskModal(taskId); };
    document.getElementById('delete-task').onclick = () => { hideModal(); openConfirmDeleteModal(taskId); };
}

function hideModal() {
    document.getElementById('task-menu').style.display = 'none';
}

let _editTaskId = null;
let _deleteTaskId = null;
let _reminderTaskId = null;

function openEditTaskModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    _editTaskId = taskId;
    const modal = document.getElementById('edit-task-modal');
    const input = document.getElementById('edit-task-input');
    if (!modal || !input) return;
    input.value = task.text;
    modal.style.display = 'flex';
    input.focus();
}

function closeEditTaskModal() {
    _editTaskId = null;
    const modal = document.getElementById('edit-task-modal');
    if (modal) modal.style.display = 'none';
}

function openConfirmDeleteModal(taskId) {
    _deleteTaskId = taskId;
    const modal = document.getElementById('confirm-delete-modal');
    if (modal) modal.style.display = 'flex';
}

function closeConfirmDeleteModal() {
    _deleteTaskId = null;
    const modal = document.getElementById('confirm-delete-modal');
    if (modal) modal.style.display = 'none';
}

function setupEditDeleteModals() {
    const editOk = document.getElementById('edit-task-ok');
    const editCancel = document.getElementById('edit-task-cancel');
    const editInput = document.getElementById('edit-task-input');
    if (editOk) editOk.addEventListener('click', submitEditTaskFromModal);
    if (editCancel) editCancel.addEventListener('click', closeEditTaskModal);
    if (editInput) editInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') submitEditTaskFromModal();
    });

    const delOk = document.getElementById('confirm-delete-ok');
    const delCancel = document.getElementById('confirm-delete-cancel');
    if (delOk) delOk.addEventListener('click', submitDeleteTaskFromModal);
    if (delCancel) delCancel.addEventListener('click', closeConfirmDeleteModal);
}

async function submitEditTaskFromModal() {
    const taskId = _editTaskId;
    const input = document.getElementById('edit-task-input');
    const newText = input && input.value ? input.value.trim() : '';
    closeEditTaskModal();
    if (!taskId || !newText) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task || newText === task.text) return;
    try {
        await fetch(`${baseUrl}/api/edit_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, text: newText, user_id: userId })
        });
        task.text = newText;
        const q = document.getElementById('search-input');
        renderTaskList(q ? q.value : '');
        showToast('Задача отредактирована');
    } catch (err) {
        console.error("❌ Ошибка редактирования:", err);
        showToast('Ошибка редактирования');
    }
}

async function submitDeleteTaskFromModal() {
    const taskId = _deleteTaskId;
    closeConfirmDeleteModal();
    if (!taskId) return;
    try {
        await fetch(`${baseUrl}/api/delete_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, user_id: userId })
        });
        tasks = tasks.filter(t => t.id !== taskId);
        const q = document.getElementById('search-input');
        renderTaskList(q ? q.value : '');
        showToast('Задача удалена');
    } catch (err) {
        console.error("❌ Ошибка удаления:", err);
        showToast('Ошибка удаления');
    }
}

async function setReminder(taskId) {
    _reminderTaskId = taskId;
    openReminderModal();
}

function openReminderModal() {
    const modal = document.getElementById('reminder-modal');
    if (!modal) return;
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    buildReminderWheels(hour, minute);
    modal.style.display = 'flex';
}

function closeReminderModal() {
    _reminderTaskId = null;
    const modal = document.getElementById('reminder-modal');
    if (modal) modal.style.display = 'none';
}

function buildReminderWheels(initialHour, initialMinute) {
    const hourEl = document.getElementById('reminder-hour-wheel');
    const minEl = document.getElementById('reminder-minute-wheel');
    if (!hourEl || !minEl) return;

    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    const minutes = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')); // 00, 05, 10, ... 55

    hourEl.innerHTML = '';
    minEl.innerHTML = '';

    const hIdx = Math.min(initialHour, 23);
    const mIdx = Math.min(Math.round(initialMinute / 5) % 12, 11);

    function makeWheel(container, items, selectedIndex, onSelect) {
        container.classList.add('wheel');
        const wrap = document.createElement('div');
        wrap.className = 'wheel-inner';
        items.forEach((label, i) => {
            const div = document.createElement('div');
            div.className = 'wheel-item' + (i === selectedIndex ? ' selected' : '');
            div.textContent = label;
            div.dataset.index = String(i);
            wrap.appendChild(div);
        });
        container.appendChild(wrap);
        let currentIdx = selectedIndex;
        const updateSelection = () => {
            wrap.querySelectorAll('.wheel-item').forEach((el, i) => {
                el.classList.toggle('selected', i === currentIdx);
            });
            wrap.style.transform = `translateY(${-currentIdx * 44}px)`;
            onSelect(currentIdx);
        };
        container.addEventListener('touchstart', (e) => { wheelTouchStart(e, container, items.length, (idx) => { currentIdx = idx; updateSelection(); }); });
        container.addEventListener('touchmove', (e) => { wheelTouchMove(e, container); }, { passive: false });
        container.addEventListener('touchend', (e) => { wheelTouchEnd(e, container, items.length); });
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY > 0) currentIdx = Math.max(0, currentIdx - 1);
            else currentIdx = Math.min(items.length - 1, currentIdx + 1);
            updateSelection();
        }, { passive: false });
        updateSelection();
        return { getIndex: () => currentIdx, setIndex: (i) => { currentIdx = i; updateSelection(); } };
    }

    let hourVal = hIdx, minVal = mIdx;
    const hourControl = makeWheel(hourEl, hours, hIdx, (i) => { hourVal = i; });
    const minControl = makeWheel(minEl, minutes, mIdx, (i) => { minVal = i; });

    window._reminderGetTime = function() {
        const h = hourControl.getIndex();
        const m = minControl.getIndex() * 5;
        return { hour: h, minute: m };
    };
}

let _wheelStartY = 0, _wheelStartTransform = 0;
function wheelTouchStart(e, container, itemCount, setIndex) {
    container._wheelSetIndex = setIndex;
    const inner = container.querySelector('.wheel-inner');
    if (!inner) return;
    _wheelStartY = e.touches[0].clientY;
    const t = inner.style.transform || 'translateY(0px)';
    const m = t.match(/-?\d+/);
    _wheelStartTransform = m ? parseInt(m[0], 10) : 0;
}
function wheelTouchMove(e, container) {
    e.preventDefault();
}
function wheelTouchEnd(e, container, itemCount) {
    const setIndex = container._wheelSetIndex;
    const inner = container.querySelector('.wheel-inner');
    if (!inner || !setIndex) return;
    const dy = e.changedTouches[0].clientY - _wheelStartY;
    const step = 44;
    let idx = Math.round(-_wheelStartTransform / step);
    idx = Math.max(0, Math.min(itemCount - 1, idx - Math.round(dy / step)));
    setIndex(idx);
}

async function submitReminderFromModal() {
    const taskId = _reminderTaskId;
    if (!taskId || !window._reminderGetTime) return;
    const { hour, minute } = window._reminderGetTime();
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
    const deadline = `${y}-${m}-${d} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
    closeReminderModal();
    try {
        await fetch(`${baseUrl}/api/set_reminder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, deadline, user_id: userId })
        });
        loadTasks();
        showToast('Напоминание установлено. В указанное время придёт сообщение в Telegram.');
    } catch (err) {
        console.error("❌ Ошибка установки напоминания:", err);
        showToast('Ошибка при установке напоминания');
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
        const data = await response.json();
        if (!response.ok || data.error) {
            console.warn("⚠️ Пользователь не найден или ошибка:", data.error);
            return false;
        }

        const avatar = document.querySelector('.avatar');
        if (avatar) {
            const name = data.full_name || "Аноним";
            avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3B82F6&color=fff`;
        }

        const userNameEl = document.getElementById('userName');
        const userCourseEl = document.getElementById('userCourse');
        const userGroupEl = document.getElementById('userGroup');

        const fullName = data.full_name || "—";
        userRole = data.role || 'user';
        if (userNameEl) userNameEl.textContent = fullName;
        if (userCourseEl) userCourseEl.textContent = `Курс: ${data.course || "—"}`;
        if (userGroupEl) userGroupEl.textContent = `Группа: ${data.group || "—"}`;
        const userRoleEl = document.getElementById('userRole');
        if (userRoleEl) userRoleEl.textContent = 'Роль: ' + getRoleLabel(userRole);
        userFio = fullName;
        console.log("✅ Профиль загружен:", fullName, "роль:", userRole);
        return true;
    } catch (err) {
        console.error("❌ Ошибка загрузки профиля:", err);
        return false;
    }
}

function showUnregisteredState() {
    document.getElementById('unregistered-screen').style.display = 'flex';
    const header = document.getElementById('main-header');
    if (header) header.style.display = 'none';
    document.querySelectorAll('.app-screen').forEach(function(el) { el.style.display = 'none'; });
    const main = document.getElementById('main-content');
    if (main) main.classList.add('hidden');
    const fab = document.getElementById('add-task-fab');
    if (fab) fab.style.display = 'none';
    const nav = document.getElementById('bottom-nav');
    if (nav) nav.style.display = 'none';
}

async function loadDuties(userId) {
    try {
        const response = await fetch(`${baseUrl}/api/duties?telegram_id=${userId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const widget = document.getElementById('next-duty-widget');
        if (!widget) return;

        if (data.error) {
            const friendly = data.error.includes('График нарядов') || data.error.includes('не загружен');
            if (friendly) {
                try {
                    const st = await fetch(baseUrl + '/api/survey/status');
                    const surveyStatus = st.ok ? await st.json() : {};
                    const voted = surveyStatus.voted != null ? surveyStatus.voted : 0;
                    if (voted > 0) {
                        widget.innerHTML = '<h3>🎖️ Ближайший наряд</h3><p style="color: #10B981;">Опрос завершён. Результаты на главной.</p><p style="color: #94A3B8; font-size: 13px;">Проголосовало: ' + voted + ' чел.</p>';
                        return;
                    }
                } catch (_) {}
                widget.innerHTML = '<h3>🎖️ Ближайший наряд</h3><p style="color: #94A3B8;">' + data.error + '</p><p style="color: #64748B; font-size: 13px;">Пройти <a href="#" onclick="switchTab(\'survey\'); return false;" style="color: #3B82F6;">опрос</a> о сложности нарядов.</p>';
            } else {
                widget.innerHTML = '<h3>🎖️ Ближайший наряд</h3><p style="color: #f87171;">' + data.error + '</p>';
            }
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
            // Если таблица duties существует, но записей нет — предлагаем пройти опрос
            const total = Number.isFinite(Number(data.total)) ? Number(data.total) : 0;
            if (total === 0) {
                widget.innerHTML = `
                    <h3>🎖️ Ближайший наряд</h3>
                    <p>Нарядов пока нет.</p>
                    <p>Чтобы настроить систему, <a href="#" onclick="switchTab('survey'); return false;" style="color: #3B82F6;">пройдите опрос</a> о сложности объектов.</p>
                `;
            } else {
                widget.innerHTML = `<h3>🎖️ Ближайший наряд</h3><p>Нарядов нет</p>`;
            }
        }

        console.log("✅ Наряды загружены:", data.total);
    } catch (err) {
        console.error("❌ Ошибка загрузки нарядов:", err);
        document.getElementById('next-duty-widget').innerHTML = 
            `<h3>🎖️ Ближайший наряд</h3><p style="color: #f87171;">Не удалось загрузить данные</p>`;
    }
}

// === ОПРОСНИК — попарное сравнение 2/1/0 ===

let surveyPairsMain = [];
let surveyPairsCanteen = [];
let surveyPairsFemale = [];
let surveyCurrentStage = 'main';
const SURVEY_INTRO_CARD_COUNT = 5;
let surveyIntroIndex = 0;
let currentSurveyType = null; // 'male' | 'female' | null
let currentCustomSurveyId = null;

function showSurveyList() {
    const listBlock = document.getElementById('survey-list-block');
    const intro = document.getElementById('survey-intro');
    const content = document.getElementById('survey-content');
    const alreadyPassed = document.getElementById('survey-already-passed');
    const customBlock = document.getElementById('survey-custom-block');
    const finalizeBlock = document.getElementById('survey-finalize-block');
    if (listBlock) listBlock.style.display = 'block';
    if (intro) intro.style.display = 'none';
    if (content) content.style.display = 'none';
    if (alreadyPassed) alreadyPassed.style.display = 'none';
    if (customBlock) customBlock.style.display = 'none';
    if (finalizeBlock) finalizeBlock.style.display = (userRole === 'admin' || userRole === 'assistant') ? 'block' : 'none';
    currentSurveyType = null;
    currentCustomSurveyId = null;
}

async function loadSurveyList() {
    const systemEl = document.getElementById('survey-system-cards');
    const customSection = document.getElementById('survey-custom-section');
    const customCards = document.getElementById('survey-custom-cards');
    const createWrap = document.getElementById('survey-create-wrap');
    if (!systemEl) return;
    try {
        const res = await fetch(`${baseUrl}/api/survey/list?telegram_id=${userId}`);
        const data = res.ok ? await res.json() : { system: [], custom: [], user_gender: 'male' };
        const gender = data.user_gender || 'male';
        systemEl.innerHTML = '';
        data.system.forEach(function(item) {
            if (item.for_gender !== gender) return;
            const card = document.createElement('div');
            card.className = 'survey-list-card';
            card.style.cssText = 'background:#1E293B;border-radius:12px;padding:14px;border-left:4px solid #3B82F6;cursor:pointer;';
            card.innerHTML = '<div style="color:#93C5FD;font-weight:600;">' + (item.id === 'female' ? '👩 ' : '👨 ') + item.title + '</div>';
            card.onclick = function() { openSystemSurvey(item.id); };
            systemEl.appendChild(card);
        });
        if (data.custom && data.custom.length > 0) {
            customSection.style.display = 'block';
            customCards.innerHTML = '';
            data.custom.forEach(function(s) {
                const card = document.createElement('div');
                card.className = 'survey-list-card';
                card.style.cssText = 'background:#1E293B;border-radius:12px;padding:14px;border-left:4px solid #8B5CF6;cursor:pointer;';
                card.innerHTML = '<div style="color:#E2E8F0;">' + s.title + '</div><div style="color:#94A3B8;font-size:12px;">' + (s.scope_type === 'group' ? 'Группа' : 'Курс') + '</div>';
                card.onclick = function() { openCustomSurvey(s.id); };
                customCards.appendChild(card);
            });
        } else {
            customSection.style.display = 'none';
        }
        if (createWrap) createWrap.style.display = (userRole === 'sergeant' || userRole === 'assistant' || userRole === 'admin') ? 'block' : 'none';
        if (!window._createSurveyBound) {
            window._createSurveyBound = true;
            document.getElementById('survey-create-btn')?.addEventListener('click', showCreateSurveyModal);
            document.getElementById('create-survey-cancel')?.addEventListener('click', function() { document.getElementById('create-survey-modal').style.display = 'none'; });
            document.getElementById('create-survey-ok')?.addEventListener('click', submitCreateSurvey);
        }
    } catch (e) {
        console.warn('Ошибка загрузки списка опросов:', e);
        systemEl.innerHTML = '<p style="color:#94A3B8;">Не удалось загрузить список</p>';
    }
}

function showCreateSurveyModal() {
    document.getElementById('create-survey-title').value = '';
    document.getElementById('create-survey-options').value = '';
    document.getElementById('create-survey-modal').style.display = 'flex';
}

async function submitCreateSurvey() {
    const title = (document.getElementById('create-survey-title').value || '').trim();
    const optsText = document.getElementById('create-survey-options').value || '';
    const options = optsText.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
    if (!title || options.length < 2) {
        showToast('Укажите название и минимум 2 варианта ответа');
        return;
    }
    const scopeType = (userRole === 'assistant' || userRole === 'admin') ? 'course' : 'group';
    try {
        const res = await fetch(baseUrl + '/api/survey/custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: userId, title: title, scope_type: scopeType, options: options })
        });
        if (!res.ok) { const err = await res.json(); showToast(err.detail || 'Ошибка'); return; }
        document.getElementById('create-survey-modal').style.display = 'none';
        showToast('Опрос создан');
        loadSurveyList();
    } catch (e) {
        showToast('Ошибка сети');
    }
}

function openSystemSurvey(systemId) {
    currentSurveyType = systemId;
    currentCustomSurveyId = null;
    document.getElementById('survey-list-block').style.display = 'none';
    if (systemId === 'female') {
        checkSurveyStateAndShowFemale();
    } else {
        checkSurveyStateAndShow();
    }
}

async function openCustomSurvey(sid) {
    currentCustomSurveyId = sid;
    currentSurveyType = null;
    document.getElementById('survey-list-block').style.display = 'none';
    document.getElementById('survey-intro').style.display = 'none';
    document.getElementById('survey-content').style.display = 'none';
    document.getElementById('survey-already-passed').style.display = 'none';
    const block = document.getElementById('survey-custom-block');
    const optsEl = document.getElementById('survey-custom-options');
    const completeWrap = document.getElementById('survey-custom-complete-wrap');
    const completeBtn = document.getElementById('survey-custom-complete-btn');
    block.style.display = 'block';
    optsEl.innerHTML = '<p style="color:#94A3B8;">Загрузка...</p>';
    try {
        const res = await fetch(`${baseUrl}/api/survey/custom/${sid}?telegram_id=${userId}`);
        if (!res.ok) throw new Error('HTTP');
        const data = await res.json();
        document.getElementById('survey-custom-title').textContent = data.title;
        optsEl.innerHTML = '';
        if (data.completed_at) {
            data.options.forEach(function(o) {
                const div = document.createElement('div');
                div.style.cssText = 'background:#1E293B;padding:12px;border-radius:8px;color:#CBD5E1;';
                div.textContent = o.text + ' — ' + o.votes + ' гол.(ов)';
                optsEl.appendChild(div);
            });
            completeWrap.style.display = 'none';
        } else {
            data.options.forEach(function(o) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.dataset.optionId = o.id;
                btn.style.cssText = 'padding:12px;background:#1E293B;border:2px solid #334155;border-radius:8px;color:#CBD5E1;cursor:pointer;text-align:left;';
                btn.textContent = o.text + (o.votes ? ' (' + o.votes + ')' : '');
                if (data.my_option_id === o.id) btn.style.borderColor = '#3B82F6';
                btn.onclick = function() { voteCustomOption(sid, o.id, btn); };
                optsEl.appendChild(btn);
            });
            completeWrap.style.display = data.can_complete ? 'block' : 'none';
            if (completeBtn) completeBtn.onclick = function() { completeCustomSurvey(sid); };
        }
    } catch (e) {
        optsEl.innerHTML = '<p style="color:#f87171;">Ошибка загрузки опроса</p>';
    }
}

async function voteCustomOption(surveyId, optionId, btnEl) {
    try {
        const res = await fetch(`${baseUrl}/api/survey/custom/${surveyId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: userId, option_id: optionId })
        });
        if (!res.ok) throw new Error();
        btnEl.parentElement.querySelectorAll('button').forEach(function(b) { b.style.borderColor = '#334155'; });
        btnEl.style.borderColor = '#3B82F6';
        showToast('Голос учтён');
        openCustomSurvey(surveyId);
    } catch (e) {
        showToast('Ошибка');
    }
}

async function completeCustomSurvey(surveyId) {
    try {
        const res = await fetch(`${baseUrl}/api/survey/custom/${surveyId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: userId })
        });
        if (!res.ok) throw new Error();
        showToast('Опрос завершён');
        openCustomSurvey(surveyId);
    } catch (e) {
        showToast('Ошибка');
    }
}

async function checkSurveyStateAndShowFemale() {
    const intro = document.getElementById('survey-intro');
    const content = document.getElementById('survey-content');
    const alreadyPassed = document.getElementById('survey-already-passed');
    const finalizeBlock = document.getElementById('survey-finalize-block');
    if (finalizeBlock) finalizeBlock.style.display = 'none';
    try {
        const response = await fetch(`${baseUrl}/api/survey/user-results?telegram_id=${userId}`);
        if (!response.ok) throw new Error('HTTP');
        const data = await response.json();
        if (data.voted && data.survey_stage === 'female') {
            alreadyPassed.style.display = 'block';
            alreadyPassed.querySelector('h2').textContent = '📊 Опрос для девушек';
            intro.style.display = 'none';
            content.style.display = 'none';
            return;
        }
    } catch (e) { console.warn(e); }
    alreadyPassed.style.display = 'none';
    showSurveyIntroFemale();
}

function showSurveyIntroFemale() {
    const intro = document.getElementById('survey-intro');
    const content = document.getElementById('survey-content');
    if (intro) intro.style.display = 'block';
    if (content) content.style.display = 'none';
    intro.querySelector('h2').textContent = '📊 Опрос для девушек (ПУТСО, Столовая, Медчасть)';
    surveyIntroIndex = 0;
    setSurveyIntroCard(0);
    renderSurveyIntroDots();
}

async function loadSurveyObjectsFemale() {
    const container = document.getElementById('survey-objects-container');
    const stageIndicator = document.getElementById('survey-stage-indicator');
    if (!container) return;
    try {
        const res = await fetch(`${baseUrl}/api/survey/pairs?stage=female`);
        const data = res.ok ? await res.json() : {};
        surveyPairsFemale = data.pairs || [];
        surveyPairsMain = [];
        surveyPairsCanteen = [];
        surveyCurrentStage = 'female';
        stageIndicator.textContent = 'Сравнение нарядов: ПУТСО, Столовая, Медчасть — 3 пары';
        renderSurveyPairs('female');
        document.getElementById('submit-survey-btn').onclick = handleSurveySubmitFemale;
    } catch (err) {
        container.innerHTML = '<p style="color: #f87171;">Ошибка загрузки опроса</p>';
    }
}

function renderSurveyPairsFemale() {
    renderSurveyPairs('female');
}

async function handleSurveySubmitFemale() {
    const pairs = surveyPairsFemale;
    const choices = window._surveyChoices || {};
    const votes = [];
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const a = pair.object_a, b = pair.object_b;
        const name = 'pair_' + a.id + '_' + b.id;
        const choice = choices[name];
        if (choice) votes.push({ object_a_id: a.id, object_b_id: b.id, choice: choice, stage: 'female' });
    }
    if (votes.length < pairs.length) {
        showToast('Ответьте на все ' + pairs.length + ' пар(ы)');
        return;
    }
    for (const v of votes) {
        const res = await fetch(`${baseUrl}/api/survey/pair-vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, object_a_id: v.object_a_id, object_b_id: v.object_b_id, choice: v.choice, stage: v.stage })
        });
        if (!res.ok) { showToast('Ошибка отправки'); return; }
    }
    document.getElementById('survey-screen').style.display = 'none';
    switchTab('home');
    showSurveyList();
    loadSurveyList();
    showToast('Спасибо! Ваши голоса учтены.');
}

async function checkSurveyStateAndShow() {
    const intro = document.getElementById('survey-intro');
    const content = document.getElementById('survey-content');
    const alreadyPassed = document.getElementById('survey-already-passed');
    const finalizeBlock = document.getElementById('survey-finalize-block');
    if (finalizeBlock) finalizeBlock.style.display = (userRole === 'admin' || userRole === 'assistant') ? 'block' : 'none';
    if (!intro || !alreadyPassed) return;
    try {
        const response = await fetch(`${baseUrl}/api/survey/user-results?telegram_id=${userId}`);
        if (!response.ok) throw new Error('HTTP');
        const data = await response.json();
        if (data.voted) {
            alreadyPassed.style.display = 'block';
            if (alreadyPassed.querySelector('h2')) alreadyPassed.querySelector('h2').textContent = '📊 Опрос сложности нарядов';
            intro.style.display = 'none';
            if (content) content.style.display = 'none';
            return;
        }
    } catch (e) {
        console.warn('Проверка опроса:', e);
    }
    alreadyPassed.style.display = 'none';
    showSurveyIntro();
}

function showSurveyIntro() {
    const intro = document.getElementById('survey-intro');
    const content = document.getElementById('survey-content');
    const alreadyPassed = document.getElementById('survey-already-passed');
    const finalizeBlock = document.getElementById('survey-finalize-block');
    if (finalizeBlock) finalizeBlock.style.display = (userRole === 'admin' || userRole === 'assistant') ? 'block' : 'none';
    if (alreadyPassed) alreadyPassed.style.display = 'none';
    if (intro) {
        intro.style.display = 'block';
        intro.querySelector('h2').textContent = '📊 Опрос сложности нарядов';
    }
    if (content) content.style.display = 'none';
    surveyIntroIndex = 0;
    setSurveyIntroCard(0);
    renderSurveyIntroDots();
    if (!window._surveyIntroBound) {
        window._surveyIntroBound = true;
        document.getElementById('survey-intro-prev').addEventListener('click', function() {
            if (surveyIntroIndex > 0) {
                surveyIntroIndex--;
                setSurveyIntroCard(surveyIntroIndex);
                renderSurveyIntroDots();
            }
        });
        document.getElementById('survey-intro-next').addEventListener('click', function() {
            if (surveyIntroIndex < SURVEY_INTRO_CARD_COUNT - 1) {
                surveyIntroIndex++;
                setSurveyIntroCard(surveyIntroIndex);
                renderSurveyIntroDots();
            }
        });
        document.getElementById('survey-intro-start').addEventListener('click', function() {
            if (intro) intro.style.display = 'none';
            if (content) content.style.display = 'block';
            if (currentSurveyType === 'female') loadSurveyObjectsFemale();
            else loadSurveyObjects();
        });
    }
}

function setSurveyIntroCard(idx) {
    document.querySelectorAll('.survey-intro-card').forEach(function(card) {
        card.classList.toggle('active', parseInt(card.dataset.card, 10) === idx);
    });
    const prev = document.getElementById('survey-intro-prev');
    const next = document.getElementById('survey-intro-next');
    if (prev) prev.disabled = idx === 0;
    if (next) next.disabled = idx === SURVEY_INTRO_CARD_COUNT - 1;
}

function renderSurveyIntroDots() {
    const dotsEl = document.getElementById('survey-intro-dots');
    if (!dotsEl) return;
    dotsEl.innerHTML = '';
    for (let i = 0; i < SURVEY_INTRO_CARD_COUNT; i++) {
        const dot = document.createElement('span');
        dot.className = 'survey-intro-dot' + (i === surveyIntroIndex ? ' active' : '');
        dot.onclick = function() {
            surveyIntroIndex = i;
            setSurveyIntroCard(surveyIntroIndex);
            renderSurveyIntroDots();
        };
        dotsEl.appendChild(dot);
    }
}

/**
 * Загружает пары для попарного голосования и отображает их
 */
async function loadSurveyObjects() {
    const container = document.getElementById('survey-objects-container');
    const stageIndicator = document.getElementById('survey-stage-indicator');
    if (!container) return;

    try {
        // Загружаем пары Этапа 1 (основные наряды)
        const resMain = await fetch(`${baseUrl}/api/survey/pairs?stage=main`);
        if (!resMain.ok) throw new Error(`HTTP ${resMain.status}`);
        const dataMain = await resMain.json();
        surveyPairsMain = dataMain.pairs || [];

        // Загружаем пары Этапа 2 (объекты столовой)
        const resCanteen = await fetch(`${baseUrl}/api/survey/pairs?stage=canteen`);
        if (!resCanteen.ok) surveyPairsCanteen = [];
        else {
            const dataCanteen = await resCanteen.json();
            surveyPairsCanteen = dataCanteen.pairs || [];
        }

        surveyCurrentStage = 'main';
        renderSurveyPairs('main');
        stageIndicator.textContent = 'Этап 1 из 2: Основные наряды (Курс vs ГБР vs Столовая vs ЗУБ) — 6 пар';

        document.getElementById('submit-survey-btn').onclick = handleSurveySubmit;
    } catch (err) {
        console.error('❌ Ошибка загрузки опроса:', err);
        container.innerHTML = '<p style="color: #f87171;">Ошибка загрузки опроса</p>';
    }
}

function renderSurveyPairs(stage) {
    const container = document.getElementById('survey-objects-container');
    const stageIndicator = document.getElementById('survey-stage-indicator');
    if (!container) return;

    const pairs = stage === 'female' ? surveyPairsFemale : (stage === 'main' ? surveyPairsMain : surveyPairsCanteen);

    if (pairs.length === 0) {
        container.innerHTML = '<p style="color: #64748B;">Нет пар для голосования</p>';
        return;
    }

    if (!window._surveyChoices) window._surveyChoices = {};
    var choices = window._surveyChoices;

    var html = '';
    for (var idx = 0; idx < pairs.length; idx++) {
        var pair = pairs[idx];
        var a = pair.object_a;
        var b = pair.object_b;
        var name = 'pair_' + a.id + '_' + b.id;
        var selected = choices[name] || '';
        var s = 'padding:14px 12px;border-radius:10px;border:2px solid #334155;background:#1E293B;color:#CBD5E1;font-size:15px;cursor:pointer;flex:1;min-width:100px;';
        var sSel = 'border-color:#3B82F6;background:#2563EB;color:white;';
        var questionLabel = stage === 'canteen' ? 'Какой объект сложнее?' : 'Какой наряд сложнее?';
        var vsLabel = a.name + ' vs ' + b.name;
        html += '<div style="background:#1E293B;border-radius:8px;padding:14px;margin-bottom:12px;border-left:4px solid #3B82F6;">';
        html += '<p style="color:#94A3B8;font-size:13px;margin-bottom:6px;">Пара ' + (idx + 1) + ' из ' + pairs.length + '</p>';
        html += '<p style="color:#93C5FD;font-size:14px;font-weight:600;margin-bottom:8px;">' + vsLabel + '</p>';
        html += '<p style="color:#CBD5E1;margin-bottom:12px;">' + questionLabel + '</p>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:10px;">';
        html += '<button type="button" class="survey-pair-btn" data-name="' + name + '" data-choice="a" style="' + s + (selected === 'a' ? sSel : '') + '">' + a.name + ' сложнее</button>';
        html += '<button type="button" class="survey-pair-btn" data-name="' + name + '" data-choice="equal" style="' + s + (selected === 'equal' ? sSel : '') + '">Одинаково</button>';
        html += '<button type="button" class="survey-pair-btn" data-name="' + name + '" data-choice="b" style="' + s + (selected === 'b' ? sSel : '') + '">' + b.name + ' сложнее</button>';
        html += '</div></div>';
    }
    container.innerHTML = html;

    container.querySelectorAll('.survey-pair-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var name = this.getAttribute('data-name');
            var choice = this.getAttribute('data-choice');
            choices[name] = choice;
            var block = this.parentElement;
            block.querySelectorAll('.survey-pair-btn').forEach(function(b) {
                b.style.borderColor = '#334155';
                b.style.background = '#1E293B';
                b.style.color = '#CBD5E1';
            });
            this.style.borderColor = '#3B82F6';
            this.style.background = '#2563EB';
            this.style.color = 'white';
        });
    });
}

async function handleSurveySubmit() {
    const stage = surveyCurrentStage;
    const pairs = stage === 'main' ? surveyPairsMain : surveyPairsCanteen;

    var choices = window._surveyChoices || {};
    var votes = [];
    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];
        var a = pair.object_a;
        var b = pair.object_b;
        var name = 'pair_' + a.id + '_' + b.id;
        var choice = choices[name];
        if (choice) {
            votes.push({ object_a_id: a.id, object_b_id: b.id, choice: choice, stage: stage });
        }
    }

    if (votes.length === 0) {
        showToast('Выберите хотя бы один вариант');
        return;
    }
    if (votes.length < pairs.length) {
        showToast('Ответьте на все ' + pairs.length + ' пар(ы)');
        return;
    }

    let allSuccess = true;
    let lastResult = null;

    for (const v of votes) {
        try {
            const res = await fetch(`${baseUrl}/api/survey/pair-vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    object_a_id: v.object_a_id,
                    object_b_id: v.object_b_id,
                    choice: v.choice,
                    stage: v.stage
                })
            });
            if (!res.ok) {
                const err = await res.json();
                showToast('Ошибка: ' + (err.detail || 'Не удалось отправить голос'));
                allSuccess = false;
                break;
            }
            lastResult = await res.json();
        } catch (err) {
            console.error(err);
            showToast('Ошибка сети');
            allSuccess = false;
            break;
        }
    }

    if (!allSuccess) return;

    // Если это был Этап 1 и есть Этап 2 — переключаемся
    if (stage === 'main' && surveyPairsCanteen.length > 0) {
        surveyCurrentStage = 'canteen';
        renderSurveyPairs('canteen');
        document.getElementById('survey-stage-indicator').textContent =
            'Этап 2 из 2: Объекты в столовой (Горячий цех, Овощной цех, Стаканы, Железо, Лента, Тарелки) — 13 пар';
        return;
    }

    // Этап 2 завершён или Этап 1 без Этапа 2 — сначала закрываем опрос, потом показываем тост поверх главной
    const msg = lastResult && lastResult.total_voted 
        ? `Спасибо! Ваши голоса учтены. Проголосовало: ${lastResult.total_voted} чел.`
        : 'Спасибо! Ваши голоса учтены.';
    const surveyScreen = document.getElementById('survey-screen');
    if (surveyScreen) surveyScreen.style.display = 'none';
    switchTab('home');
    await loadSurveyResults();
    showToast(msg);
}

/**
 * Загружает и отображает результаты опроса для пользователя, который уже прошёл опрос
 */
async function loadSurveyResults() {
    try {
        const response = await fetch(`${baseUrl}/api/survey/user-results?telegram_id=${userId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        if (!data.voted) {
            // Пользователь ещё не прошёл опрос - ничего не показываем
            return;
        }
        
        // Показываем объекты с рассчитанными весами (родители и подобъекты)
        const votedObjects = data.results.filter(r => r.median_weight != null);
        
        if (votedObjects.length === 0) {
            return; // Веса ещё не рассчитаны
        }
        
        // Группируем по родителям (parent_id = null — основные наряды, иначе подобъекты столовой)
        const parentsMap = {};
        votedObjects.forEach(obj => {
            const pid = obj.parent_id || 'main';
            if (!parentsMap[pid]) parentsMap[pid] = [];
            parentsMap[pid].push(obj);
        });
        
        const parentNames = {};
        data.results.forEach(r => {
            if (r.parent_id === null) parentNames[r.id] = r.name;
        });
        parentNames['main'] = 'Основные наряды';
        
        // Создаём виджет результатов на главной странице
        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;
        
        // Проверяем, есть ли уже виджет результатов
        let resultsWidget = document.getElementById('survey-results-widget');
        if (!resultsWidget) {
            resultsWidget = document.createElement('div');
            resultsWidget.id = 'survey-results-widget';
            resultsWidget.className = 'widget';
            mainContent.insertBefore(resultsWidget, mainContent.firstChild);
        }
        
        let html = '<h3>📊 Результаты опроса</h3>';
        html += '<p style="color: #94A3B8; font-size: 14px; margin-bottom: 12px;">Веса объектов (рассчитаны по формуле k = S/avg):</p>';
        
        // Выводим результаты по категориям с объяснением
        Object.keys(parentsMap).forEach(parentId => {
            const parentName = parentNames[parentId] || 'Неизвестная категория';
            const children = parentsMap[parentId];
            
            // Рассчитываем среднюю медиану для родительского объекта
            const medians = children.filter(c => c.median_weight !== null).map(c => c.median_weight);
            const avgMedian = medians.length > 0 
                ? (medians.reduce((a, b) => a + b, 0) / medians.length).toFixed(1)
                : null;
            
            html += `<div style="background: #1E293B; border-radius: 8px; padding: 12px; margin-bottom: 16px; border-left: 4px solid #3B82F6;">`;
            html += `<h4 style="color: #93C5FD; margin: 0 0 8px 0; font-size: 16px;">${parentName}`;
            if (avgMedian) {
                html += ` <span style="color: #FBBF24; font-size: 14px;">(средняя сложность: ${avgMedian})</span>`;
            }
            html += `</h4>`;
            
            children.forEach(child => {
                const w = child.median_weight != null ? child.median_weight.toFixed(1) : '—';
                const isDefault = child.median_weight === 8 || (child.median_weight != null && Math.abs(child.median_weight - 8) < 0.01);
                const hint = isDefault ? ' (коэфф. 0.8, 8 баллов)' : '';
                html += '<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #0f172a; border-radius: 6px; margin-bottom: 6px;">';
                html += '<span style="color: #CBD5E1; font-weight: 500;">' + child.name + '</span>';
                html += '<span style="color: #3B82F6; font-size: 14px;">Вес: ' + w + hint + '</span>';
                html += '</div>';
            });
            html += `</div>`;
        });
        
        const stageForPairs = data.survey_stage || 'main';
        html += '<p style="margin-top: 12px;"><button type="button" onclick="openPairStatsModal(\'' + stageForPairs + '\')" style="padding: 8px 16px; background: #334155; color: #93C5FD; border: 1px solid #64748B; border-radius: 8px; cursor: pointer;">Подробнее по парам (A/B/равно)</button></p>';
        resultsWidget.innerHTML = html;
        console.log('✅ Результаты опроса загружены');
    } catch (err) {
        console.error('❌ Ошибка загрузки результатов опроса:', err);
    }
}

let pairStatsPairs = [];
let pairStatsIndex = 0;

async function openPairStatsModal(stage) {
    try {
        const res = await fetch(`${baseUrl}/api/survey/pair-stats?stage=${encodeURIComponent(stage)}`);
        if (!res.ok) throw new Error('HTTP');
        const data = await res.json();
        pairStatsPairs = data.pairs || [];
        pairStatsIndex = 0;
        const modal = document.getElementById('pair-stats-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        renderPairStatsCard();
        if (!window._pairStatsNavBound) {
            window._pairStatsNavBound = true;
            document.getElementById('pair-stats-prev')?.addEventListener('click', function() {
                if (pairStatsIndex > 0) { pairStatsIndex--; renderPairStatsCard(); }
            });
            document.getElementById('pair-stats-next')?.addEventListener('click', function() {
                if (pairStatsIndex < pairStatsPairs.length - 1) { pairStatsIndex++; renderPairStatsCard(); }
            });
            document.getElementById('pair-stats-close')?.addEventListener('click', function() {
                modal.style.display = 'none';
            });
        }
    } catch (e) {
        showToast('Не удалось загрузить данные по парам');
    }
}

function renderPairStatsCard() {
    const content = document.getElementById('pair-stats-content');
    const prevBtn = document.getElementById('pair-stats-prev');
    const nextBtn = document.getElementById('pair-stats-next');
    const counter = document.getElementById('pair-stats-counter');
    if (!content) return;
    if (pairStatsPairs.length === 0) {
        content.innerHTML = '<p style="color: #94A3B8;">Нет данных по парам</p>';
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        return;
    }
    const p = pairStatsPairs[pairStatsIndex];
    if (counter) counter.textContent = (pairStatsIndex + 1) + ' / ' + pairStatsPairs.length;
    if (prevBtn) { prevBtn.style.display = 'block'; prevBtn.disabled = pairStatsIndex === 0; }
    if (nextBtn) { nextBtn.style.display = 'block'; nextBtn.disabled = pairStatsIndex === pairStatsPairs.length - 1; }
    content.innerHTML = '<div style="background:#1E293B;border-radius:12px;padding:20px;border-left:4px solid #3B82F6;">' +
        '<h4 style="color:#93C5FD;margin:0 0 16px 0;">' + p.object_a_name + ' vs ' + p.object_b_name + '</h4>' +
        '<p style="color:#CBD5E1;margin:8px 0;"><span style="color:#60A5FA;">' + p.object_a_name + ' сложнее:</span> ' + p.pct_a + '% (' + p.count_a + ')</p>' +
        '<p style="color:#CBD5E1;margin:8px 0;"><span style="color:#94A3B8;">Одинаково:</span> ' + p.pct_equal + '% (' + p.count_equal + ')</p>' +
        '<p style="color:#CBD5E1;margin:8px 0;"><span style="color:#A78BFA;">' + p.object_b_name + ' сложнее:</span> ' + p.pct_b + '% (' + p.count_b + ')</p>' +
        '<p style="color:#64748B;font-size:12px;margin-top:12px;">Всего ответов: ' + p.total + '</p></div>';
}

/**
 * Возвращает объяснение сложности на основе медианы
 */
function getDifficultyExplanation(median) {
    if (median < 2) {
        return 'Очень лёгкий объект — минимальная нагрузка';
    } else if (median < 3) {
        return 'Лёгкий объект — небольшая нагрузка';
    } else if (median < 4) {
        return 'Средний объект — умеренная нагрузка';
    } else if (median < 4.5) {
        return 'Тяжёлый объект — высокая нагрузка';
    } else {
        return 'Очень тяжёлый объект — максимальная нагрузка';
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
    showToast("Уведомления (в разработке)");
}

function openSettings() {
    showToast("Настройки (в разработке)");
}

// === ФУНКЦИИ ДЛЯ РАБОТЫ С НАРЯДАМИ ===

function bindDutyUploadOnce() {
    if (window._dutyUploadBound) return;
    const btn = document.getElementById('duty-upload-btn');
    const fileInput = document.getElementById('duty-upload-file');
    if (!btn || !fileInput) return;
    window._dutyUploadBound = true;
    btn.addEventListener('click', async function() {
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
            showToast('Выберите файл .xlsx');
            return;
        }
        const form = new FormData();
        form.append('file', file);
        form.append('telegram_id', userId);
        try {
            const res = await fetch(baseUrl + '/api/schedule/upload', { method: 'POST', body: form });
            const data = res.ok ? await res.json() : { detail: (await res.json()).detail || 'Ошибка' };
            if (res.ok) {
                showToast('График загружен: ' + (data.count || 0) + ' записей');
                fileInput.value = '';
                loadDutiesForMonth();
                loadDuties(userId);
            } else {
                showToast(data.detail || 'Ошибка загрузки');
            }
        } catch (e) {
            showToast('Ошибка сети');
        }
    });
}

/**
 * Загружает наряды пользователя на текущий месяц
 */
async function loadDutiesForMonth() {
    const container = document.getElementById('duties-list-container');
    if (!container) return;
    
    try {
        const response = await fetch(`${baseUrl}/api/duties?telegram_id=${userId}&month=${currentMonth}&year=${currentYear}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        if (data.error) {
            const statsEl = document.getElementById('duties-month-stats');
            if (statsEl) statsEl.style.display = 'none';
            const friendly = data.error.includes('График нарядов') || data.error.includes('не загружен');
            container.innerHTML = friendly
                ? `<p style="color: #94A3B8; text-align: center;">${data.error}</p>`
                : `<p style="color: #f87171;">Ошибка: ${data.error}</p>`;
            return;
        }
        
        // Обновляем заголовок месяца
        const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                           'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        document.getElementById('current-month').textContent = `${monthNames[currentMonth - 1]} ${currentYear}`;

        // Статистика по месяцу
        const totalInMonth = data.total != null ? data.total : data.duties.length;
        const statsEl = document.getElementById('duties-month-stats');
        if (statsEl) {
            statsEl.textContent = 'В этом месяце: ' + totalInMonth + ' наряд(ов)';
            statsEl.style.display = 'block';
        }
        
        if (data.duties.length === 0) {
            container.innerHTML = '<p style="color: #64748B; text-align: center;">Нарядов на этот месяц нет</p>';
            return;
        }
        
        // Группируем наряды по датам
        const byDate = {};
        data.duties.forEach(duty => {
            if (!byDate[duty.date]) {
                byDate[duty.date] = [];
            }
            byDate[duty.date].push(duty);
        });
        
        let html = '';
        Object.keys(byDate).sort().forEach(date => {
            const dutiesOnDate = byDate[date];
            const dateFormatted = formatDate(date);
            
            html += `<div style="background: #1E293B; border-radius: 8px; padding: 12px; margin-bottom: 12px;">`;
            html += `<h4 style="color: #93C5FD; margin: 0 0 8px 0; font-size: 16px;">${dateFormatted}</h4>`;
            
            dutiesOnDate.forEach(duty => {
                html += `<div style="background: #0f172a; border-radius: 6px; padding: 10px; margin-bottom: 8px;">`;
                html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">`;
                html += `<span style="color: #CBD5E1; font-weight: 500;">${duty.role_full || duty.role}</span>`;
                if (duty.group) {
                    html += `<span style="color: #94A3B8; font-size: 13px;">Группа: ${duty.group}</span>`;
                }
                html += `</div>`;
                
                // Показываем участников наряда
                if (duty.partners && duty.partners.length > 0) {
                    html += `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #334155;">`;
                    html += `<p style="color: #94A3B8; font-size: 12px; margin: 0 0 6px 0;">Участники наряда:</p>`;
                    duty.partners.forEach(partner => {
                        const isMe = userFio && partner.fio === userFio;
                        html += `<div style="display: flex; justify-content: space-between; padding: 4px 0;">`;
                        html += `<span style="color: ${isMe ? '#3B82F6' : '#CBD5E1'}; font-size: 13px;">${partner.fio}${isMe ? ' (вы)' : ''}</span>`;
                        if (partner.group) {
                            html += `<span style="color: #64748B; font-size: 12px;">${partner.group}</span>`;
                        }
                        html += `</div>`;
                    });
                    html += `</div>`;
                }
                
                html += `</div>`;
            });
            
            html += `</div>`;
        });
        
        container.innerHTML = html;
        console.log(`✅ Загружено ${data.duties.length} нарядов на ${monthNames[currentMonth - 1]} ${currentYear}`);
    } catch (err) {
        console.error('❌ Ошибка загрузки нарядов:', err);
        container.innerHTML = '<p style="color: #f87171;">Ошибка загрузки нарядов</p>';
    }
}

/**
 * Изменяет месяц для просмотра нарядов
 */
function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
    } else if (currentMonth < 1) {
        currentMonth = 12;
        currentYear--;
    }
    loadDutiesForMonth();
}

/**
 * Поиск нарядов по дате (показывает всех участников на эту дату из всех групп)
 */
async function searchDutyByDate(dateStr) {
    if (!dateStr) return;
    
    const resultsDiv = document.getElementById('date-search-results');
    const contentDiv = document.getElementById('date-search-content');
    
    if (!resultsDiv || !contentDiv) return;
    
    try {
        const response = await fetch(`${baseUrl}/api/duties/by-date?date=${dateStr}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        if (data.error) {
            contentDiv.innerHTML = `<p style="color: #f87171;">Ошибка: ${data.error}</p>`;
            resultsDiv.style.display = 'block';
            return;
        }
        
        if (data.total === 0) {
            contentDiv.innerHTML = '<p style="color: #64748B;">На эту дату нарядов нет</p>';
            resultsDiv.style.display = 'block';
            return;
        }
        
        let html = `<p style="color: #94A3B8; margin-bottom: 12px;">Всего участников: ${data.total}</p>`;
        
        Object.keys(data.by_role).forEach(role => {
            const roleFull = get_full_role(role) || role;
            const participants = data.by_role[role];
            
            html += `<div style="background: #1E293B; border-radius: 8px; padding: 12px; margin-bottom: 12px;">`;
            html += `<h5 style="color: #93C5FD; margin: 0 0 8px 0; font-size: 15px;">${roleFull} (${participants.length} чел.)</h5>`;
            
            participants.forEach(p => {
                html += `<div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #334155;">`;
                html += `<span style="color: #CBD5E1; font-size: 14px;">${p.fio}</span>`;
                html += `<span style="color: #94A3B8; font-size: 13px;">${p.group} (${p.course} курс)</span>`;
                html += `</div>`;
            });
            
            html += `</div>`;
        });
        
        contentDiv.innerHTML = html;
        resultsDiv.style.display = 'block';
    } catch (err) {
        console.error('❌ Ошибка поиска по дате:', err);
        contentDiv.innerHTML = '<p style="color: #f87171;">Ошибка поиска</p>';
        resultsDiv.style.display = 'block';
    }
}

/**
 * Очищает поиск по дате
 */
function clearDateSearch() {
    document.getElementById('duty-date-search').value = '';
    document.getElementById('date-search-results').style.display = 'none';
}

// Вспомогательная функция для получения полного названия роли (если её нет в глобальной области)
function get_full_role(roleCode) {
    const roles = {
        'к': 'Комендантский',
        'дк': 'Дежурный по каморке',
        'с': 'Столовая',
        'дс': 'Дежурный по столовой',
        'ад': 'Административный',
        'п': 'Патруль',
        'ж': 'Железо',
        'т': 'Тарелки',
        'кпп': 'КПП',
        'гбр': 'ГБР (Группа быстрого реагирования)',
        'зуб': 'Зуб'
    };
    return roles[roleCode.toLowerCase()] || roleCode.toUpperCase();
}
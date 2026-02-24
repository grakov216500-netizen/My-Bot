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
    userRegistered = !!userOk;
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
    if (openBtn) {
        openBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); openProfileScreen(); });
        openBtn.style.cursor = 'pointer';
    }
    const avatarImg = document.querySelector('.avatar');
    if (avatarImg) {
        avatarImg.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); openProfileScreen(); });
        avatarImg.style.cursor = 'pointer';
    }
    const backBtn = document.getElementById('profile-back');
    if (backBtn) backBtn.addEventListener('click', closeProfileScreen);
    const backUnregBtn = document.getElementById('profile-back-unreg');
    if (backUnregBtn) backUnregBtn.addEventListener('click', closeProfileScreen);
    const saveBtn = document.getElementById('profile-save');
    if (saveBtn) saveBtn.addEventListener('click', saveProfile);
    const adminPanelBtn = document.getElementById('profile-admin-panel');
    if (adminPanelBtn) adminPanelBtn.addEventListener('click', function() { openAdminPanel('admin'); });
    const assistantPanelBtn = document.getElementById('profile-assistant-panel');
    if (assistantPanelBtn) assistantPanelBtn.addEventListener('click', function() { openAdminPanel('assistant'); });
    const sergeantPanelBtn = document.getElementById('profile-sergeant-panel');
    if (sergeantPanelBtn) sergeantPanelBtn.addEventListener('click', function() { openAdminPanel('sergeant'); });
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
    const unregMsg = document.getElementById('profile-unregistered-msg');
    const profileToggle = document.getElementById('profile-toggle');
    const profileBody = document.getElementById('profile-body');
    if (!userRegistered) {
        if (unregMsg) unregMsg.style.display = 'block';
        if (profileToggle) profileToggle.style.display = 'none';
        if (profileBody) profileBody.style.display = 'none';
    } else {
        if (unregMsg) unregMsg.style.display = 'none';
        if (profileToggle) profileToggle.style.display = 'flex';
        document.getElementById('profile-fio').value = userFio || '';
        document.getElementById('profile-course').textContent = (document.getElementById('userCourse') && document.getElementById('userCourse').textContent) || '—';
        document.getElementById('profile-group').value = (document.getElementById('userGroup') && document.getElementById('userGroup').textContent.replace(/^Группа:\s*/, '')) || '';
        document.getElementById('profile-role').textContent = 'Роль: ' + getRoleLabel(userRole);
        document.getElementById('profile-admin-panel').style.display = userRole === 'admin' ? 'inline-block' : 'none';
        document.getElementById('profile-assistant-panel').style.display = userRole === 'assistant' ? 'inline-block' : 'none';
        var sergeantBtn = document.getElementById('profile-sergeant-panel');
        if (sergeantBtn) sergeantBtn.style.display = userRole === 'sergeant' ? 'inline-block' : 'none';
        profileBody.style.display = 'block';
        loadProfileDutyStats();
        var icon = document.getElementById('profile-toggle-icon');
        if (icon) icon.textContent = '▼ Свернуть';
    }
    document.querySelectorAll('.app-screen').forEach(function(el) { el.style.display = 'none'; });
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('profile-screen').style.display = 'block';
}

function closeProfileScreen() {
    document.getElementById('profile-screen').style.display = 'none';
    if (userRegistered) {
        document.getElementById('main-content').classList.remove('hidden');
        document.getElementById('main-content').style.display = 'block';
    } else {
        document.getElementById('unregistered-screen').style.display = 'flex';
    }
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
        if (!userRegistered) {
            userRegistered = true;
            var h = document.getElementById('main-header');
            if (h) h.style.display = '';
            var main = document.getElementById('main-content');
            if (main) { main.classList.remove('hidden'); main.style.display = 'block'; }
            document.getElementById('profile-screen').style.display = 'none';
            switchTab('home');
        }
    } catch (e) {
        showToast('Ошибка сохранения');
    }
}

let _adminPanelMode = 'admin'; // 'admin' | 'assistant'

function openAdminPanel(mode) {
    _adminPanelMode = mode;
    var titles = { admin: '⚙️ Админ-панель: список пользователей', assistant: '🛠 Панель помощника: список пользователей', sergeant: '📋 Панель сержанта: список пользователей' };
    document.getElementById('admin-panel-title').textContent = titles[mode] || titles.admin;
    document.getElementById('admin-filter-year').style.display = (mode === 'admin') ? 'block' : 'none';
    var groupFilter = document.getElementById('admin-filter-group');
    if (groupFilter) groupFilter.style.display = (mode === 'admin') ? 'block' : 'none';
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
    const groupSelect = document.getElementById('admin-filter-group');
    const search = document.getElementById('admin-search-fio').value.trim();
    const listEl = document.getElementById('admin-users-list');
    listEl.innerHTML = '<p style="color:#94A3B8;">Загрузка...</p>';
    let url = `${baseUrl}/api/users?actor_telegram_id=${userId}`;
    if (_adminPanelMode === 'admin' && yearSelect && yearSelect.value) url += '&enrollment_year=' + yearSelect.value;
    if (_adminPanelMode === 'admin' && groupSelect && groupSelect.value) url += '&group_name=' + encodeURIComponent(groupSelect.value);
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
        if (_adminPanelMode === 'admin' && groupSelect) {
            var currentVal = groupSelect.value;
            var groups = [...new Set(data.users.map(function(u) { return u.group_name || ''; }))].filter(Boolean).sort();
            groupSelect.innerHTML = '<option value="">Все группы</option>';
            groups.forEach(function(g) {
                var opt = document.createElement('option');
                opt.value = g;
                opt.textContent = g;
                if (g === currentVal) opt.selected = true;
                groupSelect.appendChild(opt);
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
        updateDutySurveyBanner();
        var isPriv = userRole === 'sergeant' || userRole === 'assistant' || userRole === 'admin';
        var uploadToolBtn = document.getElementById('duty-tool-upload');
        if (uploadToolBtn) uploadToolBtn.style.display = isPriv ? 'inline-block' : 'none';
        loadDutyAvailableMonths().then(function() {
            if (dutyAvailableMonths.length > 0 && dutyAvailableMonths.indexOf(currentYear + '-' + String(currentMonth).padStart(2, '0')) === -1) {
                var last = dutyAvailableMonths[dutyAvailableMonths.length - 1].split('-');
                currentYear = parseInt(last[0]);
                currentMonth = parseInt(last[1]);
            }
            loadDutiesForMonth();
            // синхронизируем календарь архива внутри "Моих нарядов"
            calM = currentMonth;
            calY = currentYear;
            renderDutyCalendar();
        });
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

    if (newStatus) {
        var card = document.querySelector('.task-card[data-id="' + taskId + '"]');
        if (card) {
            card.classList.add('task-completing');
            var checkEl = card.querySelector('.task-checkbox');
            if (checkEl) checkEl.classList.add('checked');
        }
    }

    try {
        await fetch(`${baseUrl}/api/done_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, user_id: userId, done: newStatus })
        });

        task.done = newStatus;
        if (newStatus && card) {
            card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            card.style.opacity = '0.6';
            card.style.transform = 'scale(0.98)';
            setTimeout(function() {
                var q = document.getElementById('search-input');
                renderTaskList(q ? q.value : '');
            }, 500);
        } else {
            const q = document.getElementById('search-input');
            renderTaskList(q ? q.value : '');
        }
        console.log(`✅ Задача ${taskId} отмечена как ${newStatus ? 'выполнена' : 'активна'}`);
    } catch (err) {
        if (card) card.classList.remove('task-completing');
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
        var header = document.getElementById('main-header');
        if (header) header.style.display = '';
        return true;
    } catch (err) {
        console.error("❌ Ошибка загрузки профиля:", err);
        return false;
    }
}

let userRegistered = false;

function showUnregisteredState() {
    userRegistered = false;
    var unreg = document.getElementById('unregistered-screen');
    if (unreg) {
        unreg.style.display = 'flex';
        unreg.style.minHeight = '60vh';
        unreg.style.flexDirection = 'column';
        unreg.style.justifyContent = 'center';
    }
    // Скрываем шапку и весь контент — только сообщение о регистрации
    var header = document.getElementById('main-header');
    if (header) header.style.display = 'none';
    document.querySelectorAll('.app-screen').forEach(function(el) { el.style.display = 'none'; });
    var main = document.getElementById('main-content');
    if (main) { main.classList.add('hidden'); main.style.display = 'none'; }
    var fab = document.getElementById('add-task-fab');
    if (fab) fab.style.display = 'none';
    var nav = document.getElementById('bottom-nav');
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
    const finalizeInList = document.getElementById('survey-finalize-in-list');
    if (listBlock) listBlock.style.display = 'block';
    if (intro) intro.style.display = 'none';
    if (content) content.style.display = 'none';
    if (alreadyPassed) alreadyPassed.style.display = 'none';
    if (customBlock) customBlock.style.display = 'none';
    if (finalizeInList) finalizeInList.style.display = (userRole === 'admin' || userRole === 'assistant') ? 'block' : 'none';
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
        window.userSurveyGender = gender;
        systemEl.innerHTML = '';
        data.system.forEach(function(item) {
            if (userRole !== 'admin' && userRole !== 'assistant' && item.for_gender !== gender && !(item.id === 'female' && gender === 'male')) return;
            const card = document.createElement('div');
            card.className = 'survey-list-card';
            card.style.cssText = 'background:#1E293B;border-radius:12px;padding:14px;border-left:4px solid #3B82F6;cursor:pointer;';
            card.innerHTML = '<div style="color:#93C5FD;font-weight:600;">' + (item.id === 'female' ? '👩 ' : '👨 ') + item.title + '</div>';
            card.onclick = function() { openSystemSurvey(item.id); };
            systemEl.appendChild(card);
        });
        var finalizeWrap = document.getElementById('survey-finalize-in-list');
        if (finalizeWrap) finalizeWrap.style.display = (userRole === 'admin' || userRole === 'assistant') ? 'block' : 'none';
        var finalizeBtn = document.getElementById('survey-finalize-in-list-btn');
        if (finalizeBtn && !finalizeBtn._bound) {
            finalizeBtn._bound = true;
            finalizeBtn.addEventListener('click', finalizeSurvey);
        }
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
            bindCreateSurveyAddOption();
        }
    } catch (e) {
        console.warn('Ошибка загрузки списка опросов:', e);
        systemEl.innerHTML = '<p style="color:#94A3B8;">Не удалось загрузить список</p>';
    }
}

function showCreateSurveyModal() {
    document.getElementById('create-survey-title').value = '';
    var list = document.getElementById('create-survey-options-list');
    if (list) {
        list.innerHTML = '';
        addCreateSurveyOptionInput(list, '');
        addCreateSurveyOptionInput(list, '');
    }
    var scopeEl = document.getElementById('create-survey-scope');
    if (scopeEl) {
        if (userRole === 'sergeant') {
            scopeEl.innerHTML = '<option value="group">Группа</option>';
            scopeEl.disabled = true;
        } else if (userRole === 'assistant') {
            scopeEl.innerHTML = '<option value="course">Курс</option>';
            scopeEl.disabled = true;
        } else {
            scopeEl.innerHTML = '<option value="course">Курс</option><option value="group">Группа</option><option value="system">Системный</option>';
            scopeEl.disabled = false;
        }
    }
    document.getElementById('create-survey-modal').style.display = 'flex';
}

function addCreateSurveyOptionInput(container, value) {
    if (!container) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Вариант ответа';
    input.value = value;
    input.style.cssText = 'flex:1;padding:10px;background:#1E293B;border:1px solid #334155;border-radius:8px;color:#E2E8F0;box-sizing:border-box';
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '✕';
    delBtn.style.cssText = 'padding:8px 12px;background:#7F1D1D;color:#FCA5A5;border:none;border-radius:8px;cursor:pointer';
    delBtn.onclick = function() {
        if (container.querySelectorAll("input[type='text']").length > 1) wrap.remove();
    };
    wrap.appendChild(input);
    wrap.appendChild(delBtn);
    container.appendChild(wrap);
}

function bindCreateSurveyAddOption() {
    var btn = document.getElementById('create-survey-add-option');
    var list = document.getElementById('create-survey-options-list');
    if (btn && list) btn.addEventListener('click', function() { addCreateSurveyOptionInput(list, ''); });
}

async function submitCreateSurvey() {
    const title = (document.getElementById('create-survey-title').value || '').trim();
    var optsList = document.getElementById('create-survey-options-list');
    var options = optsList ? [].map.call(optsList.querySelectorAll("input[type='text']"), function(inp) { return (inp.value || '').trim(); }).filter(Boolean) : [];
    if (!title || options.length < 2) {
        showToast('Укажите название и минимум 2 варианта ответа');
        return;
    }
    var scopeSelect = document.getElementById('create-survey-scope');
    var scopeType = (scopeSelect && scopeSelect.value) ? scopeSelect.value : (userRole === 'sergeant' ? 'group' : 'course');
    if (scopeType === 'system' && userRole !== 'admin') scopeType = 'course';
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
    if (!intro || !alreadyPassed) return;
    var userGender = window.userSurveyGender || 'male';
    if (userGender !== 'female') {
        intro.style.display = 'none';
        if (content) content.style.display = 'none';
        alreadyPassed.style.display = 'block';
        alreadyPassed.querySelector('h2').textContent = '📊 Опрос для девушек';
        var passedBody = alreadyPassed.querySelector('#survey-already-text');
        if (passedBody) passedBody.textContent = 'Этот опрос только для девушек. Вы можете посмотреть результаты в списке опросов.';
        var resultsWrap = document.getElementById('survey-results-in-tab');
        if (resultsWrap) { resultsWrap.style.display = 'none'; resultsWrap.innerHTML = ''; }
        try {
            const st = await fetch(baseUrl + '/api/survey/status');
            const statusData = st.ok ? await st.json() : {};
            if (statusData.weights_calculated && resultsWrap) {
                window._surveyResultsHtml = null;
                await loadSurveyResults();
                if (window._surveyResultsHtml) {
                    resultsWrap.innerHTML = window._surveyResultsHtml;
                    resultsWrap.style.display = 'block';
                }
            }
        } catch (e) { console.warn(e); }
        return;
    }
    try {
        const response = await fetch(`${baseUrl}/api/survey/user-results?telegram_id=${userId}`);
        if (!response.ok) throw new Error('HTTP');
        const data = await response.json();
        if (data.voted && data.survey_stage === 'female' && data.results && data.results.length > 0) {
            alreadyPassed.style.display = 'block';
            alreadyPassed.querySelector('h2').textContent = '📊 Опрос для девушек';
            var p1 = alreadyPassed.querySelector('#survey-already-text');
            if (p1) p1.textContent = 'Результаты ниже на этой странице.';
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
        if (data.voted && data.results && data.results.length > 0) {
            alreadyPassed.style.display = 'block';
            if (alreadyPassed.querySelector('h2')) alreadyPassed.querySelector('h2').textContent = (data.survey_stage === 'female' ? '📊 Опрос для девушек' : '📊 Опрос для парней (сложность нарядов)');
            var p2 = alreadyPassed.querySelectorAll('p')[1];
            if (p2) p2.textContent = 'Результаты ниже.';
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
            'Этап 2 из 2: Объекты в столовой (Горячий цех, Овощной цех, Стаканы, Железо, Лента, Тарелки) — все ' + surveyPairsCanteen.length + ' пар';
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
        
        window.surveyWeightsCalculated = !!(data.voted && data.results && data.results.length > 0);
        if (!data.voted) {
            // Пользователь ещё не прошёл опрос - ничего не показываем
            return;
        }
        
        // Показываем объекты с рассчитанными весами (родители и подобъекты)
        const votedObjects = data.results.filter(r => r.median_weight != null);
        
        if (votedObjects.length === 0) {
            window.surveyWeightsCalculated = false;
            return; // Веса ещё не рассчитаны
        }
        window.surveyWeightsCalculated = true;
        
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
        
        // Результаты опроса не показываем на главной — только в разделе «Опрос»
        let resultsWidget = document.getElementById('survey-results-widget');
        if (resultsWidget) resultsWidget.style.display = 'none';
        
        let html = '<h3>📊 Результаты опроса</h3>';
        html += '<p style="color: #94A3B8; font-size: 14px; margin-bottom: 12px;">Веса объектов:</p>';
        
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
        
        html += '<p style="margin-top: 12px;"><button type="button" onclick="togglePairStatsInline()" style="padding: 8px 16px; background: #334155; color: #93C5FD; border: 1px solid #64748B; border-radius: 8px; cursor: pointer;">Подробнее по парам</button></p>';
        html += '<div id="survey-pair-stats-inline" style="display: none; margin-top: 12px;"></div>';
        window._surveyResultsHtml = html;
        // Показываем результаты в разделе Опрос (survey-already-passed)
        var alreadyBlock = document.getElementById('survey-results-in-tab');
        if (alreadyBlock) { alreadyBlock.innerHTML = html; alreadyBlock.style.display = 'block'; }
        console.log('✅ Результаты опроса загружены');
    } catch (err) {
        console.error('❌ Ошибка загрузки результатов опроса:', err);
    }
}

let pairStatsPairs = [];
let pairStatsIndex = 0;

async function togglePairStatsInline() {
    var el = document.getElementById('survey-pair-stats-inline');
    if (!el) return;
    var visible = el.style.display !== 'none';
    el.style.display = visible ? 'none' : 'block';
    if (el.style.display === 'block' && !el._loaded) {
        el.innerHTML = '<p style="color:#94A3B8;">Загрузка...</p>';
        el._loaded = true;
        try {
            var stages = [{ stage: 'main', title: 'Основные наряды (6 пар)' }, { stage: 'canteen', title: 'Объекты столовой (15 пар)' }, { stage: 'female', title: 'Опрос для девушек' }];
            var html = '';
            for (var s = 0; s < stages.length; s++) {
                var res = await fetch(baseUrl + '/api/survey/pair-stats?stage=' + encodeURIComponent(stages[s].stage));
                if (!res.ok) continue;
                var data = await res.json();
                var pairs = data.pairs || [];
                if (pairs.length === 0) continue;
                html += '<div style="margin-bottom: 16px;"><h4 style="color: #93C5FD; margin: 0 0 8px 0; font-size: 14px;">' + stages[s].title + '</h4>';
                pairs.forEach(function(p) {
                    html += '<div style="background:#1E293B;border-radius:8px;padding:12px;margin-bottom:8px;border-left:4px solid #3B82F6;">';
                    html += '<h5 style="color:#E2E8F0;margin:0 0 8px 0;font-size:13px;">' + p.object_a_name + ' vs ' + p.object_b_name + '</h5>';
                    html += '<p style="color:#94A3B8;margin:4px 0;font-size:12px;">' + p.object_a_name + ' сложнее: ' + p.pct_a + '% (' + p.count_a + ')</p>';
                    html += '<p style="color:#94A3B8;margin:4px 0;font-size:12px;">Одинаково: ' + p.pct_equal + '% (' + p.count_equal + ')</p>';
                    html += '<p style="color:#94A3B8;margin:4px 0;font-size:12px;">' + p.object_b_name + ' сложнее: ' + p.pct_b + '% (' + p.count_b + ')</p></div>';
                });
                html += '</div>';
            }
            el.innerHTML = html || '<p style="color:#94A3B8;">Нет данных по парам</p>';
        } catch (e) {
            el.innerHTML = '<p style="color:#f87171;">Ошибка загрузки</p>';
        }
    }
}

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
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('ru-RU', options);
}

function getDayOfWeek(dateStr) {
    var days = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    var d = new Date(dateStr + 'T12:00:00');
    return days[d.getDay()];
}

function openNotifications() {
    showToast("Уведомления (в разработке)");
}

function openSettings() {
    showToast("Настройки (в разработке)");
}

// === ФУНКЦИИ ДЛЯ РАБОТЫ С НАРЯДАМИ ===

let dutyAvailableMonths = [];
let dutyCurrentView = 'my';
let dutyCurrentTab = 'upcoming';
let calM = new Date().getMonth() + 1;
let calY = new Date().getFullYear();

function dutySetView(view) {
    dutyCurrentView = view;
    ['my', 'upload', 'stats'].forEach(function(v) {
        var el = document.getElementById('duty-view-' + v);
        if (el) el.style.display = v === view ? 'block' : 'none';
    });
    document.querySelectorAll('.duty-tool-btn').forEach(function(b) {
        var active = b.getAttribute('data-view') === view;
        b.style.background = active ? '#3B82F6' : '#1E293B';
        b.style.color = active ? 'white' : '#CBD5E1';
    });
    if (view === 'my') loadDutiesForMonth();
    if (view === 'stats') loadDutyStats();
}

function dutySetTab(tab) {
    dutyCurrentTab = tab;
    document.getElementById('duty-tab-upcoming').style.background = tab === 'upcoming' ? '#3B82F6' : '#1E293B';
    document.getElementById('duty-tab-upcoming').style.color = tab === 'upcoming' ? 'white' : '#94A3B8';
    document.getElementById('duty-tab-past').style.background = tab === 'past' ? '#3B82F6' : '#1E293B';
    document.getElementById('duty-tab-past').style.color = tab === 'past' ? 'white' : '#94A3B8';
    loadDutiesForMonth();
}

async function loadDutyAvailableMonths() {
    try {
        var res = await fetch(baseUrl + '/api/duties/available-months?telegram_id=' + userId);
        var data = res.ok ? await res.json() : {};
        dutyAvailableMonths = data.months || [];
    } catch (e) { dutyAvailableMonths = []; }
}

function calMonth(delta) {
    calM += delta;
    if (calM > 12) { calM = 1; calY++; }
    if (calM < 1) { calM = 12; calY--; }
    renderDutyCalendar();
}

function renderDutyCalendar() {
    var grid = document.getElementById('duty-calendar-grid');
    var label = document.getElementById('cal-month-label');
    if (!grid || !label) return;
    var mn = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    label.textContent = mn[calM - 1] + ' ' + calY;
    var ym = calY + '-' + String(calM).padStart(2, '0');
    var hasData = dutyAvailableMonths.indexOf(ym) !== -1;
    if (!hasData) {
        grid.innerHTML = '<p style="grid-column: 1/-1; color: #94A3B8; text-align: center; padding: 20px;">График на этот месяц отсутствует</p>';
        document.getElementById('duty-day-detail').style.display = 'none';
        return;
    }
    var days = new Date(calY, calM, 0).getDate();
    var firstDow = (new Date(calY, calM - 1, 1).getDay() + 6) % 7;
    var dayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    var html = dayNames.map(function(d) { return '<div style="text-align:center;color:#64748B;font-size:12px;padding:4px 0;">' + d + '</div>'; }).join('');
    for (var i = 0; i < firstDow; i++) html += '<div></div>';
    var todayStr = new Date().toISOString().slice(0, 10);
    for (var d = 1; d <= days; d++) {
        var ds = calY + '-' + String(calM).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var isToday = ds === todayStr;
        html += '<div onclick="calSelectDay(\'' + ds + '\')" style="text-align:center;padding:8px 2px;border-radius:8px;cursor:pointer;background:' + (isToday ? '#3B82F6' : '#1E293B') + ';color:' + (isToday ? 'white' : '#CBD5E1') + ';font-size:14px;">' + d + '</div>';
    }
    grid.innerHTML = html;
    document.getElementById('duty-day-detail').style.display = 'none';
}

async function calSelectDay(dateStr) {
    var det = document.getElementById('duty-day-detail');
    if (!det) return;
    det.style.display = 'block';
    det.innerHTML = '<p style="color:#94A3B8;">Загрузка...</p>';
    try {
        var res = await fetch(baseUrl + '/api/duties/by-date?date=' + dateStr + '&telegram_id=' + userId);
        var data = res.ok ? await res.json() : {};
        if (data.total === 0 || !data.by_role) {
            det.innerHTML = '<p style="color:#64748B;">На ' + formatDate(dateStr) + ' нарядов нет</p>';
            return;
        }
        var html = '<h4 style="color:#93C5FD;margin:0 0 12px 0;">' + formatDate(dateStr) + '</h4>';
        Object.keys(data.by_role).forEach(function(role) {
            var parts = data.by_role[role];
            var roleFull = get_full_role(role) || role;
            html += '<div onclick="openDutyDetail(\'' + dateStr + '\',\'' + role + '\')" style="background:#1E293B;border-radius:8px;padding:12px;margin-bottom:8px;cursor:pointer;border-left:4px solid #3B82F6;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<span style="color:#CBD5E1;font-weight:600;">' + roleFull + '</span>';
            html += '<span style="color:#94A3B8;font-size:13px;">' + parts.length + ' чел.</span>';
            html += '</div></div>';
        });
        det.innerHTML = html;
    } catch (e) {
        det.innerHTML = '<p style="color:#f87171;">Ошибка загрузки</p>';
    }
}

async function openDutyDetail(dateStr, role) {
    var modal = document.getElementById('duty-detail-modal');
    var title = document.getElementById('duty-detail-title');
    var body = document.getElementById('duty-detail-body');
    if (!modal || !body) return;
    modal.style.display = 'block';
    title.textContent = (get_full_role(role) || role) + ' — ' + formatDate(dateStr);
    body.innerHTML = '<p style="color:#94A3B8;">Загрузка...</p>';
    try {
        var res = await fetch(baseUrl + '/api/duties/day-detail?date=' + dateStr + '&role=' + encodeURIComponent(role) + '&telegram_id=' + userId);
        var data = res.ok ? await res.json() : {};
        if (!data.participants || data.participants.length === 0) {
            body.innerHTML = '<p style="color:#64748B;">Нет участников</p>';
            return;
        }
        var html = '<p style="color:#94A3B8;margin-bottom:12px;">Всего: ' + data.count + ' чел.</p>';

        var isPriv = userRole === 'sergeant' || userRole === 'assistant' || userRole === 'admin';
        var isShiftRole = role === 'к' || role === 'гбр';
        var isCanteen = role === 'с';

        if (isShiftRole && data.shifts && data.shifts.length > 0) {
            html += '<h5 style="color:#93C5FD;margin:12px 0 8px;">Распределение по сменам</h5>';
            var byShift = {};
            data.shifts.forEach(function(a) {
                var s = a.shift === 0 ? 'Дежурный' : (a.shift + '-я смена');
                if (!byShift[s]) byShift[s] = [];
                byShift[s].push(a.fio);
            });
            Object.keys(byShift).forEach(function(s) {
                html += '<div style="background:#0f172a;border-radius:6px;padding:8px;margin-bottom:6px;">';
                html += '<p style="color:#60A5FA;font-size:13px;margin:0 0 4px;">' + s + '</p>';
                byShift[s].forEach(function(fio) {
                    var isMe = userFio && fio === userFio;
                    html += '<p style="color:' + (isMe ? '#3B82F6' : '#CBD5E1') + ';font-size:14px;margin:2px 0;">' + fio + (isMe ? ' (вы)' : '') + '</p>';
                });
                html += '</div>';
            });
        } else if (isShiftRole) {
            html += '<p style="color:#F59E0B;font-size:13px;margin:8px 0;">⏳ Смены будут распределены автоматически за 3 часа до наряда (в 15:30)</p>';
        }

        if (isCanteen && data.canteen && data.canteen.length > 0) {
            html += '<h5 style="color:#93C5FD;margin:12px 0 8px;">Распределение по объектам</h5>';
            var byObj = {};
            data.canteen.forEach(function(a) {
                if (!byObj[a.object]) byObj[a.object] = [];
                byObj[a.object].push(a.fio);
            });
            Object.keys(byObj).forEach(function(obj) {
                html += '<div style="background:#0f172a;border-radius:6px;padding:8px;margin-bottom:6px;">';
                html += '<p style="color:#60A5FA;font-size:13px;margin:0 0 4px;">' + obj + '</p>';
                byObj[obj].forEach(function(fio) {
                    var isMe = userFio && fio === userFio;
                    html += '<p style="color:' + (isMe ? '#3B82F6' : '#CBD5E1') + ';font-size:14px;margin:2px 0;">' + fio + (isMe ? ' (вы)' : '') + '</p>';
                });
                html += '</div>';
            });
        } else if (isCanteen) {
            html += '<p style="color:#F59E0B;font-size:13px;margin:8px 0;">⏳ Объекты будут распределены автоматически за 3 часа до наряда (в 15:30)</p>';
        }

        html += '<h5 style="color:#93C5FD;margin:12px 0 8px;">Бригада</h5>';
        data.participants.forEach(function(p) {
            var isMe = userFio && p.fio === userFio;
            var tid = p.telegram_id;
            var fioEsc = (p.fio || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            if (tid) {
                html += '<a href="tg://user?id=' + tid + '" target="_blank" rel="noopener" style="display:flex;justify-content:space-between;padding:10px;background:#1E293B;border-radius:8px;margin-bottom:6px;text-decoration:none;' + (isMe ? 'border-left:3px solid #3B82F6;' : '') + '">';
                html += '<span style="color:' + (isMe ? '#3B82F6' : '#60A5FA') + ';font-size:14px;">' + fioEsc + (isMe ? ' (вы)' : '') + ' ↗</span>';
                html += '<span style="color:#94A3B8;font-size:13px;">' + (p.group || '') + '</span>';
                html += '</a>';
            } else {
                html += '<div style="display:flex;justify-content:space-between;padding:10px;background:#1E293B;border-radius:8px;margin-bottom:6px;' + (isMe ? 'border-left:3px solid #3B82F6;' : '') + '">';
                html += '<span style="color:' + (isMe ? '#3B82F6' : '#CBD5E1') + ';font-size:14px;">' + fioEsc + (isMe ? ' (вы)' : '') + '</span>';
                html += '<span style="color:#94A3B8;font-size:13px;">' + (p.group || '') + '</span>';
                html += '</div>';
            }
        });

        if (isPriv && (isShiftRole || isCanteen)) {
            html += '<button type="button" onclick="distributeNow(\'' + dateStr + '\',\'' + role + '\')" style="width:100%;margin-top:12px;padding:10px;background:#8B5CF6;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Распределить сейчас</button>';
            html += '<p style="color:#64748B;font-size:11px;margin-top:4px;text-align:center;">Ручное распределение (перезапишет текущее)</p>';
        }

        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = '<p style="color:#f87171;">Ошибка</p>';
    }
}

async function distributeNow(dateStr, role) {
    if (!confirm('Распределить людей по сменам/объектам? Текущее распределение будет перезаписано.')) return;
    try {
        var form = new FormData();
        form.append('date', dateStr);
        form.append('role', role);
        form.append('telegram_id', userId);
        var res = await fetch(baseUrl + '/api/duties/distribute', { method: 'POST', body: form });
        var data = res.ok ? await res.json() : {};
        if (res.ok) {
            showToast('Распределение выполнено: ' + (data.count || 0) + ' назначений');
            openDutyDetail(dateStr, role);
        } else {
            showToast(data.detail || 'Ошибка');
        }
    } catch (e) {
        showToast('Ошибка сети');
    }
}

function closeDutyDetail() {
    var m = document.getElementById('duty-detail-modal');
    if (m) m.style.display = 'none';
}

async function loadDutyStats() {
    var el = document.getElementById('duty-stats-content');
    if (!el) return;
    el.innerHTML = '<p style="color:#94A3B8;">Загрузка...</p>';
    try {
        var res = await fetch(baseUrl + '/api/duties?telegram_id=' + userId);
        var data = res.ok ? await res.json() : {};
        var duties = data.duties || [];
        var total = duties.length;
        var roleCount = {};
        duties.forEach(function(d) {
            var r = d.role_full || d.role;
            roleCount[r] = (roleCount[r] || 0) + 1;
        });
        var html = '<h4 style="color:#93C5FD;margin:0 0 12px 0;">Ваша статистика за все время</h4>';
        html += '<p style="color:#CBD5E1;margin-bottom:12px;">Всего нарядов: <strong>' + total + '</strong></p>';
        Object.keys(roleCount).sort(function(a, b) { return roleCount[b] - roleCount[a]; }).forEach(function(r) {
            var pct = total > 0 ? Math.round(100 * roleCount[r] / total) : 0;
            html += '<div style="display:flex;justify-content:space-between;padding:8px 12px;background:#1E293B;border-radius:8px;margin-bottom:6px;">';
            html += '<span style="color:#CBD5E1;">' + r + '</span>';
            html += '<span style="color:#3B82F6;font-weight:600;">' + roleCount[r] + ' (' + pct + '%)</span>';
            html += '</div>';
        });
        el.innerHTML = html;
    } catch (e) {
        el.innerHTML = '<p style="color:#f87171;">Ошибка загрузки</p>';
    }
}

function openSurveyResultsView() {
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('main-content').style.display = 'none';
    document.querySelectorAll('.app-screen').forEach(function(el) { el.style.display = 'none'; });
    document.getElementById('survey-screen').style.display = 'block';
    document.getElementById('survey-list-block').style.display = 'none';
    document.getElementById('survey-already-passed').style.display = 'block';
    var r = document.getElementById('survey-results-in-tab');
    if (r && window._surveyResultsHtml) { r.innerHTML = window._surveyResultsHtml; r.style.display = 'block'; }
}

function updateDutySurveyBanner() {
    var banner = document.getElementById('duty-survey-banner');
    if (!banner) return;
    if (window.surveyWeightsCalculated) {
        var count = parseInt(localStorage.getItem('dutySurveyBannerCount') || '0', 10);
        if (count >= 10) {
            banner.style.display = 'none';
            return;
        }
        localStorage.setItem('dutySurveyBannerCount', String(count + 1));
        banner.style.display = '';
        banner.innerHTML = '<p style="color: #10B981; margin: 0; font-size: 14px;">Опрос завершён, веса рассчитаны.</p><a href="#" onclick="openSurveyResultsView(); return false;" style="color: #60A5FA; font-size: 13px;">Посмотреть результаты</a>';
        banner.style.background = '#0f172a';
        banner.style.borderColor = '#10B981';
    } else {
        banner.innerHTML = '<p style="color: #93C5FD; margin: 0 0 8px 0; font-weight: 600;">Для работы с нарядами сначала пройдите опрос</p><p style="color: #94A3B8; font-size: 14px; margin: 0 0 12px 0;">Оцените сложность объектов, чтобы система могла рассчитать веса.</p><a href="#" onclick="switchTab(\'survey\'); return false;" style="display: inline-block; background: #3B82F6; color: white; padding: 8px 16px; border-radius: 8px; text-decoration: none; font-size: 14px;">Пройти опрос</a>';
        banner.style.background = '#1E293B';
        banner.style.borderColor = '#3B82F6';
    }
}

function bindDutyUploadOnce() {
    if (window._dutyUploadBound) return;
    const btn = document.getElementById('duty-upload-btn');
    const fileInput = document.getElementById('duty-upload-file');
    const templateLink = document.getElementById('duty-template-link');
    const quickTemplate = document.getElementById('duty-graph-btn-template');
    if (templateLink) templateLink.href = baseUrl + '/api/schedule/template';
    if (quickTemplate) quickTemplate.href = baseUrl + '/api/schedule/template';
    var uploadBlock = document.getElementById('duty-graph-upload-block');
    var deleteBlock = document.getElementById('duty-graph-delete-block');
    var quickUploadBtn = document.getElementById('duty-graph-btn-upload');
    var quickDeleteBtn = document.getElementById('duty-graph-btn-delete');
    if (quickUploadBtn && uploadBlock) quickUploadBtn.addEventListener('click', function() { uploadBlock.scrollIntoView({ behavior: 'smooth' }); });
    if (quickDeleteBtn && deleteBlock) {
        quickDeleteBtn.addEventListener('click', function() {
            deleteBlock.style.display = 'block';
            loadDutyAvailableMonths().then(function() { renderDutyGraphCards(); });
            deleteBlock.scrollIntoView({ behavior: 'smooth' });
        });
    }
    if (!btn || !fileInput) return;
    window._dutyUploadBound = true;
    btn.addEventListener('click', async function() {
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
            showToast('Выберите файл .xlsx');
            return;
        }
        var form = new FormData();
        form.append('file', file);
        form.append('telegram_id', userId);
        form.append('overwrite', '0');
        try {
            var res = await fetch(baseUrl + '/api/schedule/upload', { method: 'POST', body: form });
            var data = res.ok ? await res.json() : { detail: (await res.json()).detail || 'Ошибка' };
            if (res.status === 409 && data.detail && data.detail.indexOf('уже существует') !== -1) {
                if (!confirm(data.detail + '\n\nНажмите ОК для перезаписи.')) return;
                form = new FormData();
                form.append('file', file);
                form.append('telegram_id', userId);
                form.append('overwrite', '1');
                res = await fetch(baseUrl + '/api/schedule/upload', { method: 'POST', body: form });
                data = res.ok ? await res.json() : { detail: (await res.json()).detail || 'Ошибка' };
            }
            if (res.ok) {
                var msg = (data.message || ('График загружен: ' + (data.count || 0) + ' записей'));
                showToast(msg);
                fileInput.value = '';
                await loadDutyAvailableMonths();
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

var monthNamesRu = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
function renderDutyGraphCards() {
    var container = document.getElementById('duty-graph-cards');
    if (!container) return;
    if (!dutyAvailableMonths || dutyAvailableMonths.length === 0) {
        container.innerHTML = '<p style="color:#94A3B8;">Нет загруженных графиков</p>';
        return;
    }
    var html = '';
    dutyAvailableMonths.forEach(function(ym) {
        var parts = ym.split('-');
        var y = parts[0];
        var m = parseInt(parts[1], 10);
        var label = (monthNamesRu[m - 1] || ym) + ' ' + y;
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#0f172a;border-radius:8px;margin-bottom:8px;">';
        html += '<span style="color:#CBD5E1;">' + label + '</span>';
        html += '<span style="display:flex;gap:8px;">';
        html += '<button type="button" onclick="openEditScheduleModal(\'' + ym + '\')" style="padding:6px 12px;background:#1E3A5F;color:#93C5FD;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Правка</button>';
        html += '<button type="button" onclick="deleteScheduleMonth(\'' + ym + '\')" style="padding:6px 12px;background:#7F1D1D;color:#FCA5A5;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Удалить</button>';
        html += '</span></div>';
    });
    container.innerHTML = html;
}

async function deleteScheduleMonth(ym) {
    if (!confirm('Удалить график за этот месяц? Данные будут удалены безвозвратно.')) return;
    try {
        var res = await fetch(baseUrl + '/api/schedule/month?ym=' + encodeURIComponent(ym) + '&telegram_id=' + userId, { method: 'DELETE' });
        var data = res.ok ? await res.json() : { detail: (await res.json()).detail || 'Ошибка' };
        if (res.ok) {
            showToast(data.message || 'График удалён');
            await loadDutyAvailableMonths();
            renderDutyGraphCards();
            loadDutiesForMonth();
            loadDuties(userId);
        } else {
            showToast(data.detail || 'Ошибка удаления');
        }
    } catch (e) {
        showToast('Ошибка сети');
    }
}

var dutyEditContext = null;
var dutyEditCurrentYm = null;
var DUTY_ROLE_CODES = ['к', 'дк', 'с', 'дс', 'ад', 'п', 'ж', 'т', 'кпп', 'гбр', 'зуб', 'ото', 'м', 'путсо'];

async function openEditScheduleModal(ym) {
    dutyEditCurrentYm = ym;
    var modal = document.getElementById('duty-edit-modal');
    var ymSpan = document.getElementById('duty-edit-modal-ym');
    if (ymSpan) ymSpan.textContent = ym;
    document.getElementById('duty-edit-form-remove').style.display = 'none';
    document.getElementById('duty-edit-form-add').style.display = 'none';
    modal.style.display = 'flex';
    try {
        var res = await fetch(baseUrl + '/api/duties/edit-context?ym=' + encodeURIComponent(ym) + '&telegram_id=' + userId);
        if (!res.ok) { showToast('Нет прав или ошибка загрузки'); return; }
        dutyEditContext = await res.json();
        fillDutyEditDropdowns();
    } catch (e) {
        showToast('Ошибка сети');
    }
}

function fillDutyEditDropdowns() {
    if (!dutyEditContext) return;
    var removeFio = document.getElementById('duty-edit-remove-fio');
    var removeReplacement = document.getElementById('duty-edit-remove-replacement');
    var addFio = document.getElementById('duty-edit-add-fio');
    var removeReason = document.getElementById('duty-edit-remove-reason');
    var removeRole = document.getElementById('duty-edit-remove-role');
    var addRole = document.getElementById('duty-edit-add-role');
    removeFio.innerHTML = '<option value="">— выбрать —</option>';
    dutyEditContext.cadets_in_schedule.forEach(function(c) {
        removeFio.innerHTML += '<option value="' + (c.fio || '').replace(/"/g, '&quot;') + '">' + (c.fio || '') + '</option>';
    });
    removeReplacement.innerHTML = '<option value="">— выбрать —</option>';
    addFio.innerHTML = '<option value="">— выбрать —</option>';
    dutyEditContext.group_users.forEach(function(u) {
        var fio = (u.fio || '').replace(/"/g, '&quot;');
        removeReplacement.innerHTML += '<option value="' + fio + '">' + (u.fio || '') + '</option>';
        addFio.innerHTML += '<option value="' + fio + '" data-group="' + (u.group_name || '').replace(/"/g, '&quot;') + '">' + (u.fio || '') + '</option>';
    });
    var reasons = dutyEditContext.reasons || ['заболел', 'командировка', 'рапорт', 'другое'];
    removeReason.innerHTML = reasons.map(function(r) { return '<option value="' + r + '">' + r + '</option>'; }).join('');
    var roleOpts = DUTY_ROLE_CODES.map(function(r) { return '<option value="' + r + '">' + get_full_role(r) + '</option>'; }).join('');
    removeRole.innerHTML = '<option value="">— выбрать —</option>' + roleOpts;
    addRole.innerHTML = '<option value="">— выбрать —</option>' + roleOpts;
}

(function initDutyEditModal() {
    var modal = document.getElementById('duty-edit-modal');
    if (!modal) return;
    document.getElementById('duty-edit-btn-remove').addEventListener('click', function() {
        document.getElementById('duty-edit-form-remove').style.display = 'block';
        document.getElementById('duty-edit-form-add').style.display = 'none';
    });
    document.getElementById('duty-edit-btn-add').addEventListener('click', function() {
        document.getElementById('duty-edit-form-add').style.display = 'block';
        document.getElementById('duty-edit-form-remove').style.display = 'none';
    });
    document.getElementById('duty-edit-close').addEventListener('click', function() {
        modal.style.display = 'none';
    });
    document.getElementById('duty-edit-submit-remove').addEventListener('click', async function() {
        var fioRemoved = document.getElementById('duty-edit-remove-fio').value.trim();
        var date = document.getElementById('duty-edit-remove-date').value.trim();
        var role = document.getElementById('duty-edit-remove-role').value.trim();
        var reason = document.getElementById('duty-edit-remove-reason').value.trim();
        var fioReplacement = document.getElementById('duty-edit-remove-replacement').value.trim();
        if (!fioRemoved || !date || !role || !fioReplacement) { showToast('Заполните все поля'); return; }
        try {
            var res = await fetch(baseUrl + '/api/duties/remove-and-replace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegram_id: userId, date: date, role: role, fio_removed: fioRemoved, fio_replacement: fioReplacement, reason: reason || 'заболел' })
            });
            var data = res.ok ? await res.json() : await res.json().then(function(j) { return j; }).catch(function() { return {}; });
            if (res.ok) {
                showToast(data.message || 'Замена выполнена');
                modal.style.display = 'none';
                loadDutyAvailableMonths().then(function() { renderDutyGraphCards(); });
                loadDutiesForMonth();
                loadDuties(userId);
            } else {
                showToast(data.detail || 'Ошибка');
            }
        } catch (e) {
            showToast('Ошибка сети');
        }
    });
    document.getElementById('duty-edit-submit-add').addEventListener('click', async function() {
        var sel = document.getElementById('duty-edit-add-fio');
        var fio = sel.value.trim();
        var groupName = sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].getAttribute('data-group');
        var date = document.getElementById('duty-edit-add-date').value.trim();
        var role = document.getElementById('duty-edit-add-role').value.trim();
        var fioReplaced = document.getElementById('duty-edit-add-fio-replaced').value.trim();
        if (!fio || !date || !role) { showToast('Заполните курсант, дату и роль'); return; }
        if (!groupName) groupName = (dutyEditContext && dutyEditContext.group_users && dutyEditContext.group_users[0]) ? dutyEditContext.group_users[0].group_name : '';
        try {
            var body = { telegram_id: userId, date: date, role: role, fio: fio, group_name: groupName };
            if (fioReplaced) body.reason_replacing_sick = 'заболел';
            if (fioReplaced) body.fio_replaced = fioReplaced;
            var res = await fetch(baseUrl + '/api/duties/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            var data = res.ok ? await res.json() : await res.json().then(function(j) { return j; }).catch(function() { return {}; });
            if (res.ok) {
                showToast(data.message || 'Наряд добавлен');
                modal.style.display = 'none';
                loadDutyAvailableMonths().then(function() { renderDutyGraphCards(); });
                loadDutiesForMonth();
                loadDuties(userId);
            } else {
                showToast(data.detail || 'Ошибка');
            }
        } catch (e) {
            showToast('Ошибка сети');
        }
    });
})();

async function loadProfileDutyStats() {
    var sickEl = document.getElementById('profile-stats-sick');
    var replacedEl = document.getElementById('profile-stats-replaced');
    if (!sickEl || !replacedEl) return;
    try {
        var res = await fetch(baseUrl + '/api/profile/duty-stats?telegram_id=' + userId);
        if (!res.ok) return;
        var data = await res.json();
        sickEl.textContent = 'Болел: ' + (data.times_sick || 0) + ' раз';
        replacedEl.textContent = 'Заменял других: ' + (data.times_replaced || 0) + ' раз';
    } catch (e) {}
}

(function initSickLeaveModal() {
    var modal = document.getElementById('sick-leave-modal');
    if (!modal) return;
    document.getElementById('profile-sick-leave-btn').addEventListener('click', function() {
        document.getElementById('sick-leave-date').value = '';
        modal.style.display = 'flex';
    });
    document.getElementById('sick-leave-cancel').addEventListener('click', function() {
        modal.style.display = 'none';
    });
    document.getElementById('sick-leave-submit').addEventListener('click', async function() {
        var reportDate = document.getElementById('sick-leave-date').value.trim();
        if (!reportDate || reportDate.length !== 10) {
            showToast('Введите дату в формате ГГГГ-ММ-ДД');
            return;
        }
        try {
            var res = await fetch(baseUrl + '/api/sick-leave/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegram_id: userId, report_date: reportDate })
            });
            var data = res.ok ? await res.json() : await res.json().then(function(j) { return j; }).catch(function() { return {}; });
            if (res.ok) {
                showToast(data.message || 'Больничный учтён');
                modal.style.display = 'none';
                loadProfileDutyStats();
            } else {
                showToast(data.detail || 'Ошибка');
            }
        } catch (e) {
            showToast('Ошибка сети');
        }
    });
})();

async function loadDutiesForMonth() {
    var container = document.getElementById('duties-list-container');
    if (!container) return;
    var monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    var monthEl = document.getElementById('current-month');
    if (monthEl) monthEl.textContent = monthNames[currentMonth - 1] + ' ' + currentYear;

    var ym = currentYear + '-' + String(currentMonth).padStart(2, '0');
    var hasData = dutyAvailableMonths.indexOf(ym) !== -1;
    var monthNav = document.getElementById('duty-month-nav');
    var tabs = document.getElementById('duty-tabs');
    var statsEl = document.getElementById('duties-month-stats');

    if (!hasData && dutyAvailableMonths.length === 0) {
        if (monthNav) monthNav.style.display = 'none';
        if (tabs) tabs.style.display = 'none';
        if (statsEl) statsEl.style.display = 'none';
        container.innerHTML = '<p style="color: #94A3B8; text-align: center; padding: 20px;">График нарядов ещё не загружен.<br/><small>Обратитесь к сержанту</small></p>';
        return;
    }
    if (monthNav) monthNav.style.display = 'flex';
    if (tabs) tabs.style.display = 'flex';

    try {
        var response = await fetch(baseUrl + '/api/duties?telegram_id=' + userId + '&month=' + currentMonth + '&year=' + currentYear);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var data = await response.json();

        if (data.error) {
            if (statsEl) statsEl.style.display = 'none';
            container.innerHTML = '<p style="color: #94A3B8; text-align: center; padding: 20px;">' + data.error + '</p>';
            return;
        }

        var today = new Date().toISOString().slice(0, 10);
        var duties = data.duties || [];
        var filtered;
        if (dutyCurrentTab === 'upcoming') {
            filtered = duties.filter(function(d) { return d.date >= today; });
        } else {
            filtered = duties.filter(function(d) { return d.date < today; });
        }

        if (statsEl) {
            var upcoming = duties.filter(function(d) { return d.date >= today; }).length;
            var past = duties.length - upcoming;
            statsEl.textContent = 'Всего: ' + duties.length + ' | Ожидается: ' + upcoming + ' | Завершённые: ' + past;
            statsEl.style.display = 'block';
        }

        if (filtered.length === 0) {
            container.innerHTML = '<p style="color: #64748B; text-align: center;padding:16px;">' + (dutyCurrentTab === 'upcoming' ? 'Нет нарядов в ожидании' : 'Нет завершённых нарядов') + '</p>';
            return;
        }

        var sorted = filtered.slice().sort(function(a, b) { return dutyCurrentTab === 'past' ? (b.date.localeCompare(a.date)) : (a.date.localeCompare(b.date)); });
        var html = '';
        sorted.forEach(function(duty) {
            var date = duty.date;
            var isPast = date < today;
            var role = (duty.role || '').replace(/"/g, '&quot;');
            html += '<div onclick="openDutyDetail(this.getAttribute(\'data-date\'), this.getAttribute(\'data-role\'))" data-date="' + date + '" data-role="' + role + '" style="background:' + (isPast ? '#1a2332' : '#1E293B') + ';border-radius:10px;padding:14px;margin-bottom:10px;cursor:pointer;border:1px solid #334155;border-left:4px solid #3B82F6;' + (isPast ? 'opacity:0.85;' : '') + '">';
            html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;">';
            html += '<div><span style="color:#93C5FD;font-size:15px;font-weight:600;">' + formatDate(date) + '</span>';
            html += ' <span style="color:#94A3B8;font-size:13px;">' + getDayOfWeek(date) + '</span></div>';
            html += '<span style="color:#CBD5E1;font-weight:500;">' + (duty.role_full || duty.role) + '</span>';
            html += '</div>';
            var pCount = duty.partners ? duty.partners.length : 0;
            if (pCount > 0) html += '<p style="color:#64748B;font-size:12px;margin:6px 0 0 0;">' + pCount + ' чел. в бригаде</p>';
            html += '</div>';
        });
        container.innerHTML = html;
    } catch (err) {
        console.error('Ошибка загрузки нарядов:', err);
        container.innerHTML = '<p style="color: #f87171;">Ошибка загрузки нарядов</p>';
    }
}

/**
 * Изменяет месяц для просмотра нарядов
 */
function changeMonth(delta) {
    if (dutyAvailableMonths.length > 0) {
        var ym = currentYear + '-' + String(currentMonth).padStart(2, '0');
        var idx = dutyAvailableMonths.indexOf(ym);
        var next = idx + delta;
        if (next >= 0 && next < dutyAvailableMonths.length) {
            var parts = dutyAvailableMonths[next].split('-');
            currentYear = parseInt(parts[0]);
            currentMonth = parseInt(parts[1]);
        } else if (delta > 0) {
            currentMonth += delta;
            if (currentMonth > 12) { currentMonth = 1; currentYear++; }
        } else {
            currentMonth += delta;
            if (currentMonth < 1) { currentMonth = 12; currentYear--; }
        }
    } else {
        currentMonth += delta;
        if (currentMonth > 12) { currentMonth = 1; currentYear++; }
        else if (currentMonth < 1) { currentMonth = 12; currentYear--; }
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
        const response = await fetch(`${baseUrl}/api/duties/by-date?date=${dateStr}&telegram_id=${userId}`);
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
        
        let html = '<h4 style="color:#93C5FD;margin:0 0 12px;">' + formatDate(dateStr) + ' — ' + data.total + ' чел.</h4>';
        
        Object.keys(data.by_role).forEach(function(role) {
            var roleFull = get_full_role(role) || role;
            var participants = data.by_role[role];
            
            html += '<div onclick="openDutyDetail(\'' + dateStr + '\',\'' + role + '\')" style="background:#1E293B;border-radius:8px;padding:12px;margin-bottom:8px;cursor:pointer;border-left:4px solid #3B82F6;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<span style="color:#CBD5E1;font-weight:600;">' + roleFull + '</span>';
            html += '<span style="color:#94A3B8;font-size:13px;">' + participants.length + ' чел. →</span>';
            html += '</div></div>';
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
        'к': 'Курс',
        'дк': 'Дежурный по курсу',
        'с': 'Столовая',
        'дс': 'Дежурный по столовой',
        'ад': 'Административный',
        'п': 'Патруль',
        'ж': 'Железо',
        'т': 'Тарелки',
        'кпп': 'КПП',
        'гбр': 'ГБР (Группа быстрого реагирования)',
        'зуб': 'ЗУБ',
        'ото': 'ОТО',
        'м': 'Медчасть',
        'путсо': 'ПУТСО'
    };
    return roles[roleCode.toLowerCase()] || roleCode.toUpperCase();
}
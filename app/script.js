// Глобальные переменные
let baseUrl = '';
let userId = null;
let userFio = null; // ФИО текущего пользователя
let tasks = [];
const taskMap = {};

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

    await loadUserProfile(userId);
    await loadDuties(userId);
    await loadSurveyResults(); // Загружаем результаты опроса, если пользователь уже прошёл его
});

let currentTab = 'home';
let currentMonth = new Date().getMonth() + 1; // 1-12
let currentYear = new Date().getFullYear();

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

    const mainContent = document.getElementById('main-content');
    const notesScreen = document.getElementById('notes-screen');
    const dutiesScreen = document.getElementById('duties-screen');
    const studyScreen = document.getElementById('study-screen');
    const surveyScreen = document.getElementById('survey-screen');
    const addFab = document.getElementById('add-task-fab');

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
        loadDutiesForMonth(); // Загружаем наряды на текущий месяц
    } else if (tabName === 'study') {
        if (studyScreen) studyScreen.style.display = 'block';
    } else if (tabName === 'survey') {
        if (surveyScreen) surveyScreen.style.display = 'block';
        // Проверяем, прошёл ли пользователь уже опрос
        loadSurveyObjects(); // загружаем список объектов для опроса
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

        const fullName = data.full_name || "—";
        if (userNameEl) userNameEl.textContent = fullName;
        if (userCourseEl) userCourseEl.textContent = `Курс: ${data.course || "—"}`;
        if (userGroupEl) userGroupEl.textContent = `Группа: ${data.group || "—"}`;
        
        // Сохраняем ФИО для использования в других функциях
        userFio = fullName;

        console.log("✅ Профиль загружен:", fullName);
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

        // Правильная группировка: сначала находим все родительские объекты
        const parents = objects.filter(obj => obj.parent_id === null);
        const childrenMap = {};
        
        // Группируем дочерние объекты по parent_id
        objects.forEach(obj => {
            if (obj.parent_id !== null) {
                if (!childrenMap[obj.parent_id]) {
                    childrenMap[obj.parent_id] = [];
                }
                childrenMap[obj.parent_id].push(obj);
            }
        });

        let html = '';
        
        // Выводим только родительские объекты с их детьми
        parents.forEach(parent => {
            // Заголовок категории (родитель)
            html += `<h3 style="color: #93C5FD; margin: 24px 0 12px 0; font-size: 18px; font-weight: 600;">${parent.name}</h3>`;
            
            // Дочерние объекты этой категории
            const children = childrenMap[parent.id] || [];
            if (children.length === 0) {
                html += `<p style="color: #64748B; font-style: italic; margin-bottom: 12px;">Нет подобъектов для оценки</p>`;
            } else {
                children.forEach(child => {
                    html += `
                        <div style="display: flex; align-items: center; justify-content: space-between; background: #1E293B; padding: 12px; border-radius: 8px; margin-bottom: 8px; border-left: 3px solid #3B82F6;">
                            <span style="color: #CBD5E1; font-size: 14px;">${child.name}</span>
                            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                ${[1,2,3,4,5].map(i => `
                                    <label style="color: #94A3B8; cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: background 0.2s;">
                                        <input type="radio" name="obj_${child.id}" value="${i}" style="margin-right: 4px; cursor: pointer;"> ${i}
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    `;
                });
            }
        });
        
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
            let lastResult = null;
            let allSuccess = true;
            
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
                        allSuccess = false;
                        break;
                    }
                    lastResult = await res.json();
                } catch (err) {
                    console.error(err);
                    alert('Ошибка сети');
                    allSuccess = false;
                    break;
                }
            }
            
            if (allSuccess && lastResult) {
                const message = lastResult.total_voted >= 100 
                    ? 'Спасибо! Ваши оценки сохранены.\n\n✅ Опрос завершён! Медианы рассчитаны автоматически.'
                    : `Спасибо! Ваши оценки сохранены.\n\nПроголосовало: ${lastResult.total_voted} человек`;
                alert(message);
                // Перезагружаем результаты опроса для показа
                await loadSurveyResults();
            } else if (allSuccess) {
                alert('Спасибо! Ваши оценки сохранены.');
            }
            // Можно переключиться на другой экран
            switchTab('home');
        };
    } catch (err) {
        console.error('❌ Ошибка загрузки объектов:', err);
        container.innerHTML = '<p style="color: #f87171;">Ошибка загрузки опроса</p>';
    }
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
        
        // Фильтруем только те объекты, которые пользователь оценил (имеют user_rating)
        const votedObjects = data.results.filter(r => r.user_rating !== null && r.parent_id !== null);
        
        if (votedObjects.length === 0) {
            return; // Пользователь не оценил ни одного объекта
        }
        
        // Группируем по родителям
        const parentsMap = {};
        votedObjects.forEach(obj => {
            if (!parentsMap[obj.parent_id]) {
                parentsMap[obj.parent_id] = [];
            }
            parentsMap[obj.parent_id].push(obj);
        });
        
        // Получаем названия родителей
        const parentNames = {};
        data.results.forEach(r => {
            if (r.parent_id === null) {
                parentNames[r.id] = r.name;
            }
        });
        
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
        html += '<p style="color: #94A3B8; font-size: 14px; margin-bottom: 12px;">Ваши оценки и медианы по объектам:</p>';
        
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
            
            if (avgMedian) {
                const explanation = getDifficultyExplanation(parseFloat(avgMedian));
                html += `<p style="color: #94A3B8; font-size: 13px; margin: 0 0 12px 0; font-style: italic;">${explanation}</p>`;
            }
            
            children.forEach(child => {
                const userRating = child.user_rating ? `Ваша оценка: ${child.user_rating}` : '';
                const median = child.median_weight ? `Медиана: ${child.median_weight.toFixed(1)}` : 'Медиана ещё не рассчитана';
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #0f172a; border-radius: 6px; margin-bottom: 6px;">
                        <span style="color: #CBD5E1; font-weight: 500;">${child.name}</span>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                            <span style="color: #3B82F6; font-size: 13px;">${userRating}</span>
                            <span style="color: #94A3B8; font-size: 12px;">${median}</span>
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
        });
        
        resultsWidget.innerHTML = html;
        console.log('✅ Результаты опроса загружены');
    } catch (err) {
        console.error('❌ Ошибка загрузки результатов опроса:', err);
    }
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
    alert("🔔 Уведомления\n(в разработке)");
}

function openSettings() {
    alert("⚙️ Настройки\n(в разработке)");
}

// === ФУНКЦИИ ДЛЯ РАБОТЫ С НАРЯДАМИ ===

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
            container.innerHTML = `<p style="color: #f87171;">Ошибка: ${data.error}</p>`;
            return;
        }
        
        // Обновляем заголовок месяца
        const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                           'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        document.getElementById('current-month').textContent = `${monthNames[currentMonth - 1]} ${currentYear}`;
        
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
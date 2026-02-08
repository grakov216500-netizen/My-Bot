// app/script.js — финальная версия (с отображением профиля)

document.addEventListener('DOMContentLoaded', async () => {
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
        // 🔧 Режим тестирования: подставляем ваш ID
        userId = 1027070834; // Замените на ID из schedules.json
        console.log("🔧 Тестовый режим: userId =", userId);
    }

    console.log("✅ Загружаем данные для пользователя:", userId);

    // Показываем загрузку
    const widget = document.getElementById('next-duty-widget');
    if (widget) {
        widget.innerHTML = '<p>Загрузка данных...</p>';
    }

    // Загружаем профиль и наряды
    await loadUserProfile(userId);
    await loadDuties(userId);
});

/**
 * Показывает ошибку в виджете
 */
function showError(message) {
    const widget = document.getElementById('next-duty-widget');
    if (widget) {
        widget.innerHTML = `<p style="color: #f87171;">Ошибка: ${message}</p>`;
    }
    console.error("❌", message);
}

/**
 * Загружает профиль пользователя
 */
async function loadUserProfile(userId) {
    try {
        const response = await fetch(`/api/user?telegram_id=${userId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            console.warn("⚠️ Ошибка при загрузке профиля:", data.error);
            return;
        }

        // Обновляем аватарку
        const avatar = document.querySelector('.avatar');
        if (avatar) {
            const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.fio)}&background=3B82F6&color=fff`;
            avatar.src = avatarUrl;
        }

        // ✅ Обновляем текст профиля
        const userNameEl = document.getElementById('userName');
        const userCourseEl = document.getElementById('userCourse');
        const userGroupEl = document.getElementById('userGroup');

        if (userNameEl) userNameEl.textContent = data.fio;
        if (userCourseEl) userCourseEl.textContent = `Курс: ${data.course}`;
        if (userGroupEl) userGroupEl.textContent = `Группа: ${data.group}`;

        console.log("✅ Профиль загружен:", data.fio);
    } catch (err) {
        console.error("❌ Ошибка загрузки профиля:", err);
    }
}

/**
 * Загружает наряды пользователя
 */
async function loadDuties(userId) {
    try {
        const response = await fetch(`/api/duties?telegram_id=${userId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

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

/**
 * Считает дни до даты
 */
function getDaysLeft(dateStr) {
    const today = new Date();
    const date = new Date(dateStr);
    const diffTime = date - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

/**
 * Форматирует дату
 */
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

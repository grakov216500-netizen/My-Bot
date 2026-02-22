# handlers/start.py — для зарегистрированных то же меню, что в menu.py: только «Панель управления»

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from telegram.ext import ContextTypes, CommandHandler
from database import get_db, update_user_last_active
from utils.welcome_message import get_welcome_message
from utils.course_calculator import get_course_info
import logging

logger = logging.getLogger(__name__)

ROLE_DISPLAY = {
    'user': 'Курсант',
    'sergeant': 'Сержант',
    'assistant': 'Помощник',
    'admin': 'Администратор'
}

# Тот же URL Mini App, что в menu.py (держать в синхронизации)
MINI_APP_URL = "https://a4220cdc-b701-409a-9723-28a99a5e90f8/app"

async def start_command_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик команды /start"""
    user_id = update.effective_user.id
    first_name = update.effective_user.first_name

    # Обновляем время последней активности
    try:
        update_user_last_active(user_id)
    except Exception as e:
        logger.warning(f"⚠️ Не удалось обновить last_active для {user_id}: {e}")

    # Проверяем, зарегистрирован ли пользователь
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (user_id,))
        user_row = cursor.fetchone()
        conn.close()
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке пользователя {user_id} в БД: {e}")
        try:
            await update.message.reply_text("Произошла ошибка. Попробуйте позже.")
        except:
            pass
        return

    if user_row:
        # Преобразуем в словарь
        user_dict = dict(user_row)
        
        # Извлекаем данные
        enrollment_year = user_dict.get('enrollment_year', 2023)
        fio = user_dict.get('fio', 'Не указано')
        faculty = user_dict.get('faculty', 'Не указано')
        group_name = user_dict.get('group_name', 'Не указано')
        role = user_dict.get('role', 'user')
        
        # Получаем информацию о курсе
        try:
            course_info = get_course_info(enrollment_year)
        except Exception as e:
            logger.error(f"❌ Ошибка в get_course_info для {user_id}: {e}")
            course_info = {'current': '?', 'status': 'неизвестно'}

        # Отображаемая роль
        role_display = ROLE_DISPLAY.get(role, "Курсант")

        welcome_text = (
            f"👋 С возвращением, {fio.split()[0]}!\n\n"
            f"Группа: {group_name} · Курс: {course_info['current']} · Роль: {role_display}\n\n"
            "Откройте панель управления для нарядов, задач и опросов."
        )

        keyboard = [[InlineKeyboardButton("🖥️ Панель управления", web_app=WebAppInfo(url=MINI_APP_URL))]]
        if role == 'admin':
            keyboard.append([InlineKeyboardButton("⚙️ Админ-панель", callback_data="admin_panel")])

        # Отправляем сообщение с защитой от блокировки
        try:
            await update.message.reply_text(
                welcome_text,
                reply_markup=InlineKeyboardMarkup(keyboard),
                parse_mode='HTML'
            )
        except Exception as e:
            if "Forbidden: bot was blocked by the user" in str(e):
                logger.warning(f"🚫 Пользователь {user_id} заблокировал бота. Не удалось отправить /start.")
            else:
                logger.error(f"❌ Ошибка при отправке /start пользователю {user_id}: {e}", exc_info=True)
    else:
        # Новый пользователь
        welcome_text = get_welcome_message()

        keyboard = [[InlineKeyboardButton("🚀 Начать регистрацию", callback_data="start_registration")]]

        try:
            await update.message.reply_text(
                welcome_text,
                reply_markup=InlineKeyboardMarkup(keyboard),
                parse_mode='HTML'
            )
        except Exception as e:
            if "Forbidden: bot was blocked by the user" in str(e):
                logger.warning(f"🚫 Пользователь {user_id} заблокировал бота. Не удалось отправить приветствие.")
            else:
                logger.error(f"❌ Ошибка при отправке стартового сообщения {user_id}: {e}", exc_info=True)

# Экспортируем обработчик
router = [CommandHandler("start", start_command_handler)]

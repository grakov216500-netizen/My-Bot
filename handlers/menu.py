# handlers/menu.py — обновлённая версия с Mini App

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo  # ← Добавлен WebAppInfo
from telegram.ext import ContextTypes, CallbackQueryHandler
from database import get_db, update_user_last_active
from utils.course_calculator import get_course_info
import logging

logger = logging.getLogger(__name__)

# === Константы ===
COMMANDIR_ID = 1027070834
COMMANDIR_NAME = "Граков Виктор"

# === ПОЛУЧЕНИЕ РОЛИ ИЗ bot_data['editors'] ===
def get_user_role(user_id: int, context: ContextTypes.DEFAULT_TYPE) -> str:
    editors = context.application.bot_data.get('editors', {})
    return editors.get(user_id, {}).get('role', 'user')

# === ЗАГРУЗКА ПОЛЬЗОВАТЕЛЯ ===
def load_user_data(user_id: int):
    conn = get_db()
    cursor = conn.cursor()
    
    # Сначала пробуем новую таблицу
    cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (user_id,))
    user_row = cursor.fetchone()
    
    user_dict = None
    
    if user_row:
        user_dict = dict(user_row)
    else:
        # Пробуем старую таблицу
        cursor.execute("SELECT full_name, group_num FROM old_users WHERE user_id = ?", (user_id,))
        old_user = cursor.fetchone()
        if old_user:
            old_user_dict = dict(old_user)
            user_dict = {
                'fio': old_user_dict.get('full_name', 'Не указано'),
                'group_name': old_user_dict.get('group_num', 'Не указано'),
                'faculty': 'Инженерно-технический',
                'enrollment_year': 2023,
                'role': 'курсант'
            }
    
    conn.close()
    return user_dict

# === ОТКРЫТИЕ ГЛАВНОГО МЕНЮ ===
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    
    # Обновляем активность
    update_user_last_active(user_id)
    
    user = load_user_data(user_id)
    
    if not user:
        # Не зарегистрирован
        keyboard = [
            [InlineKeyboardButton("🚀 Начать регистрацию", callback_data="start_registration")]
        ]
        
        text = (
            "Добро пожаловать в систему электронного помощника курсанта ведомственного института.\n\n"
            "Вы ещё не зарегистрированы.\n\n"
            "Нажмите кнопку ниже, чтобы начать регистрацию и получить доступ ко всем функциям:"
        )
    else:
        # Зарегистрирован
        enrollment_year = user.get('enrollment_year', 2023)
        course_info = get_course_info(enrollment_year)
        
        fio = user.get('fio', 'Не указано')
        first_name = fio.split()[0] if fio and len(fio.split()) > 0 else 'Пользователь'
        
        # Получаем актуальную роль из bot_data
        role_key = get_user_role(user_id, context)  # 'admin', 'sergeant', 'user'
        
        ROLE_TITLES = {
            'admin': 'Администратор',
            'assistant': 'Помощник',
            'sergeant': 'Сержант',
            'user': 'Курсант'
        }
        role_display = ROLE_TITLES.get(role_key, 'Курсант')

        text = f"🏠 <b>Главное меню</b>\n\nДобро пожаловать, {first_name}!\n"
        text += f"<b>Ваши данные:</b>\n"
        text += f"• Факультет: {user.get('faculty', 'Не указано')}\n"
        text += f"• Группа: {user.get('group_name', 'Не указано')}\n"
        text += f"• Курс: {course_info['current']}\n"
        text += f"• Роль: {role_display}\n\n"
        
        text += "Я помогу вам:\n"
        text += "• 📋 <b>Видеть свои наряды</b>, просматривая графики.\n"
        text += "• ✅ <b>Вести личный список задач</b>.\n"
        text += "• 📚 <b>Организовать учебный процесс</b>.\n"
        text += "• 👤 <b>Управлять профилем</b> и личными данными.\n\n"
        
        keyboard = [
            [InlineKeyboardButton("📋 Мои наряды", callback_data="my_duties")],
            [InlineKeyboardButton("📝 Мои задачи", callback_data="menu_tasks")],
            [InlineKeyboardButton("👤 Мой профиль", callback_data="my_profile")],
            [InlineKeyboardButton("❓ Помощь", callback_data="help")],
            # --- НОВАЯ КНОПКА ---
            [InlineKeyboardButton("🖥️ Панель управления", web_app=WebAppInfo(url="https://grakov216500-netizen.github.io/my-bot/app"))]
        ]
        
        # 🔐 Админ-панель — только для админа
        if role_key == 'admin':
            keyboard.append([InlineKeyboardButton("⚙️ Админ-панель", callback_data="admin_panel")])

    # Отправка сообщения
    if update.callback_query:
        try:
            await update.callback_query.edit_message_text(
                text,
                reply_markup=InlineKeyboardMarkup(keyboard),
                parse_mode="HTML"
            )
            await update.callback_query.answer()
        except Exception as e:
            logger.error(f"Ошибка при редактировании сообщения: {e}")
            # Резерв: отправить новое
            await update.callback_query.message.reply_text(
                text,
                reply_markup=InlineKeyboardMarkup(keyboard),
                parse_mode="HTML"
            )
    else:
        await update.message.reply_text(
            text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )

# === КНОПКИ ===
async def back_to_main(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await start_command(update, context)

async def open_tasks_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    # 🔐 Проверка: зарегистрирован ли пользователь?
    user_id = update.effective_user.id
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT fio FROM users WHERE telegram_id = ?", (user_id,))
    user = cursor.fetchone()
    conn.close()

    if not user:
        await query.edit_message_text(
            "❌ Вы не зарегистрированы.\n\n"
            "Сначала пройдите регистрацию:",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🚀 Начать", callback_data="start_registration")]
            ]),
            parse_mode="HTML"
        )
        return

    # Если зарегистрирован — открываем задачи
    from handlers.tasks import task_list_tasks
    await task_list_tasks(update, context)

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    help_text = (
        "📚 <b>Справка по использованию бота:</b>\n\n"
        "Основные функции:\n"
        "• <b>Мои наряды</b> - просмотр ваших нарядов на текущий месяц\n"
        "• <b>Мои задачи</b> - создание и управление личным списком задач\n"
        "• <b>Мой профиль</b> - просмотр и редактирование ваших данных\n\n"
        
        "Для сержантов:\n"
        "• <b>Загрузить график</b> — теперь в разделе «Мои наряды»\n\n"
        
        "<b>Основные команды:</b>\n"
        "/start - Главное меню\n"
        "/help - Эта справка\n"
        "/register - Регистрация (если еще не зарегистрированы)\n"
        "/menu - Альтернативный вход в меню\n\n"
        
        "<b>Версия:</b> 1.0\n"
        "<b>Разработчик:</b> Команда ведомственного института"
    )
    
    keyboard = [[InlineKeyboardButton("🏠 В главное меню", callback_data="back_to_main")]]
    
    await query.edit_message_text(
        help_text,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode='HTML'
    )

# === ЭКСПОРТ ===
router = [
    CallbackQueryHandler(open_tasks_menu, pattern="^menu_tasks$"),
    CallbackQueryHandler(help_command, pattern="^help$"),
    CallbackQueryHandler(back_to_main, pattern="^back_to_main$")
]

back_router = CallbackQueryHandler(back_to_main, pattern="^back_to_main$")

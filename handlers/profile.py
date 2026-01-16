# handlers/profile.py — обновлённый профиль с поддержкой группы+года

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, CallbackQueryHandler, MessageHandler, filters, ConversationHandler
from database import get_db, update_user_last_active
from utils.course_calculator import get_course_info
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

# Состояния для редактирования
EDIT_FIO, EDIT_GROUP = range(2)

# === ОТОБРАЖЕНИЕ РОЛЕЙ (для интерфейса) ===
ROLE_TITLES = {
    'admin': 'Администратор',
    'assistant': 'Помощник',
    'sergeant': 'Сержант',
    'user': 'Курсант'
}

ROLE_ICONS = {
    'admin': '👑',
    'assistant': '🛠️',
    'sergeant': '🎖️',
    'user': '👤'
}

# ===== ПРОСМОТР ПРОФИЛЯ =====
async def show_profile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user_id = update.effective_user.id

    if query:
        await query.answer()

    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (user_id,))
        user = cursor.fetchone()
        conn.close()

        if not user:
            text = "❌ Вы не зарегистрированы. Используйте /start для регистрации."
            keyboard = [[InlineKeyboardButton("🚀 Начать регистрацию", callback_data="start_registration")]]
            if query:
                await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
            else:
                await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
            return

        # Получаем информацию о курсе
        course_info = get_course_info(user['enrollment_year'])

        # Формируем отображаемую роль
        role_title = ROLE_TITLES.get(user['role'], "Неизвестно")
        role_icon = ROLE_ICONS.get(user['role'], "👤")
        status_emoji = "🟢" if user['status'] == 'активен' else "🔴"

        # Формируем текст профиля
        profile_text = (
            f"{role_icon} <b>Ваш профиль</b>\n\n"
            f"<b>ФИО:</b> {user['fio']}\n"
            f"<b>Факультет:</b> {user['faculty']}\n"
            f"<b>Группа:</b> {user['group_name']}"
        )

        if user['is_custom_group']:
            profile_text += " <i>(введена вручную)</i>"

        profile_text += (
            f"\n<b>Год поступления:</b> {user['enrollment_year']}\n"
            f"<b>Текущий курс:</b> {course_info['current']}\n"
            f"<b>Роль:</b> {role_title}\n"
            f"<b>Статус:</b> {status_emoji} {user['status']}\n"
            f"<b>Зарегистрирован:</b> {user['created_at'][:10]}"
        )

        if user['last_active']:
            profile_text += f"\n<b>Последняя активность:</b> {user['last_active'][:10]}"

        # Проверяем, можно ли редактировать
        can_edit = await can_user_edit_profile(user)

        # Клавиатура
        keyboard = []

        if can_edit:
            keyboard.append([InlineKeyboardButton("✏️ Изменить ФИО", callback_data="edit_fio")])
            keyboard.append([InlineKeyboardButton("🏫 Изменить группу", callback_data="edit_group")])

        keyboard.append([InlineKeyboardButton("⬅️ Назад в меню", callback_data="back_to_main")])

        if query:
            await query.edit_message_text(
                profile_text,
                reply_markup=InlineKeyboardMarkup(keyboard),
                parse_mode='HTML'
            )
        else:
            await update.message.reply_text(
                profile_text,
                reply_markup=InlineKeyboardMarkup(keyboard),
                parse_mode='HTML'
            )
    except Exception as e:
        logger.error(f"❌ Ошибка при отображении профиля: {e}", exc_info=True)
        if query:
            await query.edit_message_text("❌ Ошибка при загрузке профиля.")
        else:
            await update.message.reply_text("❌ Ошибка при загрузке профиля.")


# Проверка — может ли пользователь редактировать профиль
async def can_user_edit_profile(user_row) -> bool:
    try:
        created_at = datetime.fromisoformat(user_row['created_at'])
        now = datetime.now()
        time_diff = now - created_at
        hours_passed = time_diff.total_seconds() / 3600

        # Администратор и помощник — всегда могут редактировать
        if user_row['role'] in ['admin', 'assistant']:
            return True

        # Сержант и курсант — только первые 48 часов
        return hours_passed <= 48
    except Exception as e:
        logger.error(f"❌ Ошибка проверки прав на редактирование: {e}")
        return False


# ===== РЕДАКТИРОВАНИЕ ФИО =====
async def edit_fio_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user_id = update.effective_user.id
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (user_id,))
    user = cursor.fetchone()
    conn.close()

    if not user:
        await query.edit_message_text("❌ Пользователь не найден.")
        return ConversationHandler.END

    # Проверяем право
    if not await can_user_edit_profile(user):
        await query.edit_message_text(
            "🔒 Редактирование профиля доступно только в течение первых 48 часов после регистрации.\n\n"
            "Обратитесь к администратору, если нужно изменить данные.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⬅️ Назад", callback_data="my_profile")]
            ])
        )
        return ConversationHandler.END

    await query.edit_message_text(
        "✏️ Введите новое ФИО:\n"
        "<i>Формат: Фамилия Имя Отчество</i>",
        parse_mode='HTML'
    )
    return EDIT_FIO


async def edit_fio_save(update: Update, context: ContextTypes.DEFAULT_TYPE):
    new_fio = update.message.text.strip()
    parts = new_fio.split()
    if len(parts) < 2:
        await update.message.reply_text(
            "❌ Пожалуйста, введите ФИО полностью (минимум Фамилия и Имя).\n"
            "Попробуйте ещё раз:"
        )
        return EDIT_FIO

    user_id = update.effective_user.id
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Обновляем основную таблицу
        cursor.execute(
            "UPDATE users SET fio = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?",
            (new_fio, user_id)
        )

        # Обновляем old_users (если есть)
        cursor.execute(
            "UPDATE old_users SET full_name = ? WHERE user_id = ?",
            (new_fio, user_id)
        )

        conn.commit()
        logger.info(f"✅ ФИО обновлено: {user_id} → {new_fio}")
    except Exception as e:
        logger.error(f"❌ Ошибка при обновлении ФИО: {e}", exc_info=True)
        await update.message.reply_text("❌ Ошибка при сохранении. Попробуйте позже.")
        return ConversationHandler.END
    finally:
        if conn:
            conn.close()

    update_user_last_active(user_id)

    await update.message.reply_text(
        f"✅ <b>ФИО успешно изменено:</b> {new_fio}",
        parse_mode='HTML'
    )

    # Показываем обновлённый профиль
    await show_profile(update, context)
    return ConversationHandler.END


# ===== РЕДАКТИРОВАНИЕ ГРУППЫ =====
async def edit_group_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user_id = update.effective_user.id
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (user_id,))
    user = cursor.fetchone()

    if not user:
        await query.edit_message_text("❌ Пользователь не найден.")
        return ConversationHandler.END

    if not await can_user_edit_profile(user):
        await query.edit_message_text(
            "🔒 Изменение группы недоступно.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⬅️ Назад", callback_data="my_profile")]
            ])
        )
        return ConversationHandler.END

    current_group = user['group_name']
    conn.close()

    await query.edit_message_text(
        f"🏫 <b>Текущая группа:</b> {current_group}\n\n"
        "Введите новое название группы (до 20 символов):",
        parse_mode='HTML'
    )
    return EDIT_GROUP


async def edit_group_save(update: Update, context: ContextTypes.DEFAULT_TYPE):
    new_group = update.message.text.strip().upper()

    if not new_group or len(new_group) > 20:
        await update.message.reply_text(
            "❌ Название группы должно быть от 1 до 20 символов.\n"
            "Попробуйте ещё раз:"
        )
        return EDIT_GROUP

    user_id = update.effective_user.id
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Получаем текущий год и роль
        cursor.execute("SELECT role, enrollment_year FROM users WHERE telegram_id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            await update.message.reply_text("❌ Профиль не найден.")
            return ConversationHandler.END

        user_role = row['role']
        year = row['enrollment_year']

        # Проверяем: есть ли уже сержант в этой группе и году?
        if user_role != 'sergeant':
            cursor.execute("""
                SELECT fio FROM users 
                WHERE group_name = ? AND enrollment_year = ? AND role = 'sergeant' AND telegram_id != ?
            """, (new_group, year, user_id))
            existing_sergeant = cursor.fetchone()
            if existing_sergeant:
                await update.message.reply_text(
                    f"❌ В группе <b>{new_group}</b> ({year} г.) уже есть сержант: <code>{existing_sergeant['fio']}</code>\n"
                    "Нельзя быть в группе с другим сержантом.\n\n"
                    "Выберите другое название группы.",
                    parse_mode="HTML"
                )
                return EDIT_GROUP

        # Проверка других ролей (admin/assistant) — только если пользователь сам один из них
        if user_role in ['admin', 'assistant']:
            cursor.execute("""
                SELECT fio, role FROM users 
                WHERE group_name = ? AND telegram_id != ? AND role IN ('admin', 'assistant')
            """, (new_group, user_id))
            existing_admins = cursor.fetchall()
            if existing_admins:
                conflict = existing_admins[0]
                await update.message.reply_text(
                    f"❌ В группе <b>{new_group}</b> уже есть {ROLE_TITLES[conflict['role']]}: <code>{conflict['fio']}</code>\n"
                    "Выберите другое название.",
                    parse_mode="HTML"
                )
                return EDIT_GROUP

        # Сохраняем
        await save_group(update, context, new_group, conn)
        return ConversationHandler.END

    except Exception as e:
        logger.error(f"❌ Ошибка при смене группы: {e}", exc_info=True)
        await update.message.reply_text("❌ Ошибка при сохранении. Попробуйте позже.")
        if conn:
            conn.close()
        return ConversationHandler.END


async def save_group(update: Update, context: ContextTypes.DEFAULT_TYPE, group: str, conn):
    user_id = update.effective_user.id
    cursor = conn.cursor()

    # Обновляем группу
    cursor.execute(
        "UPDATE users SET group_name = ?, is_custom_group = 1, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?",
        (group, user_id)
    )

    # Обновляем old_users
    cursor.execute(
        "UPDATE old_users SET group_num = ? WHERE user_id = ?",
        (group, user_id)
    )
    conn.commit()
    conn.close()

    update_user_last_active(user_id)

    await update.message.reply_text(
        f"✅ <b>Группа успешно изменена:</b> {group}",
        parse_mode='HTML'
    )

    # Показываем профиль
    await show_profile(update, context)


# ===== ПОДТВЕРЖДЕНИЕ СМЕНЫ ГРУППЫ (если нужно) =====
# Сейчас не используется — но можно оставить для будущего
async def confirm_group_change(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    new_group = context.user_data.get('pending_group')
    if not new_group:
        await query.edit_message_text("❌ Ошибка: данные утеряны.")
        return

    conn = get_db()
    await save_group(update, context, new_group, conn)


# ===== СОЗДАНИЕ CONVERSATION HANDLER =====
def get_profile_edit_handler():
    return ConversationHandler(
        entry_points=[
            CallbackQueryHandler(edit_fio_start, pattern='^edit_fio$'),
            CallbackQueryHandler(edit_group_start, pattern='^edit_group$')
        ],
        states={
            EDIT_FIO: [MessageHandler(filters.TEXT & ~filters.COMMAND, edit_fio_save)],
            EDIT_GROUP: [MessageHandler(filters.TEXT & ~filters.COMMAND, edit_group_save)]
        },
        fallbacks=[
            CallbackQueryHandler(show_profile, pattern='^cancel_edit$'),
            CallbackQueryHandler(confirm_group_change, pattern='^confirm_group_change$')
        ],
        allow_reentry=True
    )


# ===== ЭКСПОРТ =====
profile_router = [
    CallbackQueryHandler(show_profile, pattern='^my_profile$'),
    CallbackQueryHandler(show_profile, pattern='^profile$')
]

__all__ = ['profile_router', 'get_profile_edit_handler']

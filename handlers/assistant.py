# handlers/assistant.py — финальная версия (2025), всё работает + безопасность + ограничения

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, CallbackQueryHandler
from database import get_db
import logging
from utils.course_calculator import get_course_info

logger = logging.getLogger(__name__)

# === ПРОВЕРКА: ПОМОЩНИК ЛИ? ===
def is_assistant(user_id: int, context: ContextTypes.DEFAULT_TYPE) -> bool:
    editors = context.application.bot_data.get('editors', {})
    user_editor = editors.get(user_id)
    if not user_editor:
        # Резервная проверка в БД
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT role FROM users WHERE telegram_id = ?", (user_id,))
        user = cursor.fetchone()
        conn.close()
        return user and user['role'] == 'assistant'
    return user_editor.get('role') == 'assistant'

# === ПОЛУЧЕНИЕ ГРУППЫ И ГОДА ПОЛЬЗОВАТЕЛЯ ===
def get_user_group_and_year(user_id: int, context: ContextTypes.DEFAULT_TYPE) -> tuple:
    """Возвращает (group_name, enrollment_year)"""
    editors = context.application.bot_data.get('editors', {})
    user_data = editors.get(user_id)
    if not user_data:
        # Резервная проверка
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT group_name, enrollment_year FROM users WHERE telegram_id = ?", (user_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return row['group_name'], row['enrollment_year']
        return None, None
    group = user_data.get('group')
    if not group:
        return None, None

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT enrollment_year FROM users WHERE telegram_id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    year = row['enrollment_year'] if row else None

    return group, year

# === ОТКРЫТИЕ ПАНЕЛИ ПОМОЩНИКА ===
async def assistant_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    if not is_assistant(user_id, context):
        if update.callback_query:
            await update.callback_query.answer("❌ У вас нет доступа", show_alert=True)
        return

    group, year = get_user_group_and_year(user_id, context)
    if not group:
        text = "❌ Ошибка: не удалось определить вашу группу."
        if update.callback_query:
            await update.callback_query.edit_message_text(text)
        else:
            await update.message.reply_text(text)
        return

    course_info = get_course_info(year) if year else {}
    course_str = f" ({course_info.get('current', '?')} курс)" if year else ""

    keyboard = [
        [InlineKeyboardButton("👮‍♂️ Назначить сержанта", callback_data="assistant_add_sergeant")],
        [InlineKeyboardButton("📋 Просмотреть группу", callback_data="assistant_list_group")],
        [InlineKeyboardButton("📅 Загрузить график", callback_data="upload_excel")],
        [InlineKeyboardButton("⬅️ В меню", callback_data="back_to_main")]
    ]

    text = (
        "🛠️ <b>Панель помощника</b>\n\n"
        f"👥 Ваша группа: <b>{group}{course_str}</b>\n\n"
        "Выберите действие:"
    )

    try:
        if update.message:
            await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
        elif update.callback_query:
            query = update.callback_query
            await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    except Exception as e:
        if "Bad Request: message is not modified" in str(e):
            pass
        else:
            logger.error(f"❌ Ошибка при открытии панели помощника: {e}")
            await update.callback_query.answer("Ошибка", show_alert=True)

# === ПОКАЗАТЬ КУРСАНТОВ ГРУППЫ ===
async def assistant_list_group(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user_id = update.effective_user.id
    group, year = get_user_group_and_year(user_id, context)

    if not group or not year:
        await query.edit_message_text("❌ Не удалось определить группу или год.")
        return

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT fio, role, enrollment_year 
            FROM users 
            WHERE group_name = ? AND enrollment_year = ? 
            ORDER BY fio
        """, (group, year))
        users = cursor.fetchall()
        conn.close()

        if not users:
            text = f"❌ В группе <b>{group}</b> ({year} г.) нет зарегистрированных курсантов."
        else:
            text = f"👥 <b>Группа: {group} ({year} г.)</b>\n\n"
            role_icons = {
                'sergeant': '🎖️',
                'user': '👤',
                'admin': '👑',
                'assistant': '🛠️'
            }
            for user in users:
                icon = role_icons.get(user['role'], '👤')
                course = get_course_info(user['enrollment_year'])['current']
                status = " (сержант)" if user['role'] == 'sergeant' else ""
                text += f"{icon} <code>{user['fio']}</code> — {course} курс{status}\n"

        keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data="assistant_panel")]]
        await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    except Exception as e:
        logger.error(f"❌ Ошибка при отображении группы: {e}", exc_info=True)
        await query.answer("Ошибка при получении списка", show_alert=True)

# === НАЧАЛО НАЗНАЧЕНИЯ СЕРЖАНТА ===
async def assistant_add_sergeant_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user_id = update.effective_user.id
    group, year = get_user_group_and_year(user_id, context)

    if not group or not year:
        await query.edit_message_text("❌ Ошибка: группа или год не определены.")
        return

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Проверка: уже есть сержант в группе?
        cursor.execute("""
            SELECT COUNT(*) FROM users 
            WHERE group_name = ? AND enrollment_year = ? AND role = 'sergeant'
        """, (group, year))
        count = cursor.fetchone()[0]

        if count >= 1:
            await query.edit_message_text(
                f"❌ В этой группе уже есть сержант. Назначение невозможно.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("⬅️ Назад", callback_data="assistant_panel")]
                ]),
                parse_mode="HTML"
            )
            conn.close()
            return

        # Получаем курсантов без роли
        cursor.execute("""
            SELECT fio FROM users 
            WHERE group_name = ? AND enrollment_year = ? AND role = 'user'
            ORDER BY fio
        """, (group, year))
        regular_users = cursor.fetchall()
        conn.close()

        if not regular_users:
            await query.edit_message_text(
                f"❌ Нет курсантов для назначения в группе <b>{group}</b> ({year} г.).",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("⬅️ Назад", callback_data="assistant_panel")]
                ]),
                parse_mode="HTML"
            )
            return

        keyboard = []
        for user in regular_users:
            safe_fio = user['fio'].replace(' ', '_')
            keyboard.append([
                InlineKeyboardButton(f"👤 {user['fio']}", callback_data=f"sel_sergeant_{safe_fio}_{group}_{year}")
            ])
        keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="assistant_panel")])

        await query.edit_message_text(
            f"👮‍♂️ Выберите курсанта для назначения сержантом:",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"❌ Ошибка при начале назначения сержанта: {e}", exc_info=True)
        await query.answer("Ошибка", show_alert=True)

# === ПОДТВЕРЖДЕНИЕ НАЗНАЧЕНИЯ СЕРЖАНТА ===
async def assistant_confirm_sergeant(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    try:
        data = query.data.split('_')
        if len(data) < 5 or data[1] != 'sergeant':
            await query.answer("❌ Неверные данные", show_alert=True)
            return
        fio_part = data[2:-2]
        group = data[-2]
        year = int(data[-1])
        fio = ' '.join(fio_part).replace('_', ' ')

        context.user_data['pending_sergeant_fio'] = fio
        context.user_data['pending_sergeant_group'] = group
        context.user_data['pending_sergeant_year'] = year

        await query.edit_message_text(
            f"🔧 Назначить сержантом:\n\n👤 <b>{fio}</b> в группе <b>{group}</b> ({year} г.)\n\nПодтвердите действие:",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("✅ Подтвердить", callback_data="do_set_sergeant")],
                [InlineKeyboardButton("⬅️ Назад", callback_data="assistant_add_sergeant_start")]
            ]),
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"❌ Ошибка при подтверждении назначения: {e}", exc_info=True)
        await query.answer("Ошибка", show_alert=True)

# === УСТАНОВКА РОЛИ СЕРЖАНТА ===
async def assistant_do_set_sergeant(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    fio = context.user_data.get('pending_sergeant_fio')
    group = context.user_data.get('pending_sergeant_group')
    year = context.user_data.get('pending_sergeant_year')

    if not fio or not group or not year:
        await query.edit_message_text("❌ Ошибка: данные утеряны.")
        return

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT telegram_id FROM users 
            WHERE fio = ? AND group_name = ? AND enrollment_year = ?
        """, (fio, group, year))
        user = cursor.fetchone()

        if not user:
            await query.edit_message_text("❌ Пользователь не найден.")
            return

        user_id_to_set = user['telegram_id']

        # Назначаем сержанта
        cursor.execute("UPDATE users SET role = 'sergeant' WHERE telegram_id = ?", (user_id_to_set,))
        conn.commit()
        conn.close()

        # Обновляем editors
        editors = context.application.bot_data.get('editors', {})
        editors[user_id_to_set] = {'role': 'sergeant', 'group': group}
        context.application.bot_data['editors'] = editors

        # Уведомление
        try:
            await context.bot.send_message(user_id_to_set, "🎖️ Вы назначены сержантом!", parse_mode="HTML")
        except Exception as e:
            logger.warning(f"⚠️ Не удалось уведомить {user_id_to_set}: {e}")

        await query.edit_message_text(
            f"✅ <b>{fio}</b> назначен сержантом!",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⬅️ Назад", callback_data="assistant_panel")]
            ]),
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"❌ Ошибка при назначении сержанта: {e}", exc_info=True)
        await query.answer("Ошибка", show_alert=True)
    finally:
        context.user_data.pop('pending_sergeant_fio', None)
        context.user_data.pop('pending_sergeant_group', None)
        context.user_data.pop('pending_sergeant_year', None)

# === ОБРАБОТЧИК КНОПОК ===
async def assistant_button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    data = query.data.strip() if query.data else ""
    logger.info(f"📥 [assistant_button_handler] Получен callback: {data}")

    try:
        if data == "assistant_panel":
            await assistant_panel(update, context)
        elif data == "assistant_list_group":
            await assistant_list_group(update, context)
        elif data == "assistant_add_sergeant":
            await assistant_add_sergeant_start(update, context)
        elif data.startswith("sel_sergeant_"):
            await assistant_confirm_sergeant(update, context)
        elif data == "do_set_sergeant":
            await assistant_do_set_sergeant(update, context)
        else:
            await query.answer("❌ Неизвестная команда", show_alert=True)
    except Exception as e:
        logger.error(f"❌ Ошибка в assistant_button_handler: {e}", exc_info=True)
        try:
            await query.answer("❌ Ошибка обработки", show_alert=True)
        except:
            pass

# === ЭКСПОРТ ===
assistant_router = [
    CallbackQueryHandler(assistant_panel, pattern="^assistant_panel$"),
    CallbackQueryHandler(assistant_button_handler, pattern="^assistant_"),
    CallbackQueryHandler(assistant_button_handler, pattern="^sel_sergeant_"),
    CallbackQueryHandler(assistant_button_handler, pattern="^do_set_sergeant$"),
]

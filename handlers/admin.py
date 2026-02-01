# handlers/admin.py — финальная версия (2025), всё работает + безопасность + female_editor

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, CallbackQueryHandler
from database import get_db
from utils.course_calculator import get_course_info
import logging

logger = logging.getLogger(__name__)

# === 🌐 РОЛИ: ОТОБРАЖЕНИЕ ===
ROLE_DISPLAY = {
    'admin': '👑 Администратор',
    'assistant': '🛠️ Помощник',
    'sergeant': '🎖️ Сержант',
    'user': '👤 Курсант',
    'female_editor': '👩‍🔧 Ред. девушек'
}

ROLE_TITLES = {
    'admin': 'Администратор',
    'assistant': 'Помощник',
    'sergeant': 'Сержант',
    'user': 'Курсант',
    'female_editor': 'Редактор девушек'
}

# === ПРОВЕРКА: АДМИН ЛИ? ===
def is_admin(user_id: int, context: ContextTypes.DEFAULT_TYPE) -> bool:
    editors = context.application.bot_data.get('editors', {})
    return editors.get(user_id, {}).get('role') == 'admin'

# === ОТКРЫТИЕ АДМИН-ПАНЕЛИ ===
async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    if not is_admin(user_id, context):
        if update.callback_query:
            await update.callback_query.answer("❌ У вас нет доступа", show_alert=True)
        return

    keyboard = [
        [InlineKeyboardButton("📋 Список пользователей", callback_data="admin_list_users")],
        [InlineKeyboardButton("➕ Назначить помощника", callback_data="admin_add_assistant")],
        [InlineKeyboardButton("➕ Назначить сержанта", callback_data="admin_add_sergeant")],
        [InlineKeyboardButton("➕ Назначить ред. девушек", callback_data="admin_add_female_editor")],
        [InlineKeyboardButton("⬅️ В меню", callback_data="back_to_main")]
    ]

    text = "🔧 <b>Админ-панель</b>\n\nВыберите действие:"

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
            logger.error(f"❌ Ошибка при открытии админ-панели: {e}")
            await update.callback_query.answer("Ошибка при открытии", show_alert=True)

# === СПИСОК ПОЛЬЗОВАТЕЛЕЙ: СНАЧАЛА ГОД → ПОТОМ ГРУППЫ ===
async def admin_list_users(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT enrollment_year FROM users ORDER BY enrollment_year DESC")
        years = [row[0] for row in cursor.fetchall()]
        conn.close()

        keyboard = []
        for year in years:
            course_info = get_course_info(year)
            year_label = f"📅 {year} ({course_info['current']} курс)"
            keyboard.append([InlineKeyboardButton(year_label, callback_data=f"admin_filter_year_{year}")])
        
        keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="admin_panel")])

        await query.edit_message_text(
            "📋 <b>Фильтр пользователей</b>\n\n"
            "Выберите <b>год поступления</b>:",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"❌ Ошибка при открытии списка пользователей: {e}", exc_info=True)
        await query.answer("Ошибка", show_alert=True)

# === ПОКАЗАТЬ ПОЛЬЗОВАТЕЛЕЙ — ПО ГРУППЕ И ГОДУ ===
async def admin_show_users(update: Update, context: ContextTypes.DEFAULT_TYPE, filter_type: str, value: str, year: int = None):
    query = update.callback_query
    await query.answer()

    try:
        conn = get_db()
        cursor = conn.cursor()
        text = ""

        if filter_type == "group" and year:
            cursor.execute("""
                SELECT telegram_id, fio, role, group_name, enrollment_year 
                FROM users 
                WHERE group_name = ? AND enrollment_year = ? 
                ORDER BY fio
            """, (value, year))
            title = f"🎓 Группа: {value} ({year})"
        elif filter_type == "year":
            cursor.execute("""
                SELECT telegram_id, fio, role, group_name, enrollment_year 
                FROM users 
                WHERE enrollment_year = ? 
                ORDER BY group_name, fio
            """, (int(value),))
            title = f"📅 Год поступления: {value}"
        else:
            await query.edit_message_text("❌ Неверные параметры.")
            return

        users = cursor.fetchall()
        conn.close()

        if not users:
            text = f"❌ Нет пользователей в {title.lower()}."
        else:
            text = f"<b>{title}</b>:\n\n"
            for user in users:
                icon = ROLE_DISPLAY.get(user['role'], "👤")
                role_name = ROLE_TITLES.get(user['role'], user['role'].title())
                course = get_course_info(user['enrollment_year'])['current']
                text += f"{icon} <code>{user['fio']}</code> — <b>{role_name}</b> [{user['group_name']}, {course} курс]\n"

        keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data="admin_list_users")]]
        await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    except Exception as e:
        logger.error(f"❌ Ошибка при отображении пользователей: {e}", exc_info=True)
        await query.answer("Ошибка", show_alert=True)

# === ВЫБОР ГОДА ПОСТУПЛЕНИЯ ===
async def admin_select_role_year(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    data = query.data
    target_role = 'assistant' if 'assistant' in data else 'sergeant'
    if 'female_editor' in data:
        target_role = 'female_editor'

    context.user_data['pending_role_action'] = target_role

    # Проверка: уже есть помощник
    if target_role == 'assistant':
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'assistant'")
        assistant_count = cursor.fetchone()[0]
        conn.close()
        if assistant_count >= 1:
            await query.edit_message_text(
                "❌ В системе уже есть <b>помощник</b>. Назначение невозможно.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("⬅️ Назад", callback_data="admin_panel")]
                ]),
                parse_mode="HTML"
            )
            return

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT enrollment_year FROM users ORDER BY enrollment_year DESC")
        years = [row[0] for row in cursor.fetchall()]
        conn.close()

        keyboard = []
        for year in years:
            course_info = get_course_info(year)
            keyboard.append([
                InlineKeyboardButton(
                    f"📅 {year} ({course_info['current']} курс)",
                    callback_data=f"admin_select_role_year_{year}"
                )
            ])
        keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="admin_panel")])

        role_title = ROLE_TITLES[target_role]
        await query.edit_message_text(
            f"🔧 Выберите <b>год поступления</b> для назначения <b>{role_title}</b>:",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"❌ Ошибка при выборе года: {e}")
        await query.edit_message_text("❌ Ошибка.")

# === ВЫБОР ГРУППЫ ===
async def admin_select_role_group(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    try:
        year = int(query.data.split('_')[-1])
    except (ValueError, IndexError):
        await query.answer("❌ Неверные данные", show_alert=True)
        return

    context.user_data['pending_role_year'] = year

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT group_name FROM users WHERE enrollment_year = ? ORDER BY group_name", (year,))
        groups = [row[0] for row in cursor.fetchall()]
        conn.close()

        if not groups:
            await query.edit_message_text("❌ Нет групп для этого года.")
            return

        keyboard = []
        for group in groups:
            keyboard.append([
                InlineKeyboardButton(
                    f"👥 {group} ({year})",
                    callback_data=f"admin_select_role_group_{group}_{year}"
                )
            ])
        keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="admin_panel")])

        role_title = ROLE_TITLES[context.user_data['pending_role_action']]
        await query.edit_message_text(
            f"🔧 Выберите <b>группу</b> для назначения <b>{role_title}</b> в {year} году:",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"❌ Ошибка при выборе группы: {e}")
        await query.edit_message_text("❌ Ошибка.")

# === ПОКАЗАТЬ ПОЛЬЗОВАТЕЛЕЙ ДЛЯ НАЗНАЧЕНИЯ (ТОЛЬКО КУРСАНТЫ) ===
async def admin_show_users_for_role(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    group_name = context.user_data.get('pending_role_group')
    year = context.user_data.get('pending_role_year')

    if not group_name or not year:
        await query.edit_message_text("❌ Не выбраны группа или год.")
        return

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT telegram_id, fio, role 
            FROM users 
            WHERE group_name = ? 
              AND enrollment_year = ? 
              AND role = 'user'
            ORDER BY fio
        """, (group_name, year))
        users = cursor.fetchall()
        conn.close()

        logger.info(f"🔍 admin_show_users_for_role: группа={group_name}, год={year}, найдено={len(users)}")

        if not users:
            await query.edit_message_text(
                "❌ Нет доступных курсантов в этой группе.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("⬅️ Назад в админ-панель", callback_data="admin_panel")]
                ])
            )
            return

        keyboard = []
        for user in users:
            icon = ROLE_DISPLAY.get(user['role'], "👤")
            keyboard.append([
                InlineKeyboardButton(
                    f"{icon} {user['fio']}",
                    callback_data=f"admin_select_role_id_{user['telegram_id']}"
                )
            ])
        keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="admin_panel")])

        await query.edit_message_text(
            f"🔧 Выберите пользователя из группы <b>{group_name}</b> ({year} г.) для назначения роли:",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"❌ Ошибка при отображении пользователей для роли: {e}", exc_info=True)
        await query.answer("Ошибка", show_alert=True)

# === ПОДТВЕРЖДЕНИЕ НАЗНАЧЕНИЯ ===
async def admin_confirm_role_change(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if not query.data.startswith("admin_select_role_id_"):
        await query.edit_message_text("❌ Ошибка данных.")
        return

    try:
        user_id = int(query.data.replace("admin_select_role_id_", ""))
    except ValueError:
        await query.edit_message_text("❌ Неверный ID пользователя.")
        return

    context.user_data['pending_role_user_id'] = user_id

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT fio FROM users WHERE telegram_id = ?", (user_id,))
        user = cursor.fetchone()
        conn.close()

        if not user:
            await query.edit_message_text("❌ Пользователь не найден.")
            return

        fio = user['fio']
        target_role = context.user_data['pending_role_action']
        role_name = ROLE_TITLES.get(target_role, target_role)

        await query.edit_message_text(
            f"🔧 Назначить роль <b>{role_name}</b> для:\n\n👤 <b>{fio}</b>\n\nПодтвердите действие:",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("✅ Подтвердить", callback_data="admin_do_set_role")],
                [InlineKeyboardButton("⬅️ Назад", callback_data="admin_panel")]
            ]),
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"❌ Ошибка при подтверждении: {e}")
        await query.edit_message_text("❌ Ошибка.")

# === УСТАНОВКА РОЛИ ===
async def admin_do_set_role(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user_id = context.user_data.get('pending_role_user_id')
    target_role = context.user_data.get('pending_role_action')

    if not user_id or not target_role:
        await query.edit_message_text("❌ Ошибка: данные утеряны.")
        return

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Проверка: уже есть сержант в группе
        if target_role == 'sergeant':
            cursor.execute("""
                SELECT fio FROM users 
                WHERE group_name = (SELECT group_name FROM users WHERE telegram_id = ?)
                  AND enrollment_year = (SELECT enrollment_year FROM users WHERE telegram_id = ?)
                  AND role = 'sergeant'
                  AND telegram_id != ?
            """, (user_id, user_id, user_id))
            existing = cursor.fetchone()
            if existing:
                await query.edit_message_text(
                    f"❌ В этой группе уже есть сержант: <code>{existing['fio']}</code>",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="admin_list_users")]]),
                    parse_mode="HTML"
                )
                conn.close()
                return

        cursor.execute("SELECT fio, role, group_name FROM users WHERE telegram_id = ?", (user_id,))
        user = cursor.fetchone()
        if not user:
            await query.edit_message_text("❌ Пользователь не найден.")
            conn.close()
            return

        old_role = user['role']
        fio = user['fio']
        group_name = user['group_name']

        cursor.execute("UPDATE users SET role = ? WHERE telegram_id = ?", (target_role, user_id))
        conn.commit()
        conn.close()

        # Обновляем editors
        editors = context.application.bot_data.get('editors', {})
        if target_role in ['admin', 'assistant', 'sergeant', 'female_editor']:
            editors[user_id] = {'role': target_role, 'group': group_name}
        else:
            editors.pop(user_id, None)
        context.application.bot_data['editors'] = editors

        # Уведомление
        try:
            role_title = ROLE_TITLES[target_role]
            await context.bot.send_message(user_id, f"✅ Вам назначена роль: <b>{role_title}</b>!", parse_mode="HTML")
        except Exception:
            pass

        old_display = ROLE_TITLES.get(old_role, old_role)
        new_display = ROLE_TITLES[target_role]

        await query.edit_message_text(
            f"✅ Роль изменена:\n\n"
            f"👤 <b>{fio}</b>\n"
            f"🔄 {old_display} → <b>{new_display}</b>",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="admin_list_users")]])
        )
        logger.info(f"✅ Админ назначил {target_role} пользователю {user_id} ({fio})")

        # 🔥 Обновление меню
        try:
            from handlers.menu import start_command
            user_context = context.application.context_types.context(context.application)
            user_context._chat_id = user_id
            user_context._user_id = user_id
            await start_command(None, user_context)
        except Exception as e:
            logger.error(f"❌ Не удалось обновить меню для {user_id}: {e}")

    except Exception as e:
        logger.error(f"❌ Ошибка при установке роли: {e}", exc_info=True)
        await query.edit_message_text("❌ Ошибка при назначении.")

# === ОБРАБОТЧИК КНОПОК ===
async def admin_button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    data = query.data.strip() if query.data else ""
    logger.info(f"📥 [admin_button_handler] Принят callback_data: '{data}'")

    try:
        if data == "admin_panel":
            await admin_panel(update, context)
        elif data == "admin_list_users":
            await admin_list_users(update, context)
        elif data.startswith("admin_filter_group_"):
            try:
                parts = data.split('_')
                group = '_'.join(parts[3:-1]) or parts[-2]
                year = int(parts[-1])
                await admin_show_users(update, context, "group", group, year=year)
            except Exception as e:
                logger.error(f"❌ Ошибка парсинга admin_filter_group: {e}")
                await query.answer("❌ Ошибка фильтра", show_alert=True)
        elif data.startswith("admin_filter_year_"):
            year = data.replace("admin_filter_year_", "")
            await admin_show_users(update, context, "year", year)
        elif data in ["admin_add_assistant", "admin_add_sergeant", "admin_add_female_editor"]:
            await admin_select_role_year(update, context)
        elif data.startswith("admin_select_role_year_"):
            await admin_select_role_group(update, context)
        elif data.startswith("admin_select_role_group_"):
            try:
                parts = data.split('_')
                year = int(parts[-1])
                group_name = '_'.join(parts[4:-1]) or parts[-2]
                context.user_data['pending_role_group'] = group_name
                context.user_data['pending_role_year'] = year
                await admin_show_users_for_role(update, context)
            except Exception as e:
                logger.error(f"❌ Ошибка парсинга admin_select_role_group: {e}")
                await query.answer("❌ Ошибка выбора группы", show_alert=True)
        elif data.startswith("admin_select_role_id_"):
            await admin_confirm_role_change(update, context)
        elif data == "admin_do_set_role":
            await admin_do_set_role(update, context)
        else:
            await query.answer("❌ Неизвестная команда", show_alert=True)
    except Exception as e:
        logger.error(f"❌ Ошибка в admin_button_handler: {e}", exc_info=True)
        try:
            await query.answer("❌ Ошибка обработки", show_alert=True)
        except:
            pass

# === ЭКСПОРТ ===
admin_router = [
    CallbackQueryHandler(admin_panel, pattern="^admin_panel$"),
    CallbackQueryHandler(admin_button_handler, pattern="^admin_"),
]

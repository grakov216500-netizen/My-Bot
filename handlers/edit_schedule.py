# handlers/edit_schedule.py

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, CallbackQueryHandler, ConversationHandler, MessageHandler, filters
from database import get_db
from utils.roles import VALID_ROLES, get_full_role_name, ROLE_SHORT_NAMES
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# === СОСТОЯНИЯ ===
SELECT_ACTION, SELECT_FIO, SELECT_DATE, SELECT_ROLE, CONFIRM_DELETE = range(5)

# === ДОСТУПНЫЕ ДЕЙСТВИЯ ===
ACTIONS = {
    'add': '➕ Добавить наряд',
    'edit': '✏️ Изменить наряд',
    'delete': '🗑️ Удалить наряд'
}

# === ПРОВЕРКА: ДОПУЩЕН ЛИ К РЕДАКТИРОВАНИЮ ===
def can_edit_schedule(user_id: int, context: ContextTypes.DEFAULT_TYPE) -> tuple[bool, str]:
    editors = context.application.bot_data.get('editors', {})
    editor = editors.get(user_id)
    
    if not editor:
        return False, "Доступ запрещён"
    
    role = editor['role']
    if role not in ['admin', 'assistant', 'sergeant']:
        return False, "Недостаточно прав"
    
    return True, editor['group']

# === НАЧАЛО РЕДАКТИРОВАНИЯ ===
async def start_edit_schedule(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    query = update.callback_query

    allowed, group = can_edit_schedule(user_id, context)
    if not allowed:
        if query:
            await query.answer("❌ У вас нет прав", show_alert=True)
        else:
            await update.message.reply_text("❌ У вас нет прав на редактирование графика.")
        return ConversationHandler.END

    context.user_data['editor_group'] = group

    keyboard = [
        [InlineKeyboardButton(ACTIONS['add'], callback_data='edit_action_add')],
        [InlineKeyboardButton(ACTIONS['edit'], callback_data='edit_action_edit')],
        [InlineKeyboardButton(ACTIONS['delete'], callback_data='edit_action_delete')],
        [InlineKeyboardButton("⬅️ Отмена", callback_data="back_to_main")]
    ]

    text = (
        "📊 <b>Редактирование графика</b>\n\n"
        f"👥 Группа: <b>{group}</b>\n\n"
        "Выберите действие:"
    )

    if query:
        await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    else:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")

    return SELECT_ACTION

# === ВЫБОР ДЕЙСТВИЯ ===
async def select_action(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    action_map = {
        'edit_action_add': 'add',
        'edit_action_edit': 'edit',
        'edit_action_delete': 'delete'
    }
    action = action_map.get(query.data)
    if not action:
        await query.edit_message_text("❌ Неизвестное действие.")
        return ConversationHandler.END

    context.user_data['edit_action'] = action
    await show_fio_selection(update, context)
    return SELECT_FIO

# === ВЫБОР ФИО ===
async def show_fio_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    group = context.user_data['editor_group']

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT fio FROM users WHERE group_name = ? ORDER BY fio", (group,))
    users = cursor.fetchall()
    conn.close()

    if not users:
        await query.edit_message_text("❌ Нет пользователей в вашей группе.")
        return ConversationHandler.END

    keyboard = []
    for user in users:
        keyboard.append([InlineKeyboardButton(f"👤 {user['fio']}", callback_data=f"edit_fio_{user['fio']}")])
    keyboard.append([InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")])

    action = context.user_data['edit_action']
    action_text = ACTIONS[action].split()[1].capitalize()

    await query.edit_message_text(
        f"👥 Выберите курсанта для {action_text.lower()} наряда:",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="HTML"
    )

# === СОХРАНЕНИЕ ВЫБРАННОГО ФИО ===
async def save_selected_fio(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    fio = query.data.replace("edit_fio_", "")
    context.user_data['edit_fio'] = fio

    await query.edit_message_text(
        "📅 Введите дату в формате <code>ГГГГ-ММ-ДД</code>:\n\n<i>Например: 2026-01-15</i>",
        parse_mode="HTML"
    )
    return SELECT_DATE

# === ОБРАБОТКА ДАТЫ ===
async def handle_date_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    date_str = update.message.text.strip()
    try:
        parsed_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        context.user_data['edit_date'] = str(parsed_date)
    except ValueError:
        await update.message.reply_text(
            "❌ Неверный формат даты. Используйте <code>ГГГГ-ММ-ДД</code>",
            parse_mode="HTML"
        )
        return SELECT_DATE

    action = context.user_data['edit_action']

    if action == 'delete':
        await confirm_delete_duty(update, context)
        return CONFIRM_DELETE
    else:
        await show_role_selection(update, context)
        return SELECT_ROLE

# === ВЫБОР РОЛИ ===
async def show_role_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = []
    row = []
    for short, full in VALID_ROLES.items():
        emoji = "🔹"
        if short in ['к', 'дк']: emoji = "👮‍♂️"
        elif short in ['с', 'дс']: emoji = "🍽️"
        elif short == 'ад': emoji = "🏢"
        elif short == 'п': emoji = "🚔"
        
        btn_text = f"{emoji} {ROLE_SHORT_NAMES.get(short, short.upper())}"
        row.append(InlineKeyboardButton(btn_text, callback_data=f"edit_role_{short}"))
        
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)

    keyboard.append([InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")])

    await update.message.reply_text(
        "🔧 Выберите тип наряда:",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="HTML"
    )

# === СОХРАНЕНИЕ РОЛИ ===
async def save_role_and_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    role = query.data.replace("edit_role_", "")
    if role not in VALID_ROLES:
        await query.edit_message_text("❌ Неверная роль.")
        return ConversationHandler.END

    context.user_data['edit_role'] = role
    fio = context.user_data['edit_fio']
    date = context.user_data['edit_date']
    action = context.user_data['edit_action']

    role_full = get_full_role_name(role)
    action_verb = "добавлен" if action == 'add' else "изменён"

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Подтвердить", callback_data="confirm_edit")],
        [InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")]
    ])

    await query.edit_message_text(
        f"📋 Подтверждение:\n\n"
        f"👤 <b>{fio}</b>\n"
        f"📅 <b>{date}</b>\n"
        f"🔧 <b>{role_full}</b>\n\n"
        f"Вы хотите {action_verb} этот наряд?",
        reply_markup=keyboard,
        parse_mode="HTML"
    )
    return SELECT_ROLE

# === ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ ===
async def confirm_delete_duty(update: Update, context: ContextTypes.DEFAULT_TYPE):
    fio = context.user_data['edit_fio']
    date = context.user_data['edit_date']

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT role FROM duty_schedule WHERE fio = ? AND date = ?",
        (fio, date)
    )
    duty = cursor.fetchone()
    conn.close()

    if not duty:
        await update.message.reply_text(
            "❌ На указанную дату нет наряда для этого курсанта.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⬅️ Назад", callback_data="back_to_main")]
            ])
        )
        return ConversationHandler.END

    role_full = get_full_role_name(duty['role'])

    context.user_data['edit_role'] = duty['role']  # для удаления

    await update.message.reply_text(
        f"🗑️ Вы действительно хотите удалить наряд?\n\n"
        f"👤 <b>{fio}</b>\n"
        f"📅 <b>{date}</b>\n"
        f"🔧 <b>{role_full}</b>",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Удалить", callback_data="confirm_delete")],
            [InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")]
        ]),
        parse_mode="HTML"
    )

# === ВЫПОЛНЕНИЕ ИЗМЕНЕНИЯ ===
async def execute_edit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    action = context.user_data['edit_action']
    fio = context.user_data['edit_fio']
    date = context.user_data['edit_date']
    role = context.user_data['edit_role']
    group = context.user_data['editor_group']

    conn = get_db()
    cursor = conn.cursor()

    try:
        if action == 'delete':
            cursor.execute("DELETE FROM duty_schedule WHERE fio = ? AND date = ?", (fio, date))
            if cursor.rowcount == 0:
                text = "❌ Не удалось удалить: наряд не найден."
            else:
                text = f"✅ <b>Наряд удалён</b>:\n\n👤 {fio}\n📅 {date}"
        else:
            cursor.execute("""
                INSERT OR REPLACE INTO duty_schedule (fio, date, role, group_name)
                VALUES (?, ?, ?, ?)
            """, (fio, date, role, group))
            action_text = "добавлен" if action == 'add' else "обновлён"
            text = f"✅ <b>Наряд {action_text}</b>:\n\n👤 {fio}\n📅 {date}\n🔧 {get_full_role_name(role)}"

        conn.commit()

        # Обновляем график в боте
        all_schedules = context.application.bot_data.get('schedules', {})
        current = context.application.bot_data.get('current_schedule', datetime.now().strftime('%Y-%m'))
        
        schedule_list = all_schedules.get(current, [])
        schedule_list = [d for d in schedule_list if not (d['fio'] == fio and d['date'] == date)]
        
        if action != 'delete':
            schedule_list.append({'fio': fio, 'date': date, 'role': role, 'group': group})
        
        all_schedules[current] = schedule_list
        context.application.bot_data['schedules'] = all_schedules
        context.application.bot_data['duty_schedule'] = schedule_list

    except Exception as e:
        logger.error(f"Ошибка при редактировании графика: {e}")
        text = "❌ Ошибка при сохранении. Обратитесь к администратору."
    finally:
        conn.close()

    await query.edit_message_text(text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup([
        [InlineKeyboardButton("➕ Другой наряд", callback_data="start_edit_schedule")],
        [InlineKeyboardButton("⬅️ В меню", callback_data="back_to_main")]
    ]))

    return ConversationHandler.END

# === ОБРАБОТЧИК КНОПОК ===
async def edit_schedule_button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    data = query.data

    if data == "start_edit_schedule":
        return await start_edit_schedule(update, context)
    elif data.startswith("edit_action_"):
        return await select_action(update, context)
    elif data.startswith("edit_fio_"):
        return await save_selected_fio(update, context)
    elif data == "confirm_edit":
        return await execute_edit(update, context)
    elif data == "confirm_delete":
        return await execute_edit(update, context)
    else:
        await query.answer("❌ Неизвестная команда", show_alert=True)

# === ЭКСПОРТ ===
edit_schedule_handler = ConversationHandler(
    entry_points=[
        CallbackQueryHandler(start_edit_schedule, pattern="^start_edit_schedule$")
    ],
    states={
        SELECT_ACTION: [CallbackQueryHandler(select_action, pattern="^edit_action_")],
        SELECT_FIO: [CallbackQueryHandler(save_selected_fio, pattern="^edit_fio_")],
        SELECT_DATE: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_date_input)],
        SELECT_ROLE: [
            CallbackQueryHandler(save_role_and_confirm, pattern="^edit_role_"),
            CallbackQueryHandler(execute_edit, pattern="^confirm_edit$")
        ],
        CONFIRM_DELETE: [CallbackQueryHandler(execute_edit, pattern="^confirm_delete$")]
    },
    fallbacks=[
        CallbackQueryHandler(lambda u, c: ConversationHandler.END, pattern="^back_to_main$")
    ],
    allow_reentry=True
)

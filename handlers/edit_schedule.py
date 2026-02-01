# handlers/edit_schedule.py — ручное редактирование графика (с выбором месяца и группой)

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, ConversationHandler, CallbackQueryHandler, MessageHandler, filters
from database import get_db
from utils.storage import load_all_schedules, save_all_schedules
from utils.roles import VALID_ROLES, get_full_role_name, ROLE_SHORT_NAMES
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# === СОСТОЯНИЯ ===
SELECT_ACTION, SELECT_MONTH, SELECT_FIO, SELECT_DATE, SELECT_ROLE, CONFIRM_EDIT = range(6)

# === ДОСТУПНЫЕ ДЕЙСТВИЯ ===
ACTIONS = {
    'add': '➕ Добавить наряд',
    'delete': '🗑️ Удалить наряд'
}

# === ПРОВЕРКА ПРАВ НА РЕДАКТИРОВАНИЕ ===
def can_edit_schedule(user_id: int, context: ContextTypes.DEFAULT_TYPE) -> tuple[bool, str, str]:
    editors = context.application.bot_data.get('editors', {})
    editor = editors.get(user_id)
    
    if not editor:
        return False, "Доступ запрещён", None
    
    role = editor['role']
    if role not in ['admin', 'assistant', 'sergeant']:
        return False, "Недостаточно прав", None
    
    return True, editor['role'], editor['group']

# === НАЧАЛО РЕДАКТИРОВАНИЯ ===
async def start_edit_schedule(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    query = update.callback_query

    allowed, user_role, editor_group = can_edit_schedule(user_id, context)
    if not allowed:
        if query:
            await query.answer("❌ У вас нет прав", show_alert=True)
            await query.edit_message_text("❌ У вас нет прав на редактирование графика.")
        else:
            await update.message.reply_text("❌ У вас нет прав на редактирование графика.")
        return ConversationHandler.END

    context.user_data['user_role'] = user_role
    context.user_data['editor_group'] = editor_group

    keyboard = [
        [InlineKeyboardButton(ACTIONS['add'], callback_data='edit_action_add')],
        [InlineKeyboardButton(ACTIONS['delete'], callback_data='edit_action_delete')],
        [InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")]
    ]

    text = (
        "📊 <b>Редактирование графика</b>\n\n"
        f"👥 Ваша группа: <b>{editor_group}</b>\n\n"
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
        'edit_action_delete': 'delete'
    }
    action = action_map.get(query.data)
    if not action:
        await query.edit_message_text("❌ Неизвестное действие.")
        return ConversationHandler.END

    context.user_data['edit_action'] = action

    # Загружаем доступные месяцы
    schedules = load_all_schedules()
    if not schedules:
        await query.edit_message_text("❌ Нет загруженных графиков.")
        return ConversationHandler.END

    # Определяем, какие месяцы есть для редактирования (где есть группа)
    available_months = []
    for month in sorted(schedules.keys(), reverse=True):
        month_data = schedules[month]
        editor_group = context.user_data['editor_group']
        if editor_group in month_data:
            available_months.append(month)

    if not available_months:
        await query.edit_message_text("❌ У вашей группы нет графиков.")
        return ConversationHandler.END

    keyboard = []
    for month in available_months:
        keyboard.append([InlineKeyboardButton(month, callback_data=f"edit_month_{month}")])
    keyboard.append([InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")])

    await query.edit_message_text(
        "📅 Выберите месяц для редактирования:",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="HTML"
    )
    return SELECT_MONTH

# === ВЫБОР МЕСЯЦА ===
async def select_month(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    month = query.data.replace("edit_month_", "")
    context.user_data['edit_month'] = month

    # Получаем ФИО курсантов из группы
    editor_group = context.user_data['editor_group']
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT fio FROM users WHERE group_name = ? ORDER BY fio", (editor_group,))
    users = cursor.fetchall()
    conn.close()

    if not users:
        await query.edit_message_text("❌ Нет курсантов в вашей группе.")
        return ConversationHandler.END

    keyboard = []
    for user in users:
        fio = user['fio']
        keyboard.append([InlineKeyboardButton(f"👤 {fio}", callback_data=f"edit_fio_{fio}")])
    keyboard.append([InlineKeyboardButton("✏️ Ввести вручную", callback_data="edit_fio_custom")])
    keyboard.append([InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")])

    await query.edit_message_text(
        "👥 Выберите курсанта:",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="HTML"
    )
    return SELECT_FIO

# === СОХРАНЕНИЕ ФИО ===
async def save_selected_fio(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    data = query.data
    if data == "edit_fio_custom":
        await query.edit_message_text(
            "✏️ Введите ФИО курсанта:\n\nФормат: Фамилия Имя Отчество",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")]
            ]),
            parse_mode="HTML"
        )
        return SELECT_FIO

    fio = data.replace("edit_fio_", "")
    context.user_data['edit_fio'] = fio

    await query.edit_message_text(
        "📅 Введите дату в формате <code>ГГГГ-ММ-ДД</code>:\n\n<i>Например: 2025-04-05</i>",
        parse_mode="HTML"
    )
    return SELECT_DATE

# === ВВОД ФИО ВРУЧНУЮ ===
async def enter_fio_manual(update: Update, context: ContextTypes.DEFAULT_TYPE):
    fio = update.message.text.strip()
    if len(fio.split()) < 2:
        await update.message.reply_text(
            "❌ Введите ФИО полностью (минимум фамилия и имя).",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")]
            ])
        )
        return SELECT_FIO

    context.user_data['edit_fio'] = fio

    await update.message.reply_text(
        "📅 Введите дату в формате <code>ГГГГ-ММ-ДД</code>:\n\n<i>Например: 2025-04-05</i>",
        parse_mode="HTML"
    )
    return SELECT_DATE

# === ОБРАБОТКА ДАТЫ ===
async def handle_date_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    date_str = update.message.text.strip()
    try:
        parsed_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        formatted_date = str(parsed_date)
        context.user_data['edit_date'] = formatted_date
    except ValueError:
        await update.message.reply_text(
            "❌ Неверный формат даты. Используйте <code>ГГГГ-ММ-ДД</code>",
            parse_mode="HTML"
        )
        return SELECT_DATE

    action = context.user_data['edit_action']
    if action == 'delete':
        await confirm_delete_duty(update, context)
        return CONFIRM_EDIT
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
    return SELECT_ROLE

# === СОХРАНЕНИЕ РОЛИ И ПОДТВЕРЖДЕНИЕ ===
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
    action_verb = "добавить" if action == 'add' else "удалить"

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Подтвердить", callback_data="confirm_edit")],
        [InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")]
    ])

    await query.edit_message_text(
        f"📋 Подтверждение {action_verb}:\n\n"
        f"👤 <b>{fio}</b>\n"
        f"📅 <b>{date}</b>\n"
        f"🔧 <b>{role_full}</b>\n\n"
        f"Вы уверены, что хотите {action_verb} этот наряд?",
        reply_markup=keyboard,
        parse_mode="HTML"
    )
    return CONFIRM_EDIT

# === ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ ===
async def confirm_delete_duty(update: Update, context: ContextTypes.DEFAULT_TYPE):
    fio = context.user_data['edit_fio']
    date = context.user_data['edit_date']
    month = context.user_data['edit_month']

    schedules = load_all_schedules()
    month_data = schedules.get(month, {})
    group_data = month_data.get(context.user_data['editor_group'], [])

    found = False
    for item in group_data:
        if item['fio'] == fio and item['date'] == date:
            found = True
            role_full = get_full_role_name(item['role'])
            break

    if not found:
        await update.message.reply_text(
            "❌ На указанную дату нет наряда у этого курсанта.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⬅️ Назад", callback_data="back_to_main")]
            ])
        )
        return ConversationHandler.END

    context.user_data['edit_role'] = item['role']  # для удаления

    await update.message.reply_text(
        f"🗑️ Вы действительно хотите удалить наряд?\n\n"
        f"👤 <b>{fio}</b>\n"
        f"📅 <b>{date}</b>\n"
        f"🔧 <b>{role_full}</b>",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Удалить", callback_data="confirm_edit")],
            [InlineKeyboardButton("❌ Отмена", callback_data="back_to_main")]
        ]),
        parse_mode="HTML"
    )
    return CONFIRM_EDIT

# === ВЫПОЛНЕНИЕ ИЗМЕНЕНИЯ ===
async def execute_edit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    action = context.user_data['edit_action']
    fio = context.user_data['edit_fio']
    date = context.user_data['edit_date']
    role = context.user_data['edit_role']
    month = context.user_data['edit_month']
    group = context.user_data['editor_group']

    schedules = load_all_schedules()
    month_data = schedules.get(month, {})
    group_data = month_data.get(group, [])

    try:
        if action == 'delete':
            initial_count = len(group_data)
            group_data = [d for d in group_data if not (d['fio'] == fio and d['date'] == date)]
            if len(group_data) == initial_count:
                text = "❌ Не удалось удалить: наряд не найден."
            else:
                schedules[month][group] = group_data
                save_all_schedules(schedules)
                # Обновляем bot_data
                if month == context.application.bot_data.get('current_schedule'):
                    full_list = []
                    for g, duties in schedules[month].items():
                        full_list.extend(duties)
                    context.application.bot_data['duty_schedule'] = full_list
                    context.application.bot_data['schedules'] = schedules
                text = f"✅ <b>Наряд удалён</b>:\n\n👤 {fio}\n📅 {date}"
        else:
            # Удаляем старый
            group_data = [d for d in group_data if not (d['fio'] == fio and d['date'] == date)]
            # Добавляем новый
            group_data.append({'fio': fio, 'date': date, 'role': role})
            schedules[month][group] = sorted(group_data, key=lambda x: x['date'])
            save_all_schedules(schedules)
            # Обновляем bot_data
            if month == context.application.bot_data.get('current_schedule'):
                full_list = []
                for g, duties in schedules[month].items():
                    full_list.extend(duties)
                context.application.bot_data['duty_schedule'] = full_list
                context.application.bot_data['schedules'] = schedules
            role_full = get_full_role_name(role)
            text = f"✅ <b>Наряд добавлен</b>:\n\n👤 {fio}\n📅 {date}\n🔧 {role_full}"

    except Exception as e:
        logger.error(f"Ошибка при редактировании графика: {e}")
        text = "❌ Ошибка при сохранении. Обратитесь к администратору."

    await query.edit_message_text(
        text,
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("➕ Другой наряд", callback_data="start_edit_schedule")],
            [InlineKeyboardButton("⬅️ В меню", callback_data="back_to_main")]
        ])
    )

    return ConversationHandler.END

# === ОТМЕНА РЕДАКТИРОВАНИЯ ===
async def cancel_edit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("❌ Редактирование отменено.")
    return ConversationHandler.END

# === ЭКСПОРТ — ConversationHandler ===
edit_schedule_handler = ConversationHandler(
    entry_points=[
        CallbackQueryHandler(start_edit_schedule, pattern="^start_edit_schedule$")
    ],
    states={
        SELECT_ACTION: [CallbackQueryHandler(select_action, pattern="^edit_action_")],
        SELECT_MONTH: [CallbackQueryHandler(select_month, pattern="^edit_month_")],
        SELECT_FIO: [
            CallbackQueryHandler(save_selected_fio, pattern="^edit_fio_"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, enter_fio_manual)
        ],
        SELECT_DATE: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_date_input)],
        SELECT_ROLE: [CallbackQueryHandler(save_role_and_confirm, pattern="^edit_role_")],
        CONFIRM_EDIT: [CallbackQueryHandler(execute_edit, pattern="^confirm_edit$")]
    },
    fallbacks=[
        CallbackQueryHandler(cancel_edit, pattern="^back_to_main$")
    ],
    allow_reentry=True
)

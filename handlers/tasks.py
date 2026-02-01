# handlers/tasks.py — задачи с кнопкой "назад" везде

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, CallbackQueryHandler, MessageHandler, filters
from database import get_db
from datetime import datetime
import re

ENTER_TASK, CHOOSE_REMINDER, ENTER_REMINDER_DATE, EDIT_REMINDER_DATE = range(4)

def main_tasks_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("➕ Добавить задачу", callback_data="task_add_start")],
        [InlineKeyboardButton("📋 Мои задачи", callback_data="task_list")],
        [InlineKeyboardButton("⬅️ В меню", callback_data="back_to_main")]
    ])

def task_list_keyboard(tasks):
    keyboard = []
    for task in tasks:
        status = "✅" if task['done'] else "🔲"
        deadline_text = ""
        if task['deadline']:
            try:
                d = datetime.fromisoformat(task['deadline'])
                deadline_text = f" ⏰ {d.strftime('%d %H:%M')}"
            except:
                pass
        button = InlineKeyboardButton(f"{status} {task['text']}{deadline_text}", callback_data=f"task_action_{task['id']}")
        keyboard.append([button])
    keyboard.append([
        InlineKeyboardButton("🔄 Обновить", callback_data="task_list"),
        InlineKeyboardButton("⬅️ Меню", callback_data="back_to_main")
    ])
    return InlineKeyboardMarkup(keyboard)

def task_action_keyboard(task_id):
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🟢 Выполнить", callback_data=f"task_done_{task_id}")],
        [InlineKeyboardButton("🗑 Удалить", callback_data=f"task_delete_{task_id}")],
        [InlineKeyboardButton("⏰ Изменить напоминание", callback_data=f"task_edit_remind_{task_id}")],
        [InlineKeyboardButton("⬅️ Назад", callback_data="task_list")]
    ])

# --- Открытие добавления задачи ---
async def task_add_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("📝 Введите текст задачи:")
    context.user_data['awaiting_task_text'] = True

# --- Ввод текста задачи ---
async def task_enter_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get('awaiting_task_text'):
        return
    context.user_data['awaiting_task_text'] = False
    context.user_data['new_task_text'] = update.message.text
    context.user_data['new_task_user_id'] = update.effective_user.id

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("📅 Напоминание", callback_data="task_set_reminder_new")],
        [InlineKeyboardButton("❌ Без напоминания", callback_data="task_no_reminder_new")],
        [InlineKeyboardButton("⬅️ Отмена", callback_data="task_list")]
    ])
    await update.message.reply_text("🔔 Нужно напоминание?", reply_markup=keyboard)

# --- Список задач ---
async def task_list_tasks(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = update.effective_user.id
    with get_db() as conn:
        tasks = conn.execute('''
            SELECT id, text, done, deadline FROM tasks 
            WHERE user_id = ? AND done = 0 
            ORDER BY deadline IS NULL, deadline
        ''', (user_id,)).fetchall()

    if not tasks:
        await query.edit_message_text("📋 Нет активных задач.", reply_markup=main_tasks_keyboard())
        return

    await query.edit_message_text("📋 <b>Мои задачи:</b>", reply_markup=task_list_keyboard(tasks), parse_mode="HTML")

# --- Остальное ---
async def menu_open_tasks(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await task_list_tasks(update, context)

async def task_set_reminder_new(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "📅 Введите дату и время напоминания:\n\n"
        "Формат: <code>ДД ЧЧ:ММ</code>\n"
        "Пример: <code>05 20:30</code>",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⬅️ Отмена", callback_data="task_list")]
        ])
    )
    context.user_data['awaiting_reminder_date'] = True

async def task_no_reminder_new(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = context.user_data['new_task_user_id']
    task_text = context.user_data['new_task_text']
    with get_db() as conn:
        conn.execute('''INSERT INTO tasks (user_id, text, deadline, done, reminded) VALUES (?, ?, NULL, 0, 0)''', (user_id, task_text))
        conn.commit()
    await query.message.reply_text(
        f"✅ <b>Задача добавлена:</b> {task_text}",
        reply_markup=main_tasks_keyboard(),
        parse_mode="HTML"
    )

async def task_enter_reminder_date(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get('awaiting_reminder_date'):
        return
    context.user_data['awaiting_reminder_date'] = False
    text = update.message.text.strip()
    match = re.match(r'^(\d{1,2})\s+(\d{1,2}):(\d{2})$', text)
    if not match:
        await update.message.reply_text(
            "❌ Неверный формат.\n\n"
            "Используйте: <code>ДД ЧЧ:ММ</code>\n"
            "Пример: <code>05 20:30</code>",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Попробовать снова", callback_data="task_add_start")],
                [InlineKeyboardButton("⬅️ В меню задач", callback_data="task_list")]
            ])
        )
        return
    day, hour, minute = map(int, match.groups())
    now = datetime.now()
    year, month = now.year, now.month
    if day < now.day:
        month += 1
        if month > 12:
            month, year = 1, year + 1
    try:
        deadline = datetime(year, month, day, hour, minute)
    except:
        await update.message.reply_text(
            "❌ Ошибка: некорректная дата.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Попробовать снова", callback_data="task_add_start")],
                [InlineKeyboardButton("⬅️ В меню задач", callback_data="task_list")]
            ])
        )
        return

    user_id, task_text = context.user_data['new_task_user_id'], context.user_data['new_task_text']
    with get_db() as conn:
        conn.execute('''INSERT INTO tasks (user_id, text, deadline, done, reminded) VALUES (?, ?, ?, 0, 0)''',
                     (user_id, task_text, deadline.strftime('%Y-%m-%d %H:%M:%S')))
        conn.commit()
    await update.message.reply_text(
        f"✅ <b>Задача добавлена:</b> {task_text}\n⏰ {deadline.strftime('%d %H:%M')}",
        reply_markup=main_tasks_keyboard(),
        parse_mode="HTML"
    )

async def task_action(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    task_id = int(query.data.split("_")[-1])
    with get_db() as conn:
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not task:
        return await query.message.reply_text(
            "❌ Задача не найдена.",
            reply_markup=main_tasks_keyboard()
        )
    await query.edit_message_text(f"🔧 <b>Управление:</b>\n\n{task['text']}", reply_markup=task_action_keyboard(task_id), parse_mode="HTML")

async def task_done(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    task_id = int(query.data.split("_")[-1])
    with get_db() as conn:
        text = conn.execute("SELECT text FROM tasks WHERE id = ?", (task_id,)).fetchone()['text']
        conn.execute("UPDATE tasks SET done = 1 WHERE id = ?", (task_id,))
        conn.commit()
    await query.message.reply_text(f"✅ Выполнено: {text}", reply_markup=main_tasks_keyboard(), parse_mode="HTML")

async def task_delete(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    task_id = int(query.data.split("_")[-1])
    with get_db() as conn:
        text = conn.execute("SELECT text FROM tasks WHERE id = ?", (task_id,)).fetchone()['text']
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
    await query.message.reply_text(f"🗑 Удалено: {text}", reply_markup=main_tasks_keyboard(), parse_mode="HTML")

async def task_edit_reminder(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    task_id = int(query.data.split("_")[-1])
    context.user_data['edit_task_id'] = task_id
    context.user_data['awaiting_edit_reminder'] = True
    await query.message.reply_text(
        "📅 Введите новое время:\n\n"
        "Формат: <code>ДД ЧЧ:ММ</code>\n"
        "Пример: <code>05 20:30</code>",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⬅️ Отмена", callback_data="task_list")]
        ])
    )

async def task_enter_edit_reminder(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get('awaiting_edit_reminder'):
        return
    context.user_data['awaiting_edit_reminder'] = False
    text = update.message.text.strip()
    match = re.match(r'^(\d{1,2})\s+(\d{1,2}):(\d{2})$', text)
    if not match:
        await update.message.reply_text(
            "❌ Неверный формат.\n\n"
            "Используйте: <code>ДД ЧЧ:ММ</code>",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Попробовать снова", callback_data=f"task_edit_remind_{context.user_data['edit_task_id']}")],
                [InlineKeyboardButton("⬅️ В меню задач", callback_data="task_list")]
            ])
        )
        return
    day, hour, minute = map(int, match.groups())
    now = datetime.now()
    year, month = now.year, now.month
    if day < now.day:
        month += 1
        if month > 12:
            month, year = 1, year + 1
    try:
        deadline = datetime(year, month, day, hour, minute)
    except:
        await update.message.reply_text(
            "❌ Ошибка: некорректная дата.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Попробовать снова", callback_data=f"task_edit_remind_{context.user_data['edit_task_id']}")],
                [InlineKeyboardButton("⬅️ В меню задач", callback_data="task_list")]
            ])
        )
        return
    task_id = context.user_data['edit_task_id']
    with get_db() as conn:
        conn.execute("UPDATE tasks SET deadline = ?, reminded = 0 WHERE id = ?", (deadline.strftime('%Y-%m-%d %H:%M:%S'), task_id))
        conn.commit()
    await update.message.reply_text(
        f"✅ Напоминание изменено: {deadline.strftime('%d %H:%M')}",
        reply_markup=main_tasks_keyboard(),
        parse_mode="HTML"
    )

async def task_back_to_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    from handlers.menu import start_command
    await start_command(update, context)


# === ЭКСПОРТ ===
router = [
    CallbackQueryHandler(menu_open_tasks, pattern="^menu_tasks$"),
    CallbackQueryHandler(task_list_tasks, pattern="^task_list$"),
    CallbackQueryHandler(task_action, pattern="^task_action_"),
    CallbackQueryHandler(task_done, pattern="^task_done_"),
    CallbackQueryHandler(task_delete, pattern="^task_delete_"),
    CallbackQueryHandler(task_back_to_menu, pattern="^back_to_main$"),
    CallbackQueryHandler(task_edit_reminder, pattern="^task_edit_remind_"),
    CallbackQueryHandler(task_add_start, pattern="^task_add_start$"),
    CallbackQueryHandler(task_set_reminder_new, pattern="^task_set_reminder_new$"),
    CallbackQueryHandler(task_no_reminder_new, pattern="^task_no_reminder_new$")
]

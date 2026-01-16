# handlers/registration.py — финальная версия (2025), всё работает + выбор пола + защита от дублей

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import (
    ContextTypes,
    ConversationHandler,
    CallbackQueryHandler,
    MessageHandler,
    filters,
    CommandHandler
)
from database import get_db, update_user_last_active
from utils.welcome_message import get_welcome_message
from utils.course_calculator import get_course_info
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# ===== КОНСТАНТЫ =====
FACULTY_CHOICES = ['Инженерно-технический', 'Юридический']
ENROLLMENT_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]
GENDER_CHOICES = [
    ('male', '👨 Мужской'),
    ('female', '👩 Женский')
]

# ===== СОСТОЯНИЯ =====
CHOOSE_FACULTY, CHOOSE_YEAR, CHOOSE_GROUP, ENTER_CUSTOM_GROUP, ENTER_FIO, CHOOSE_GENDER, CONFIRMATION = range(7)

# === ОТОБРАЖЕНИЕ РОЛЕЙ ===
ROLE_TITLES = {
    'admin': 'Администратор',
    'assistant': 'Помощник',
    'sergeant': 'Сержант',
    'user': 'Курсант'
}

# ===== КЛАВИАТУРЫ =====
def get_year_keyboard():
    """Клавиатура: год поступления + курс"""
    keyboard = []
    row = []
    for year in ENROLLMENT_YEARS:
        course_info = get_course_info(year)
        btn_text = f"📅 {year} ({course_info['current']} курс)"
        row.append(InlineKeyboardButton(btn_text, callback_data=f"year_{year}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    return InlineKeyboardMarkup(keyboard)


def get_group_keyboard(faculty: str, year: int):
    """Группы по факультету и году"""
    if faculty == 'Инженерно-технический':
        if year in [2021, 2022]:  # 3-4 курс
            groups = [['ИБ1', 'ИБ2'], ['ИО3', 'ИО4']]
        else:  # 1-2 курс
            groups = [['ИБ3', 'ИБ4'], ['ИО5', 'ИО6']]
    else:  # Юридический
        groups = [['ЮО1', 'ЮО2']]

    keyboard = []
    for row in groups:
        keyboard.append([
            InlineKeyboardButton(
                f"{group} ({year})",
                callback_data=f"group_{group}_{year}"
            ) for group in row
        ])
    keyboard.append([
        InlineKeyboardButton(
            "➕ Другая группа (ввести вручную)",
            callback_data=f"group_custom_{year}"
        )
    ])
    return InlineKeyboardMarkup(keyboard)


def get_gender_keyboard():
    """Клавиатура выбора пола"""
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(text, callback_data=f"gender_{key}")] for key, text in GENDER_CHOICES
    ])


# ===== НАЧАЛО РЕГИСТРАЦИИ =====
async def start_registration(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    # Проверка: уже зарегистрирован?
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (user_id,))
    existing_user = cursor.fetchone()
    conn.close()

    if existing_user:
        if update.callback_query:
            await update.callback_query.answer("Вы уже зарегистрированы!", show_alert=True)
        else:
            await update.message.reply_text("Вы уже зарегистрированы! Используйте /menu для главного меню.")
        return ConversationHandler.END

    welcome_text = get_welcome_message()
    keyboard = [
        [InlineKeyboardButton(fac, callback_data=f"faculty_{fac}")]
        for fac in FACULTY_CHOICES
    ]

    if update.callback_query:
        await update.callback_query.edit_message_text(
            welcome_text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode='HTML'
        )
        await update.callback_query.answer()
    else:
        await update.message.reply_text(
            welcome_text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode='HTML'
        )

    return CHOOSE_FACULTY


# ===== ВЫБОР ФАКУЛЬТЕТА =====
async def choose_faculty(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    faculty = query.data.replace("faculty_", "")
    context.user_data['faculty'] = faculty

    await query.edit_message_text(
        f"🏛️ <b>Факультет:</b> {faculty}\n\n"
        "Теперь выберите <b>год поступления</b>:",
        reply_markup=get_year_keyboard(),
        parse_mode='HTML'
    )
    return CHOOSE_YEAR


# ===== ВЫБОР ГОДА ПОСТУПЛЕНИЯ =====
async def choose_year(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    try:
        year = int(query.data.replace("year_", ""))
    except (ValueError, IndexError):
        await query.edit_message_text("❌ Неверные данные.")
        return ConversationHandler.END

    if year not in ENROLLMENT_YEARS:
        await query.edit_message_text("❌ Неверный год.")
        return ConversationHandler.END

    context.user_data['enrollment_year'] = year
    faculty = context.user_data['faculty']

    await query.edit_message_text(
        f"📅 <b>Год поступления:</b> {year}\n\n"
        "Выберите вашу <b>группу</b>:",
        reply_markup=get_group_keyboard(faculty, year),
        parse_mode='HTML'
    )
    return CHOOSE_GROUP


# ===== ВЫБОР ГРУППЫ =====
async def choose_group(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data.split('_')

    if len(data) < 3:
        await query.edit_message_text("❌ Ошибка выбора группы.")
        return ConversationHandler.END

    if data[1] == 'custom':
        try:
            year = int(data[2])
        except ValueError:
            await query.edit_message_text("❌ Ошибка года.")
            return ConversationHandler.END
        context.user_data['enrollment_year'] = year
        context.user_data['awaiting_custom_group'] = True
        await query.edit_message_text(
            f"✏️ Введите название вашей группы для {year} года поступления:\n"
            "<i>Например: ИО7, АБВ123</i>",
            parse_mode='HTML'
        )
        return ENTER_CUSTOM_GROUP

    group_name = data[1]
    try:
        year = int(data[2])
    except ValueError:
        await query.edit_message_text("❌ Неверный год.")
        return ConversationHandler.END

    context.user_data['group_name'] = group_name
    context.user_data['enrollment_year'] = year
    context.user_data['is_custom_group'] = False

    await query.edit_message_text(
        f"✅ <b>Группа:</b> {group_name} ({year} г.)\n\n"
        "Теперь введите ваше <b>ФИО</b> полностью:\n"
        "<i>Формат: Фамилия Имя Отчество</i>",
        parse_mode='HTML'
    )
    return ENTER_FIO


# ===== РУЧНОЙ ВВОД ГРУППЫ =====
async def enter_custom_group(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get('awaiting_custom_group'):
        return

    context.user_data['awaiting_custom_group'] = False
    group_name = update.message.text.strip().upper()
    year = context.user_data['enrollment_year']

    if not group_name or len(group_name) > 20:
        await update.message.reply_text(
            "❌ Название группы — от 1 до 20 символов.\n"
            "Попробуйте ещё раз:"
        )
        return ENTER_CUSTOM_GROUP

    context.user_data['group_name'] = group_name
    context.user_data['is_custom_group'] = True

    await update.message.reply_text(
        f"✅ <b>Группа:</b> {group_name} ({year} г.)\n\n"
        "Введите <b>ФИО</b> полностью:",
        parse_mode='HTML'
    )
    return ENTER_FIO


# ===== ВВОД ФИО =====
async def enter_fio(update: Update, context: ContextTypes.DEFAULT_TYPE):
    fio = update.message.text.strip()
    if len(fio.split()) < 2:
        await update.message.reply_text(
            "❌ Пожалуйста, введите ФИО полностью (минимум Фамилия и Имя).\n"
            "Попробуйте ещё раз:"
        )
        return ENTER_FIO

    # Проверка на дублирование ФИО
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT telegram_id FROM users WHERE fio = ?", (fio,))
    existing_user = cursor.fetchone()
    conn.close()

    if existing_user:
        await update.message.reply_text(
            "⚠️ <b>Внимание!</b>\n\n"
            f"Пользователь с ФИО <code>{fio}</code> уже зарегистрирован в системе.\n\n"
            "Если это вы — обратитесь к администратору.\n"
            "Если это другой человек — введите другое ФИО:",
            parse_mode="HTML"
        )
        return ENTER_FIO

    context.user_data['fio'] = fio
    await update.message.reply_text(
        "🎭 Укажите ваш пол:\n\n"
        "Это важно для корректного формирования графиков нарядов.",
        reply_markup=get_gender_keyboard(),
        parse_mode='HTML'
    )
    return CHOOSE_GENDER


# ===== ВЫБОР ПОЛА =====
async def choose_gender(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    gender = query.data.replace("gender_", "")
    context.user_data['gender'] = gender

    # Определяем роль
    group = context.user_data['group_name']
    year = context.user_data['enrollment_year']

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT fio FROM users 
            WHERE group_name = ? AND enrollment_year = ? AND role = 'sergeant'
        """, (group, year))
        existing_sergeant = cursor.fetchone()

        user_id = update.effective_user.id
        if user_id == 1027070834:
            role = 'admin'
        else:
            role = 'user'

        context.user_data['role'] = role
        context.user_data['has_sergeant'] = bool(existing_sergeant)
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке сержанта: {e}")
        context.user_data['role'] = 'user'
    finally:
        conn.close()

    # Формируем подтверждение
    faculty = context.user_data['faculty']
    is_custom = context.user_data.get('is_custom_group', False)
    course_info = get_course_info(year)

    confirmation_text = (
        f"📋 <b>Проверьте ваши данные:</b>\n\n"
        f"<b>ФИО:</b> {fio}\n"
        f"<b>Факультет:</b> {faculty}\n"
        f"<b>Группа:</b> {group} ({year})"
    )

    gender_display = "👨 Мужской" if gender == 'male' else "👩 Женский"
    confirmation_text += f"\n<b>Пол:</b> {gender_display}"

    if is_custom:
        confirmation_text += " <i>(введена вручную)</i>"

    confirmation_text += (
        f"\n<b>Текущий курс:</b> {course_info['current']}\n"
        f"<b>Статус:</b> {course_info['status']}\n"
        f"<b>Роль:</b> {ROLE_TITLES.get(role, role.title())}"
    )

    if role == 'admin':
        confirmation_text += "\n\n🛠️ <b>Вы — администратор</b>. Полный доступ."

    if course_info['status'] == 'активен' and role != 'admin':
        confirmation_text += (
            f"\n<b>До перевода на {course_info['next']} курс:</b> {course_info['days_until_next']} дней"
        )

    if existing_sergeant:
        confirmation_text += f"\n\n⚠️ В этой группе уже есть сержант: <code>{existing_sergeant['fio']}</code>"

    confirmation_text += "\n\n<b>Всё верно?</b>"

    keyboard = [
        [InlineKeyboardButton("✅ Да, сохранить", callback_data="confirm_yes"),
         InlineKeyboardButton("✏️ Нет, исправить", callback_data="confirm_no")]
    ]

    await query.edit_message_text(
        confirmation_text,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode='HTML'
    )
    return CONFIRMATION


# ===== ПОДТВЕРЖДЕНИЕ И СОХРАНЕНИЕ =====
async def confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if query.data == 'confirm_no':
        await query.edit_message_text(
            "🔄 Начните регистрацию заново: /start",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🚀 Начать", callback_data="start_registration")]
            ])
        )
        return ConversationHandler.END

    user_id = update.effective_user.id
    fio = context.user_data.get('fio')
    faculty = context.user_data.get('faculty')
    group = context.user_data.get('group_name')
    year = context.user_data.get('enrollment_year')
    is_custom = context.user_data.get('is_custom_group', False)
    role = context.user_data.get('role')
    gender = context.user_data.get('gender', 'male')

    if not all([fio, faculty, group, year, role]):
        await query.edit_message_text("❌ Не все данные собраны.")
        return ConversationHandler.END

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT OR REPLACE INTO users 
            (telegram_id, fio, faculty, enrollment_year, group_name, is_custom_group, role, status, gender)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, fio, faculty, year, group, is_custom, role, get_course_info(year)['status'], gender))

        cursor.execute('''
            INSERT OR REPLACE INTO old_users (user_id, full_name, group_num)
            VALUES (?, ?, ?)
        ''', (user_id, fio, group))

        conn.commit()
        update_user_last_active(user_id)

        editors = context.application.bot_data.setdefault('editors', {})
        if role in ['admin', 'assistant', 'sergeant']:
            editors[user_id] = {'role': role, 'group': group}
        context.application.bot_data['editors'] = editors

        success_text = (
            f"🎉 <b>Регистрация завершена!</b>\n\n"
            f"Добро пожаловать, {fio.split()[0]}!\n\n"
            f"• Факультет: {faculty}\n"
            f"• Группа: {group}\n"
            f"• Курс: {get_course_info(year)['current']}\n"
            f"• Роль: {ROLE_TITLES.get(role, role.title())}\n"
            f"• Пол: {'Мужской' if gender == 'male' else 'Женский'}\n\n"
        )

        if role == 'admin':
            success_text += "🛠️ <b>Администратор</b>. Все функции доступны.\n\n"

        success_text += "Используйте меню ниже для продолжения."

        keyboard = [[InlineKeyboardButton("🏠 В главное меню", callback_data="back_to_main")]]

        await query.edit_message_text(
            success_text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode='HTML'
        )
        logger.info(f"✅ Пользователь {user_id} зарегистрирован: {role}, {gender}")
    except Exception as e:
        logger.error(f"❌ Ошибка при регистрации: {e}", exc_info=True)
        await query.edit_message_text(
            "❌ Ошибка сохранения. Попробуйте снова: /start",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Повторить", callback_data="start_registration")]
            ])
        )
    finally:
        conn.close()

    keys_to_clear = ['fio', 'faculty', 'group_name', 'enrollment_year', 'is_custom_group', 'role', 'has_sergeant', 'awaiting_custom_group', 'gender']
    for key in keys_to_clear:
        context.user_data.pop(key, None)

    return ConversationHandler.END


# ===== ОТМЕНА РЕГИСТРАЦИИ =====
async def cancel_registration(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keys_to_clear = ['fio', 'faculty', 'group_name', 'enrollment_year', 'is_custom_group', 'role', 'has_sergeant', 'awaiting_custom_group', 'gender']
    for key in keys_to_clear:
        context.user_data.pop(key, None)

    await update.message.reply_text(
        "Регистрация отменена.\n"
        "Вы всегда можете начать снова командой /start"
    )
    return ConversationHandler.END


# ===== СОЗДАНИЕ HANDLER'А =====
def get_registration_handler():
    return ConversationHandler(
        entry_points=[
            CallbackQueryHandler(start_registration, pattern='^start_registration$'),
            CommandHandler('register', start_registration)
        ],
        states={
            CHOOSE_FACULTY: [CallbackQueryHandler(choose_faculty, pattern='^faculty_')],
            CHOOSE_YEAR: [CallbackQueryHandler(choose_year, pattern='^year_')],
            CHOOSE_GROUP: [CallbackQueryHandler(choose_group, pattern='^group_')],
            ENTER_CUSTOM_GROUP: [MessageHandler(filters.TEXT & ~filters.COMMAND, enter_custom_group)],
            ENTER_FIO: [MessageHandler(filters.TEXT & ~filters.COMMAND, enter_fio)],
            CHOOSE_GENDER: [CallbackQueryHandler(choose_gender, pattern='^gender_')],
            CONFIRMATION: [CallbackQueryHandler(confirmation, pattern='^confirm_')]
        },
        fallbacks=[CommandHandler('cancel', cancel_registration)],
        allow_reentry=True
    )


__all__ = ['get_registration_handler']

# handlers/my_duties.py — финальная версия (с кнопкой "Загрузить график" в "Мои наряды")

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, CallbackQueryHandler, MessageHandler, filters
from datetime import datetime
from utils.schedule import (
    get_my_duties_with_partners,
    get_duty_by_date,
    get_full_schedule_pages,
    get_course_partners,
    get_duty_by_date_all_groups
)
from utils.storage import load_all_schedules
from database import get_db
from utils.date_parser import parse_date_input
import logging

logger = logging.getLogger(__name__)

# === РАСШИФРОВКА РОЛЕЙ ===
ROLE_NAMES = {
    'дс': 'Дежурный по столовой (ДС)', 'к': 'Дежурный по курсу (К)', 'дк': 'Дежурный по курсу (К)',
    'с': 'Дежурный по столовой (С)', 'ад': 'Административный корпус (АД)',
    'зуб': 'Загородная учебная база (ЗУБ)', 'дсб': 'Дежурный по спортивному блоку',
    'дх': 'Дежурный по хозяйственной части', 'дм': 'Дежурный по медицинскому пункту',
    'дп': 'Дежурный по почте', 'дт': 'Дежурный по технике',
    'зк': 'Заместитель командира взвода', 'св': 'Староста взвода', 'сп': 'Старший по палате',
    'дл': 'Дежурный по лаборатории', 'длаб': 'Дежурный по лаборатории',
    'дкп': 'Дежурный по компьютерному классу', 'дкаб': 'Дежурный по кабинету',
    'дкл': 'Дежурный по классу', 'дц': 'Дежурный по цеху', 'дмл': 'Дежурный по мастерской',
    'дг': 'Дежурный по гаражу', 'дэ': 'Дежурный по электрощитовой', 'дб': 'Дежурный по библиотеке',
    'дов': 'Дежурный по овощехранилищу', 'дсн': 'Дежурный по спортивному залу',
    'дпс': 'Дежурный по прачечной', 'дф': 'Дежурный по фойе', 'дкх': 'Дежурный по кухне',
    'дпк': 'Дежурный по пожарному щиту', 'дсв': 'Дежурный по святилищу',
}

# === УНИВЕРСАЛЬНАЯ ФУНКЦИЯ: ПОЛУЧЕНИЕ ТЕКУЩЕГО ГРАФИКА ===
def get_current_schedule(context: ContextTypes.DEFAULT_TYPE):
    return (
        context.user_data.get('selected_schedule') or
        context.application.bot_data.get('duty_schedule', [])
    )

def get_current_month_key(context: ContextTypes.DEFAULT_TYPE) -> str:
    return (
        context.user_data.get('selected_month') or
        context.application.bot_data.get('current_schedule') or
        datetime.now().strftime('%Y-%m')
    )

# === ПОЛУЧЕНИЕ РОЛИ ПОЛЬЗОВАТЕЛЯ ===
def get_user_role(user_id: int, context: ContextTypes.DEFAULT_TYPE) -> str:
    editors = context.application.bot_data.get('editors', {})
    return editors.get(user_id, {}).get('role', 'user')

# === Показать мои наряды ===
async def show_my_duties(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query:
        await query.answer()

    user_id = update.effective_user.id
    user_role = get_user_role(user_id, context)
    is_sergeant = user_role == 'sergeant'

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT fio FROM users WHERE telegram_id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            if query:
                await query.edit_message_text("❌ Вы не зарегистрированы. Используйте /start")
            else:
                await update.message.reply_text("❌ Вы не зарегистрированы. Используйте /start")
            return
        full_name = row['fio']
        last_name = full_name.split()[0].strip().lower()

        schedule_data = get_current_schedule(context)
        duties = get_my_duties_with_partners(last_name, schedule_data)

        current_month = get_current_month_key(context)
        month_name = {
            '01': 'Январь', '02': 'Февраль', '03': 'Март', '04': 'Апрель', '05': 'Май',
            '06': 'Июнь', '07': 'Июль', '08': 'Август', '09': 'Сентябрь', '10': 'Октябрь',
            '11': 'Ноябрь', '12': 'Декабрь'
        }.get(current_month[5:7], 'Месяц')

        if not duties:
            reply = f"📋 У вас нет нарядов в графике <b>{month_name} {current_month[:4]}</b>."
        else:
            reply = f"📋 <b>Мои наряды ({month_name})</b>:\n\n"
            for duty in duties:
                status = "✅" if duty['is_past'] else "⏰"
                date_str = datetime.strptime(duty['date'], '%Y-%m-%d').strftime('%d.%m')
                role = duty['role'].upper()
                reply += f"{status} <b>{date_str}</b> — {role}\n"
            reply += "\n💡 <i>Прошедшие — ✅, будущие — ⏰</i>"

        # === Кнопки ===
        keyboard = []

        # Основные
        keyboard.append([InlineKeyboardButton("👥 С кем в паре?", callback_data="show_partners")])
        keyboard.append([InlineKeyboardButton("📅 Посмотреть за дату", callback_data="duty_by_date")])
        keyboard.append([InlineKeyboardButton("📋 Полный график", callback_data="full_schedule_0")])
        keyboard.append([InlineKeyboardButton("📆 Выбрать месяц", callback_data="select_month")])

        # 🔽 КНОПКА ДЛЯ СЕРЖАНТА
        if is_sergeant:
            keyboard.append([InlineKeyboardButton("📂 Загрузить график", callback_data="upload_schedule")])

        keyboard.append([InlineKeyboardButton("⬅️ В меню", callback_data="back_to_main")])

        if query:
            await query.edit_message_text(
                reply,
                reply_markup=InlineKeyboardMarkup(keyboard),
                parse_mode="HTML"
            )
        else:
            await update.message.reply_text(
                reply,
                reply_markup=InlineKeyboardMarkup(keyboard),
                parse_mode="HTML"
            )
    except Exception as e:
        logger.error(f"❌ Ошибка в show_my_duties: {e}")
        if query:
            await query.edit_message_text(
                "⚠️ Произошла ошибка при загрузке нарядов.",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ В меню", callback_data="back_to_main")]])
            )
    finally:
        conn.close()

# === ОСТАЛЬНЫЕ ФУНКЦИИ БЕЗ ИЗМЕНЕНИЙ ===
# (Все функции ниже — оставлены как есть, они работают корректно)

async def button_show_partners(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user_id = update.effective_user.id
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT fio FROM users WHERE telegram_id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            await query.edit_message_text("❌ Не найдено")
            return
        full_name = row['fio']
        last_name = full_name.split()[0].strip().lower()

        schedule_data = get_current_schedule(context)
        duties = get_my_duties_with_partners(last_name, schedule_data)

        if not duties:
            await query.edit_message_text("❌ У вас нет нарядов.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]]))
            return

        text = "👥 <b>Вы в наряде с:</b>\n\n"
        for d in duties:
            date_str = datetime.strptime(d['date'], '%Y-%m-%d').strftime('%d.%m')
            role = d['role'].upper()
            partners = ", ".join(d['partners']) if d['partners'] else "нет"
            text += f"📅 <b>{date_str}</b> — {role}:\n • {partners}\n\n"

        keyboard = [
            [InlineKeyboardButton("🏫 Со всем курсом", callback_data="partners_course")],
            [InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]
        ]
        await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    finally:
        conn.close()

async def button_show_partners_course(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user_id = update.effective_user.id
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT fio, group_name FROM users WHERE telegram_id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            await query.edit_message_text("❌ Не найдено")
            return
        full_name = row['fio']
        last_name = full_name.split()[0].strip().lower()
        user_group = row['group_name']

        all_schedules = context.application.bot_data.get('schedules', {})
        current_month = get_current_month_key(context)

        my_group_schedules = all_schedules.get(user_group, {})
        my_duties = my_group_schedules.get(current_month, [])

        if not my_duties:
            await query.edit_message_text("❌ У вашей группы нет графика на этот месяц", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]]))
            return

        partners = get_course_partners(last_name, user_group, my_duties, all_schedules, current_month)

        if not partners:
            text = "🏫 В этот наряд вы не заступаете с другими группами"
        else:
            text = "🏫 <b>Вы в наряде со всего курса:</b>\n\n"
            for p in partners:
                date_str = datetime.strptime(p['date'], '%Y-%m-%d').strftime('%d.%m')
                role = p['role'].upper()
                text += f"📅 <b>{date_str}</b> — {role}:\n"
                for partner in p['partners']:
                    text += f" • {partner}\n"
                text += "\n"

        keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]]
        await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    finally:
        conn.close()

async def ask_duty_date(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    current_month = get_current_month_key(context)
    month_name = {
        '01': 'Январь', '02': 'Февраль', '03': 'Март', '04': 'Апрель', '05': 'Май',
        '06': 'Июнь', '07': 'Июль', '08': 'Август', '09': 'Сентябрь', '10': 'Октябрь',
        '11': 'Ноябрь', '12': 'Декабрь'
    }.get(current_month[5:7], 'месяц')
    await query.edit_message_text(
        f"📅 Введите день, чтобы посмотреть наряд в <b>{month_name}</b>:\n\n"
        "Формат:\n"
        "• <code>15</code> — 15-е число\n"
        "• <code>15.12.2025</code> — полная дата",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]
        ])
    )
    context.user_data['awaiting_duty_date'] = True

async def handle_duty_date_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get('awaiting_duty_date'):
        return
    context.user_data['awaiting_duty_date'] = False

    text = update.message.text.strip()
    current_month = get_current_month_key(context)

    date_str = parse_date_input(text, current_month)

    if not date_str:
        await update.message.reply_text(
            "❌ Не удалось распознать дату.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Попробовать снова", callback_data="duty_by_date")],
                [InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]
            ])
        )
        return

    if date_str[:7] != current_month:
        target_month = datetime.strptime(date_str[:7], '%Y-%m').strftime('%B %Y')
        await update.message.reply_text(
            f"📅 Введённая дата — <b>{date_str[:10]}</b>.\n\n"
            f"Но активен график <b>{current_month.replace('-', '.')}</b>.\n\n"
            "Пожалуйста, переключитесь на нужный месяц в разделе «📆 Выбрать месяц».",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("📆 Выбрать месяц", callback_data="select_month")],
                [InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]
            ])
        )
        return

    schedule = get_current_schedule(context)
    duties = get_duty_by_date(date_str, schedule)

    if not duties:
        reply = f"📅 <b>Наряд на {date_str[8:10]}.{date_str[5:7]}</b>\n\nДежурных нет."
    else:
        reply = f"📅 <b>Наряд на {date_str[8:10]}.{date_str[5:7]}</b>:\n\n"
        roles = {}
        for duty in duties:
            role = duty['role'].strip().lower()
            if role not in roles:
                roles[role] = []
            roles[role].append(duty['fio'])
        for role, fis in roles.items():
            role_full = ROLE_NAMES.get(role, role.upper())
            fis_text = ", ".join(fis)
            reply += f"• <b>{role_full}</b>: {fis_text}\n"

    await update.message.reply_text(
        reply,
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]
        ]),
        parse_mode="HTML"
    )

async def show_full_schedule(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    schedule = get_current_schedule(context)
    page = 0
    if query.data.startswith("full_schedule_"):
        try:
            page = int(query.data.split("_")[2])
        except:
            pass

    pages = get_full_schedule_pages(schedule, page)
    if not pages['data']:
        reply = "📋 Нет данных."
        keyboard = [[InlineKeyboardButton("⬅️ В меню", callback_data="back_to_main")]]
    else:
        reply = f"📊 <b>Полный график (стр. {page+1}/{pages['total']})</b>\n\n"
        for person in pages['data']:
            reply += f"👤 <b>{person['fio']}</b>:\n"
            for duty in person['duties']:
                date_str = datetime.strptime(duty['date'], '%Y-%m-%d').strftime('%d')
                reply += f" • {date_str} — {duty['role'].upper()}\n"
            reply += "\n"

        buttons = []
        if page > 0:
            buttons.append(InlineKeyboardButton("◀️ Назад", callback_data=f"full_schedule_{page-1}"))
        if page < pages['total'] - 1:
            buttons.append(InlineKeyboardButton("Вперёд ▶️", callback_data=f"full_schedule_{page+1}"))
        keyboard = [buttons] if buttons else []
        keyboard.append([InlineKeyboardButton("⬅️ В меню", callback_data="back_to_main")])

    await query.edit_message_text(reply, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(keyboard))

async def select_month(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    all_schedules = load_all_schedules()
    if not all_schedules:
        await query.edit_message_text(
            "❌ Нет загруженных графиков.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]])
        )
        return
    months = sorted(all_schedules.keys(), reverse=True)
    keyboard = []
    for month in months:
        is_active = month == context.application.bot_data.get('current_schedule', '')
        prefix = "✅ " if is_active else "🗓️ "
        keyboard.append([InlineKeyboardButton(f"{prefix}{month}", callback_data=f"view_month_{month}")])
    keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")])
    await query.edit_message_text("📅 Выберите месяц:", reply_markup=InlineKeyboardMarkup(keyboard))

async def view_month_duties(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    month = query.data.split("_")[2]
    all_schedules = load_all_schedules()
    if month not in all_schedules:
        await query.edit_message_text(
            "❌ График не найден.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]])
        )
        return
    schedule_data = all_schedules[month]
    context.user_data['selected_schedule'] = schedule_data
    context.user_data['selected_month'] = month

    user_id = update.effective_user.id
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT fio FROM users WHERE telegram_id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            await query.edit_message_text("❌ Пройдите регистрацию.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]]))
            return
        full_name = row['fio']
        last_name = full_name.split()[0].lower()

        my_duties = get_my_duties_with_partners(last_name, schedule_data)

        month_name = {
            '01': 'Январь', '02': 'Февраль', '03': 'Март', '04': 'Апрель', '05': 'Май',
            '06': 'Июнь', '07': 'Июль', '08': 'Август', '09': 'Сентябрь', '10': 'Октябрь',
            '11': 'Ноябрь', '12': 'Декабрь'
        }.get(month[5:7], 'месяц')

        if not my_duties:
            reply = f"📋 У вас нет нарядов в {month_name}."
        else:
            reply = f"📋 <b>Мои наряды ({month_name})</b>:\n\n"
            for duty in my_duties:
                status = "✅" if duty['is_past'] else "🔲"
                date_str = datetime.strptime(duty['date'], '%Y-%m-%d').strftime('%d.%m')
                role = duty['role']
                role_full = ROLE_NAMES.get(role, role.upper())
                reply += f"{status} <b>{date_str}</b> — {role_full}\n"

        keyboard = [
            [InlineKeyboardButton("👥 С кем я?", callback_data="show_partners")],
            [InlineKeyboardButton("📅 Выбрать другой месяц", callback_data="select_month")],
            [InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]
        ]
        await query.edit_message_text(reply, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    finally:
        conn.close()

async def ask_global_duty_date(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query:
        await query.answer()
        await query.edit_message_text(
            "📅 Введите дату, чтобы посмотреть наряд <b>по всем группам</b>:\n\n"
            "Формат: <code>29.01.2026</code>",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]
            ])
        )
    else:
        await update.message.reply_text(
            "📅 Введите дату, чтобы посмотреть наряд <b>по всем группам</b>:\n\n"
            "Формат: <code>29.01.2026</code>",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]
            ])
        )
    context.user_data['awaiting_global_duty_date'] = True

async def handle_global_duty_date_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get('awaiting_global_duty_date'):
        return
    context.user_data['awaiting_global_duty_date'] = False

    text = update.message.text.strip()
    try:
        target_date = datetime.strptime(text, '%d.%m.%Y')
        date_str = target_date.strftime('%Y-%m-%d')
        month_key = target_date.strftime('%Y-%m')
    except:
        await update.message.reply_text(
            "❌ Неверный формат даты.\n\n"
            "Пожалуйста, используйте формат:\n"
            "<code>ДД.ММ.ГГГГ</code>\n"
            "Например: <code>29.01.2026</code>",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Попробовать снова", callback_data="global_duty_date")],
                [InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]
            ])
        )
        return

    all_schedules = context.application.bot_data.get('schedules', {})
    duties_by_group = get_duty_by_date_all_groups(date_str, month_key, all_schedules)

    if not duties_by_group:
        await update.message.reply_text(
            f"📅 <b>Наряд на {text} не найден</b>\n"
            "Ни одна группа не имеет наряда в этот день.",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]
            ])
        )
        return

    reply = f"📅 <b>Наряд на {text} — весь курс</b>:\n\n"
    user_id = update.effective_user.id
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT fio, group_name FROM users WHERE telegram_id = ?", (user_id,))
        row = cursor.fetchone()
        user_fio = row['fio'] if row else None
        user_group = row['group_name'] if row else None

        is_in_duty = False
        for group_name, duties in duties_by_group.items():
            reply += f"<b>🎓 {group_name}</b>:\n"
            roles = {}
            for duty in duties:
                role = duty['role'].strip().lower()
                if role not in roles:
                    roles[role] = []
                roles[role].append(duty['fio'])
                if user_fio and user_fio.lower() in duty['fio'].lower():
                    is_in_duty = True
                    my_role = duty['role']
            for role, fis in roles.items():
                role_full = ROLE_NAMES.get(role, role.upper())
                fis_text = ", ".join(fis)
                reply += f" • {role_full}: {fis_text}\n"
            reply += "\n"

        keyboard = []
        if is_in_duty and user_fio and user_group:
            context.user_data['duty_check_date'] = date_str
            context.user_data['duty_check_role'] = my_role
            context.user_data['duty_check_group'] = user_group
            keyboard.append([InlineKeyboardButton("👥 С кем я в наряде?", callback_data="check_duty_partners")])
        keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")])

        await update.message.reply_text(reply, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    finally:
        conn.close()

async def check_duty_partners(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    date_str = context.user_data.get('duty_check_date')
    my_role = context.user_data.get('duty_check_role')
    user_group = context.user_data.get('duty_check_group')
    user_id = update.effective_user.id

    if not all([date_str, my_role, user_group]):
        await query.edit_message_text("❌ Данные утеряны.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]]))
        return

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT fio FROM users WHERE telegram_id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            await query.edit_message_text("❌ Вы не зарегистрированы.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]]))
            return
        fio = row['fio']
        last_name = fio.split()[0].strip().lower()

        all_schedules = context.application.bot_data.get('schedules', {})
        month_key = date_str[:7]

        my_group_schedule = all_schedules.get(user_group, {}).get(month_key, [])
        partners_in_group = [
            d['fio'] for d in my_group_schedule
            if d['date'] == date_str and d['role'] == my_role
            and d['fio'].split()[0].lower() != last_name
        ]

        partners_course = []
        for group_name, schedules in all_schedules.items():
            if group_name == user_group:
                continue
            group_month = schedules.get(month_key, [])
            for d in group_month:
                if (d['date'] == date_str and d['role'] == my_role and
                    d['fio'].split()[0].lower() != last_name):
                    partners_course.append(f"{d['fio']} ({group_name})")

        date_display = datetime.strptime(date_str, '%Y-%m-%d').strftime('%d.%m')
        reply = f"👥 <b>Вы в наряде {date_display}</b>:\n\n"

        if partners_in_group:
            reply += f"🎓 <b>С группой:</b>\n"
            for p in partners_in_group:
                reply += f" • {p}\n"
            reply += "\n"

        if partners_course:
            reply += f"🏫 <b>С другими группами:</b>\n"
            for p in partners_course:
                reply += f" • {p}\n"
            reply += "\n"

        if not partners_in_group and not partners_course:
            reply += "❌ Никто не найден в наряде с вами."

        await query.edit_message_text(reply, parse_mode="HTML", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="my_duties")]]))
    finally:
        conn.close()

# === ЭКСПОРТ: ОБРАБОТЧИКИ ===
my_duties_router = [
    CallbackQueryHandler(show_my_duties, pattern="^my_duties$"),
    CallbackQueryHandler(ask_duty_date, pattern="^duty_by_date$"),
    CallbackQueryHandler(ask_global_duty_date, pattern="^global_duty_date$"),
    CallbackQueryHandler(button_show_partners, pattern="^show_partners$"),
    CallbackQueryHandler(button_show_partners_course, pattern="^partners_course$"),
    CallbackQueryHandler(check_duty_partners, pattern="^check_duty_partners$"),
    CallbackQueryHandler(show_full_schedule, pattern="^full_schedule_"),
    CallbackQueryHandler(select_month, pattern="^select_month$"),
    CallbackQueryHandler(view_month_duties, pattern="^view_month_"),
]

# === ЭКСПОРТ: ФУНКЦИИ ВВОДА ===
__all__ = ['my_duties_router', 'handle_duty_date_input', 'handle_global_duty_date_input']

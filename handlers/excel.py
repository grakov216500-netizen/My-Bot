# handlers/excel.py — финальная версия (оптимизированная)

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes
import pandas as pd
import os
from datetime import datetime
import logging
from utils.storage import get_month_year_from_schedule, save_all_schedules
from utils.schedule import save_schedule
from handlers import reminders
from utils.roles import validate_duty_role, IGNORED_VALUES
from database import get_db

logger = logging.getLogger(__name__)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


# === ОБРАБОТКА ЗАГРУЗКИ EXCEL ===
async def handle_excel_upload(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    # 🔐 Получаем ADMIN_ID из bot_data или окружения
    ADMIN_ID = context.application.bot_data.get('ADMIN_ID')
    if ADMIN_ID is None:
        from os import getenv
        ADMIN_ID = int(getenv("ADMIN_ID", 1027070834))
        context.application.bot_data['ADMIN_ID'] = ADMIN_ID

    # 🔐 Добавляем админа в editors
    editors = context.application.bot_data.get('editors', {})
    if user_id == ADMIN_ID:
        editors[user_id] = {'role': 'admin', 'group': 'Администратор'}
        context.application.bot_data['editors'] = editors
        logger.info("🛡️ Админ (1027070834) добавлен в editors")

    # 🔍 Проверка прав
    if user_id not in editors:
        await update.message.reply_text("❌ У вас нет прав на загрузку графика.")
        return

    role = editors[user_id].get('role')
    user_group = editors[user_id].get('group')

    document = update.message.document
    if not document:
        await update.message.reply_text("❌ Ожидался документ Excel.")
        return

    if not document.file_name.lower().endswith('.xlsx'):
        await update.message.reply_text("❌ Пришлите файл в формате <code>.xlsx</code>", parse_mode="HTML")
        return

    file = await document.get_file()
    file_path = os.path.join(UPLOAD_DIR, "current_graph.xlsx")

    try:
        await file.download_to_drive(file_path)
    except Exception as e:
        await update.message.reply_text(f"❌ Ошибка загрузки файла: {e}")
        return

    # Парсим с валидацией
    result = parse_excel_schedule_with_validation(file_path)
    if not result['success']:
        errors = result.get('errors', [])
        warnings = result.get('warnings', [])
        error_msg = "❌ Не удалось загрузить график:\n"
        if errors:
            error_msg += "\n".join([f"• {e}" for e in errors[:5]])
            if len(errors) > 5:
                error_msg += f"\n• и ещё {len(errors) - 5} ошибок..."
        if warnings:
            error_msg += "\n\n⚠️ Предупреждения:\n" + "\n".join([f"• {w}" for w in warnings[:3]])
        await update.message.reply_text(error_msg)
        return

    schedule_data = result['data']
    detected_group = result['group']

    # Определяем, женский ли график
    is_female_group = any(
        "девушки" in record['group'].lower() or "женщины" in record['group'].lower()
        for record in schedule_data
    )
    if not is_female_group:
        is_female_group = "Ж" in detected_group or "жен" in detected_group.lower()

    # 🔐 Проверка прав
    if role == 'female_editor':
        if not is_female_group:
            await update.message.reply_text(
                "❌ Вы можете загружать <b>только женские графики</b>.",
                parse_mode="HTML"
            )
            return
    elif role == 'assistant':
        if detected_group != user_group:
            await update.message.reply_text(
                f"❌ Вы можете загружать график только для своей группы.\n"
                f"Ваша группа: <b>{user_group}</b>\n"
                f"Файл содержит: <b>{detected_group}</b>",
                parse_mode="HTML"
            )
            return
    elif role == 'sergeant':
        if detected_group != user_group:
            await update.message.reply_text(
                f"❌ Вы можете загружать график только для своей группы.\n"
                f"Ваша группа: <b>{user_group}</b>",
                parse_mode="HTML"
            )
            return

    # Определяем месяц и год
    month_year = get_month_year_from_schedule(schedule_data)
    if not month_year:
        month_year = datetime.now().strftime('%Y-%m')

    # --- 🔥 ОБНОВЛЕНИЕ ДАННЫХ В БОТЕ ---
    all_schedules = context.application.bot_data.get('schedules', {})

    # Сохраняем график
    all_schedules[month_year] = schedule_data

    # Группируем по группам и полу
    grouped = {}
    for record in schedule_data:
        g = record['group']
        if g not in grouped:
            grouped[g] = []
        grouped[g].append(record)

    context.application.bot_data['grouped_schedules'] = grouped
    context.application.bot_data['schedules'] = all_schedules
    context.application.bot_data['current_schedule'] = month_year
    context.application.bot_data['duty_schedule'] = schedule_data

    # Сохраняем на диск
    save_schedule(schedule_data)
    save_all_schedules(all_schedules)

    # Напоминания
    try:
        await reminders.create_duty_reminders(context, schedule_data)
    except Exception as e:
        logger.warning(f"⚠️ Ошибка при создании напоминаний: {e}")

    # Принудительное сохранение состояния
    try:
        await context.application.persistence.flush()
        logger.info("💾 bot_data.pkl принудительно сохранён")
    except Exception as e:
        logger.warning(f"⚠️ Не удалось сохранить persistence: {e}")

    # Ответ
    await update.message.reply_text(
        f"✅ <b>График за {month_year}</b> успешно загружен!\n\n"
        f"👥 Группа: <b>{detected_group}</b>\n"
        f"🚻 {'(женский)' if is_female_group else '(мужской)'}\n"
        f"📅 Нарядов: <b>{len(schedule_data)}</b>\n"
        f"🛡️ Проверено: <b>{result['valid_count']}</b> корректных, "
        f"<b>{result['ignored_count']}</b> пропущено",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("📋 Мои наряды", callback_data="my_duties")],
            [InlineKeyboardButton("📆 Выбрать месяц", callback_data="select_month")]
        ])
    )
    logger.info(f"✅ График загружен: {month_year}, {len(schedule_data)} записей, группа={detected_group}, женский={is_female_group}")


# === ПАРСИНГ EXCEL (общий с server / utils.parse_excel) ===
from utils.parse_excel import parse_excel_schedule_with_validation


# === ЭКСПОРТ ===
__all__ = ['handle_excel_upload']

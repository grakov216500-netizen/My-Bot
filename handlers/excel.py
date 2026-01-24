# handlers/excel.py — финальная исправленная версия (2025)

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, MessageHandler, filters
import pandas as pd
import os
from datetime import datetime
import logging

from utils.storage import get_month_year_from_schedule, save_all_schedules
from utils.schedule import save_schedule
from handlers import reminders
from utils.roles import validate_duty_role, VALID_ROLES, IGNORED_VALUES
from database import get_db

logger = logging.getLogger(__name__)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# === ОБРАБОТКА ЗАГРУЗКИ EXCEL ===
async def handle_excel_upload(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    # 🔐 ГАРАНТИРУЕМ, ЧТО АДМИН ВСЕГДА ЕСТЬ
    editors = context.application.bot_data.get('editors', {})
    if user_id == context.application.bot_data.get('ADMIN_ID', 1027070834):
        editors[user_id] = {'role': 'admin', 'group': 'Администратор'}
        context.application.bot_data['editors'] = editors
        logger.info("🛡️ Админ добавлен в editors временно")

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
    is_female_group = any("девушки" in record['group'].lower() or "женщины" in record['group'].lower() for record in schedule_data)
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
    # Админ может загружать всё — ✅ уже разрешено

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


# === ПАРСИНГ EXCEL С ВАЛИДАЦИЕЙ ===
def parse_excel_schedule_with_validation(file_path: str) -> dict:
    """
    Возвращает:
    {
        'success': bool,
        'data': [...],
        'group': str,
        'errors': [str],
        'warnings': [str],
        'valid_count': int,
        'ignored_count': int
    }
    """
    errors = []
    warnings = []
    duty_data = []
    valid_count = 0
    ignored_count = 0

    try:
        df = pd.read_excel(file_path, header=None, engine='openpyxl')

        # 1. Группа — E1:E2
        group = "Неизвестно"
        for i in range(2):
            val = df.iloc[i, 4] if i < len(df) and 4 < len(df.iloc[i]) else None
            if pd.notna(val) and str(val).strip().lower() not in ['nan', '']:
                group = str(val).strip()
                break

        # 2. ФИО — F6:H21
        fio_cells = df.iloc[5:21, 5:8]
        fio_list = []
        for idx, row in fio_cells.iterrows():
            parts = [str(x).strip() for x in row if pd.notna(x) and str(x).strip().lower() != 'nan']
            fio = " ".join(parts) if parts else ""
            fio_list.append(fio)

        # 3. Месяц — I4:AM4
        month_row = df.iloc[3, 8:39] if 3 < len(df) else []
        month_str = None
        for cell in month_row:
            if pd.notna(cell) and str(cell).strip():
                month_str = str(cell).strip().lower()
                break

        # 4. Дни — I5:AM5
        day_row = df.iloc[4, 8:39] if 4 < len(df) else []
        day_numbers = []
        for d in day_row:
            try:
                day_numbers.append(int(d))
            except:
                day_numbers.append(None)

        # 5. Наряды — I6:AM21
        duties_matrix = df.iloc[5:21, 8:39] if 5 < len(df) else pd.DataFrame()

        month_map = {
            'декабрь': 12, 'дек': 12,
            'январь': 1, 'янв': 1,
            'февраль': 2, 'фев': 2,
            'март': 3, 'мар': 3,
            'апрель': 4, 'апр': 4,
            'май': 5,
            'июнь': 6, 'июн': 6,
            'июль': 7, 'июл': 7,
            'август': 8, 'авг': 8,
            'сентябрь': 9, 'сен': 9,
            'октябрь': 10, 'окт': 10,
            'ноябрь': 11, 'ноя': 11
        }

        month_num = month_map.get(month_str, 12)
        year = 2026 if month_num == 1 else 2025

        # Подключаем БД для определения пола
        conn = get_db()
        cursor = conn.cursor()

        # Сбор данных
        for i, fio in enumerate(fio_list):
            if not fio:
                continue
            for j, day in enumerate(day_numbers):
                if day is None or j >= len(duties_matrix.columns):
                    continue
                try:
                    duty_cell = duties_matrix.iloc[i, j]
                except:
                    continue

                cell_value = str(duty_cell) if not pd.isna(duty_cell) else ''

                is_valid, status = validate_duty_role(cell_value)

                if status == 'ignored':
                    ignored_count += 1
                    continue
                elif status == 'invalid':
                    errors.append(f"Ячейка ({i+6}, {chr(74+j)}): '{cell_value}' — неизвестная роль")
                    continue
                else:
                    role = cell_value.strip().lower()
                    try:
                        full_date = f"{year}-{month_num:02d}-{int(day):02d}"
                    except:
                        errors.append(f"❌ Ошибка даты: строка {i+6}, день {day}")
                        continue

                    # Определяем пол по БД
                    cursor.execute("SELECT gender FROM users WHERE fio LIKE ?", (f"{fio}%",))
                    user = cursor.fetchone()
                    gender = user['gender'] if user else 'male'

                    duty_data.append({
                        "fio": fio,
                        "date": full_date,
                        "role": role,
                        "group": group,
                        "gender": gender
                    })
                    valid_count += 1

        conn.close()

        if not duty_data:
            errors.append("❌ Не найдено ни одного корректного наряда.")

        return {
            'success': len(errors) == 0,
            'data': duty_data,
            'group': group,
            'errors': errors,
            'warnings': warnings,
            'valid_count': valid_count,
            'ignored_count': ignored_count
        }

    except Exception as e:
        logger.error(f"❌ Ошибка парсинга Excel: {e}")
        return {
            'success': False,
            'data': [],
            'group': 'Неизвестно',
            'errors': [f"Ошибка чтения файла: {e}"],
            'warnings': [],
            'valid_count': 0,
            'ignored_count': 0
        }


# === МАРШРУТИЗАТОР ===
excel_router = MessageHandler(
    filters.Document.ALL,
    handle_excel_upload
)

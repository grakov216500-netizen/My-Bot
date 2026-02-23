# Парсинг Excel-графика нарядов (без зависимостей от Telegram).
# Используется в server.py (API загрузки) и может использоваться в handlers/excel.py.

import pandas as pd
from database import get_db
from utils.roles import validate_duty_role


def parse_excel_schedule_with_validation(file_path: str) -> dict:
    """
    Возвращает:
    {
        'success': bool,
        'data': [{'fio', 'date', 'role', 'group', 'gender'}],
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
            if i < len(df) and 4 < len(df.iloc[i]) and pd.notna(df.iloc[i, 4]):
                val = df.iloc[i, 4]
                if str(val).strip().lower() not in ['nan', '']:
                    group = str(val).strip()
                    break
        # 1.1 Год — E3 (сержанты указывают год в ячейке E3, чтобы не путаться)
        year = None
        if len(df) > 2 and 4 < len(df.iloc[2]) and pd.notna(df.iloc[2, 4]):
            try:
                y = int(float(df.iloc[2, 4]))
                if 2020 <= y <= 2030:
                    year = y
            except Exception:
                pass

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
            except Exception:
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
        if year is None:
            year = 2026 if month_num == 1 else 2025

        conn = get_db()
        cursor = conn.cursor()

        for i, fio in enumerate(fio_list):
            if not fio:
                continue
            for j, day in enumerate(day_numbers):
                if day is None or j >= len(duties_matrix.columns):
                    continue
                try:
                    duty_cell = duties_matrix.iloc[i, j]
                except Exception:
                    continue
                cell_value = str(duty_cell) if not pd.isna(duty_cell) else ''
                is_valid, status = validate_duty_role(cell_value)

                if status == 'ignored':
                    ignored_count += 1
                    continue
                if status == 'invalid':
                    errors.append(f"Ячейка ({i+6}, {chr(74+j)}): '{cell_value}' — неизвестная роль")
                    continue
                role = cell_value.strip().lower()

                try:
                    full_date = f"{year}-{month_num:02d}-{int(day):02d}"
                except Exception:
                    errors.append(f"Ошибка даты: строка {i+6}, день {day}")
                    continue

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
            errors.append("Не найдено ни одного корректного наряда.")

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
        return {
            'success': False,
            'data': [],
            'group': 'Неизвестно',
            'errors': [f"Ошибка чтения файла: {e}"],
            'warnings': [],
            'valid_count': 0,
            'ignored_count': 0
        }

# utils/storage.py — финальная версия (2025), всё работает + безопасность + поддержка gender и year

import json
import os
from datetime import datetime

DATA_DIR = "data"
SCHEDULES_FILE = os.path.join(DATA_DIR, "schedules.json")

# Создаём папку, если нет
os.makedirs(DATA_DIR, exist_ok=True)


def save_all_schedules(schedules):
    """
    Сохраняет все графики в JSON.
    Преобразует ключи в строки (на случай, если переданы datetime и т.п.).
    Автоматически очищает роли и приводит к нижнему регистру.
    """
    try:
        # Глубокое копирование с очисткой
        safe_schedules = {}
        for key, data in schedules.items():
            safe_key = str(key).strip()
            if isinstance(data, list):
                safe_data = []
                for item in data:
                    if isinstance(item, dict):
                        clean_item = {}
                        for k, v in item.items():
                            if k == 'role' and isinstance(v, str):
                                clean_item[k] = v.strip().lower()
                            elif k in ['date', 'fio', 'group_name', 'group', 'gender']:
                                clean_item[k] = str(v) if v else ""
                            else:
                                clean_item[k] = v
                        safe_data.append(clean_item)
                safe_schedules[safe_key] = safe_data
            else:
                print(f"⚠️ Пропущен некорректный месяц '{safe_key}': не список")

        with open(SCHEDULES_FILE, "w", encoding="utf-8") as f:
            json.dump(safe_schedules, f, ensure_ascii=False, indent=2)

        print(f"✅ Все графики сохранены: {len(safe_schedules)} месяцев")

    except Exception as e:
        print(f"❌ Ошибка сохранения schedules.json: {e}")


def load_all_schedules():
    """
    Загружает все графики из JSON.
    Возвращает словарь: {"2025-12": [...], "2026-01": [...]}

    Автоматически:
    - Восстанавливает строковые ключи
    - Приводит роли к нижнему регистру
    - Фильтрует битые записи
    """
    if not os.path.exists(SCHEDULES_FILE):
        print("⚠️ Файл schedules.json не найден — начнём с пустого")
        return {}

    try:
        with open(SCHEDULES_FILE, "r", encoding="utf-8") as f:
            raw_data = json.load(f)

        if not isinstance(raw_data, dict):
            print("❌ Формат schedules.json: ожидается dict")
            return {}

        schedules = {}
        for key, value in raw_data.items():
            safe_key = str(key).strip()
            if not safe_key:
                continue

            if not isinstance(value, list):
                print(f"⚠️ Пропущен некорректный ключ '{safe_key}': не список")
                continue

            clean_data = []
            for item in value:
                if isinstance(item, dict) and 'fio' in item and 'date' in item:
                    # Приводим роль к нижнему регистру
                    if isinstance(item.get('role'), str):
                        item['role'] = item['role'].strip().lower()
                    # Восстанавливаем group_name, если было group
                    if 'group' in item and 'group_name' not in item:
                        item['group_name'] = item['group']
                    clean_data.append(item)
                else:
                    print(f"⚠️ Пропущена битая запись: {item}")

            if clean_data:
                schedules[safe_key] = clean_data

        print(f"✅ Загружено {len(schedules)} месяцев графиков")
        return schedules

    except Exception as e:
        print(f"❌ Ошибка загрузки schedules.json: {e}")
        return {}


def get_month_year_from_schedule(schedule_data):
    """
    Определяет месяц и год из даты в графике.
    Возвращает строку в формате "YYYY-MM"

    Пример: "2025-12-01" → "2025-12"
    """
    if not schedule_data:
        # Если данных нет — возвращаем текущий месяц
        return datetime.now().strftime("%Y-%m")

    for item in schedule_data:
        date_str = item.get('date', '')
        if date_str and isinstance(date_str, str):
            parts = date_str.split('-')
            if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
                year = parts[0]
                month = parts[1]
                return f"{year}-{month}"

    # По умолчанию — текущий месяц
    return datetime.now().strftime("%Y-%m")

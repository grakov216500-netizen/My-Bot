# utils/storage.py — финальная версия (2025) + user_id для Mini App + совместимость
# 🔧 Автоматически форматирует данные для Mini App и бота

import json
import os
from datetime import datetime
from typing import Dict, List, Any

# === Настройки путей ===
DATA_DIR = "data"
SCHEDULES_FILE = os.path.join(DATA_DIR, "schedules.json")

# Создаём папку, если не существует
os.makedirs(DATA_DIR, exist_ok=True)


def save_all_schedules(schedules: Dict[str, List[Dict[str, Any]]]) -> None:
    """
    Сохраняет все графики в JSON-файл.

    Автоматически:
    - Преобразует ключи в строки
    - Приводит роли к нижнему регистру
    - Очищает поля: fio, date, group_name, gender
    - Добавляет user_id, если есть telegram_id
    - Игнорирует битые данные
    - Сохраняет с отступами и кириллицей
    
    Args:
        schedules (dict): Словарь графиков, например:
            {
                "2025-04": [
                    {
                        "fio": "Иванов И.И.",
                        "date": "2025-04-05",
                        "role": "к",
                        "group_name": "1-1",
                        "gender": "male",
                        "telegram_id": 123456789   # <-- будет преобразован в user_id
                    }
                ]
            }
    """
    try:
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
                            elif k in ['fio', 'date', 'group_name', 'group', 'gender']:
                                clean_item[k] = str(v) if v else ""
                            else:
                                clean_item[k] = v

                        # 🔐 Добавляем user_id, если есть telegram_id
                        if 'telegram_id' in item and 'user_id' not in clean_item:
                            clean_item['user_id'] = str(item['telegram_id'])

                        # ✅ Гарантируем, что user_id — строка (важно для JSON и Mini App)
                        if 'user_id' in clean_item:
                            clean_item['user_id'] = str(clean_item['user_id']).strip()

                        safe_data.append(clean_item)
                safe_schedules[safe_key] = safe_data
            else:
                print(f"⚠️ Пропущен некорректный месяц '{safe_key}': значение не список")

        with open(SCHEDULES_FILE, "w", encoding="utf-8") as f:
            json.dump(safe_schedules, f, ensure_ascii=False, indent=2)

        print(f"✅ Все графики сохранены: {len(safe_schedules)} месяцев → {SCHEDULES_FILE}")

    except Exception as e:
        print(f"❌ Ошибка сохранения schedules.json: {e}")
        raise


def load_all_schedules() -> Dict[str, List[Dict[str, Any]]]:
    """
    Загружает все графики из JSON-файла.

    Автоматически:
    - Восстанавливает строковые ключи
    - Приводит роли к нижнему регистру
    - Заменяет 'group' на 'group_name', если нужно
    - Удаляет старое 'group'
    - Добавляет 'gender' по умолчанию
    - Фильтрует битые записи
    - Гарантирует корректную структуру

    Returns:
        dict: Графики по месяцам. Пример:
            {
                "2025-04": [
                    {
                        "fio": "Иванов И.И.",
                        "date": "2025-04-05",
                        "role": "к",
                        "group_name": "1-1",
                        "gender": "male",
                        "user_id": "123456789"
                    }
                ]
            }
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
                print(f"⚠️ Пропущен некорректный ключ '{safe_key}': значение не список")
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
                        del item['group']  # убираем старое

                    # Убедимся, что gender есть
                    if 'gender' not in item:
                        item['gender'] = "male"

                    # 🔐 Убедимся, что user_id есть (если был telegram_id)
                    if 'telegram_id' in item and 'user_id' not in item:
                        item['user_id'] = str(item['telegram_id'])

                    # ✅ Гарантируем, что user_id — строка (для корректного сравнения в Mini App)
                    if 'user_id' in item:
                        item['user_id'] = str(item['user_id']).strip()

                    clean_data.append(item)
                else:
                    print(f"⚠️ Пропущена битая запись: {item}")

            if clean_data:
                schedules[safe_key] = clean_data

        print(f"✅ Загружено {len(schedules)} месяцев графиков из {SCHEDULES_FILE}")
        return schedules

    except json.JSONDecodeError as e:
        print(f"❌ Ошибка парсинга JSON в schedules.json: {e}")
        return {}
    except Exception as e:
        print(f"❌ Неизвестная ошибка при загрузке schedules.json: {e}")
        return {}


def get_month_year_from_schedule(schedule_data: List[Dict[str, Any]]) -> str:
    """
    Определяет месяц и год из первой валидной даты в графике.
    
    Если данных нет — возвращает текущий месяц.

    Args:
        schedule_data (list): Список записей о нарядах

    Returns:
        str: Месяц в формате "YYYY-MM", например "2025-04"
    """
    if not schedule_data:
        return datetime.now().strftime("%Y-%m")

    for item in schedule_data:
        date_str = item.get('date', '')
        if date_str and isinstance(date_str, str):
            parts = date_str.split('-')
            if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
                year = parts[0]
                month = parts[1].zfill(2)
                return f"{year}-{month}"

    return datetime.now().strftime("%Y-%m")


# === 🔧 ДОПОЛНИТЕЛЬНАЯ ФУНКЦИЯ: извлекает график по user_id для внешних систем ===
def get_schedule_for_user(user_id: str) -> List[Dict[str, Any]]:
    """
    Возвращает отсортированный график дежурств для конкретного пользователя.
    
    Используется в Mini App и API.

    Args:
        user_id (str): Telegram ID пользователя

    Returns:
        list: Список записей с полями: date, role, group_name, isPast
    """
    all_schedules = load_all_schedules()
    user_id = str(user_id).strip()
    result = []

    for month, duties in all_schedules.items():
        if not isinstance(duties, list):
            continue
        for duty in duties:
            if isinstance(duty, dict) and duty.get('user_id') == user_id:
                result.append({
                    "date": duty["date"],
                    "role": duty.get("role", "").strip(),
                    "group_name": duty.get("group_name", "").strip(),
                    "isPast": datetime.now().strftime("%Y-%m-%d") > duty["date"]
                })

    # Сортируем по дате
    result.sort(key=lambda x: x["date"])
    return result

# utils/schedule.py — финальная версия (2025), всё работает + пол, группы, партнеры

import json
import os
from datetime import datetime

SCHEDULE_FILE = "duty_schedule.json"

def save_schedule(schedule):
    """
    Сохраняет график в JSON-файл.
    Автоматически приводит роли к нижнему регистру.
    """
    try:
        # Приводим роли к нижнему регистру перед сохранением
        safe_schedule = []
        for item in schedule:
            if isinstance(item, dict):
                item_copy = item.copy()
                if 'role' in item_copy and isinstance(item_copy['role'], str):
                    item_copy['role'] = item_copy['role'].strip().lower()
                safe_schedule.append(item_copy)
            else:
                print(f"⚠️ Пропущена некорректная запись: {item}")

        with open(SCHEDULE_FILE, "w", encoding="utf-8") as f:
            json.dump(safe_schedule, f, ensure_ascii=False, indent=2)
        print(f"✅ График сохранён: {len(safe_schedule)} записей")
    except Exception as e:
        print(f"❌ Ошибка сохранения: {e}")


def load_schedule():
    """
    Загружает график из JSON-файла.
    Возвращает список нарядов.
    """
    if not os.path.exists(SCHEDULE_FILE):
        print("⚠️ Файл графика не найден")
        return []

    try:
        with open(SCHEDULE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, list):
            print("❌ Формат файла: ожидается список")
            return []

        # Приводим роли к нижнему регистру
        for item in data:
            if isinstance(item, dict) and 'role' in item and isinstance(item['role'], str):
                item['role'] = item['role'].strip().lower()

        print(f"✅ График загружен: {len(data)} записей")
        return data
    except Exception as e:
        print(f"❌ Ошибка загрузки графика: {e}")
        return []


def get_my_duties_with_partners(fio: str, schedule_data: list):
    """
    Возвращает наряды пользователя + с кем он в паре в ту же дату и роль.
    Поиск по полному ФИО (или хотя бы фамилии).
    """
    if not fio or not schedule_data:
        return []

    # Извлекаем фамилию
    last_name = fio.strip().split()[0].lower()

    # Находим все наряды пользователя
    my_duties = []
    for duty in schedule_data:
        duty_fio = duty.get('fio', '').strip()
        if not duty_fio:
            continue
        duty_last_name = duty_fio.split()[0].lower()
        if duty_last_name == last_name:
            my_duties.append(duty)

    if not my_duties:
        return []

    # Сортируем по дате
    my_duties = sorted(my_duties, key=lambda x: x['date'])
    now = datetime.now().date()
    result = []

    for duty in my_duties:
        try:
            duty_date = datetime.strptime(duty['date'], '%Y-%m-%d').date()
        except (ValueError, KeyError):
            continue

        is_past = duty_date < now

        # Ищем партнёра: тот же день, та же роль, другая фамилия
        partners = []
        for d in schedule_data:
            d_fio = d.get('fio', '').strip()
            if not d_fio:
                continue
            d_last_name = d_fio.split()[0].lower()
            if (d['date'] == duty['date'] and
                d['role'] == duty['role'] and
                d_last_name != last_name):
                partners.append(d['fio'])

        result.append({
            **duty,
            'is_past': is_past,
            'partners': partners
        })

    return result


def get_duty_by_date(target_date: str, schedule_data: list):
    """
    Возвращает всех, кто в наряде в заданную дату.
    target_date: '2025-12-04'
    """
    if not schedule_data:
        return []
    return [d for d in schedule_data if d.get('date') == target_date]


def get_full_schedule_pages(schedule_data: list, page: int = 0, per_page: int = 6):
    """
    Разбивает график на страницы для отображения.
    Возвращает список людей с их нарядами.
    """
    if not schedule_data:
        return {'data': [], 'current': 0, 'total': 1}

    # Уникальные ФИО
    fios = sorted(set(d['fio'] for d in schedule_data if d.get('fio')))
    total_pages = (len(fios) + per_page - 1) // per_page
    start = page * per_page
    end = start + per_page
    page_fios = fios[start:end]

    page_data = []
    for person in page_fios:
        duties = [d for d in schedule_data if d.get('fio') == person]
        page_data.append({'fio': person, 'duties': duties})

    return {
        'data': page_data,
        'current': page,
        'total': total_pages
    }


def get_course_partners(user_fio: str, user_group: str, user_year: int, all_schedules: dict, month_key: str):
    """
    Ищет, с кем из других групп ты в наряде (по фамилии).
    """
    if not user_fio or not all_schedules or not month_key:
        return []

    last_name = user_fio.strip().split()[0].lower()
    result = []

    # Получаем наряды пользователя
    user_schedule = []
    for group_name, schedules in all_schedules.items():
        group_month = schedules.get(month_key, [])
        for item in group_month:
            item_last_name = item.get('fio', '').split()[0].lower()
            if (item_last_name == last_name and
                item.get('group_name') == user_group and
                item.get('enrollment_year') == user_year):
                user_schedule.append(item)

    # По каждой дежурной дате пользователя
    for duty in user_schedule:
        date = duty['date']
        role = duty['role']

        partners = []
        for group_name, schedules in all_schedules.items():
            if group_name == user_group:
                continue
            group_month = schedules.get(month_key, [])
            for item in group_month:
                item_last_name = item.get('fio', '').split()[0].lower()
                if (item['date'] == date and
                    item['role'] == role and
                    item_last_name == last_name):
                    partners.append(f"{item['fio']} ({group_name})")

        if partners:
            result.append({
                'date': date,
                'role': role,
                'partners': partners
            })

    return result


def get_duty_by_date_all_groups(date_str: str, all_schedules: dict):
    """
    Возвращает всех, кто в наряде в указанную дату — по всем группам.
    """
    result = {}
    for group_name, schedules in all_schedules.items():
        # Проходим по всем месяцам
        for month_key, month_data in schedules.items():
            duties_on_date = [d for d in month_data if d.get('date') == date_str]
            if duties_on_date:
                if group_name not in result:
                    result[group_name] = []
                result[group_name].extend(duties_on_date)
    return result


def get_duties_for_user_in_month(fio: str, month_key: str, all_schedules: dict):
    """
    Возвращает все наряды пользователя в заданном месяце.
    """
    last_name = fio.strip().split()[0].lower()
    duties = []
    for group_data in all_schedules.values():
        month_data = group_data.get(month_key, [])
        for item in month_data:
            item_last_name = item.get('fio', '').split()[0].lower()
            if item_last_name == last_name:
                duties.append(item)
    return sorted(duties, key=lambda x: x['date'])


def get_duties_by_role_in_month(role: str, month_key: str, all_schedules: dict):
    """
    Возвращает всех, кто был в заданной роли в месяц.
    """
    role = role.strip().lower()
    result = []
    for group_data in all_schedules.values():
        month_data = group_data.get(month_key, [])
        for item in month_data:
            if item.get('role') == role:
                result.append(item)
    return sorted(result, key=lambda x: x['date'])


def is_female_duty_schedule(schedule_data: list) -> bool:
    """
    Определяет, женский ли график (по метке в group или gender).
    """
    if not schedule_data:
        return False
    sample = schedule_data[0]
    group = sample.get('group', '').lower()
    if any(kw in group for kw in ['жен', 'девушки', 'девочка', 'ж']):
        return True
    return sample.get('gender') == 'female'

# utils/course_calculator.py — финальная версия (2025), 2021 = 5 курс, выпускники

from datetime import datetime, date

def get_current_course(enrollment_year: int, reference_date: date = None) -> int:
    """
    Определяет текущий курс на основе года поступления.
    Ключевая дата перевода: 15 августа.
    
    Для 2021 года: 5 курс (выпускники).
    
    Args:
        enrollment_year: Год поступления (например, 2023)
        reference_date: Дата, на которую проверяем (по умолчанию - сегодня)
    
    Returns:
        Текущий курс (1-5, где 5 — выпускники)
    """
    if reference_date is None:
        reference_date = date.today()
    
    # Определяем учебный год
    # Если дата до 15 августа, считаем предыдущий учебный год
    if reference_date.month < 8 or (reference_date.month == 8 and reference_date.day < 15):
        academic_year = reference_date.year - 1
    else:
        academic_year = reference_date.year
    
    # Вычисляем курс
    course = academic_year - enrollment_year + 1
    
    # ⚠️ Особый случай: 2021 год — 5 курс (выпускники)
    if enrollment_year == 2021:
        # Проверяем, активен ли учебный год
        if course > 4:
            return 5  # или можно возвращать "выпускник"
    
    # Ограничиваем от 1 до 5
    return max(1, course)  # не min(4), а просто max(1, course)

def get_course_info(enrollment_year: int) -> dict:
    """
    Возвращает полную информацию о курсе пользователя
    """
    current_course = get_current_course(enrollment_year)
    
    # Определяем следующий учебный год (15 августа)
    today = date.today()
    if today.month >= 8 and today.day >= 15:
        next_year_start = date(today.year + 1, 8, 15)
    else:
        next_year_start = date(today.year, 8, 15)
    
    # Дни до перевода
    days_until_next = (next_year_start - today).days
    
    # Определяем статус
    if current_course >= 5 or (enrollment_year == 2021 and current_course == 5):
        status = "выпускник"
        next_course = "выпуск"
    else:
        status = "активен"
        next_course = current_course + 1 if current_course < 4 else "выпуск"
    
    return {
        "current": current_course,
        "next": next_course,
        "days_until_next": max(0, days_until_next),
        "status": status,
        "enrollment_year": enrollment_year,
        "graduation_year": enrollment_year + 4  # стандарт 4 года
    }

def get_academic_year() -> str:
    """Возвращает текущий учебный год в формате '2023/2024'"""
    today = date.today()
    
    if today.month >= 8:  # Август-декабрь
        return f"{today.year}/{today.year + 1}"
    else:  # Январь-Июль
        return f"{today.year - 1}/{today.year}"

def is_transition_period() -> bool:
    """Проверяет, находимся ли мы в периоде перевода на следующий курс (1-31 августа)"""
    today = date.today()
    return today.month == 8

def format_course_display(course: int, status: str) -> str:
    """Форматирует отображение курса и статуса"""
    if status == "выпускник":
        return "🎓 Выпускник"
    
    course_emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"]
    if 1 <= course <= 4:
        return f"{course_emojis[course-1]} {course} курс"
    else:
        return f"📚 {course} курс"

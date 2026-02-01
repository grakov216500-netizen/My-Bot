# utils/date_parser.py

from datetime import datetime
from typing import Optional

def parse_date_input(text: str, base_year_month: str) -> Optional[str]:
    """
    Парсит упрощённый ввод даты:
    - "15" → 2025-12-15 (если base_year_month = "2025-12")
    - "15.12.2025" → 2025-12-15
    - "15 12" → 2025-12-15
    Возвращает строку в формате 'YYYY-MM-DD' или None
    """
    text = text.strip()

    # Формат: ДД.ММ.ГГГГ
    if '.' in text:
        try:
            dt = datetime.strptime(text, '%d.%m.%Y')
            return dt.strftime('%Y-%m-%d')
        except:
            return None

    # Формат: ДД ММ
    if ' ' in text:
        parts = text.split()
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            day, month = int(parts[0]), int(parts[1])
            year = int(base_year_month.split('-')[0])
            try:
                dt = datetime(year, month, day)
                return dt.strftime('%Y-%m-%d')
            except:
                return None

    # Формат: только день
    if text.isdigit():
        day = int(text)
        if 1 <= day <= 31:
            year, month = map(int, base_year_month.split('-'))
            try:
                dt = datetime(year, month, day)
                return dt.strftime('%Y-%m-%d')
            except:
                return None

    return None

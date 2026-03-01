#!/usr/bin/env python3
"""
setup_db.py — Скрипт инициализации БД для VITECHBOT
Запуск: python setup_db.py
"""

import os
import sqlite3

DB_PATH = "bot.db"

def main():
    if not os.path.exists(DB_PATH):
        print("❌ Файл bot.db не найден. Запустите сначала бота или server.py для создания БД.")
        return

    try:
        from database import init_db, init_survey_objects, ensure_female_survey_objects
        init_db()
        init_survey_objects()
        ensure_female_survey_objects()
        print("✅ База данных инициализирована")
        print("")
        print("Следующие команды можно выполнить вручную в sqlite3:")
        print("  sqlite3 bot.db")
        print("  UPDATE users SET role = 'admin' WHERE telegram_id = ВАШ_ID;")
        print("")
    except ImportError as e:
        print(f"⚠️ Ошибка импорта: {e}")
        print("Попробуйте: python -c \"import database; database.init_db()\"")
    except Exception as e:
        print(f"❌ Ошибка: {e}")

if __name__ == "__main__":
    main()

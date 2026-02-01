# fix_role.py — исправляет роль админа в БД

import sqlite3
import os

DB_NAME = "bot.db"
ADMIN_ID = 1027070834

if not os.path.exists(DB_NAME):
    print("❌ Файл bot.db не найден в папке!")
else:
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        
        # Обновляем роль
        cursor.execute(
            "UPDATE users SET role = 'админ' WHERE telegram_id = ?", 
            (ADMIN_ID,)
        )
        
        if cursor.rowcount == 0:
            # Если ни одной строки не обновлено — возможно, нет такого пользователя
            cursor.execute('''
                INSERT OR REPLACE INTO users 
                (telegram_id, role, status, fio, faculty, enrollment_year, group_name, is_custom_group)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (ADMIN_ID, 'админ', 'активен', 'Админ', 'Инженерно-технический', 2023, 'ИО6', 0))
            print("🆕 Админ не найден — создан заново с ролью 'админ'")
        else:
            print("✅ Роль админа успешно обновлена на 'админ'")
        
        conn.commit()
        conn.close()
        
        # Проверим
        conn = sqlite3.connect(DB_NAME)
        row = conn.execute("SELECT fio, role FROM users WHERE telegram_id = ?", (ADMIN_ID,)).fetchone()
        if row:
            print(f"🔍 Проверка: {row['fio']} — роль: {row['role']}")
        conn.close()
        
    except Exception as e:
        print(f"❌ Ошибка: {e}")

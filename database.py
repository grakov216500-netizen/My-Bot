# database.py — финальная версия (2025), всё работает + gender + female_editor + миграция

import sqlite3
import os
from datetime import datetime

DB_NAME = "bot.db"

def get_db():
    """Возвращает подключение к БД с row_factory"""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row  # Для доступа по именам
    return conn

def init_db():
    """Инициализирует все таблицы с новой структурой"""
    conn = get_db()
    cursor = conn.cursor()
    
    # === 1. СТАРАЯ ТАБЛИЦА (для обратной совместимости) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS old_users (
            user_id INTEGER PRIMARY KEY,
            full_name TEXT NOT NULL,
            group_num TEXT DEFAULT 'ИО6'
        )
    ''')
    
    # === 2. НОВАЯ ТАБЛИЦА ПОЛЬЗОВАТЕЛЕЙ ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER UNIQUE NOT NULL,
            fio TEXT NOT NULL,
            faculty TEXT CHECK(faculty IN ('Инженерно-технический', 'Юридический')),
            enrollment_year INTEGER NOT NULL CHECK(enrollment_year BETWEEN 2021 AND 2027),
            group_name TEXT NOT NULL,
            is_custom_group BOOLEAN DEFAULT 0,
            role TEXT DEFAULT 'user' CHECK(role IN ('user', 'sergeant', 'assistant', 'admin', 'female_editor')),
            status TEXT DEFAULT 'активен' CHECK(status IN ('активен', 'выпускник', 'отчислен')),
            gender TEXT DEFAULT 'male' CHECK(gender IN ('male', 'female')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_active TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 🛠 Добавляем недостающие колонки (если БД старая)

    # Добавляем role, если нет
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
    except sqlite3.OperationalError:
        pass

    # Добавляем gender
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN gender TEXT DEFAULT 'male'")
    except sqlite3.OperationalError:
        pass

    # Добавляем status (на всякий случай)
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'активен'")
    except sqlite3.OperationalError:
        pass

    # ⚠️ Миграция старых ролей
    cursor.execute("UPDATE users SET role = 'user' WHERE role IN ('курсант', 'user')")
    cursor.execute("UPDATE users SET role = 'sergeant' WHERE role IN ('сержант', 'sergeant')")
    cursor.execute("UPDATE users SET role = 'admin' WHERE role IN ('админ', 'admin')")
    # `assistant` — оставляем как есть
    # Добавляем `female_editor` — если нужно, руками или через админку

    # === 3. ТАБЛИЦА ЗАДАЧ ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            done BOOLEAN NOT NULL DEFAULT 0,
            deadline TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reminded BOOLEAN DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (telegram_id) ON DELETE CASCADE
        )
    ''')
    
    # === 4. ТАБЛИЦА ЛОГОВ КУРСОВ ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS course_updates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            updated_date DATE NOT NULL,
            users_updated INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # === 5. ТАБЛИЦА ГРАФИКА НАРЯДОВ (С УЧЁТОМ ГОДА!) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS duty_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fio TEXT NOT NULL,
            date TEXT NOT NULL CHECK(date LIKE '____-__-__'),
            role TEXT NOT NULL,
            group_name TEXT NOT NULL,
            enrollment_year INTEGER NOT NULL,
            gender TEXT DEFAULT 'male' CHECK(gender IN ('male', 'female')),
            UNIQUE(fio, date, enrollment_year) ON CONFLICT REPLACE,
            FOREIGN KEY (enrollment_year) REFERENCES users (enrollment_year)
        )
    ''')

    # === 6. ИНДЕКСЫ (оптимизация) ===
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_tg_id ON users (telegram_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_group_year ON users (group_name, enrollment_year)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_status ON users (status)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_gender ON users (gender)')
    
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_duty_date ON duty_schedule (date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_duty_group_year ON duty_schedule (group_name, enrollment_year)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_duty_gender ON duty_schedule (gender)')

    conn.commit()
    conn.close()
    print("✅ База данных инициализирована с новой структурой")
    
    # Миграция старых данных
    migrate_old_data()

def migrate_old_data():
    """Переносит данные из старой таблицы в новую"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='old_users'")
    if cursor.fetchone():
        cursor.execute("SELECT COUNT(*) FROM old_users")
        old_count = cursor.fetchone()[0]
        
        if old_count > 0:
            print(f"🔄 Найдено {old_count} старых записей для миграции...")
            
            # Переносим с дефолтным enrollment_year = 2023
            cursor.execute('''
                INSERT OR IGNORE INTO users (
                    telegram_id, fio, faculty, enrollment_year, group_name, role, gender
                )
                SELECT 
                    user_id,
                    full_name,
                    'Инженерно-технический',
                    2023,
                    group_num,
                    CASE WHEN user_id = 1027070834 THEN 'admin' ELSE 'user' END,
                    'male'
                FROM old_users
                WHERE user_id NOT IN (SELECT telegram_id FROM users)
            ''')
            
            migrated = cursor.rowcount
            conn.commit()
            print(f"✅ Перенесено {migrated} записей")
    
    conn.close()

def update_user_last_active(user_id: int):
    """Обновляет время последней активности"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE users 
        SET last_active = CURRENT_TIMESTAMP 
        WHERE telegram_id = ?
    ''', (user_id,))
    conn.commit()
    conn.close()

def check_and_update_courses():
    """Проверяет и обновляет статус пользователей (активен/выпускник)"""
    from utils.course_calculator import get_current_course
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT telegram_id, enrollment_year FROM users WHERE status = 'активен'")
    users = cursor.fetchall()
    
    updated = 0
    for user in users:
        telegram_id = user['telegram_id']
        enrollment_year = user['enrollment_year']
        
        current_course = get_current_course(enrollment_year)
        status = 'выпускник' if current_course >= 5 else 'активен'
        
        cursor.execute('''
            UPDATE users 
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ? AND status != ?
        ''', (status, telegram_id, status))
        
        if cursor.rowcount > 0:
            updated += 1
    
    if updated > 0:
        cursor.execute('''
            INSERT INTO course_updates (updated_date, users_updated)
            VALUES (DATE('now'), ?)
        ''', (updated,))
    
    conn.commit()
    conn.close()
    
    if updated > 0:
        print(f"🔄 Автообновление курсов: обновлено {updated} пользователей")
    
    return updated

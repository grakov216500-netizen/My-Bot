# database.py — финальная версия (2025), синхронизирована с server.py (FastAPI)

import sqlite3
import os
from datetime import datetime

DB_NAME = "bot.db"

def get_db():
    """Возвращает подключение к БД с row_factory"""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
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
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("ALTER TABLE users ADD COLUMN gender TEXT DEFAULT 'male'")
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'активен'")
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("ALTER TABLE users ADD COLUMN global_score REAL DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    # ⚠️ Миграция старых ролей
    cursor.execute("UPDATE users SET role = 'user' WHERE role IN ('курсант', 'user')")
    cursor.execute("UPDATE users SET role = 'sergeant' WHERE role IN ('сержант', 'sergeant')")
    cursor.execute("UPDATE users SET role = 'admin' WHERE role IN ('админ', 'admin')")

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
    
    # === 3.1 ТАБЛИЦА ОБЪЕКТОВ ДЛЯ ОПРОСА (ИСПРАВЛЕНО: duty_objects) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS duty_objects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            description TEXT,
            FOREIGN KEY (parent_id) REFERENCES duty_objects (id)
        )
    ''')

    # === 3.2 ТАБЛИЦА ГОЛОСОВ — попарное сравнение (2/1/0), stage: main, canteen, female ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS survey_pair_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            object_a_id INTEGER NOT NULL,
            object_b_id INTEGER NOT NULL,
            choice TEXT NOT NULL CHECK(choice IN ('a', 'b', 'equal')),
            stage TEXT NOT NULL CHECK(stage IN ('main', 'canteen', 'female')),
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (object_a_id) REFERENCES duty_objects (id),
            FOREIGN KEY (object_b_id) REFERENCES duty_objects (id),
            UNIQUE(user_id, object_a_id, object_b_id) ON CONFLICT REPLACE
        )
    ''')

    # Миграция: создать survey_pair_votes если ещё нет (старые БД)
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='survey_pair_votes'")
    if not cursor.fetchone():
        cursor.execute('''
            CREATE TABLE survey_pair_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                object_a_id INTEGER NOT NULL,
                object_b_id INTEGER NOT NULL,
                choice TEXT NOT NULL CHECK(choice IN ('a', 'b', 'equal')),
                stage TEXT NOT NULL CHECK(stage IN ('main', 'canteen', 'female')),
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (object_a_id) REFERENCES duty_objects (id),
                FOREIGN KEY (object_b_id) REFERENCES duty_objects (id),
                UNIQUE(user_id, object_a_id, object_b_id) ON CONFLICT REPLACE
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_pair_votes_user ON survey_pair_votes (user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_pair_votes_stage ON survey_pair_votes (stage)')
    else:
        # Миграция: добавить stage 'female' в существующую таблицу (recreate)
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='survey_pair_votes'")
        row = cursor.fetchone()
        if row and "female" not in (row[0] or ""):
            cursor.execute('''
                CREATE TABLE survey_pair_votes_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    object_a_id INTEGER NOT NULL,
                    object_b_id INTEGER NOT NULL,
                    choice TEXT NOT NULL CHECK(choice IN ('a', 'b', 'equal')),
                    stage TEXT NOT NULL CHECK(stage IN ('main', 'canteen', 'female')),
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id),
                    FOREIGN KEY (object_a_id) REFERENCES duty_objects (id),
                    FOREIGN KEY (object_b_id) REFERENCES duty_objects (id),
                    UNIQUE(user_id, object_a_id, object_b_id) ON CONFLICT REPLACE
                )
            ''')
            cursor.execute('INSERT INTO survey_pair_votes_new SELECT * FROM survey_pair_votes')
            cursor.execute('DROP TABLE survey_pair_votes')
            cursor.execute('ALTER TABLE survey_pair_votes_new RENAME TO survey_pair_votes')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pair_votes_user ON survey_pair_votes (user_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pair_votes_stage ON survey_pair_votes (stage)')

    # === 3.2b Пользовательские опросы (сержант — группа, помощник — курс) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS custom_surveys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            scope_type TEXT NOT NULL CHECK(scope_type IN ('group', 'course')),
            scope_value TEXT NOT NULL,
            created_by_telegram_id INTEGER NOT NULL,
            ends_at TEXT,
            completed_at TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS custom_survey_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            survey_id INTEGER NOT NULL,
            option_text TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (survey_id) REFERENCES custom_surveys (id) ON DELETE CASCADE
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS custom_survey_votes (
            survey_id INTEGER NOT NULL,
            user_telegram_id INTEGER NOT NULL,
            option_id INTEGER NOT NULL,
            PRIMARY KEY (survey_id, user_telegram_id),
            FOREIGN KEY (survey_id) REFERENCES custom_surveys (id) ON DELETE CASCADE,
            FOREIGN KEY (option_id) REFERENCES custom_survey_options (id) ON DELETE CASCADE
        )
    ''')

    # === 3.3 ТАБЛИЦА ВЕСОВ (k = S/avg, итог = 10 × k) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS object_weights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            object_id INTEGER UNIQUE NOT NULL,
            weight REAL NOT NULL,
            calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (object_id) REFERENCES duty_objects (id) ON DELETE CASCADE
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
    
    # === 5. ТАБЛИЦА ГРАФИКА НАРЯДОВ ===
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

    # === 6. РАСПРЕДЕЛЕНИЕ ПО СМЕНАМ (Курс, ГБР) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS duty_shift_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL CHECK(date LIKE '____-__-__'),
            role TEXT NOT NULL,
            fio TEXT NOT NULL,
            shift INTEGER NOT NULL DEFAULT 0,
            enrollment_year INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(date, role, fio, enrollment_year)
        )
    ''')

    # === 7. РАСПРЕДЕЛЕНИЕ ПО ОБЪЕКТАМ (Столовая) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS duty_canteen_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL CHECK(date LIKE '____-__-__'),
            fio TEXT NOT NULL,
            object_name TEXT NOT NULL,
            enrollment_year INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(date, fio, enrollment_year)
        )
    ''')

    # === 8. ИСТОРИЯ НАЗНАЧЕНИЙ (для алгоритма) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS duty_assignment_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fio TEXT NOT NULL,
            date TEXT NOT NULL,
            role TEXT NOT NULL,
            sub_object TEXT,
            shift INTEGER,
            enrollment_year INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # === 8.0 ЗАГРУЗКИ ГРАФИКОВ (кто и когда загрузил) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS schedule_uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ym TEXT NOT NULL CHECK(ym LIKE '____-__'),
            group_name TEXT NOT NULL,
            enrollment_year INTEGER NOT NULL,
            uploaded_by_telegram_id INTEGER,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ym, group_name, enrollment_year)
        )
    ''')

    # === 8.1 ЗАМЕНЫ В НАРЯДАХ (статистика: кто болел, кого заменял) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS duty_replacements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL CHECK(date LIKE '____-__-__'),
            role TEXT NOT NULL,
            group_name TEXT NOT NULL,
            enrollment_year INTEGER NOT NULL,
            fio_removed TEXT NOT NULL,
            fio_replacement TEXT NOT NULL,
            reason TEXT NOT NULL CHECK(reason IN ('заболел', 'командировка', 'рапорт', 'другое')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by_telegram_id INTEGER
        )
    ''')

    # === 8.2 САМООТЧЁТ КУРСАНТА О БОЛЬНИЧНОМ ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sick_leave_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            report_date TEXT NOT NULL CHECK(report_date LIKE '____-__-__'),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        )
    ''')

    # === 9. ИНДЕКСЫ (оптимизация) ===
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_tg_id ON users (telegram_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_group_year ON users (group_name, enrollment_year)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_status ON users (status)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_gender ON users (gender)')
    
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_duty_date ON duty_schedule (date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_duty_group_year ON duty_schedule (group_name, enrollment_year)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_duty_gender ON duty_schedule (gender)')
    
    # Индексы для опроса (попарное голосование)
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_pair_votes_user ON survey_pair_votes (user_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_pair_votes_stage ON survey_pair_votes (stage)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_duty_objects_parent ON duty_objects (parent_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_object_weights_object ON object_weights (object_id)')
    
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_shift_assign_date ON duty_shift_assignments (date, role)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_canteen_assign_date ON duty_canteen_assignments (date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_assign_history_fio ON duty_assignment_history (fio, role)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_duty_replacements_date ON duty_replacements (date, enrollment_year)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_duty_replacements_fio_removed ON duty_replacements (fio_removed)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_duty_replacements_fio_repl ON duty_replacements (fio_replacement)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_sick_leave_telegram ON sick_leave_reports (telegram_id)')

    # === 10. УВЕДОМЛЕНИЯ ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER,
            scope TEXT NOT NULL CHECK(scope IN ('user', 'group', 'course', 'all')),
            scope_value TEXT,
            title TEXT NOT NULL,
            body TEXT,
            type TEXT DEFAULT 'info' CHECK(type IN ('schedule_change', 'reminder', 'system', 'course', 'group')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by_telegram_id INTEGER,
            FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_notifications_telegram ON notifications (telegram_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_notifications_scope ON notifications (scope, scope_value)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at)')

    # === 11. ПРОЧИТАННЫЕ УВЕДОМЛЕНИЯ (для scope group/course/all храним кому показано) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notification_read (
            notification_id INTEGER NOT NULL,
            telegram_id INTEGER NOT NULL,
            read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (notification_id, telegram_id),
            FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE,
            FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_notification_read_tg ON notification_read (telegram_id)')

    # === 12. ДОСТИЖЕНИЯ (фиксированный набор) ===
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS achievements (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            icon_url TEXT,
            sort_order INTEGER DEFAULT 0
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_achievements (
            telegram_id INTEGER NOT NULL,
            achievement_id TEXT NOT NULL,
            unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (telegram_id, achievement_id),
            FOREIGN KEY (telegram_id) REFERENCES users (telegram_id),
            FOREIGN KEY (achievement_id) REFERENCES achievements (id)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_achievements_tg ON user_achievements (telegram_id)')
    # Сидер достижений (если пусто)
    cursor.execute('SELECT COUNT(*) FROM achievements')
    if cursor.fetchone()[0] == 0:
        for row in [
            ('first_10_duties', 'Первые 10 нарядов', 'Выполнил 10 нарядов', None, 1),
            ('month_no_skip', 'Месяц без пропусков', 'Месяц без замен по болезни', None, 2),
            ('top3_course', 'Топ-3 курса', 'Вошел в тройку лидеров по курсу за месяц', None, 3),
            ('top10_institute', 'Топ-10 института', 'Вошел в десятку по институту за месяц', None, 4),
            ('canteen_master', 'Мастер столовой', '10 нарядов в столовой', None, 5),
            ('gbr_5', 'ГБР × 5', '5 нарядов ГБР', None, 6),
        ]:
            cursor.execute('INSERT OR IGNORE INTO achievements (id, title, description, icon_url, sort_order) VALUES (?, ?, ?, ?, ?)', row)

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

# === НОВЫЕ ФУНКЦИИ ДЛЯ ОПРОСА (синхронизировано с server.py) ===

def init_survey_objects():
    """Инициализирует объекты для попарного голосования (2/1/0).
    Этап 1: Курс, ГБР, Столовая, ЗУБ (4 объекта, 6 пар).
    Этап 2: 6 объектов столовой (Горячий цех, Овощной цех, Стаканы, Железо, Лента, Тарелки) — 13 случайных пар.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM duty_objects")
    total = cursor.fetchone()[0]
    if total > 0:
        conn.close()
        return
    
    # Этап 1: Основные наряды (4 шт.)
    main_duties = ['Курс', 'ГБР', 'Столовая', 'ЗУБ']
    for name in main_duties:
        cursor.execute('INSERT INTO duty_objects (name, parent_id) VALUES (?, ?)', (name, None))
    
    conn.commit()
    
    # Этап 2: Объекты столовой (6 шт.) — для опроса 13 случайных пар
    cursor.execute("SELECT id FROM duty_objects WHERE name='Столовая' AND parent_id IS NULL")
    row = cursor.fetchone()
    if row:
        canteen_id = row['id']
        canteen_objects = ['Горячий цех', 'Овощной цех', 'Стаканы', 'Железо', 'Лента', 'Тарелки']
        for name in canteen_objects:
            cursor.execute('INSERT INTO duty_objects (name, parent_id) VALUES (?, ?)', (name, canteen_id))
    
    # Опрос для девушек: Столовая, ПУТСО, Медчасть, ОТО (4 объекта, 6 пар)
    cursor.execute("SELECT id FROM duty_objects WHERE name = 'Опрос девушек' AND parent_id IS NULL")
    if not cursor.fetchone():
        cursor.execute('INSERT INTO duty_objects (name, parent_id) VALUES (?, ?)', ('Опрос девушек', None))
        conn.commit()
    cursor.execute("SELECT id FROM duty_objects WHERE name = 'Опрос девушек' AND parent_id IS NULL")
    female_parent = cursor.fetchone()
    if female_parent:
        fid = female_parent['id']
        for name in ('Столовая', 'ПУТСО', 'Медчасть', 'ОТО'):
            cursor.execute("SELECT id FROM duty_objects WHERE name = ? AND parent_id = ?", (name, fid))
            if not cursor.fetchone():
                cursor.execute('INSERT INTO duty_objects (name, parent_id) VALUES (?, ?)', (name, fid))
    conn.commit()
    conn.close()
    print("✅ Объекты для опроса инициализированы: 4 основных наряда (6 пар), 6 объектов столовой (13 случайных пар), опрос девушек (4 объекта: Столовая, ПУТСО, Медчасть, ОТО)")


def ensure_female_survey_objects():
    """Добавляет недостающие объекты в «Опрос девушек» (миграция: добавить ОТО в существующие БД)."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM duty_objects WHERE name = 'Опрос девушек' AND parent_id IS NULL")
    row = cursor.fetchone()
    if not row:
        conn.close()
        return
    fid = row['id']
    for name in ('Столовая', 'ПУТСО', 'Медчасть', 'ОТО'):
        cursor.execute("SELECT id FROM duty_objects WHERE name = ? AND parent_id = ?", (name, fid))
        if not cursor.fetchone():
            cursor.execute('INSERT INTO duty_objects (name, parent_id) VALUES (?, ?)', (name, fid))
    conn.commit()
    conn.close()

def get_survey_results_by_course(course_year):
    """Получает результаты опроса (веса объектов). course_year пока не фильтрует — веса глобальные."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT o.id, o.name, o.parent_id, w.weight as avg_rating
        FROM duty_objects o
        LEFT JOIN object_weights w ON o.id = w.object_id
        ORDER BY o.parent_id, o.id
    ''')
    results = cursor.fetchall()
    conn.close()
    return [dict(r) for r in results]
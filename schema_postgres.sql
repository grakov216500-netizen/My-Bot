-- Схема PostgreSQL для сайта ВИТЕХ (аналог SQLite из database.py)
-- Запуск: psql -U postgres -d vitech -f schema_postgres.sql

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    fio TEXT NOT NULL,
    faculty TEXT CHECK (faculty IN ('Инженерно-технический', 'Юридический')),
    enrollment_year INTEGER NOT NULL CHECK (enrollment_year BETWEEN 2021 AND 2027),
    group_name TEXT NOT NULL,
    is_custom_group BOOLEAN DEFAULT FALSE,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'sergeant', 'assistant', 'admin', 'female_editor')),
    status TEXT DEFAULT 'активен' CHECK (status IN ('активен', 'выпускник', 'отчислен')),
    gender TEXT DEFAULT 'male' CHECK (gender IN ('male', 'female')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_tg_id ON users (telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_group_year ON users (group_name, enrollment_year);

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    text TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'overdue')),
    deadline TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reminded BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks (user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks (deadline) WHERE deadline IS NOT NULL;

-- Блочный контент задачи/заметки (Notion-стиль: текст, to-do, медиа, дедлайн)
CREATE TABLE IF NOT EXISTS task_blocks (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    block_type TEXT NOT NULL CHECK (block_type IN ('text', 'todo', 'media', 'deadline')),
    content JSONB DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_task_blocks_task ON task_blocks (task_id);

-- Канбан «подготовка к сессии»: колонки и привязка задач к колонкам по датам
CREATE TABLE IF NOT EXISTS kanban_columns (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO kanban_columns (slug, title, sort_order) VALUES
    ('todo', 'К выполнению', 0),
    ('in_progress', 'В процессе', 1),
    ('done', 'Готово', 2)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS kanban_cards (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    column_slug TEXT NOT NULL DEFAULT 'todo',
    title TEXT,
    due_date DATE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_user ON kanban_cards (user_id);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_due ON kanban_cards (due_date) WHERE due_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS duty_objects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES duty_objects(id),
    description TEXT
);

CREATE TABLE IF NOT EXISTS survey_pair_votes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    object_a_id INTEGER NOT NULL REFERENCES duty_objects(id),
    object_b_id INTEGER NOT NULL REFERENCES duty_objects(id),
    choice TEXT NOT NULL CHECK (choice IN ('a', 'b', 'equal')),
    stage TEXT NOT NULL CHECK (stage IN ('main', 'canteen', 'female')),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, object_a_id, object_b_id)
);

CREATE TABLE IF NOT EXISTS object_weights (
    object_id INTEGER PRIMARY KEY REFERENCES duty_objects(id),
    weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS duty_schedule (
    id SERIAL PRIMARY KEY,
    fio TEXT NOT NULL,
    date DATE NOT NULL,
    role TEXT NOT NULL,
    group_name TEXT NOT NULL,
    enrollment_year INTEGER NOT NULL,
    gender TEXT DEFAULT 'male',
    UNIQUE(fio, date, enrollment_year)
);
CREATE INDEX IF NOT EXISTS idx_duty_date ON duty_schedule (date);
CREATE INDEX IF NOT EXISTS idx_duty_group_year ON duty_schedule (group_name, enrollment_year);

CREATE TABLE IF NOT EXISTS duty_shift_assignments (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    role TEXT NOT NULL,
    fio TEXT NOT NULL,
    shift INTEGER NOT NULL DEFAULT 0,
    enrollment_year INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, role, fio, enrollment_year)
);

CREATE TABLE IF NOT EXISTS duty_canteen_assignments (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    fio TEXT NOT NULL,
    object_name TEXT NOT NULL,
    enrollment_year INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, fio, enrollment_year)
);

CREATE TABLE IF NOT EXISTS duty_replacements (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    role TEXT NOT NULL,
    group_name TEXT NOT NULL,
    enrollment_year INTEGER NOT NULL,
    fio_removed TEXT NOT NULL,
    fio_replacement TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('заболел', 'командировка', 'рапорт', 'другое')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by_telegram_id BIGINT
);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT,
    scope TEXT NOT NULL CHECK (scope IN ('user', 'group', 'course', 'all')),
    scope_value TEXT,
    title TEXT NOT NULL,
    body TEXT,
    type TEXT DEFAULT 'info',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by_telegram_id BIGINT
);
CREATE INDEX IF NOT EXISTS idx_notifications_scope ON notifications (scope, scope_value);

CREATE TABLE IF NOT EXISTS notification_read (
    notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    telegram_id BIGINT NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id, telegram_id)
);

CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_achievements (
    telegram_id BIGINT NOT NULL,
    achievement_id TEXT NOT NULL REFERENCES achievements(id),
    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (telegram_id, achievement_id)
);

-- Форум (заготовка)
CREATE TABLE IF NOT EXISTS forum_categories (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS forum_topics (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES forum_categories(id),
    author_telegram_id BIGINT NOT NULL,
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    title TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    report_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS forum_posts (
    id SERIAL PRIMARY KEY,
    topic_id INTEGER NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
    author_telegram_id BIGINT NOT NULL,
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS forum_reports (
    id SERIAL PRIMARY KEY,
    topic_id INTEGER REFERENCES forum_topics(id) ON DELETE CASCADE,
    post_id INTEGER REFERENCES forum_posts(id) ON DELETE CASCADE,
    reporter_telegram_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

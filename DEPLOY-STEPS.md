# Что сделать, чтобы всё работало в полном объёме

После изменений (интерфейс нарядов, календарь, распределение по сменам и объектам) выполните по шагам.

---

## 1. У себя на компьютере

### 1.1. Где лежат изменения

- Изменения сделаны в **worktree**: `C:\Users\MSI\.cursor\worktrees\My_Bot\mnt`
- Коммит уже создан: `Duties: new UI toolbar calendar shifts canteen distribution API and DB tables`

### 1.2. Перенести изменения в основной репозиторий (если вы работаете из папки «My Bot»)

Если вы обычно работаете из **`C:\Users\MSI\Desktop\My Bot`**:

**Вариант А — через копирование коммита:**

```bash
cd "C:\Users\MSI\Desktop\My Bot"
git fetch "C:\Users\MSI\.cursor\worktrees\My_Bot\mnt"  # или добавить worktree как remote и fetch
# Либо просто скопировать изменённые файлы из mnt в My Bot и сделать git add + commit
```

**Вариант Б — скопировать файлы вручную** из `mnt` в `My Bot`:

- `server.py`
- `app/index.html`
- `app/script.js`
- `app/style.css`
- `database.py`
- `main.py`
- `handlers/duty_distributor.py` (новый файл)

Затем в папке «My Bot»:

```bash
git status
git add server.py app/index.html app/script.js app/style.css database.py main.py handlers/duty_distributor.py
git commit -m "Duties: UI, calendar, shifts, canteen distribution"
git push
```

---

## 2. На сервере

### 2.1. Обновить код

```bash
cd /путь/к/вашему/боту   # папка проекта на сервере
git pull
# или скопировать те же 7 файлов на сервер, если не используете git там
```

### 2.2. База данных

- Новые таблицы создаются при первом запуске (`CREATE TABLE IF NOT EXISTS` в `database.py`).
- Колонка `global_score` добавляется миграцией при вызове `init_db()`.
- Убедитесь, что **один и тот же файл БД** (например `bot.db`) используется и API, и ботом (переменная окружения `DATABASE`).

### 2.3. Перезапустить оба процесса

**1) API (FastAPI / uvicorn):**

```bash
# Как вы обычно перезапускаете (примеры):
sudo systemctl restart vitechbot-api
# или
pkill -f "uvicorn server:app"
uvicorn server:app --host 0.0.0.0 --port 8000
# или через screen/tmvm
```

**2) Telegram-бот:**

```bash
# Как вы обычно перезапускаете (примеры):
sudo systemctl restart vitechbot
# или
pkill -f "python main.py"
python main.py
# или через screen/tmvm
```

После перезапуска бота в логах должно появиться что-то вроде:  
`✅ duty_distributor загружен` и `⏰ Автораспределение нарядов: каждые 5 мин`.

---

## 3. Mini App (фронтенд)

Если Mini App раздаётся с **GitHub Pages** (grakov216500-netizen.github.io):

- Залить обновлённые файлы из папки **`app/`** в репозиторий, который крутит GitHub Pages:
  - `app/index.html`
  - `app/script.js`
  - `app/style.css`
- Сделать коммит и push — после деплоя страница подхватит новый интерфейс нарядов.

Если фронт лежит на том же сервере, что и API — достаточно было обновить файлы и перезапустить API (п. 2.3).

---

## 4. Краткий чеклист

| Шаг | Действие |
|-----|----------|
| 1 | У себя: перенести изменения в «My Bot» (или worktree) и сделать `git push` |
| 2 | На сервере: `git pull` (или скопировать 7 файлов) |
| 3 | На сервере: перезапустить **API** (server.py) |
| 4 | На сервере: перезапустить **бота** (main.py) |
| 5 | Обновить **Mini App** (GitHub Pages или сервер), чтобы подтянулись новый HTML/JS/CSS |
| 6 | Проверить: открыть приложение → вкладка «Наряды» → тулбар, календарь, загрузка графика, детали наряда |

---

## 5. Если что-то не работает

- **Наряды не грузятся / «График не загружен»** — проверьте, что API отвечает: `https://ваш-домен/api/duties/available-months?telegram_id=ВАШ_ID`.
- **Нет автораспределения в 15:30** — бот должен быть запущен и в логах есть сообщение про duty_distributor и job_queue.
- **Ошибки БД** — убедитесь, что при первом запуске вызывается инициализация БД (например при старте бота или API), чтобы создались новые таблицы и колонка `global_score`.

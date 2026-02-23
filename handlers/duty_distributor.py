"""
Автоматическое распределение по сменам (Курс/ГБР) и объектам (Столовая).
Запускается каждые 5 минут, проверяет наряды на сегодня.
За 3 часа до развода (18:30 → проверка в 15:30) делает распределение.
"""
from telegram.ext import ContextTypes
from datetime import datetime
from database import get_db
import random
import logging

logger = logging.getLogger(__name__)

CANTEEN_OBJECTS = ["ГЦ", "овощи", "тарелки", "железо", "стаканы", "лента"]
SHIFT_ROLES = ["к", "гбр"]
DISTRIBUTION_HOUR = 15
DISTRIBUTION_MINUTE = 30


async def auto_distribute_duties(context: ContextTypes.DEFAULT_TYPE):
    """Проверяет, нужно ли распределить наряды на сегодня."""
    now = datetime.now()
    if now.hour != DISTRIBUTION_HOUR or now.minute < DISTRIBUTION_MINUTE or now.minute > DISTRIBUTION_MINUTE + 5:
        return

    today = now.strftime("%Y-%m-%d")
    conn = get_db()
    if not conn:
        return

    try:
        ey_rows = conn.execute(
            "SELECT DISTINCT enrollment_year FROM duty_schedule WHERE date = ?", (today,)
        ).fetchall()
        
        for ey_row in ey_rows:
            ey = ey_row["enrollment_year"]

            for role in SHIFT_ROLES:
                existing = conn.execute(
                    "SELECT COUNT(*) as c FROM duty_shift_assignments WHERE date = ? AND role = ? AND enrollment_year = ?",
                    (today, role, ey)
                ).fetchone()
                if existing and existing["c"] > 0:
                    continue

                people = conn.execute(
                    "SELECT fio FROM duty_schedule WHERE date = ? AND role = ? AND enrollment_year = ?",
                    (today, role, ey)
                ).fetchall()
                if not people:
                    continue

                names = [r["fio"] for r in people]
                random.shuffle(names)
                assignments = []
                if role == "к":
                    for i, fio in enumerate(names):
                        shift = (i + 1) if i < 3 else 0
                        assignments.append((fio, shift))
                elif role == "гбр":
                    for i, fio in enumerate(names):
                        shift = (i // 2) + 1
                        assignments.append((fio, shift))

                for fio, shift in assignments:
                    conn.execute("""
                        INSERT OR REPLACE INTO duty_shift_assignments (date, role, fio, shift, enrollment_year)
                        VALUES (?, ?, ?, ?, ?)
                    """, (today, role, fio, shift, ey))
                    conn.execute("""
                        INSERT INTO duty_assignment_history (fio, date, role, shift, enrollment_year)
                        VALUES (?, ?, ?, ?, ?)
                    """, (fio, today, role, shift, ey))
                conn.commit()
                logger.info(f"Распределение {role} на {today} (EY={ey}): {len(assignments)} назначений")

            existing_c = conn.execute(
                "SELECT COUNT(*) as c FROM duty_canteen_assignments WHERE date = ? AND enrollment_year = ?",
                (today, ey)
            ).fetchone()
            if existing_c and existing_c["c"] > 0:
                continue

            canteen_people = conn.execute(
                "SELECT fio FROM duty_schedule WHERE date = ? AND role = 'с' AND enrollment_year = ?",
                (today, ey)
            ).fetchall()
            if not canteen_people:
                continue

            names = [r["fio"] for r in canteen_people]

            scores = {}
            for fio in names:
                u = conn.execute("SELECT global_score FROM users WHERE fio = ? AND enrollment_year = ?",
                                 (fio, ey)).fetchone()
                gs = u["global_score"] if u and u["global_score"] else 0

                hist = conn.execute("""
                    SELECT sub_object FROM duty_assignment_history
                    WHERE fio = ? AND role = 'с' AND enrollment_year = ?
                    ORDER BY date DESC LIMIT 5
                """, (fio, ey)).fetchall()
                history = [h["sub_object"] for h in hist if h["sub_object"]]

                streak_penalty = 0
                if len(history) >= 2:
                    weights_map = {}
                    try:
                        w_rows = conn.execute("""
                            SELECT do.name, ow.weight FROM duty_objects do
                            JOIN object_weights ow ON do.id = ow.object_id
                        """).fetchall()
                        weights_map = {r["name"]: r["weight"] for r in w_rows}
                    except Exception:
                        pass
                    heavy = [o for o in CANTEEN_OBJECTS if weights_map.get(o, 10) >= 12]
                    if history[0] in heavy and history[1] in heavy:
                        streak_penalty = 5

                scores[fio] = 0.5 * gs + streak_penalty

            sorted_names = sorted(names, key=lambda f: scores.get(f, 0))

            weights_map = {}
            try:
                w_rows = conn.execute("""
                    SELECT do.name, ow.weight FROM duty_objects do
                    JOIN object_weights ow ON do.id = ow.object_id
                """).fetchall()
                weights_map = {r["name"]: r["weight"] for r in w_rows}
            except Exception:
                pass
            objects_sorted = sorted(CANTEEN_OBJECTS, key=lambda o: weights_map.get(o, 10), reverse=True)

            for i, fio in enumerate(sorted_names):
                obj = objects_sorted[i % len(objects_sorted)]
                conn.execute("""
                    INSERT OR REPLACE INTO duty_canteen_assignments (date, fio, object_name, enrollment_year)
                    VALUES (?, ?, ?, ?)
                """, (today, fio, obj, ey))
                conn.execute("""
                    INSERT INTO duty_assignment_history (fio, date, role, sub_object, enrollment_year)
                    VALUES (?, ?, 'с', ?, ?)
                """, (fio, today, obj, ey))
            conn.commit()
            logger.info(f"Распределение столовой на {today} (EY={ey}): {len(sorted_names)} назначений")

    except Exception as e:
        logger.error(f"Ошибка автораспределения: {e}", exc_info=True)
    finally:
        conn.close()

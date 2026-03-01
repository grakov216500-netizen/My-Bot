import os
import json
import re
from datetime import datetime, date
from pathlib import Path
from typing import Dict, List, Optional

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://edu.vi.fsin.gov.ru"


class ApexAuthError(Exception):
    """Ошибка авторизации в Апекс-ВУЗ."""


class ApexScheduleParser:
    """
    Небольшой клиент для Апекс-ВУЗ:
    - логинится по служебному аккаунту;
    - умеет парсить дерево групп (факультет/курс/группа);
    - по названию группы и году набора отдаёт занятия «на сегодня».

    Важно: работает в рамках одного серверного процесса (FastAPI),
    хранит сессию в памяти и кэширует карту групп на диске.
    """

    def __init__(
        self,
        username: str,
        password: str,
        base_url: str = BASE_URL,
        cache_dir: str = "apex_cache",
        schedule_url: Optional[str] = None,
    ) -> None:
        if not username or not password:
            raise ValueError("APEX_USER / APEX_PASS не заданы")

        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "ru,en;q=0.9",
            }
        )

        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        # Файл с картой групп: {"Ио6-23": 165, ...}
        self.groups_cache_path = self.cache_dir / "apex_groups.json"

        # URL страницы расписания, на которой есть дерево групп
        # Можно переопределить через переменную окружения APEX_SCHEDULE_URL,
        # например: "/schedule/day/165/student"
        env_schedule_url = os.getenv("APEX_SCHEDULE_URL") or "/schedule/day/165/student"
        self.schedule_url = schedule_url or env_schedule_url

        self._logged_in = False

    # ------------------------------------------------------------------ #
    # Вспомогательные методы
    # ------------------------------------------------------------------ #

    def _full_url(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            return path
        if not path.startswith("/"):
            path = "/" + path
        return self.base_url + path

    def _login(self) -> None:
        """Логин в Апекс-ВУЗ (стандартная форма Yii2 /login)."""
        login_url = self._full_url("/login")
        resp = self.session.get(login_url, timeout=15)
        if resp.status_code != 200:
            raise ApexAuthError(f"Не удалось открыть страницу логина: HTTP {resp.status_code}")

        soup = BeautifulSoup(resp.text, "lxml")
        csrf = soup.find("meta", attrs={"name": "csrf-token"})
        csrf_token = csrf["content"] if csrf and csrf.has_attr("content") else None

        data = {
            "LoginForm[login]": self.username,
            "LoginForm[password]": self.password,
            "LoginForm[rememberMe]": "1",
        }
        if csrf_token:
            data["_csrf"] = csrf_token

        post_resp = self.session.post(login_url, data=data, timeout=15, allow_redirects=False)
        # У Yii2 успешный логин обычно = редирект (302) на / или /student/...
        if post_resp.status_code not in (302, 303):
            raise ApexAuthError(f"Ошибка авторизации: HTTP {post_resp.status_code}")

        self._logged_in = True

    def _ensure_login(self) -> None:
        if not self._logged_in:
            self._login()

    # ------------------------------------------------------------------ #
    # Карта групп
    # ------------------------------------------------------------------ #

    def _load_cached_groups(self) -> Optional[Dict[str, int]]:
        if not self.groups_cache_path.exists():
            return None
        try:
            with self.groups_cache_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            # ожидаем формат {label: id}
            if isinstance(data, dict):
                return {str(k): int(v) for k, v in data.items()}
        except Exception:
            return None
        return None

    def _save_cached_groups(self, mapping: Dict[str, int]) -> None:
        try:
            with self.groups_cache_path.open("w", encoding="utf-8") as f:
                json.dump(mapping, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def load_groups(self, force_reload: bool = False) -> Dict[str, int]:
        """
        Парсит левое дерево факультет/курс/группа и возвращает {label: base_id}.
        Пример label: "Ио6-23", "Юо2-ОП25".
        base_id берётся из href /schedule/day/<id>/student.
        """
        if not force_reload:
            cached = self._load_cached_groups()
            if cached:
                return cached

        self._ensure_login()
        url = self._full_url(self.schedule_url)
        resp = self.session.get(url, timeout=20)
        if resp.status_code != 200:
            raise RuntimeError(f"Не удалось загрузить страницу расписания: HTTP {resp.status_code}")

        soup = BeautifulSoup(resp.text, "lxml")
        mapping: Dict[str, int] = {}

        # Ищем элементы-узлы с иконкой групп (mdi-account-multiple) и ссылкой /schedule/day/<id>/student
        for li in soup.select("ul.list-group li.list-group-item.node-tree"):
            # У групп внутри есть <span class="mdi mdi-account-multiple">
            if not li.select_one("span.mdi-account-multiple"):
                continue
            a = li.select_one("a[href^='/schedule/day/']")
            if not a:
                continue
            label = (a.get_text(strip=True) or "").strip()
            href = a.get("href") or ""
            m = re.search(r"/schedule/day/(\d+)/student", href)
            if not label or not m:
                continue
            try:
                base_id = int(m.group(1))
            except ValueError:
                continue
            mapping[label] = base_id

        if not mapping:
            raise RuntimeError("Не удалось распарсить список групп с расписания")

        self._save_cached_groups(mapping)
        return mapping

    # ------------------------------------------------------------------ #
    # Расписание на сегодня
    # ------------------------------------------------------------------ #

    @staticmethod
    def _normalize_group_label(label: str) -> str:
        """
        Нормализация названия группы:
        - обрезаем пробелы;
        - приводим к единому регистру (первая буква большая, остальное как есть).

        Важное допущение: пользователь в боте вводит группу так же, как она
        написана в Апексе (Ио6-23, Юо1-ОК25 и т.п.), а мы только подчищаем мелочи.
        """
        if not label:
            return ""
        label = label.strip()
        # Просто убираем лишние пробелы вокруг дефисов
        label = re.sub(r"\s*-\s*", "-", label)
        return label

    def _find_group_id(self, group_label: str, groups: Dict[str, int]) -> Optional[int]:
        """
        Находит base_id по названию группы.
        Сначала пробует точное совпадение, затем — без учёта регистра.
        """
        label_norm = self._normalize_group_label(group_label)
        if not label_norm:
            return None

        if label_norm in groups:
            return groups[label_norm]

        # Попробуем без учёта регистра
        lower = label_norm.lower()
        for k, v in groups.items():
            if k.lower() == lower:
                return v
        return None

    def _parse_schedule_html_for_date(self, html: str, target_date: date) -> List[Dict]:
        """
        Разбирает HTML страницы /schedule/day/<id>/student?set-year=YYYY
        и возвращает список занятий на указанную дату.
        """
        soup = BeautifulSoup(html, "lxml")
        table = soup.find("table", class_="schedule-table")
        if not table:
            return []

        tbody = table.find("tbody")
        if not tbody:
            return []

        target_str = target_date.strftime("%d.%m.%Y")
        lessons: List[Dict] = []
        current_date_str: Optional[str] = None

        for tr in tbody.find_all("tr"):
            # В day-start есть data-date с датой дня
            data_date = tr.get("data-date")
            if data_date:
                current_date_str = data_date.strip()

            if current_date_str != target_str:
                continue

            time_td = tr.find("td", class_="time-column")
            subj_td = tr.find("td", class_="discipline-column")
            if not time_td or not subj_td:
                continue

            time_text = time_td.get_text(strip=True)
            subject = subj_td.get_text(" ", strip=True)
            if not subject and not time_text:
                continue

            # Преподаватель и аудитория (если есть)
            teacher_td = tr.find("td", class_="staff-column")
            room_td = tr.find("td", class_="text-center")

            teacher = teacher_td.get_text(" ", strip=True) if teacher_td else ""
            room = room_td.get_text(" ", strip=True) if room_td else ""

            lessons.append(
                {
                    "date": current_date_str,
                    "time": time_text,
                    "subject": subject,
                    "teacher": teacher,
                    "room": room,
                }
            )

        return lessons

    def get_today_schedule(self, group_label: str, year: int) -> List[Dict]:
        """
        Возвращает список занятий на сегодняшнюю дату для указанной группы и года набора.
        """
        self._ensure_login()
        groups = self.load_groups()
        group_id = self._find_group_id(group_label, groups)
        if group_id is None:
            raise ValueError(f"Группа '{group_label}' не найдена в Апексе")

        today = datetime.now().date()
        try:
            year_int = int(year)
        except Exception:
            year_int = today.year

        url = self._full_url(f"/schedule/day/{group_id}/student?set-year={year_int}")
        try:
            resp = self.session.get(url, timeout=20)
        except Exception as e:
            raise RuntimeError(f"Ошибка запроса к Апекс: {e}") from e

        if resp.status_code != 200:
            # Не бросаем — возвращаем пустой список (например выходной или сайт вернул ошибку)
            return []

        return self._parse_schedule_html_for_date(resp.text, today)

    def get_schedule_for_date(self, group_label: str, year: int, target_date: date) -> List[Dict]:
        """Возвращает список занятий на указанную дату для группы и года набора."""
        self._ensure_login()
        groups = self.load_groups()
        group_id = self._find_group_id(group_label, groups)
        if group_id is None:
            raise ValueError(f"Группа '{group_label}' не найдена в Апексе")
        try:
            year_int = int(year)
        except Exception:
            year_int = target_date.year
        url = self._full_url(f"/schedule/day/{group_id}/student?set-year={year_int}")
        try:
            resp = self.session.get(url, timeout=20)
        except Exception as e:
            raise RuntimeError(f"Ошибка запроса к Апекс: {e}") from e
        if resp.status_code != 200:
            return []
        return self._parse_schedule_html_for_date(resp.text, target_date)

    def get_schedule_for_week(
        self, group_label: str, year: int, week_start: date
    ) -> Dict[str, List[Dict]]:
        """
        Расписание на учебную неделю (Пн–Пт).
        week_start — понедельник недели.
        Возвращает { "YYYY-MM-DD": [уроки], ... }.
        """
        from datetime import timedelta

        result = {}
        for i in range(5):
            d = week_start + timedelta(days=i)
            lessons = self.get_schedule_for_date(group_label, year, d)
            result[d.strftime("%Y-%m-%d")] = lessons
        return result


def create_default_parser(): -> ApexScheduleParser:
    """
    Утилита для server.py: создаёт парсер из переменных окружения.
    Требуются:
      - APEX_USER
      - APEX_PASS
      - (опционально) APEX_SCHEDULE_URL
    """
    user = os.getenv("APEX_USER")
    password = os.getenv("APEX_PASS")
    if not user or not password:
        raise RuntimeError("APEX_USER / APEX_PASS не заданы в окружении")
    return ApexScheduleParser(username=user, password=password)


import argparse
import csv
import os
import sqlite3
from datetime import datetime, time
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

PATH = "https://rent.pe.ntu.edu.tw/"
CSV_PATH = "gym_data.csv"
SQLITE_PATH = "gym_data.db"

def scrape_gym_count():
    response = requests.get(PATH, timeout=20)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    count = 0

    items = soup.find_all("div", class_="CMCItem")
    for item in items:
        title = item.find("div", class_="IT")
        if title and "健身中心" in title.text:
            count = int(item.find("span").text.strip())

    return count

def save_to_csv(data, path=CSV_PATH):
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp", "count"])
        if f.tell() == 0:
            writer.writeheader()
        writer.writerow(data)

def save_to_sqlite(data, path=SQLITE_PATH):
    with sqlite3.connect(path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS gym_data (
                timestamp TEXT PRIMARY KEY,
                count INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT OR REPLACE INTO gym_data (timestamp, count) VALUES (?, ?)",
            (data["timestamp"], data["count"]),
        )
        conn.commit()

def insert_to_supabase(data):
    base_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    if not base_url or not service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to write to Supabase."
        )

    url = f"{base_url}/rest/v1/gym_data"
    payload = {
        "ts": data["timestamp"],
        "count": data["count"],
        "source": "rent.pe.ntu.edu.tw",
    }
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    response = requests.post(url, json=payload, headers=headers, timeout=20)
    response.raise_for_status()

def in_collection_window(now_local):
    weekday = now_local.weekday()  # Mon=0, Sun=6
    current_time = now_local.time()

    if weekday <= 4:  # Mon-Fri
        return time(8, 0) <= current_time <= time(21, 30)
    if weekday == 5:  # Sat
        return time(9, 0) <= current_time <= time(21, 30)
    return time(9, 0) <= current_time <= time(17, 30)  # Sun


def run(tz_name, write_csv, write_sqlite, write_supabase):
    now_local = datetime.now(ZoneInfo(tz_name))
    if not in_collection_window(now_local):
        print(f"Outside collection window for {tz_name}: {now_local.isoformat()}")
        return

    count = scrape_gym_count()
    data = {"timestamp": now_local.isoformat(), "count": count}

    if write_csv:
        save_to_csv(data)
    if write_sqlite:
        save_to_sqlite(data)
    if write_supabase:
        insert_to_supabase(data)
    print(data)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Scrape gym occupancy and persist to CSV/SQLite/Supabase."
    )
    parser.add_argument(
        "--timezone",
        default="Asia/Taipei",
        help="IANA timezone for collection window checks.",
    )
    parser.add_argument(
        "--csv",
        action="store_true",
        help="Write rows to gym_data.csv.",
    )
    parser.add_argument(
        "--sqlite",
        action="store_true",
        help="Write rows to gym_data.db.",
    )
    parser.add_argument(
        "--supabase",
        action="store_true",
        help="Insert rows to Supabase table gym_data.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    write_csv = args.csv
    write_sqlite = args.sqlite
    write_supabase = args.supabase or (not args.csv and not args.sqlite and not args.supabase)
    run(
        tz_name=args.timezone,
        write_csv=write_csv,
        write_sqlite=write_sqlite,
        write_supabase=write_supabase,
    )

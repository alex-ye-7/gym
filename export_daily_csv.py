import argparse
import csv
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

CSV_PATH = "gym_data.csv"

def parse_date(value):
    return datetime.strptime(value, "%Y-%m-%d").date()

def day_bounds_utc(local_day, tz_name):
    tz = ZoneInfo(tz_name)
    start_local = datetime.combine(local_day, datetime.min.time(), tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(ZoneInfo("UTC")), end_local.astimezone(ZoneInfo("UTC"))

def fetch_rows(local_day, tz_name):
    base_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    if not base_url or not service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for export."
        )

    start_utc, end_utc = day_bounds_utc(local_day, tz_name)
    start_iso = start_utc.isoformat().replace("+00:00", "Z")
    end_iso = end_utc.isoformat().replace("+00:00", "Z")

    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }

    rows = []
    page_size = 1000
    offset = 0

    while True:
        params = {
            "select": "ts,count",
            "ts": f"gte.{start_iso}",
            "and": f"(ts.lt.{end_iso})",
            "order": "ts.asc",
            "limit": page_size,
            "offset": offset,
        }
        response = requests.get(
            f"{base_url}/rest/v1/gym_data",
            headers=headers,
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        batch = response.json()
        rows.extend(batch)

        if len(batch) < page_size:
            break
        offset += page_size

    return rows


def write_csv(rows, path=CSV_PATH):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp", "count"])
        writer.writeheader()
        for row in rows:
            writer.writerow({"timestamp": row["ts"], "count": row["count"]})


def main():
    parser = argparse.ArgumentParser(
        description="Export one local day of Supabase gym_data rows to gym_data.csv"
    )
    parser.add_argument("--timezone", default="Asia/Taipei")
    parser.add_argument("--date", help="Local date in YYYY-MM-DD. Defaults to today.")
    args = parser.parse_args()

    local_day = parse_date(args.date) if args.date else datetime.now(ZoneInfo(args.timezone)).date()
    rows = fetch_rows(local_day, args.timezone)
    write_csv(rows)
    print(f"Exported {len(rows)} rows for {local_day.isoformat()} to {CSV_PATH}")


if __name__ == "__main__":
    main()
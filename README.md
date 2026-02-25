## This script
- Scrapes National Taiwan University fitness center occupancy from `https://rent.pe.ntu.edu.tw/`.
- Runs every 10 minutes with GitHub Actions.
- Writes each row to Supabase table `gym_data`.
- Exports daily CSV snapshot (`gym_data.csv`) and commits once per day.

## Time window 
Data is only collected:
- Mon-Fri: 08:00-21:30
- Sat: 09:00-21:30
- Sun: 09:00-17:30

## Workflows
- `Gym Scrape` (`.github/workflows/gym-scrape.yml`)
  - Cron: every 10 minutes
  - Inserts row into Supabase only

- `Daily Gym CSV Export` (`.github/workflows/daily-export.yml`)
  - Cron: `40 13 * * *` (21:40 Asia/Taipei)
  - Exports and commits one time summary of day to `gym_data.csv`

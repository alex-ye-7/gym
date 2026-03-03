## Premise
I have found myself frustrated when I go to the fitness center at National Taiwan University and every machine, bench, and rack is in use. Luckily, the flow of people and occupancy is posted online on `https://rent.pe.ntu.edu.tw/` and is updated whenever you reload the page. 

Thus, I started with a Python script to scrape the website, looking for a way to run it every 10 minutes from the cloud. I ended up landing with Supabase to store the time and occupancy count, converting the script to Typescript, and using pg_cron (cron-based job scheduler for PostgreSQL) and pg_net (make asynchronous HTTP/HTTPS requests in SQL) features in Supabase. 

My goal is to identify a general time where gym occupancy is most optimal during the week, and perhaps run the script throughout a semester to identify trends by week. 

## Time window 
Data is only collected (ending 30 minutes before gym close)
- Mon-Fri: 08:00-21:30
- Sat: 09:00-21:30
- Sun: 09:00-17:30


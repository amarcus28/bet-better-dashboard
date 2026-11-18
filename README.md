# Bet Better results

Static dashboard for placed-bet results. The betting bot stays in its private
repository and writes each placed bet to Supabase. This site reads that
database in the browser. GitHub Pages serves the page from `docs/`.

The page rebuilds the pivots in the browser:

- profit, stake, ROI, and record
- league × book, market × book, and month × book
- the bet log

There is no live link to the spreadsheet. Order ids are not readable from
this page. Bovada picks are not in the database yet.

Site: https://amarcus28.github.io/bet-better-dashboard/

## Local preview

```sh
python3 -m http.server 8000 --directory docs
```

Open `http://127.0.0.1:8000`.

# Bet Better results

Static dashboard for placed-bet results. The betting bot stays in its private
repository. This repo only has a snapshot of the results sheet, published with
GitHub Pages from `docs/`.

The page rebuilds the spreadsheet pivots in the browser:

- profit, stake, ROI, and record
- league × book, market × book, and month × book
- the bet log
- the separate Bovada pick list

There is no live link to the spreadsheet.

Site: https://amarcus28.github.io/bet-better-dashboard/

## Refresh the numbers

From the private bot repo, with `src/user_info.json` and `src/credentials.json`
in place:

```sh
python scripts/export_dashboard.py
```

That writes `docs/data/bets.json` in this repo. Commit and push to update the
site.

## Local preview

```sh
python3 -m http.server 8000 --directory docs
```

Open `http://127.0.0.1:8000`.

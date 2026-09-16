# Pokémon Data Explorer

The presentation layer for the PokéAPI ETL pipeline. A Flask app reads the
processed CSV files and serves them to a vanilla JS front end with a searchable
Pokédex gallery, detail modal, head-to-head comparison and eight Chart.js
visualisations.

The ETL pipeline is not modified or imported. This app only reads
`data/processed/*.csv`.

## Run it

```bash
pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000>

## Where the data comes from

On start-up the app looks for `data/processed/pokemon.csv` in this order:

1. `POKEDEX_DATA_DIR` (environment variable, if set)
2. `./data/processed` next to `app.py`
3. `../data/processed` (when this folder sits inside the pipeline project)
4. `./data/processed` relative to the working directory

So if you drop this folder inside your existing project, it finds the pipeline
output without copying any CSV files. To point somewhere else:

```bash
POKEDEX_DATA_DIR=/path/to/data/processed python app.py
```

## Derived fields

`pokemon.csv` from the pipeline contains raw stats only. These fields are
computed in `data_layer.py` when the app starts, not invented and not stored:

| Field | Rule |
| --- | --- |
| `total_base_stats` | sum of the six base stats |
| `offensive_power` | mean of attack and special attack |
| `defensive_power` | mean of hp, defense and special defense |
| `speed_percentile` | percentile rank of speed across the dataset |
| `battle_style` | offensive if offence ÷ defence ≥ 1.15, defensive if ≤ 0.87, else balanced |
| `stat_specialization` | highest single base stat, plus its share of the total |
| `size_class` | height bands: Tiny <0.5 m, Small <1 m, Medium <2 m, Large <4 m, Huge ≥4 m |
| `special_status` | Mythical / Legendary / Baby / Alternate Form / Standard |

If your ETL pipeline later writes these columns itself, delete the matching
lines in `Pokedex._derive()` and they will be read from the CSV instead.

## Dataset notes found during inspection

- `pokemon.csv` holds 1,351 rows: 1,025 default Pokémon plus 326 alternate
  forms with ids above 10000. Forms are joined to species through
  `pokemon_varieties.csv`, so they inherit generation, category and flags.
- `pokemon_species.csv` has 1,025 rows. `habitat` is null for 639 of them and
  `egg_group_2` is null for 746; both render as "Not recorded".
- `base_experience` is null for 49 Pokémon; `moves.csv` has no power for 287
  moves and no accuracy for 207. Nulls are serialised as `null` and shown as `—`.
- `pokemon_moves.csv` is 638,321 rows. It is loaded once with narrow dtypes
  (~9 MB in memory) and reduced to one row per Pokémon/move/learn-method,
  keeping the most recent version group.
- Record holders exclude alternate forms, which would otherwise win nearly
  every category.

## API

| Endpoint | Returns |
| --- | --- |
| `GET /api/health` | load status |
| `GET /api/summary` | counts, filter options, record holders |
| `GET /api/pokemon` | paginated gallery feed |
| `GET /api/pokemon/index` | id + name list for the compare selectors |
| `GET /api/pokemon/random` | one random default Pokémon, full detail |
| `GET /api/pokemon/<id>` | full detail: stats, derived, species, abilities, moves, forms |
| `GET /api/types` | types with Pokémon counts |
| `GET /api/abilities` | abilities with usage counts |
| `GET /api/moves` | full move table |
| `GET /api/analytics/all` | every chart payload in one call |
| `GET /api/analytics/{type-distribution,generations,battle-style,top-stats,attack-defense,speed,moves}` | individual chart payloads |

Query parameters on `/api/pokemon`: `search`, `type`, `generation`,
`battle_style`, `special_status`, `size_class`, `sort`
(`id|name|total|attack|defense|speed`), `page`, `per_page` (1–120).

```
GET /api/pokemon?search=pika&type=electric&generation=generation-i&page=1
```

Every response is `{"success": true, "data": ...}` or
`{"success": false, "error": "..."}`. Status codes: 200 ok, 400 bad parameter,
404 unknown Pokémon, 500 data not loaded.

## Files

```
pokemon_dashboard/
├── app.py              Flask routes and JSON responses
├── data_layer.py       CSV loading, derived fields, analytics cache
├── requirements.txt
├── templates/index.html
├── static/css/style.css
├── static/js/app.js
└── README.md
```

## Notes

- Artwork is loaded from the public PokéAPI sprite repository by id, with a
  fallback chain: official artwork → small sprite → Pokéball silhouette. No
  images are stored in the project.
- Chart.js 4.4.1 loads from a CDN. Without internet access the charts show
  "This chart could not be drawn" and the rest of the site still works.
- All CSVs are read once at start-up; analytics payloads are computed once and
  cached. Start-up takes a few seconds, mostly for `pokemon_moves.csv`.

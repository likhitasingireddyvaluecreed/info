"""
Pokemon Data Explorer - Flask presentation layer.

Reads the processed CSV files produced by the existing ETL pipeline and serves
them as JSON to a vanilla JS front end. The ETL pipeline itself is untouched.

Run:
    pip install -r requirements.txt
    python app.py
Then open http://127.0.0.1:5000
"""

from __future__ import annotations

import logging

from flask import Flask, jsonify, render_template, request

from data_layer import DataError, Pokedex, records

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
)
log = logging.getLogger("pokemon_dashboard")

app = Flask(__name__)
app.json.sort_keys = False

# Loaded once at start-up. If the CSVs are missing, POKEDEX stays None and
# every endpoint answers with a clean 500 instead of crashing the process.
POKEDEX: Pokedex | None = None
LOAD_ERROR: str | None = None

try:
    POKEDEX = Pokedex()
except DataError as exc:
    LOAD_ERROR = str(exc)
    log.error("Failed to load processed data: %s", exc)
except Exception as exc:  # unexpected, still must not kill the server
    LOAD_ERROR = f"Unexpected error while loading processed data: {exc}"
    log.exception("Failed to load processed data")


# --------------------------------------------------------------------------- #
# Response helpers
# --------------------------------------------------------------------------- #

def ok(data, **extra):
    payload = {"success": True, "data": data}
    payload.update(extra)
    return jsonify(payload), 200


def fail(message: str, status: int):
    return jsonify({"success": False, "error": message}), status


def store() -> Pokedex:
    """Return the loaded store or raise, so routes stay short."""
    if POKEDEX is None:
        raise DataError(LOAD_ERROR or "Processed data is not available.")
    return POKEDEX


@app.errorhandler(404)
def handle_404(_):
    return fail("Endpoint not found.", 404)


@app.errorhandler(500)
def handle_500(_):
    return fail("Something went wrong on the server.", 500)


# --------------------------------------------------------------------------- #
# Page
# --------------------------------------------------------------------------- #

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health")
def health():
    if POKEDEX is None:
        return fail(LOAD_ERROR or "Data not loaded.", 500)
    return ok({"status": "ok", "pokemon_loaded": POKEDEX.summary["pokemon"]})


# --------------------------------------------------------------------------- #
# Core data
# --------------------------------------------------------------------------- #

@app.route("/api/summary")
def api_summary():
    try:
        dex = store()
    except DataError as exc:
        return fail(str(exc), 500)
    return ok({"counts": dex.summary, "filters": dex.filter_options,
               "superlatives": dex.superlatives})


@app.route("/api/pokemon")
def api_pokemon():
    """Paginated, searchable, filterable gallery feed."""
    try:
        dex = store()
    except DataError as exc:
        return fail(str(exc), 500)

    try:
        page = int(request.args.get("page", 1))
        per_page = int(request.args.get("per_page", 24))
    except ValueError:
        return fail("page and per_page must be integers.", 400)

    if page < 1:
        return fail("page must be 1 or greater.", 400)
    if not 1 <= per_page <= 120:
        return fail("per_page must be between 1 and 120.", 400)

    frame = dex.filtered(
        search=request.args.get("search", ""),
        type_name=request.args.get("type", ""),
        generation=request.args.get("generation", ""),
        battle_style=request.args.get("battle_style", ""),
        special_status=request.args.get("special_status", ""),
        size_class=request.args.get("size_class", ""),
        sort=request.args.get("sort", "id"),
    )

    total = len(frame)
    pages = max(1, -(-total // per_page))  # ceil
    start = (page - 1) * per_page
    slice_ = frame.iloc[start:start + per_page]
    items = [dex.card_fields(row) for _, row in slice_.iterrows()]

    return ok(
        items,
        pagination={
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": pages,
            "has_next": page < pages,
            "has_prev": page > 1,
        },
    )


@app.route("/api/pokemon/index")
def api_pokemon_index():
    """Lightweight id + name list, used by the compare selectors."""
    try:
        dex = store()
    except DataError as exc:
        return fail(str(exc), 500)
    frame = dex.pokemon[["pokemon_id", "display_name", "primary_type"]]
    return ok(records(frame))


@app.route("/api/pokemon/random")
def api_pokemon_random():
    try:
        dex = store()
    except DataError as exc:
        return fail(str(exc), 500)
    return ok(dex.detail(dex.random_id()))


@app.route("/api/pokemon/<pokemon_id>")
def api_pokemon_detail(pokemon_id: str):
    try:
        dex = store()
    except DataError as exc:
        return fail(str(exc), 500)

    if not pokemon_id.isdigit():
        return fail("Pokemon id must be a number.", 400)

    detail = dex.detail(int(pokemon_id))
    if detail is None:
        return fail(f"No Pokemon with id {pokemon_id} in the dataset.", 404)
    return ok(detail)


@app.route("/api/types")
def api_types():
    try:
        dex = store()
    except DataError as exc:
        return fail(str(exc), 500)
    counts = dex.analytics["type_distribution"]
    data = [
        {"type_name": key, "label": label, "count": value}
        for key, label, value in zip(counts["keys"], counts["labels"], counts["values"])
    ]
    return ok(data)


@app.route("/api/abilities")
def api_abilities():
    try:
        dex = store()
    except DataError as exc:
        return fail(str(exc), 500)
    usage = (
        dex.pokemon_abilities.groupby("ability_name")["pokemon_id"]
        .nunique()
        .sort_values(ascending=False)
    )
    data = [{"ability_name": name, "pokemon_count": int(count)} for name, count in usage.items()]
    return ok(data)


@app.route("/api/moves")
def api_moves():
    try:
        dex = store()
    except DataError as exc:
        return fail(str(exc), 500)
    return ok(records(dex.moves))


# --------------------------------------------------------------------------- #
# Analytics (all precomputed once at start-up)
# --------------------------------------------------------------------------- #

def _analytics(key: str):
    try:
        dex = store()
    except DataError as exc:
        return fail(str(exc), 500)
    return ok(dex.analytics[key])


@app.route("/api/analytics/type-distribution")
def analytics_types():
    return _analytics("type_distribution")


@app.route("/api/analytics/generations")
def analytics_generations():
    return _analytics("generations")


@app.route("/api/analytics/battle-style")
def analytics_battle_style():
    return _analytics("battle_style")


@app.route("/api/analytics/top-stats")
def analytics_top_stats():
    return _analytics("top_stats")


@app.route("/api/analytics/attack-defense")
def analytics_attack_defense():
    return _analytics("attack_defense")


@app.route("/api/analytics/speed")
def analytics_speed():
    return _analytics("speed")


@app.route("/api/analytics/moves")
def analytics_moves():
    return _analytics("moves")


@app.route("/api/analytics/all")
def analytics_all():
    """One request for the whole analytics section."""
    try:
        dex = store()
    except DataError as exc:
        return fail(str(exc), 500)
    return ok(dex.analytics)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)

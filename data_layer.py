"""
Data layer for the Pokemon Data Explorer.

Loads the processed CSV files produced by the ETL pipeline exactly once at
start-up, then derives the analytics fields the presentation layer needs.

IMPORTANT
---------
The ETL pipeline is NOT modified by this module. It only reads
data/processed/*.csv.

The processed pokemon.csv contains raw stats only:
    pokemon_id, pokemon_name, height_m, weight_kg, base_experience,
    hp, attack, defense, special_attack, special_defense, speed

The derived fields used by the dashboard (total_base_stats, offensive_power,
defensive_power, speed_percentile, battle_style, stat_specialization,
size_class, special_status) are therefore computed here, in the reporting
layer, from those raw columns. Every rule is documented next to its code so
nothing on the website is invented or hard-coded.
"""

from __future__ import annotations

import logging
import math
import os
import random
from typing import Any

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _find_data_dir() -> str:
    """
    Locate data/processed so the dashboard works whether it sits at the project
    root or one level inside it. POKEDEX_DATA_DIR overrides the search.
    """
    override = os.environ.get("POKEDEX_DATA_DIR")
    if override:
        return os.path.abspath(override)
    candidates = [
        os.path.join(BASE_DIR, "data", "processed"),
        os.path.join(BASE_DIR, os.pardir, "data", "processed"),
        os.path.join(os.getcwd(), "data", "processed"),
    ]
    for path in candidates:
        if os.path.isfile(os.path.join(path, "pokemon.csv")):
            return os.path.abspath(path)
    return os.path.abspath(candidates[0])


DATA_DIR = _find_data_dir()

FILES = {
    "pokemon": "pokemon.csv",
    "species": "pokemon_species.csv",
    "varieties": "pokemon_varieties.csv",
    "types": "types.csv",
    "pokemon_types": "pokemon_types.csv",
    "abilities": "abilities.csv",
    "pokemon_abilities": "pokemon_abilities.csv",
    "moves": "moves.csv",
    "pokemon_moves": "pokemon_moves.csv",
}

STAT_COLUMNS = ["hp", "attack", "defense", "special_attack", "special_defense", "speed"]

STAT_LABELS = {
    "hp": "HP",
    "attack": "Attack",
    "defense": "Defense",
    "special_attack": "Sp. Attack",
    "special_defense": "Sp. Defense",
    "speed": "Speed",
}

# Release order of the version groups present in pokemon_moves.csv. Used only
# to pick the most recent game entry for a move, so the level shown is the
# newest one the dataset knows about.
VERSION_GROUP_ORDER = [
    "red-green-japan", "blue-japan", "red-blue", "yellow",
    "gold-silver", "crystal",
    "ruby-sapphire", "firered-leafgreen", "emerald", "colosseum", "xd",
    "diamond-pearl", "platinum", "heartgold-soulsilver",
    "black-white", "black-2-white-2",
    "x-y", "omega-ruby-alpha-sapphire",
    "sun-moon", "ultra-sun-ultra-moon", "lets-go-pikachu-lets-go-eevee",
    "sword-shield", "brilliant-diamond-shining-pearl", "legends-arceus",
    "scarlet-violet", "champions",
]

GENERATION_ORDER = [
    "generation-i", "generation-ii", "generation-iii", "generation-iv",
    "generation-v", "generation-vi", "generation-vii", "generation-viii",
    "generation-ix",
]

GENERATION_LABELS = {
    "generation-i": "Gen I", "generation-ii": "Gen II", "generation-iii": "Gen III",
    "generation-iv": "Gen IV", "generation-v": "Gen V", "generation-vi": "Gen VI",
    "generation-vii": "Gen VII", "generation-viii": "Gen VIII", "generation-ix": "Gen IX",
}


class DataError(RuntimeError):
    """Raised when the processed datasets cannot be loaded."""


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #

def _read_csv(key: str, **kwargs) -> pd.DataFrame:
    path = os.path.join(DATA_DIR, FILES[key])
    if not os.path.exists(path):
        raise DataError(
            f"Missing processed dataset: {FILES[key]}. Expected it at {path}. "
            "Run the ETL pipeline before starting the dashboard."
        )
    try:
        frame = pd.read_csv(path, **kwargs)
    except Exception as exc:  # malformed / unreadable file
        raise DataError(f"Could not read {FILES[key]}: {exc}") from exc
    if frame.empty:
        log.warning("%s loaded but contains no rows.", FILES[key])
    return frame


def _require_columns(frame: pd.DataFrame, columns: list[str], name: str) -> None:
    missing = [c for c in columns if c not in frame.columns]
    if missing:
        raise DataError(f"{name} is missing required column(s): {', '.join(missing)}")


def jsonable(value: Any) -> Any:
    """Convert numpy / pandas scalars and NaN into JSON-safe Python values."""
    if value is None:
        return None
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return None if math.isnan(number) or math.isinf(number) else number
    if value is pd.NaT:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def records(frame: pd.DataFrame) -> list[dict]:
    """DataFrame -> list of JSON-safe dicts."""
    return [
        {key: jsonable(val) for key, val in row.items()}
        for row in frame.to_dict(orient="records")
    ]


def title_case(value: Any) -> str | None:
    """pikachu-gmax -> Pikachu Gmax ; medium-slow -> Medium Slow."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    if not text:
        return None
    return " ".join(part.capitalize() for part in text.replace("_", "-").split("-") if part)


# --------------------------------------------------------------------------- #
# Derived field rules (documented, computed from raw stats)
# --------------------------------------------------------------------------- #

def _size_class(height_m: float) -> str:
    """Height buckets used for the size filter."""
    if height_m is None or (isinstance(height_m, float) and math.isnan(height_m)):
        return "Unknown"
    if height_m < 0.5:
        return "Tiny"
    if height_m < 1.0:
        return "Small"
    if height_m < 2.0:
        return "Medium"
    if height_m < 4.0:
        return "Large"
    return "Huge"


def _battle_style(offensive: float, defensive: float) -> str:
    """
    Offensive power and defensive power are both averages of their stats, so
    they are directly comparable. A >=15% lean either way names the style.
    """
    if defensive <= 0:
        return "Balanced"
    ratio = offensive / defensive
    if ratio >= 1.15:
        return "Offensive"
    if ratio <= 0.87:
        return "Defensive"
    return "Balanced"


class Pokedex:
    """In-memory store. Built once at start-up, read-only afterwards."""

    def __init__(self) -> None:
        self._load()
        self._derive()
        self._build_indexes()
        self._build_analytics_cache()
        log.info(
            "Pokedex ready: %s pokemon, %s species, %s types, %s abilities, %s moves.",
            len(self.pokemon), len(self.species), len(self.types),
            len(self.abilities), len(self.moves),
        )

    # ---------------------------------------------------------------- load --

    def _load(self) -> None:
        self.pokemon = _read_csv("pokemon")
        self.species = _read_csv("species")
        self.varieties = _read_csv("varieties")
        self.types = _read_csv("types")
        self.pokemon_types = _read_csv("pokemon_types")
        self.abilities = _read_csv("abilities")
        self.pokemon_abilities = _read_csv("pokemon_abilities")
        self.moves = _read_csv("moves")

        # 638k rows / 27 MB on disk. Narrow dtypes keep it near 9 MB in RAM.
        self.pokemon_moves = _read_csv(
            "pokemon_moves",
            dtype={
                "pokemon_id": "int32",
                "move_id": "int32",
                "level_learned_at": "int16",
                "move_name": "category",
                "learn_method": "category",
                "version_group": "category",
            },
        )

        _require_columns(self.pokemon, ["pokemon_id", "pokemon_name"] + STAT_COLUMNS, "pokemon.csv")
        _require_columns(self.species, ["pokemon_id", "generation"], "pokemon_species.csv")
        _require_columns(self.pokemon_types, ["pokemon_id", "type_name", "slot"], "pokemon_types.csv")

    # -------------------------------------------------------------- derive --

    def _derive(self) -> None:
        df = self.pokemon.copy()
        df["pokemon_name"] = df["pokemon_name"].astype(str)
        df["display_name"] = df["pokemon_name"].map(title_case)

        for col in STAT_COLUMNS:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)
        for col in ("height_m", "weight_kg", "base_experience"):
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
            else:
                df[col] = np.nan

        # --- derived stat fields -------------------------------------------
        df["total_base_stats"] = df[STAT_COLUMNS].sum(axis=1)
        # Mean of the two attacking stats.
        df["offensive_power"] = ((df["attack"] + df["special_attack"]) / 2).round(1)
        # Mean of the three stats that decide how long a Pokemon survives.
        df["defensive_power"] = ((df["hp"] + df["defense"] + df["special_defense"]) / 3).round(1)
        # Percentile rank of speed across every Pokemon in the dataset.
        df["speed_percentile"] = (df["speed"].rank(pct=True) * 100).round(1)
        df["battle_style"] = [
            _battle_style(o, d) for o, d in zip(df["offensive_power"], df["defensive_power"])
        ]
        # The single highest base stat, plus how dominant it is within the total.
        best = df[STAT_COLUMNS].idxmax(axis=1)
        df["stat_specialization"] = best.map(STAT_LABELS)
        df["specialization_score"] = (
            df[STAT_COLUMNS].max(axis=1) / df["total_base_stats"].replace(0, np.nan) * 100
        ).round(1)
        df["size_class"] = df["height_m"].map(_size_class)

        # --- species link ---------------------------------------------------
        # pokemon.csv holds 1,351 rows: 1,025 default Pokemon plus alternate
        # forms with ids above 10000. Forms are linked to their species through
        # pokemon_varieties.csv, so they inherit generation, category, etc.
        variety_map = self.varieties[["pokemon_id", "species_id", "is_default"]].copy()
        df = df.merge(variety_map, on="pokemon_id", how="left")
        df["species_id"] = df["species_id"].fillna(df["pokemon_id"]).astype(int)
        df["is_default"] = df["is_default"].fillna(True).astype(bool)

        species = self.species.rename(columns={"pokemon_id": "species_id"}).copy()
        for flag in ("is_baby", "is_legendary", "is_mythical"):
            if flag in species.columns:
                species[flag] = species[flag].astype(str).str.lower().eq("true") | species[flag].eq(True)
            else:
                species[flag] = False
        df = df.merge(species, on="species_id", how="left")

        for flag in ("is_baby", "is_legendary", "is_mythical"):
            df[flag] = df[flag].fillna(False).astype(bool)

        df["generation"] = df["generation"].where(df["generation"].notna(), None)
        df["generation_label"] = df["generation"].map(
            lambda g: GENERATION_LABELS.get(g, title_case(g) or "Unknown")
        )

        def _status(row) -> str:
            if row["is_mythical"]:
                return "Mythical"
            if row["is_legendary"]:
                return "Legendary"
            if row["is_baby"]:
                return "Baby"
            if not row["is_default"]:
                return "Alternate Form"
            return "Standard"

        df["special_status"] = df.apply(_status, axis=1)

        self.pokemon = df

    # ------------------------------------------------------------- indexes --

    def _build_indexes(self) -> None:
        # types per pokemon, ordered by slot
        types = self.pokemon_types.sort_values(["pokemon_id", "slot"])
        self._types_by_id = types.groupby("pokemon_id")["type_name"].apply(list).to_dict()
        self.pokemon["types"] = self.pokemon["pokemon_id"].map(
            lambda pid: self._types_by_id.get(pid, [])
        )
        self.pokemon["primary_type"] = self.pokemon["types"].map(
            lambda t: t[0] if t else "unknown"
        )

        # abilities per pokemon
        abil = self.pokemon_abilities.copy()
        if "is_hidden" in abil.columns:
            abil["is_hidden"] = abil["is_hidden"].astype(str).str.lower().eq("true") | abil["is_hidden"].eq(True)
        else:
            abil["is_hidden"] = False
        abil = abil.sort_values(["pokemon_id", "slot"])
        self._abilities_by_id: dict[int, list[dict]] = {
            pid: [
                {
                    "ability_name": r["ability_name"],
                    "display_name": title_case(r["ability_name"]),
                    "slot": int(r["slot"]),
                    "is_hidden": bool(r["is_hidden"]),
                }
                for _, r in group.iterrows()
            ]
            for pid, group in abil.groupby("pokemon_id")
        }

        # moves: keep one row per (pokemon, move, method), from the newest game
        moves_link = self.pokemon_moves.copy()
        order = {name: i for i, name in enumerate(VERSION_GROUP_ORDER)}
        moves_link["vg_rank"] = (
            moves_link["version_group"].astype(str).map(order).fillna(-1).astype(int)
        )
        moves_link = (
            moves_link.sort_values("vg_rank")
            .drop_duplicates(["pokemon_id", "move_id", "learn_method"], keep="last")
        )
        move_meta = self.moves[["move_id", "move_type", "power", "accuracy", "pp", "damage_class"]]
        moves_link = moves_link.merge(move_meta, on="move_id", how="left")
        moves_link["level_learned_at"] = moves_link["level_learned_at"].astype(int)
        moves_link = moves_link.sort_values(
            ["pokemon_id", "learn_method", "level_learned_at", "move_name"]
        )
        self._moves_by_id = {
            pid: group.drop(columns=["vg_rank"])
            for pid, group in moves_link.groupby("pokemon_id", observed=True)
        }

        self._by_id = {int(r["pokemon_id"]): r for _, r in self.pokemon.iterrows()}
        self._species_by_id = {int(r["pokemon_id"]): r for _, r in self.species.iterrows()}

        # search helpers
        self.pokemon["search_key"] = self.pokemon["pokemon_name"].str.lower()
        self.pokemon = self.pokemon.sort_values("pokemon_id").reset_index(drop=True)

    # --------------------------------------------------------- public reads --

    def card_fields(self, row) -> dict:
        """The compact shape used by the gallery grid."""
        return {
            "pokemon_id": int(row["pokemon_id"]),
            "pokemon_name": row["pokemon_name"],
            "display_name": row["display_name"],
            "types": list(row["types"]),
            "primary_type": row["primary_type"],
            "generation": jsonable(row["generation"]),
            "generation_label": row["generation_label"],
            "total_base_stats": int(row["total_base_stats"]),
            "battle_style": row["battle_style"],
            "special_status": row["special_status"],
            "size_class": row["size_class"],
            "is_default": bool(row["is_default"]),
            "speed": int(row["speed"]),
            "attack": int(row["attack"]),
            "defense": int(row["defense"]),
        }

    def filtered(
        self,
        search: str = "",
        type_name: str = "",
        generation: str = "",
        battle_style: str = "",
        special_status: str = "",
        size_class: str = "",
        sort: str = "id",
    ) -> pd.DataFrame:
        df = self.pokemon

        search = (search or "").strip().lower()
        if search:
            if search.isdigit():
                mask = df["pokemon_id"].astype(str).str.startswith(search) | df["search_key"].str.contains(search, regex=False)
            else:
                mask = df["search_key"].str.contains(search, regex=False)
            df = df[mask]

        if type_name:
            wanted = type_name.lower()
            df = df[df["types"].map(lambda t: wanted in t)]
        if generation:
            df = df[df["generation"] == generation]
        if battle_style:
            df = df[df["battle_style"] == battle_style]
        if special_status:
            df = df[df["special_status"] == special_status]
        if size_class:
            df = df[df["size_class"] == size_class]

        sorters = {
            "id": ("pokemon_id", True),
            "name": ("pokemon_name", True),
            "total": ("total_base_stats", False),
            "attack": ("attack", False),
            "defense": ("defense", False),
            "speed": ("speed", False),
        }
        column, ascending = sorters.get(sort, sorters["id"])
        return df.sort_values(column, ascending=ascending)

    def detail(self, pokemon_id: int) -> dict | None:
        row = self._by_id.get(int(pokemon_id))
        if row is None:
            return None

        species_row = self._species_by_id.get(int(row["species_id"]))
        species_block = None
        if species_row is not None:
            egg_groups = [
                title_case(species_row.get("egg_group_1")),
                title_case(species_row.get("egg_group_2")),
            ]
            species_block = {
                "pokemon_category": jsonable(species_row.get("pokemon_category")),
                "generation": jsonable(species_row.get("generation")),
                "generation_label": row["generation_label"],
                "color": title_case(species_row.get("color")),
                "shape": title_case(species_row.get("shape")),
                "habitat": title_case(species_row.get("habitat")),
                "capture_rate": jsonable(species_row.get("capture_rate")),
                "base_happiness": jsonable(species_row.get("base_happiness")),
                "growth_rate": title_case(species_row.get("growth_rate")),
                "gender_rate": jsonable(species_row.get("gender_rate")),
                "hatch_counter": jsonable(species_row.get("hatch_counter")),
                "egg_groups": [g for g in egg_groups if g],
                "is_baby": bool(row["is_baby"]),
                "is_legendary": bool(row["is_legendary"]),
                "is_mythical": bool(row["is_mythical"]),
            }

        moves_frame = self._moves_by_id.get(int(pokemon_id))
        if moves_frame is None:
            move_list: list[dict] = []
        else:
            move_list = [
                {
                    "move_id": int(r["move_id"]),
                    "move_name": str(r["move_name"]),
                    "display_name": title_case(r["move_name"]),
                    "move_type": jsonable(r["move_type"]),
                    "damage_class": jsonable(r["damage_class"]),
                    "power": jsonable(r["power"]),
                    "accuracy": jsonable(r["accuracy"]),
                    "pp": jsonable(r["pp"]),
                    "learn_method": str(r["learn_method"]),
                    "level_learned_at": int(r["level_learned_at"]),
                    "version_group": str(r["version_group"]),
                }
                for _, r in moves_frame.iterrows()
            ]

        # sibling forms of the same species
        family = self.pokemon[self.pokemon["species_id"] == int(row["species_id"])]
        forms = [
            {
                "pokemon_id": int(f["pokemon_id"]),
                "display_name": f["display_name"],
                "is_default": bool(f["is_default"]),
            }
            for _, f in family.iterrows()
            if int(f["pokemon_id"]) != int(pokemon_id)
        ]

        return {
            **self.card_fields(row),
            "height_m": jsonable(row["height_m"]),
            "weight_kg": jsonable(row["weight_kg"]),
            "base_experience": jsonable(row["base_experience"]),
            "stats": {col: int(row[col]) for col in STAT_COLUMNS},
            "derived": {
                "total_base_stats": int(row["total_base_stats"]),
                "offensive_power": jsonable(row["offensive_power"]),
                "defensive_power": jsonable(row["defensive_power"]),
                "speed_percentile": jsonable(row["speed_percentile"]),
                "battle_style": row["battle_style"],
                "stat_specialization": row["stat_specialization"],
                "specialization_score": jsonable(row["specialization_score"]),
                "size_class": row["size_class"],
            },
            "species": species_block,
            "abilities": self._abilities_by_id.get(int(pokemon_id), []),
            "moves": move_list,
            "move_count": len(move_list),
            "forms": forms,
        }

    def random_id(self) -> int:
        """Random pick from default Pokemon only, so forms don't dominate."""
        pool = self.pokemon[self.pokemon["is_default"]]["pokemon_id"]
        if pool.empty:
            pool = self.pokemon["pokemon_id"]
        return int(random.choice(pool.tolist()))

    # ------------------------------------------------------------ analytics --

    def _build_analytics_cache(self) -> None:
        """Every chart payload is computed once here, never per request."""
        df = self.pokemon

        type_counts = (
            self.pokemon_types.groupby("type_name")["pokemon_id"]
            .nunique()
            .sort_values(ascending=False)
        )
        gen_counts = (
            self.species.groupby("generation")["pokemon_id"].count()
            .reindex(GENERATION_ORDER)
            .dropna()
            .astype(int)
        )
        style_counts = df["battle_style"].value_counts()

        top_stats = df.nlargest(10, "total_base_stats")[
            ["pokemon_id", "display_name", "total_base_stats", "primary_type"]
        ]

        scatter = df[["pokemon_id", "display_name", "attack", "defense", "primary_type"]]

        speed_bins = list(range(0, 201, 20))
        speed_labels = [f"{speed_bins[i]}–{speed_bins[i + 1] - 1}" for i in range(len(speed_bins) - 1)]
        speed_cut = pd.cut(
            df["speed"].clip(upper=199), bins=speed_bins, right=False, labels=speed_labels
        )
        speed_hist = speed_cut.value_counts().reindex(speed_labels).fillna(0).astype(int)

        damage_class = self.moves["damage_class"].value_counts()
        move_types = self.moves["move_type"].value_counts().sort_values(ascending=False)
        top_moves = self.moves.dropna(subset=["power"]).nlargest(10, "power")[
            ["move_name", "move_type", "power", "damage_class"]
        ]

        self.analytics = {
            "type_distribution": {
                "labels": [title_case(t) for t in type_counts.index],
                "keys": list(type_counts.index),
                "values": [int(v) for v in type_counts.values],
            },
            "generations": {
                "labels": [GENERATION_LABELS.get(g, g) for g in gen_counts.index],
                "keys": list(gen_counts.index),
                "values": [int(v) for v in gen_counts.values],
            },
            "battle_style": {
                "labels": list(style_counts.index),
                "values": [int(v) for v in style_counts.values],
            },
            "top_stats": {
                "labels": list(top_stats["display_name"]),
                "values": [int(v) for v in top_stats["total_base_stats"]],
                "ids": [int(v) for v in top_stats["pokemon_id"]],
                "types": list(top_stats["primary_type"]),
            },
            "attack_defense": {
                "points": [
                    {
                        "x": int(r["attack"]),
                        "y": int(r["defense"]),
                        "name": r["display_name"],
                        "id": int(r["pokemon_id"]),
                        "type": r["primary_type"],
                    }
                    for _, r in scatter.iterrows()
                ]
            },
            "speed": {
                "labels": speed_labels,
                "values": [int(v) for v in speed_hist.values],
                "median": float(df["speed"].median()),
            },
            "moves": {
                "damage_class": {
                    "labels": [title_case(c) for c in damage_class.index],
                    "values": [int(v) for v in damage_class.values],
                },
                "move_types": {
                    "labels": [title_case(t) for t in move_types.index],
                    "keys": list(move_types.index),
                    "values": [int(v) for v in move_types.values],
                },
                "top_power": [
                    {
                        "move_name": title_case(r["move_name"]),
                        "move_type": r["move_type"],
                        "power": int(r["power"]),
                        "damage_class": r["damage_class"],
                    }
                    for _, r in top_moves.iterrows()
                ],
            },
        }

        self.summary = {
            "pokemon": int(len(df)),
            "default_pokemon": int(df["is_default"].sum()),
            "alternate_forms": int((~df["is_default"]).sum()),
            "species": int(len(self.species)),
            "types": int(len(self.types)),
            "abilities": int(len(self.abilities)),
            "moves": int(len(self.moves)),
            "move_links": int(len(self.pokemon_moves)),
            "legendary": int(self.species["is_legendary"].astype(str).str.lower().eq("true").sum()),
            "mythical": int(self.species["is_mythical"].astype(str).str.lower().eq("true").sum()),
            "generations": int(self.species["generation"].nunique()),
            "average_total_stats": round(float(df["total_base_stats"].mean()), 1),
        }

        self.superlatives = self._build_superlatives()
        self.filter_options = {
            "types": sorted(self.types["type_name"].tolist()),
            "generations": [
                {"value": g, "label": GENERATION_LABELS.get(g, g)}
                for g in GENERATION_ORDER
                if g in set(df["generation"].dropna())
            ],
            "battle_styles": sorted(df["battle_style"].unique().tolist()),
            "special_statuses": sorted(df["special_status"].unique().tolist()),
            "size_classes": [
                s for s in ["Tiny", "Small", "Medium", "Large", "Huge", "Unknown"]
                if s in set(df["size_class"])
            ],
        }

    def _build_superlatives(self) -> list[dict]:
        # Records are taken across the default Pokemon only. Mega/Gmax forms
        # would otherwise win almost every category and hide the real spread.
        df = self.pokemon[self.pokemon["is_default"]]

        def entry(icon, title, subtitle, row, value, unit=""):
            return {
                "icon": icon,
                "title": title,
                "subtitle": subtitle,
                "pokemon_id": int(row["pokemon_id"]),
                "display_name": row["display_name"],
                "primary_type": row["primary_type"],
                "types": list(row["types"]),
                "value": jsonable(value),
                "unit": unit,
            }

        fastest = df.loc[df["speed"].idxmax()]
        hitter = df.loc[df["offensive_power"].idxmax()]
        tank = df.loc[df["defensive_power"].idxmax()]
        champion = df.loc[df["total_base_stats"].idxmax()]
        specialist = df.loc[df["specialization_score"].idxmax()]
        heaviest = df.loc[df["weight_kg"].idxmax()] if df["weight_kg"].notna().any() else champion

        legendaries = df[df["is_legendary"]]
        legendary_pick = (
            legendaries.loc[legendaries["total_base_stats"].idxmax()]
            if not legendaries.empty else champion
        )

        # Smallest Pokemon (<= 0.5 m) with the strongest total, i.e. tiny but mighty.
        tiny = df[(df["height_m"] <= 0.5) & df["height_m"].notna()]
        tiny_pick = tiny.loc[tiny["total_base_stats"].idxmax()] if not tiny.empty else champion

        return [
            entry("⚡", "Speed demon", "Highest base speed", fastest, int(fastest["speed"])),
            entry("💥", "Heavy hitter", "Highest offensive power", hitter, hitter["offensive_power"]),
            entry("🛡️", "The tank", "Highest defensive power", tank, tank["defensive_power"]),
            entry("🏆", "Stat champion", "Highest total base stats", champion, int(champion["total_base_stats"])),
            entry("🎯", "The specialist", "Largest share in one stat", specialist,
                  specialist["specialization_score"], "%"),
            entry("🌟", "Legendary peak", "Strongest legendary", legendary_pick,
                  int(legendary_pick["total_base_stats"])),
            entry("🌱", "Tiny but mighty", "Best total at 0.5 m or under", tiny_pick,
                  int(tiny_pick["total_base_stats"])),
            entry("🏋️", "Heavyweight", "Heaviest on record", heaviest, heaviest["weight_kg"], " kg"),
        ]

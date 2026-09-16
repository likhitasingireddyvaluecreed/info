"""
Central configuration for the Pokémon ETL pipeline.
"""

from pathlib import Path


# -------------------------------------------------------------------
# API configuration
# -------------------------------------------------------------------

BASE_URL = "https://pokeapi.co/api/v2"

REQUEST_TIMEOUT = 10
MAX_RETRIES = 3

RETRYABLE_STATUS_CODES = {
    429,
    500,
    502,
    503,
    504
}


# -------------------------------------------------------------------
# Project directories
# -------------------------------------------------------------------

DATA_DIR = Path("./data")

RAW_DIR = DATA_DIR / "raw"

PROCESSED_DIR = DATA_DIR / "processed"

LOG_DIR = Path("logs")


# -------------------------------------------------------------------
# Raw data files
# -------------------------------------------------------------------

RAW_POKEMON_FILE = RAW_DIR / "pokemon_raw.json"

RAW_SPECIES_FILE = RAW_DIR / "species_raw.json"

# -------------------------------------------------------------------
# Processed data files
# -------------------------------------------------------------------

TYPES_FILE = PROCESSED_DIR / "types.csv"
ABILITIES_FILE = PROCESSED_DIR / "abilities.csv"
MOVES_FILE = PROCESSED_DIR / "moves.csv"

# -------------------------------------------------------------------
# Processed data files
# -------------------------------------------------------------------

PROCESSED_POKEMON_FILE = PROCESSED_DIR / "pokemon.csv"

PROCESSED_TYPES_FILE = PROCESSED_DIR / "pokemon_types.csv"

PROCESSED_ABILITIES_FILE = PROCESSED_DIR / "pokemon_abilities.csv"

PROCESSED_SPECIES_FILE = PROCESSED_DIR / "pokemon_species.csv"

PROCESSED_VARIETIES_FILE = PROCESSED_DIR / "pokemon_varieties.csv"

PROCESSED_MOVES_FILE = PROCESSED_DIR / "pokemon_moves.csv"
# -------------------------------------------------------------------
# Pipeline behavior
# -------------------------------------------------------------------

INCREMENTAL_MODE = True
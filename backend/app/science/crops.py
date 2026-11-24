"""Crop calendars and dual crop coefficients adapted from PI-Advisor."""

import json
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

CROPS = json.loads(Path(__file__).with_name("crop_data.json").read_text(encoding="utf-8"))
CROP_NAMES = {name.casefold(): name for name in CROPS}
STAGES = ("initial", "development", "mid", "late")
STAGE_LABELS = ("Initial", "Development", "Mid-season", "Late season")


def local_today():
    return datetime.now(ZoneInfo("Asia/Karachi")).date()


def crop_stage(crop: str, planted: date, day: date):
    days = (day - planted).days
    if days < 0:
        return "Pre-planting"
    lengths = CROPS[crop]["lengths"]
    for key, label in zip(STAGES, STAGE_LABELS, strict=True):
        days -= lengths[key]
        if days < 0:
            return label
    return "Beyond modeled season"


def crop_parameters(crop: str, planted: date, day: date):
    """PI-Advisor's four stages, with linear coefficient transitions per FAO-56."""
    config = CROPS[crop]
    initial, growth, mid, late = (config["lengths"][stage] for stage in STAGES)
    days = (day - planted).days
    if not 0 <= days < initial + growth + mid + late:
        return 0.0, 0.0

    boundaries = (initial, initial + growth, initial + growth + mid, initial + growth + mid + late)

    def interpolate(values):
        return float(np.interp(days, boundaries, [
            values["initial"], values["mid"], values["mid"], values["end"],
        ]))

    kcb = interpolate(config["kcb"])
    height = interpolate(config["height"])
    cover = min(0.99, max(0, (max(0, kcb - 0.15) / (max(1.2, kcb + 0.05) - 0.15)) ** (1 + 0.5 * height)))
    return kcb, cover


def estimated_stage(seasons, day=None):
    if not seasons or not seasons[0]["planted"]:
        return "Planting date required"
    season = seasons[0]
    crop = CROP_NAMES.get(season["crop"].casefold())
    if not crop:
        return "Crop calendar unavailable"
    return crop_stage(crop, date.fromisoformat(season["planted"]), day or local_today())

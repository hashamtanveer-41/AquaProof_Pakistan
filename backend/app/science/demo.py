"""Opt-in synthetic registry data for trying the live science screens."""

from datetime import timedelta

from ..database import connect
from ..registry import CropInput, Registration, add_season, register
from .crops import local_today
from .irrigation import IrrigationSettings
from .routes import save_settings

DEMO_FIELDS = (
    ("sindh", "Sindh", "Demo Lower Indus parcel", "Wheat", 68.35, 25.37),
    ("balochistan", "Balochistan", "Demo Plateau parcel", "Maize", 67.05, 30.17),
)


def seed():
    today = local_today()
    for key, region, name, crop, longitude, latitude in DEMO_FIELDS:
        email = f"aquaproof-demo-{key}@example.com"
        with connect() as connection:
            if connection.execute("SELECT 1 FROM farmers WHERE email = %s", (email,)).fetchone():
                print(f"Already present: {name}")
                continue
        first = [longitude, latitude]
        saved = register(Registration.model_validate({
            "farmer": {
                "name": f"Demo farmer ({region})", "email": email, "phone": "00000000000",
                "region": region, "village": "Synthetic demonstration record",
            },
            "field": {
                "name": name, "crop": crop, "soil": "Demo loam", "source": "Canal + Tubewell",
                "boundary": {"type": "Polygon", "coordinates": [[
                    first, [longitude + 0.001, latitude],
                    [longitude + 0.001, latitude + 0.0008], [longitude, latitude + 0.0008], first,
                ]]},
            },
        }))
        field_id = saved["field"]["id"]
        add_season(field_id, CropInput(crop=crop, planted=today - timedelta(days=40)))
        save_settings(field_id, IrrigationSettings.model_validate({
            "taw_mm": 105, "initial_depletion_mm": 45, "allowable_depletion": 0.5,
            "efficiency": 0.75, "surface_taw_mm": 20, "surface_raw_mm": 8,
            "initial_surface_depletion_mm": 12,
            "canal": {"first_date": today + timedelta(days=2), "hours": 4, "flow_m3_hour": 65},
            "tubewell": {"flow_m3_hour": 38, "hours_per_day": 6, "pkr_hour": 1400},
        }))
        print(f"Created: {name} ({field_id})")


if __name__ == "__main__":
    seed()

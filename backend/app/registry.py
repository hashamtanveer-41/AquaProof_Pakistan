from datetime import date
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from psycopg.errors import CheckViolation, UniqueViolation
from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, model_validator

from .database import connect
from .assistant_access import queue_field_recheck
from .maps import require_tracing_authorization
from .science.crops import estimated_stage, local_today

router = APIRouter(prefix="/api", tags=["registry"])
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FarmerInput(Input):
    name: Label
    email: EmailStr
    phone: Label
    region: Label
    village: Label


class Boundary(Input):
    type: Literal["Polygon"]
    coordinates: list[list[tuple[Longitude, Latitude]]]

    @model_validator(mode="after")
    def check_ring(self):
        if len(self.coordinates) != 1:
            raise ValueError("Provide one outer boundary ring")
        ring = self.coordinates[0]
        if not 4 <= len(ring) <= 5001 or ring[0] != ring[-1] or len(set(ring[:-1])) < 3:
            raise ValueError("Provide a closed ring with at least three distinct vertices")
        return self


class CropInput(Input):
    crop: Label
    variety: Label | None = None
    planted: date


class FieldInput(Input):
    name: Label
    soil: Label
    source: Label
    crop: Label
    boundary: Boundary


class Registration(Input):
    farmer_id: str | None = None
    farmer: FarmerInput | None = None
    field: FieldInput | None = None

    @model_validator(mode="after")
    def check_owner(self):
        if (self.farmer is None) == (self.farmer_id is None):
            raise ValueError("Provide either an existing farmer ID or a new farmer")
        if self.farmer_id is not None and self.field is None:
            raise ValueError("Provide a field for the existing farmer")
        return self


FIELD_QUERY = """
    SELECT f.id, f.farmer_id AS "farmerId", f.name, p.region, p.village,
           f.soil, f.source, ST_AsGeoJSON(f.boundary, 15)::json AS boundary,
           ST_X(f.representative_point) AS longitude, ST_Y(f.representative_point) AS latitude,
           ST_Area(f.boundary::geography) / 4046.8564224 AS acres,
           i.settings AS irrigation_settings,
           COALESCE(c.seasons, '[]'::json) AS seasons,
           COALESCE(m.events, '[]'::json) AS history
    FROM fields f JOIN farmers p ON p.id = f.farmer_id
    LEFT JOIN irrigation_settings i ON i.field_id = f.id
    LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('id', id, 'crop', crop, 'variety', variety,
                    'planted', planted) ORDER BY planted DESC NULLS LAST, id DESC) AS seasons
        FROM crop_seasons WHERE field_id = f.id
    ) c ON true
    LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
            'date', m.parsed->>'irrigation_date', 'label', 'Irrigation reported by email',
            'detail', concat(m.parsed->>'source', ' · ', m.parsed->>'duration_minutes', ' minutes')
        ) ORDER BY m.parsed->>'irrigation_date', m.id) AS events
        FROM farmer_messages m JOIN advisories a ON a.id = m.advisory_id
        WHERE a.field_id = f.id AND m.approved_at IS NOT NULL
    ) m ON true
    WHERE f.archived_at IS NULL
"""


def require(row, entity):
    if row is None:
        raise HTTPException(404, f"{entity} could not be found")
    return row


def farmer_by_id(connection, farmer_id):
    return require(
        connection.execute("SELECT * FROM farmers WHERE id = %s", (farmer_id,)).fetchone(),
        "Farmer",
    )


def field_by_id(connection, field_id):
    return with_stage(require(
        connection.execute(FIELD_QUERY + " AND f.id = %s", (field_id,)).fetchone(),
        "Field",
    ))


def with_stage(field):
    settings = field.pop("irrigation_settings")
    today = local_today()
    return {
        **field, "stage": estimated_stage(field["seasons"], today),
        "irrigation_status": irrigation_status(field["source"], settings, today),
    }


def irrigation_status(source, settings, today):
    sources = source.casefold()
    settings = settings or {}
    canal = settings.get("canal")
    pump = settings.get("tubewell")
    if canal:
        days = (today - date.fromisoformat(canal["first_date"])).days
        if days >= 0 and days % canal["cycle_days"] == 0:
            return "canal_today"
    if ("canal" in sources and not canal) or ("tubewell" in sources and not pump):
        return "setup_required"
    if canal or pump:
        return "configured"
    return "rain_fed" if "rain-fed" in sources else "setup_required"


def create_farmer(connection, farmer):
    return connection.execute(
        """INSERT INTO farmers (id, name, email, phone, region, village)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
        (f"FMR-{uuid4().hex}", farmer.name, farmer.email, farmer.phone, farmer.region, farmer.village),
    ).fetchone()


@router.get("/registry")
def get_registry():
    with connect() as connection:
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        return {
            "farmers": connection.execute("SELECT * FROM farmers ORDER BY name, id").fetchall(),
            "fields": [with_stage(row) for row in connection.execute(FIELD_QUERY + " ORDER BY f.name, f.id")],
        }


@router.get("/farmers")
def list_farmers():
    with connect() as connection:
        return connection.execute("SELECT * FROM farmers ORDER BY name, id").fetchall()


@router.post("/farmers", status_code=201)
def add_farmer(farmer: FarmerInput):
    with connect() as connection:
        return create_farmer(connection, farmer)


@router.get("/farmers/{farmer_id}")
def get_farmer(farmer_id: str):
    with connect() as connection:
        return farmer_by_id(connection, farmer_id)


@router.post("/registrations", status_code=201)
def register(registration: Registration):
    if registration.field is not None:
        require_tracing_authorization()
    try:
        with connect() as connection:
            farmer = (
                create_farmer(connection, registration.farmer)
                if registration.farmer
                else farmer_by_id(connection, registration.farmer_id)
            )
            field = registration.field
            if field is None:
                return {"farmer": farmer, "field": None}
            field_id = f"AP-{uuid4().hex}"
            connection.execute(
                """INSERT INTO fields (id, farmer_id, name, soil, source, boundary)
                   VALUES (%s, %s, %s, %s, %s, ST_GeomFromGeoJSON(%s))""",
                (field_id, farmer["id"], field.name, field.soil, field.source, field.boundary.model_dump_json()),
            )
            connection.execute(
                "INSERT INTO crop_seasons (field_id, crop) VALUES (%s, %s)", (field_id, field.crop)
            )
            return {"farmer": farmer, "field": field_by_id(connection, field_id)}
    except CheckViolation as error:
        raise HTTPException(422, "Draw a valid boundary without crossing edges") from error


@router.post("/fields", status_code=201)
def add_field(farmer_id: str, field: FieldInput):
    return register(Registration(farmer_id=farmer_id, field=field))["field"]


@router.get("/fields/{field_id}")
def get_field(field_id: str):
    with connect() as connection:
        return field_by_id(connection, field_id)


@router.patch("/fields/{field_id}")
def update_boundary(field_id: str, boundary: Boundary):
    require_tracing_authorization()
    try:
        with connect() as connection:
            require(connection.execute(
                """UPDATE fields SET boundary = ST_GeomFromGeoJSON(%s)
                   WHERE id = %s AND archived_at IS NULL RETURNING id""",
                (boundary.model_dump_json(), field_id),
            ).fetchone(), "Field")
            return field_by_id(connection, field_id)
    except CheckViolation as error:
        raise HTTPException(422, "Draw a valid boundary without crossing edges") from error


@router.delete("/fields/{field_id}")
def archive_field(field_id: str):
    with connect() as connection:
        return require(connection.execute(
            """UPDATE fields SET archived_at = COALESCE(archived_at, now())
               WHERE id = %s RETURNING id""", (field_id,),
        ).fetchone(), "Field")


@router.post("/crop-seasons", status_code=201)
def add_season(field_id: str, season: CropInput):
    try:
        with connect() as connection:
            field_by_id(connection, field_id)
            connection.execute(
                "INSERT INTO crop_seasons (field_id, crop, variety, planted) VALUES (%s, %s, %s, %s)",
                (field_id, season.crop, season.variety, season.planted),
            )
            queue_field_recheck(connection, field_id)
            return field_by_id(connection, field_id)
    except UniqueViolation as error:
        raise HTTPException(409, "A season already starts on this date for the field") from error

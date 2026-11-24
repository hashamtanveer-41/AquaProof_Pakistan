CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE farmers (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    region text NOT NULL CHECK (region IN ('Punjab', 'Khyber Pakhtunkhwa')),
    village text NOT NULL
);

CREATE TABLE fields (
    id text PRIMARY KEY,
    farmer_id text NOT NULL REFERENCES farmers(id),
    name text NOT NULL,
    soil text NOT NULL,
    source text NOT NULL,
    boundary geometry(Polygon, 4326) NOT NULL,
    CHECK (ST_IsValid(boundary) AND NOT ST_IsEmpty(boundary) AND ST_Area(boundary::geography) > 0)
);
CREATE INDEX fields_boundary_idx ON fields USING gist (boundary);
CREATE INDEX fields_farmer_idx ON fields (farmer_id);

CREATE TABLE crop_seasons (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    field_id text NOT NULL REFERENCES fields(id),
    crop text NOT NULL,
    variety text,
    planted date,
    UNIQUE (field_id, planted)
);
CREATE INDEX crop_seasons_field_idx ON crop_seasons (field_id, planted DESC, id DESC);

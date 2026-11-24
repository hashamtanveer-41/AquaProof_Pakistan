ALTER TABLE fields
    ADD COLUMN representative_point geometry(Point, 4326)
        GENERATED ALWAYS AS (ST_PointOnSurface(boundary)) STORED,
    ADD COLUMN archived_at timestamptz;

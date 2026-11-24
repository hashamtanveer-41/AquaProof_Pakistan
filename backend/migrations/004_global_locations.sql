ALTER TABLE farmers DROP CONSTRAINT farmers_region_check;
ALTER TABLE farmers ADD CONSTRAINT farmers_region_label
    CHECK (char_length(trim(region)) BETWEEN 1 AND 160);

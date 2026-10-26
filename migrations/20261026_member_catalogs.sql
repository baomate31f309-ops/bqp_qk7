ALTER TABLE users ADD COLUMN IF NOT EXISTS position_title TEXT NOT NULL DEFAULT '';

INSERT INTO positions (name, level) VALUES
    ('Đại đội trưởng', 1),
    ('Tiểu đoàn trưởng', 2),
    ('Trung đoàn trưởng', 3),
    ('Sư đoàn trưởng', 4),
    ('Tư lệnh', 5)
ON CONFLICT (name) DO NOTHING;

UPDATE users
SET position_title = CASE level
    WHEN 1 THEN 'Đại đội trưởng'
    WHEN 2 THEN 'Tiểu đoàn trưởng'
    WHEN 3 THEN 'Trung đoàn trưởng'
    WHEN 4 THEN 'Sư đoàn trưởng'
    WHEN 5 THEN 'Tư lệnh'
    ELSE ''
END
WHERE position_title = '';

INSERT INTO military_ranks (name) VALUES
    ('Đại tướng'), ('Thượng tướng'), ('Trung tướng'), ('Thiếu tướng'),
    ('Đại tá'), ('Thượng tá'), ('Trung tá'), ('Thiếu tá'),
    ('Đại úy'), ('Thượng úy'), ('Trung úy'), ('Thiếu úy'),
    ('Thượng sĩ'), ('Trung sĩ'), ('Hạ sĩ'), ('Binh nhất'), ('Binh nhì')
ON CONFLICT (name) DO NOTHING;

INSERT INTO military_ranks (name)
SELECT candidate.name
FROM (
    SELECT DISTINCT ON (LOWER(BTRIM(military_rank))) BTRIM(military_rank) AS name
    FROM users
    WHERE BTRIM(military_rank) <> ''
    ORDER BY LOWER(BTRIM(military_rank)), BTRIM(military_rank)
) candidate
WHERE NOT EXISTS (
    SELECT 1 FROM military_ranks WHERE LOWER(military_ranks.name) = LOWER(candidate.name)
)
ON CONFLICT (name) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS positions_name_lower_unique_idx ON positions (LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS military_ranks_name_lower_unique_idx ON military_ranks (LOWER(name));

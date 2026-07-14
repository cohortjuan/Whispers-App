-- optional sample data so the app isn't empty the first time you open it
-- loaded automatically by docker-compose, or run manually:
-- psql "$DATABASE_URL" -f database/seed.sql

BEGIN;

INSERT INTO people (first_name, last_name, nickname, birth_date, death_date, bio)
VALUES
  ('Eleanor', 'Reyes', 'Nana', '1938-04-12', '2021-11-02', 'grew up on a farm in west texas, raised five kids, famous for her tamales'),
  ('Harold', 'Reyes', 'Pop', '1935-01-30', '2018-06-15', 'korean war veteran, worked as a machinist for 40 years'),
  ('Diane', 'Reyes', NULL, '1962-09-05', NULL, 'eleanor and harold''s oldest daughter'),
  ('Marcus', 'Reyes', NULL, '1988-03-21', NULL, 'diane''s son, started this project to keep the family stories around')
ON CONFLICT DO NOTHING;

-- wire up the relationships using the ids we just inserted
INSERT INTO relationships (person_id, related_person_id, relationship_type)
SELECT h.id, e.id, 'spouse'
FROM people h, people e
WHERE h.first_name = 'Harold' AND e.first_name = 'Eleanor'
ON CONFLICT DO NOTHING;

INSERT INTO relationships (person_id, related_person_id, relationship_type)
SELECT e.id, d.id, 'parent'
FROM people e, people d
WHERE e.first_name = 'Eleanor' AND d.first_name = 'Diane'
ON CONFLICT DO NOTHING;

INSERT INTO relationships (person_id, related_person_id, relationship_type)
SELECT h.id, d.id, 'parent'
FROM people h, people d
WHERE h.first_name = 'Harold' AND d.first_name = 'Diane'
ON CONFLICT DO NOTHING;

INSERT INTO relationships (person_id, related_person_id, relationship_type)
SELECT d.id, m.id, 'parent'
FROM people d, people m
WHERE d.first_name = 'Diane' AND m.first_name = 'Marcus'
ON CONFLICT DO NOTHING;

COMMIT;

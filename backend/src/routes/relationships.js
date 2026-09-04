import { Router } from 'express';
import { pool, queryOrNotFound } from '../db/pool.js';

export const relationshipsRouter = Router();

const VALID_TYPES = new Set(['parent', 'spouse']);

// GET /api/relationships - only relationships between people in the caller's own family
// GET /api/relationships?person_id=5 - anything touching person 5, either side of the link
relationshipsRouter.get('/', async (req, res, next) => {
  try {
    const { person_id } = req.query;

    // both sides are filtered on family_id, not just one -- relationships
    // only ever exist between two people already confirmed to share a
    // family (see the POST handler below), so this is belt-and-suspenders,
    // but it's what actually keeps a cross-family row from ever surfacing
    // if that invariant were ever violated
    const baseQuery = `
      SELECT r.*,
             p1.first_name AS person_first_name, p1.last_name AS person_last_name,
             p2.first_name AS related_first_name, p2.last_name AS related_last_name
      FROM relationships r
      JOIN people p1 ON p1.id = r.person_id
      JOIN people p2 ON p2.id = r.related_person_id
      WHERE p1.family_id = $1 AND p2.family_id = $1 AND p1.deleted_at IS NULL AND p2.deleted_at IS NULL
    `;

    if (person_id) {
      const result = await pool.query(
        `${baseQuery} AND (r.person_id = $2 OR r.related_person_id = $2) ORDER BY r.id`,
        [req.user.family.id, person_id]
      );
      return res.json(result.rows);
    }

    const result = await pool.query(`${baseQuery} ORDER BY r.id`, [req.user.family.id]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/relationships  { person_id, related_person_id, relationship_type }
// parent -> person_id is the parent of related_person_id
// spouse -> symmetric, only stored once
relationshipsRouter.post('/', async (req, res, next) => {
  try {
    const { person_id, related_person_id, relationship_type } = req.body;

    if (!person_id || !related_person_id || !relationship_type) {
      return res.status(400).json({ error: 'person_id, related_person_id, and relationship_type are required' });
    }
    if (!VALID_TYPES.has(relationship_type)) {
      return res.status(400).json({ error: `relationship_type must be one of: ${[...VALID_TYPES].join(', ')}` });
    }
    if (Number(person_id) === Number(related_person_id)) {
      return res.status(400).json({ error: 'a person cannot have a relationship with themselves' });
    }

    // neither check depends on the other's result, so run them together
    // instead of waiting on one full round trip before starting the next
    const [peopleCheck, reverseCheck] = await Promise.all([
      // family_id filter here is what stops someone from linking a person in
      // their own family to a person_id belonging to a different family --
      // requiring both ids to come back scoped to family_id is what makes
      // the "2 rows" check below actually mean "2 rows, both mine"
      pool.query('SELECT id FROM people WHERE id IN ($1, $2) AND family_id = $3 AND deleted_at IS NULL', [
        person_id,
        related_person_id,
        req.user.family.id,
      ]),
      // the unique constraint only catches an exact-order duplicate -- also check
      // the reverse tuple, since "A married to B" and "B married to A" (or "A
      // parent of B" + "B parent of A") are the same/contradictory relationship
      // even though they're different rows
      pool.query(
        'SELECT id FROM relationships WHERE person_id = $1 AND related_person_id = $2 AND relationship_type = $3',
        [related_person_id, person_id, relationship_type]
      ),
    ]);
    if (peopleCheck.rows.length !== 2) {
      return res.status(404).json({ error: 'both person_id and related_person_id must reference real people' });
    }
    if (reverseCheck.rows.length > 0) {
      const message = relationship_type === 'spouse'
        ? 'that relationship already exists'
        : 'that would contradict an existing parent relationship between these two people';
      return res.status(409).json({ error: message });
    }

    const result = await pool.query(
      `INSERT INTO relationships (person_id, related_person_id, relationship_type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [person_id, related_person_id, relationship_type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // 23505 = postgres unique violation, means this exact relationship already exists
    if (err.code === '23505') {
      return res.status(409).json({ error: 'that relationship already exists' });
    }
    next(err);
  }
});

// DELETE /api/relationships/:id
relationshipsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await queryOrNotFound(
      res,
      `DELETE FROM relationships
       WHERE id = $1
         AND person_id IN (SELECT id FROM people WHERE family_id = $2)
       RETURNING id`,
      [id, req.user.family.id],
      `relationship ${id} not found`
    );
    if (!deleted) return;
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

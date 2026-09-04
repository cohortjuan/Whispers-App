// small shared helpers, mostly just date formatting so it's not copy pasted everywhere

export function formatYear(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).getFullYear();
}

export function lifespan(person) {
  const born = formatYear(person.birth_date);
  const died = formatYear(person.death_date);
  if (!born && !died) return 'dates unknown';
  if (born && died) return `${born} - ${died}`;
  if (born) return `b. ${born}`;
  return `d. ${died}`;
}

export function initials(person) {
  const a = person.first_name?.[0] || '';
  const b = person.last_name?.[0] || '';
  return (a + b).toUpperCase();
}

// name + suffix, no nickname -- the shared base both fullName and
// disambiguatedName build on, so the suffix rule only lives in one place
function nameWithSuffix(person) {
  return person.suffix
    ? `${person.first_name} ${person.last_name} ${person.suffix}`
    : `${person.first_name} ${person.last_name}`;
}

export function fullName(person) {
  if (!person) return '';
  const name = nameWithSuffix(person);
  return person.nickname ? `${name} "${person.nickname}"` : name;
}

// a short, unambiguous label for picking ONE person out of a list where two
// people can share a full name (Jr./Sr./III, or just a repeated family
// name across generations) -- birth year is the cheapest real disambiguator
// available (suffix already helps, but not everyone has one filled in)
export function disambiguatedName(person) {
  const year = formatYear(person.birth_date);
  const base = nameWithSuffix(person);
  return year ? `${base} (b. ${year})` : base;
}

// display-copy only -- the backend owns the real value (see
// backend/src/lib/retention.js) and returns exact purge_at timestamps for
// anything that has to be precise. Keep the two in step if you change it.
export const TRASH_RETENTION_DAYS = 30;

// classifies a raw relationship row from ONE person's point of view -- both
// the Family Tree page (building maps for everyone) and a person's own
// profile page (grouping just their own links) need this same "parent type:
// person_id is the parent of related_person_id, spouse: symmetric" logic,
// so it lives here once instead of being re-derived in both places
export function classifyRelationship(rel, personId) {
  const isSelf = Number(rel.person_id) === Number(personId);
  if (rel.relationship_type === 'spouse') {
    return { role: 'spouse', otherId: isSelf ? rel.related_person_id : rel.person_id };
  }
  // parent type: person_id is the parent of related_person_id
  return isSelf
    ? { role: 'child', otherId: rel.related_person_id }
    : { role: 'parent', otherId: rel.person_id };
}

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

export function fullName(person) {
  if (!person) return '';
  return person.nickname ? `${person.first_name} ${person.last_name} "${person.nickname}"` : `${person.first_name} ${person.last_name}`;
}

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

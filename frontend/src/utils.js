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
  return person.nickname ? `${person.first_name} "${person.nickname}" ${person.last_name}` : `${person.first_name} ${person.last_name}`;
}

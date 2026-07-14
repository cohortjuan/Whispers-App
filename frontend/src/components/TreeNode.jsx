import { Link } from 'react-router-dom';
import { lifespan } from '../utils.js';

// recursive node: renders a person (+ their spouse if they have one) as a
// little "couple" box, then their kids underneath, who each do the same thing.
// `node` is pre-built plain data ({ person, spouses, children }) computed once
// in FamilyTree's useMemo -- this component just renders it, no dedup logic here
export default function TreeNode({ node }) {
  const { person, spouses, children } = node;

  return (
    <div className="tree-node">
      <div className="tree-couple">
        <PersonBadge person={person} />
        {spouses.map((spouse) => (
          <span key={spouse.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--color-text-muted)' }}>&amp;</span>
            <PersonBadge person={spouse} />
          </span>
        ))}
      </div>

      {children.length > 0 && (
        <div className="tree-children">
          {children.map((child) => (
            <TreeNode key={child.person.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

function PersonBadge({ person }) {
  return (
    <Link to={`/people/${person.id}`} className="tree-person">
      <div className="tree-person-name">
        {person.first_name} {person.last_name}
        {person.nickname ? ` "${person.nickname}"` : ''}
      </div>
      <div className="tree-person-dates">{lifespan(person)}</div>
    </Link>
  );
}

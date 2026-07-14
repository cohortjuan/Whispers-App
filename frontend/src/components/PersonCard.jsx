import { Link } from 'react-router-dom';
import { lifespan, initials } from '../utils.js';

// one tile on the dashboard grid, click through to their full page.
// the delete button is a sibling of the Link (not nested inside it) since a
// button inside an anchor is invalid html and double-fires clicks
export default function PersonCard({ person, onDelete }) {
  return (
    <div className="person-card">
      <button
        type="button"
        className="person-card-remove"
        onClick={() => onDelete(person)}
        title={`delete ${person.first_name}`}
      >
        &times;
      </button>
      <Link to={`/people/${person.id}`} className="person-card-link card">
        {person.photo_url ? (
          <img className="person-card-photo" src={person.photo_url} alt={person.first_name} />
        ) : (
          <div className="person-card-photo-placeholder">{initials(person)}</div>
        )}
        <div className="person-card-name">
          {person.first_name} {person.last_name}
          {person.nickname ? ` "${person.nickname}"` : ''}
        </div>
        <div className="person-card-dates">{lifespan(person)}</div>
        <div className="person-card-clips">
          {Number(person.clip_count) === 0
            ? '🎙️ record their first memory'
            : `🎙️ ${person.clip_count} ${Number(person.clip_count) === 1 ? 'clip' : 'clips'}`}
        </div>
      </Link>
    </div>
  );
}

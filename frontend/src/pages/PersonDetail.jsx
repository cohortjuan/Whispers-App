import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { lifespan } from '../utils.js';
import ClipPlayer from '../components/ClipPlayer.jsx';
import ClipUploadForm from '../components/ClipUploadForm.jsx';
import RelationshipForm from '../components/RelationshipForm.jsx';

// a linked person's little card in the family links tree -- same visual
// language as the Family Tree page's boxes, plus a remove button since this
// is also where relationships get unlinked
function FamilyLinkBadge({ person, onRemove }) {
  if (!person) return null;
  return (
    <div className="family-link-badge">
      <button className="family-link-remove" onClick={onRemove} title={`remove link to ${person.first_name}`}>
        &times;
      </button>
      <Link to={`/people/${person.id}`} className="family-link-name-wrap">
        <div className="tree-person-name">
          {person.first_name} {person.last_name}{person.nickname ? ` "${person.nickname}"` : ''}
        </div>
        <div className="tree-person-dates">{lifespan(person)}</div>
      </Link>
    </div>
  );
}

export default function PersonDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [person, setPerson] = useState(null);
  const [clips, setClips] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [allPeople, setAllPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, c, r, all] = await Promise.all([
        api.people.get(id),
        api.clips.list(id),
        api.relationships.list(id),
        api.people.list(),
      ]);
      setPerson(p);
      setClips(c);
      setRelationships(r);
      setAllPeople(all);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleDeletePerson() {
    if (!confirm(`delete ${person.first_name} ${person.last_name}? this removes their clips and relationships too, can't be undone.`)) return;
    await api.people.remove(id);
    navigate('/');
  }

  async function handleDeleteClip(clipId) {
    if (!confirm('delete this clip? the file is gone for good.')) return;
    await api.clips.remove(clipId);
    setClips((cs) => cs.filter((c) => c.id !== clipId));
  }

  async function handleUpdateClip(clipId, body) {
    const updated = await api.clips.update(clipId, body);
    setClips((cs) => cs.map((c) => (c.id === clipId ? updated : c)));
  }

  async function handleDeleteRelationship(relId) {
    await api.relationships.remove(relId);
    setRelationships((rs) => rs.filter((r) => r.id !== relId));
  }

  const personById = useMemo(() => Object.fromEntries(allPeople.map((p) => [p.id, p])), [allPeople]);

  // sorts the raw directional relationship rows into parents/spouses/children
  // from THIS person's point of view, so they can be drawn as a little tree
  // instead of a flat list -- same idea as the Family Tree page's parentsMap
  const familyLinks = useMemo(() => {
    const parents = [];
    const spouses = [];
    const children = [];

    for (const rel of relationships) {
      const isSelfPerson = Number(rel.person_id) === Number(id);
      if (rel.relationship_type === 'spouse') {
        spouses.push({ relId: rel.id, otherId: isSelfPerson ? rel.related_person_id : rel.person_id });
      } else if (isSelfPerson) {
        children.push({ relId: rel.id, otherId: rel.related_person_id });
      } else {
        parents.push({ relId: rel.id, otherId: rel.person_id });
      }
    }

    return { parents, spouses, children };
  }, [relationships, id]);

  if (loading) return <div className="loading">loading...</div>;
  if (error) return <div className="form-error">{error}</div>;
  if (!person) return null;

  const otherPeople = allPeople.filter((p) => p.id !== person.id);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{person.first_name} {person.last_name}{person.nickname ? ` "${person.nickname}"` : ''}</h1>
          <p className="page-subtitle">{lifespan(person)}</p>
        </div>
        <div className="page-header-actions">
          <Link className="btn btn-secondary" to={`/people/${id}/edit`}>edit</Link>
          <button className="btn btn-danger" onClick={handleDeletePerson}>delete</button>
        </div>
      </div>

      {person.photo_url && (
        <img
          src={person.photo_url}
          alt={person.first_name}
          style={{
            width: 160, height: 160, objectFit: 'cover', borderRadius: '50%', marginBottom: 16,
            border: '3px solid var(--color-surface)', boxShadow: '0 0 0 2px var(--color-border), var(--shadow)',
          }}
        />
      )}
      {person.bio && <p className="bio-text">{person.bio}</p>}

      <div className="record-hero">
        <h2>🎙️ Capture {person.first_name}'s Voice</h2>
        <p className="record-hero-subtitle">
          this is what Whispers is for -- hit record and keep it, before it's just a memory of a memory.
        </p>
        <ClipUploadForm personId={id} onUploaded={load} />
      </div>

      <div className="section">
        <h2>Family Links</h2>
        {relationships.length === 0 && <p className="page-subtitle">no relationships linked yet.</p>}
        {relationships.length > 0 && (
          <div className="family-links">
            {familyLinks.parents.length > 0 && (
              <>
                <div className="family-links-row">
                  {familyLinks.parents.map(({ relId, otherId }) => (
                    <FamilyLinkBadge key={relId} person={personById[otherId]} onRemove={() => handleDeleteRelationship(relId)} />
                  ))}
                </div>
                <div className="family-links-connector" />
              </>
            )}

            <div className="family-links-row family-links-self-row">
              <div className="family-links-self">
                <div className="tree-person-name">
                  {person.first_name} {person.last_name}{person.nickname ? ` "${person.nickname}"` : ''}
                </div>
                <div className="tree-person-dates">{lifespan(person)}</div>
              </div>
              {familyLinks.spouses.map(({ relId, otherId }) => (
                <span key={relId} className="family-links-spouse">
                  <span className="family-links-amp">&amp;</span>
                  <FamilyLinkBadge person={personById[otherId]} onRemove={() => handleDeleteRelationship(relId)} />
                </span>
              ))}
            </div>

            {familyLinks.children.length > 0 && (
              <>
                <div className="family-links-connector" />
                <div className="family-links-row">
                  {familyLinks.children.map(({ relId, otherId }) => (
                    <FamilyLinkBadge key={relId} person={personById[otherId]} onRemove={() => handleDeleteRelationship(relId)} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <RelationshipForm personId={id} otherPeople={otherPeople} onCreated={load} />
      </div>

      <div className="section">
        <h2>Clips ({clips.length})</h2>
        {clips.length === 0 && <p className="page-subtitle">no clips yet -- record one above to get started.</p>}
        <div className="clip-list">
          {clips.map((clip) => (
            <ClipPlayer key={clip.id} clip={clip} onUpdate={handleUpdateClip} onDelete={handleDeleteClip} />
          ))}
        </div>
      </div>
    </div>
  );
}

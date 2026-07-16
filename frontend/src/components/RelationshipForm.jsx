import { useState } from 'react';
import { api } from '../api/client.js';

// lets you link this person to someone else in the tree.
// the three options map onto the two db relationship types + a direction
const RELATION_OPTIONS = [
  { value: 'is_parent_of', label: 'is the parent of' },
  { value: 'is_child_of', label: 'is the child of' },
  { value: 'is_spouse_of', label: 'is married to' },
];

export default function RelationshipForm({ personId, otherPeople, onCreated }) {
  const [relatedId, setRelatedId] = useState('');
  const [relation, setRelation] = useState('is_parent_of');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!relatedId) {
      setError('pick a person to link');
      return;
    }

    // translate the friendly direction back into { person_id, related_person_id, relationship_type }
    let body;
    if (relation === 'is_parent_of') {
      body = { person_id: personId, related_person_id: relatedId, relationship_type: 'parent' };
    } else if (relation === 'is_child_of') {
      body = { person_id: relatedId, related_person_id: personId, relationship_type: 'parent' };
    } else {
      body = { person_id: personId, related_person_id: relatedId, relationship_type: 'spouse' };
    }

    setSaving(true);
    try {
      const relationship = await api.relationships.create(body);
      setRelatedId('');
      onCreated(relationship);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} style={{ maxWidth: 460 }}>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">this person...</label>
          <select className="form-input" value={relation} onChange={(e) => setRelation(e.target.value)}>
            {RELATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">who</label>
          <select className="form-input" value={relatedId} onChange={(e) => setRelatedId(e.target.value)}>
            <option value="">select someone...</option>
            {otherPeople.map((p) => (
              <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <button className="btn btn-small" type="submit" disabled={saving}>
          {saving ? 'linking...' : 'add relationship'}
        </button>
      </div>
    </form>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';

const BLANK = {
  first_name: '', last_name: '', nickname: '',
  birth_date: '', death_date: '', bio: '', photo_url: '',
};

// same form handles both "add person" and "edit person", just swaps
// what happens on submit and whether it preloads existing data
export default function PersonForm({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(BLANK);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'edit') return;
    api.people.get(id)
      .then((p) => setForm({
        first_name: p.first_name || '',
        last_name: p.last_name || '',
        nickname: p.nickname || '',
        birth_date: p.birth_date ? p.birth_date.slice(0, 10) : '',
        death_date: p.death_date ? p.death_date.slice(0, 10) : '',
        bio: p.bio || '',
        photo_url: p.photo_url || '',
      }))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [mode, id]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (mode === 'edit') {
        await api.people.update(id, form);
        navigate(`/people/${id}`);
      } else {
        const created = await api.people.create(form);
        navigate(`/people/${created.id}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading">loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{mode === 'edit' ? 'Edit Person' : 'Add a Family Member'}</h1>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">first name</label>
            <input className="form-input" value={form.first_name} onChange={(e) => update('first_name', e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">last name</label>
            <input className="form-input" value={form.last_name} onChange={(e) => update('last_name', e.target.value)} required />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">nickname (optional)</label>
          <input className="form-input" value={form.nickname} onChange={(e) => update('nickname', e.target.value)} placeholder='e.g. "Nana"' />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">birth date</label>
            <input className="form-input" type="date" value={form.birth_date} onChange={(e) => update('birth_date', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">death date (leave blank if living)</label>
            <input className="form-input" type="date" value={form.death_date} onChange={(e) => update('death_date', e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">photo url (optional)</label>
          <input className="form-input" value={form.photo_url} onChange={(e) => update('photo_url', e.target.value)} placeholder="https://..." />
        </div>

        <div className="form-group">
          <label className="form-label">bio / notes</label>
          <textarea className="form-textarea" value={form.bio} onChange={(e) => update('bio', e.target.value)} placeholder="what should people know about them?" />
        </div>

        <div className="form-actions">
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'saving...' : mode === 'edit' ? 'save changes' : 'add person'}
          </button>
        </div>
      </form>
    </div>
  );
}

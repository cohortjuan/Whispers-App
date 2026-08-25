import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, getFileUrl } from '../api/client.js';

const BLANK = {
  first_name: '', last_name: '', nickname: '',
  birth_date: '', death_date: '', bio: '',
};

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function validatePhotoFile(file) {
  if (!PHOTO_MIME_TYPES.includes(file.type)) {
    return 'photo must be a JPEG, PNG, or WebP image';
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return 'photo must be under 5MB';
  }
  return null;
}

// same form handles both "add person" and "edit person", just swaps
// what happens on submit and whether it preloads existing data
export default function PersonForm({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(BLANK);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'edit') return;
    api.people.get(id)
      .then((p) => {
        setForm({
          first_name: p.first_name || '',
          last_name: p.last_name || '',
          nickname: p.nickname || '',
          birth_date: p.birth_date ? p.birth_date.slice(0, 10) : '',
          death_date: p.death_date ? p.death_date.slice(0, 10) : '',
          bio: p.bio || '',
        });
        setExistingPhotoUrl(p.photo_url || '');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [mode, id]);

  // The preview is a blob: URL created below -- not garbage-collected on
  // its own, has to be released explicitly.
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validationError = validatePhotoFile(file);
    if (validationError) {
      setPhotoError(validationError);
      return;
    }

    setPhotoError('');
    setPhotoFile(file);
    setPhotoPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
  }

  function clearPhotoSelection() {
    setPhotoFile(null);
    setPhotoPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setPhotoError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      // Only bother with multipart/FormData when there's actually a file to
      // send -- plain JSON is simpler and keeps working exactly as before
      // for a save with no photo change.
      let payload = form;
      if (photoFile) {
        payload = new FormData();
        for (const [key, value] of Object.entries(form)) {
          payload.append(key, value);
        }
        payload.append('photo', photoFile);
      }

      if (mode === 'edit') {
        await api.people.update(id, payload);
        navigate(`/people/${id}`);
      } else {
        const created = await api.people.create(payload);
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
          <label className="form-label">photo (optional)</label>
          <div className="photo-upload">
            {photoPreviewUrl || existingPhotoUrl ? (
              <img
                className="photo-upload-preview"
                src={photoPreviewUrl || getFileUrl(existingPhotoUrl)}
                alt=""
              />
            ) : (
              <div className="photo-upload-placeholder">no photo yet</div>
            )}

            <div className="photo-upload-controls">
              <label className="btn btn-secondary btn-small photo-upload-button">
                {existingPhotoUrl || photoPreviewUrl ? 'replace photo' : 'choose photo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoChange}
                  className="photo-upload-input"
                />
              </label>
              {photoPreviewUrl ? (
                <button type="button" className="photo-upload-undo" onClick={clearPhotoSelection}>
                  undo selection
                </button>
              ) : null}
              <small>JPEG, PNG, or WebP, up to 5MB.</small>
              {photoError && <div className="form-error">{photoError}</div>}
            </div>
          </div>
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

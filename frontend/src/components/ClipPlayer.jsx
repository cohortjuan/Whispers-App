import { useState } from 'react';
import { getFileUrl } from '../api/client.js';

// shows one clip: player, title/description, and edit/delete controls.
// editing just toggles a small inline form, nothing fancy
export default function ClipPlayer({ clip, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(clip.title);
  const [description, setDescription] = useState(clip.description || '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onUpdate(clip.id, { title, description });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="clip-item">
      <div className="clip-item-top">
        <div>
          {editing ? (
            <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          ) : (
            <p className="clip-item-title">{clip.title}</p>
          )}
          <p className="clip-item-meta">
            {clip.recorded_date ? `recorded ${clip.recorded_date}` : `added ${new Date(clip.created_at).toLocaleDateString()}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {editing ? (
            <>
              <button className="btn btn-small" onClick={handleSave} disabled={saving}>
                {saving ? 'saving...' : 'save'}
              </button>
              <button className="btn btn-secondary btn-small" onClick={() => setEditing(false)}>cancel</button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary btn-small" onClick={() => setEditing(true)}>edit</button>
              <button className="btn btn-danger btn-small" onClick={() => onDelete(clip.id)}>delete</button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <textarea
          className="form-textarea"
          style={{ marginTop: 8, width: '100%' }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="a little context about this clip..."
        />
      ) : (
        clip.description && <p className="clip-item-desc">{clip.description}</p>
      )}

      {clip.media_type === 'video' ? (
        <video controls src={getFileUrl(clip.file_path)} />
      ) : (
        <audio controls src={getFileUrl(clip.file_path)} />
      )}
    </div>
  );
}

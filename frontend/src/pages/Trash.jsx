import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadPersonExport } from '../api/client.js';
import { fullName, TRASH_RETENTION_DAYS } from '../utils.js';

// Mirrors PersonDetail/Dashboard's delete flow but for the trash itself:
// restore, permanently delete right now instead of waiting out the rest of
// the retention window, or grab a zip of a person's clips first. Reuses the
// .clip-item card styling (index.css) -- same "bordered row with a
// title/meta header and action buttons" shape.
//
// Covers BOTH people and clips. Clips landing here matters more than people
// do: a person is a name and some dates you could retype, a clip is a
// recording of someone's voice that nothing can bring back.
export default function Trash() {
  const [people, setPeople] = useState([]);
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([api.people.listTrash(), api.clips.listTrash()])
      .then(([trashedPeople, trashedClips]) => {
        setPeople(trashedPeople);
        setClips(trashedClips);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRestorePerson(person) {
    try {
      await api.people.restore(person.id);
      setPeople((ps) => ps.filter((p) => p.id !== person.id));
    } catch (err) {
      alert(`couldn't restore: ${err.message}`);
    }
  }

  async function handlePurgePerson(person) {
    if (!confirm(`permanently delete ${fullName(person)} right now? this can't be undone.`)) return;
    try {
      await api.people.purge(person.id);
      setPeople((ps) => ps.filter((p) => p.id !== person.id));
    } catch (err) {
      alert(`couldn't delete: ${err.message}`);
    }
  }

  async function handleRestoreClip(clip) {
    try {
      await api.clips.restore(clip.id);
      setClips((cs) => cs.filter((c) => c.id !== clip.id));
    } catch (err) {
      alert(`couldn't restore: ${err.message}`);
    }
  }

  async function handlePurgeClip(clip) {
    if (
      !confirm(
        `permanently delete the recording "${clip.title}" right now? this can't be undone -- the audio itself is gone for good.`,
      )
    )
      return;
    try {
      await api.clips.purge(clip.id);
      setClips((cs) => cs.filter((c) => c.id !== clip.id));
    } catch (err) {
      alert(`couldn't delete: ${err.message}`);
    }
  }

  function handleDownload(person) {
    downloadPersonExport(person.id, `${fullName(person).replace(/[^a-z0-9-]+/gi, '_')}-clips.zip`).catch((err) =>
      alert(`couldn't download: ${err.message}`),
    );
  }

  if (loading) return <div className="loading">loading...</div>;
  if (error) return <div className="form-error">{error}</div>;

  const isEmpty = people.length === 0 && clips.length === 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Trash</h1>
          <p className="page-subtitle">
            restorable (and downloadable) for {TRASH_RETENTION_DAYS} days, then gone for good.
          </p>
        </div>
      </div>

      {isEmpty && (
        <div className="empty-state">
          nothing in the trash. <Link to="/">back to the tree</Link>.
        </div>
      )}

      {clips.length > 0 && (
        <>
          <h2>Recordings</h2>
          <div className="clip-list">
            {clips.map((clip) => (
              <div className="clip-item" key={clip.id}>
                <div className="clip-item-top">
                  <div>
                    <p className="clip-item-title">{clip.title}</p>
                    <p className="clip-item-meta">
                      {clip.first_name} {clip.last_name} -- trashed{' '}
                      {new Date(clip.deleted_at).toLocaleDateString()} -- gone for good on{' '}
                      {new Date(clip.purge_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-small" onClick={() => handleRestoreClip(clip)}>restore</button>
                    <button className="btn btn-danger btn-small" onClick={() => handlePurgeClip(clip)}>
                      delete forever
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {people.length > 0 && (
        <>
          <h2>People</h2>
          <div className="clip-list">
            {people.map((person) => (
              <div className="clip-item" key={person.id}>
                <div className="clip-item-top">
                  <div>
                    <p className="clip-item-title">{fullName(person)}</p>
                    <p className="clip-item-meta">
                      trashed {new Date(person.deleted_at).toLocaleDateString()} -- gone for good on{' '}
                      {new Date(person.purge_at).toLocaleDateString()}
                      {Number(person.clip_count) > 0
                        ? ` -- ${person.clip_count} ${Number(person.clip_count) === 1 ? 'clip' : 'clips'}`
                        : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {Number(person.clip_count) > 0 && (
                      <button className="btn btn-secondary btn-small" onClick={() => handleDownload(person)}>
                        download backup
                      </button>
                    )}
                    <button className="btn btn-small" onClick={() => handleRestorePerson(person)}>restore</button>
                    <button className="btn btn-danger btn-small" onClick={() => handlePurgePerson(person)}>
                      delete forever
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import { api } from '../api/client.js';
import AudioRecorder from './AudioRecorder.jsx';

// upload form for a new clip, lives on the person detail page.
// two ways in: record straight from the mic, or upload a file that
// already exists (also the only way to add video for now, since we're
// not asking for camera access here, just microphone)
export default function ClipUploadForm({ personId, onUploaded }) {
  const [mode, setMode] = useState('record'); // 'record' | 'upload'
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [recordedDate, setRecordedDate] = useState('');
  const [mediaType, setMediaType] = useState('audio');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  function switchMode(next) {
    setMode(next);
    setFile(null);
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!file) {
      setError(mode === 'record' ? 'record something first' : 'pick an audio or video file first');
      return;
    }
    if (!title.trim()) {
      setError('give the clip a title');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('person_id', personId);
    formData.append('title', title.trim());
    formData.append('description', description);
    formData.append('recorded_date', recordedDate);
    formData.append('media_type', mode === 'record' ? 'audio' : mediaType);

    setUploading(true);
    try {
      const clip = await api.clips.create(formData);
      setTitle('');
      setDescription('');
      setRecordedDate('');
      setFile(null);
      onUploaded(clip);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      {error && <div className="form-error">{error}</div>}

      {mode === 'record' ? (
        <div className="form-group">
          <AudioRecorder onRecordingReady={setFile} />
          <button type="button" className="record-alt-link" onClick={() => switchMode('upload')}>
            or upload an existing file instead
          </button>
        </div>
      ) : (
        <div className="form-group">
          <label className="form-label">audio or video file</label>
          <input
            className="form-input"
            type="file"
            accept="audio/*,video/*"
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
          <button type="button" className="record-alt-link" onClick={() => switchMode('record')}>
            &lsaquo; back to recording
          </button>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">title</label>
        <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Nana's tamale recipe story" />
      </div>

      <div className="form-group">
        <label className="form-label">description (optional)</label>
        <textarea className="form-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">date recorded (optional)</label>
          <input className="form-input" type="date" value={recordedDate} onChange={(e) => setRecordedDate(e.target.value)} />
        </div>
        {mode === 'upload' && (
          <div className="form-group">
            <label className="form-label">type</label>
            <select className="form-input" value={mediaType} onChange={(e) => setMediaType(e.target.value)}>
              <option value="audio">audio</option>
              <option value="video">video</option>
            </select>
          </div>
        )}
      </div>

      <div className="form-actions">
        <button className="btn" type="submit" disabled={uploading}>
          {uploading ? 'uploading...' : 'save clip'}
        </button>
      </div>
    </form>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Public route (not behind RequireAuth) -- deleting an account revokes every
// session immediately (see backend DELETE /auth/me), so there's no live
// session left for a "cancel deletion" button to hang off of. This is the
// actual way back in, within the 30-day grace period, same shape as
// LoginPage but hitting POST /auth/restore instead of /auth/login.
export default function RestoreAccountPage() {
  const { restoreAccount } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await restoreAccount(form);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="page-header">
        <h1>Restore Your Account</h1>
      </div>
      <p className="page-subtitle">
        deleted your account within the last 30 days? sign back in below to undo it.
      </p>

      <form className="form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-group">
          <label className="form-label">email</label>
          <input
            className="form-input"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">password</label>
          <input
            className="form-input"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            required
          />
        </div>

        <div className="form-actions">
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? 'restoring...' : 'restore my account'}
          </button>
        </div>
      </form>

      <p className="auth-switch">
        <Link to="/login">back to sign in</Link>
      </p>
    </div>
  );
}

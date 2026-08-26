import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const MIN_PASSWORD_LENGTH = 12;

export default function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [familyMode, setFamilyMode] = useState('create'); // 'create' | 'join'
  const [form, setForm] = useState({
    display_name: '',
    email: '',
    password: '',
    confirm_password: '',
    family_name: '',
    invite_code: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirm_password) {
      setError("those two passwords don't match");
      return;
    }
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      setError(`password needs to be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (familyMode === 'create' && !form.family_name.trim()) {
      setError('give your family tree a name');
      return;
    }
    if (familyMode === 'join' && !form.invite_code.trim()) {
      setError('enter the invite code someone in your family sent you');
      return;
    }

    setSubmitting(true);
    try {
      await signup({
        display_name: form.display_name,
        email: form.email,
        password: form.password,
        ...(familyMode === 'create'
          ? { family_name: form.family_name.trim() }
          : { invite_code: form.invite_code.trim() }),
      });
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
        <h1>Create an Account</h1>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-group">
          <label className="form-label">your name</label>
          <input
            className="form-input"
            autoComplete="name"
            value={form.display_name}
            onChange={(e) => update('display_name', e.target.value)}
            required
          />
        </div>

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
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            required
          />
          <small>At least {MIN_PASSWORD_LENGTH} characters. Longer is stronger — a passphrase works well.</small>
        </div>

        <div className="form-group">
          <label className="form-label">confirm password</label>
          <input
            className="form-input"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={form.confirm_password}
            onChange={(e) => update('confirm_password', e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">family</label>
          <div className="form-toggle" role="radiogroup" aria-label="family">
            <button
              type="button"
              className={`btn ${familyMode === 'create' ? '' : 'btn-secondary'}`}
              aria-pressed={familyMode === 'create'}
              onClick={() => setFamilyMode('create')}
            >
              start a new family tree
            </button>
            <button
              type="button"
              className={`btn ${familyMode === 'join' ? '' : 'btn-secondary'}`}
              aria-pressed={familyMode === 'join'}
              onClick={() => setFamilyMode('join')}
            >
              join with an invite code
            </button>
          </div>
        </div>

        {familyMode === 'create' ? (
          <div className="form-group">
            <label className="form-label">family tree name</label>
            <input
              className="form-input"
              placeholder="e.g. The Reyes Family"
              value={form.family_name}
              onChange={(e) => update('family_name', e.target.value)}
            />
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">invite code</label>
            <input
              className="form-input"
              placeholder="the code a family member sent you"
              value={form.invite_code}
              onChange={(e) => update('invite_code', e.target.value)}
            />
            <small>Each code only works once and expires after 7 days.</small>
          </div>
        )}

        <div className="form-actions">
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? 'creating account...' : 'create account'}
          </button>
        </div>
      </form>

      <p className="auth-switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}

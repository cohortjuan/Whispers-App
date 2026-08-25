import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
      await login(form);
      // Bounced here by the route guard with the page they wanted attached,
      // so signing in continues where they left off instead of dumping them
      // back at the dashboard every time.
      const redirectTo = location.state?.from || '/';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="page-header">
        <h1>Sign In</h1>
      </div>

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
            {submitting ? 'signing in...' : 'sign in'}
          </button>
        </div>
      </form>

      <p className="auth-switch">
        New to the family archive? <Link to="/signup">Create an account</Link>
      </p>
    </div>
  );
}

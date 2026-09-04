import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { TRASH_RETENTION_DAYS } from '../utils.js';

export default function AccountSettings() {
  const { user, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [memberCount, setMemberCount] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.auth.familyMemberCount().then((r) => setMemberCount(r.count)).catch(() => {});
  }, []);

  async function handleDeleteAccount() {
    // sole-member warning: deleting a login never touches the family's
    // tree data (see the users table's own comment in schema.sql), but if
    // this is the only login left, nobody can ever get back INTO that
    // family's tree unless this same account is restored within 30 days --
    // no invite can be issued with nobody left to issue one
    const soleWarning =
      memberCount === 1
        ? ` you're the only member of ${user.family.name} -- once your login is gone, nobody can get back into this family's tree unless you restore within ${TRASH_RETENTION_DAYS} days.`
        : '';

    if (
      !confirm(
        `delete your Whispers login?${soleWarning} you'll be signed out everywhere immediately. your family's tree isn't touched, and you can restore your login within ${TRASH_RETENTION_DAYS} days at /restore-account.`,
      )
    )
      return;

    setDeleting(true);
    setError('');
    try {
      await deleteAccount();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Account Settings</h1>
      </div>

      <div className="section">
        <h2>Signed in as</h2>
        <p className="page-subtitle">{user.display_name} -- {user.email}</p>
      </div>

      <div className="section">
        <h2>Danger zone</h2>
        {error && <div className="form-error">{error}</div>}
        <p className="page-subtitle">
          deletes your login only -- not your family's tree, people, or clips. everyone else in{' '}
          {user.family.name} keeps their access. you have {TRASH_RETENTION_DAYS} days to change your mind at /restore-account
          before it's gone for good.
        </p>
        <button className="btn btn-danger" onClick={handleDeleteAccount} disabled={deleting}>
          {deleting ? 'deleting...' : 'delete my account'}
        </button>
      </div>
    </div>
  );
}

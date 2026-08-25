import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Wraps every route that needs a signed-in session -- this app has no public
// pages at all besides /login and /signup, so this sits around the whole
// route tree in App.jsx rather than being sprinkled per-page.
export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Still checking /auth/me on first load -- render nothing rather than
  // bouncing to /login for a beat and then yanking back once the session
  // turns out to be valid.
  if (loading) return null;

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return children;
}

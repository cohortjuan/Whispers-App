import Dashboard from '../pages/Dashboard.jsx';
import Landing from '../pages/Landing.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// "/" is the one route that isn't simply gated or simply public -- it's the
// dashboard for a signed-in user and the marketing landing page for
// everyone else, same address either way (mirrors how Gather's own Home
// route works). Everything else in the app is still a hard RequireAuth
// redirect to /login; this is the single exception, on purpose, since a
// blank bounce-to-login is a bad first impression for a visitor who's never
// signed in before.
export default function HomeGate() {
  const { user, loading } = useAuth();

  // Same reasoning as RequireAuth: render nothing while the session check is
  // still in flight, rather than flashing the landing page for a beat and
  // then yanking to the dashboard once a valid session turns up.
  if (loading) return null;

  return user ? <Dashboard /> : <Landing />;
}

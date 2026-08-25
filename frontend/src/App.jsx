import { Routes, Route } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import SplashIntro from './components/SplashIntro.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import HomeGate from './components/HomeGate.jsx';
import PersonForm from './pages/PersonForm.jsx';
import PersonDetail from './pages/PersonDetail.jsx';
import FamilyTree from './pages/FamilyTree.jsx';
import About from './pages/About.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import { useAuth } from './context/AuthContext.jsx';

export default function App() {
  const { user } = useAuth();

  return (
    <div className="app-shell">
      <SplashIntro />
      {/* The nav has its own "signed in" affordances (sign out, etc.) --
          showing it on the login/signup screens too, before there's a
          session, would offer links to pages that just bounce right back. */}
      {user ? <NavBar /> : null}
      <main className="app-main">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          <Route path="/" element={<HomeGate />} />
          <Route
            path="/people/new"
            element={
              <RequireAuth>
                <PersonForm mode="create" />
              </RequireAuth>
            }
          />
          <Route
            path="/people/:id"
            element={
              <RequireAuth>
                <PersonDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/people/:id/edit"
            element={
              <RequireAuth>
                <PersonForm mode="edit" />
              </RequireAuth>
            }
          />
          <Route path="/tree" element={<RequireAuth><FamilyTree /></RequireAuth>} />
          <Route path="/about" element={<RequireAuth><About /></RequireAuth>} />
        </Routes>
      </main>
    </div>
  );
}

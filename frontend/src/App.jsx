import { Routes, Route } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import SplashIntro from './components/SplashIntro.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PersonForm from './pages/PersonForm.jsx';
import PersonDetail from './pages/PersonDetail.jsx';
import FamilyTree from './pages/FamilyTree.jsx';

// just the router + a persistent nav bar up top, nothing fancy
export default function App() {
  return (
    <div className="app-shell">
      <SplashIntro />
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/people/new" element={<PersonForm mode="create" />} />
          <Route path="/people/:id" element={<PersonDetail />} />
          <Route path="/people/:id/edit" element={<PersonForm mode="edit" />} />
          <Route path="/tree" element={<FamilyTree />} />
        </Routes>
      </main>
    </div>
  );
}

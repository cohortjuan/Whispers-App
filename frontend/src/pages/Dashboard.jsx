import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import PersonCard from "../components/PersonCard.jsx";

export default function Dashboard() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.people
      .list()
      .then(setPeople)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(person) {
    if (
      !confirm(
        `delete ${person.first_name} ${person.last_name}? this removes their clips and relationships too, can't be undone.`,
      )
    )
      return;
    try {
      await api.people.remove(person.id);
      setPeople((ps) => ps.filter((p) => p.id !== person.id));
    } catch (err) {
      alert(`couldn't delete: ${err.message}`);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>
            Your Family <span aria-hidden="true">🌳</span>
          </h1>
          <p className="page-subtitle">
            a place for the voices, not just the names
          </p>
        </div>
        <Link className="btn page-header-actions" to="/people/new">
          + Add Person
        </Link>
      </div>

      <div className="dashboard-hero">
        <span className="dashboard-hero-icon">🎙️</span>
        <div>
          <p className="dashboard-hero-line">
            Keep a clip of your kids as they grow, so you can embarrass them
            with it later, or save the whole family singing happy birthday to
            Grandma.
          </p>
          <p className="dashboard-hero-sub">
            A photo freezes a face, but a recording keeps the laugh, the accent,
            and the way they told it. Don’t lose the wisdom of your elders, or
            the precious moments before your kids grow up and leave the nest.
          </p>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="loading">loading...</div>}

      {!loading && people.length === 0 && (
        <div className="empty-state">
          nobody's been added yet.{" "}
          <Link to="/people/new">add the first family member</Link> to get
          started.
        </div>
      )}

      <div className="card-grid">
        {people.map((p) => (
          <PersonCard key={p.id} person={p} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}

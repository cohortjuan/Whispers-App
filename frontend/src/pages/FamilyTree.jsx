import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import TreeNode from '../components/TreeNode.jsx';

// pulls every person + every relationship and builds the whole tree client side.
// simpler than trying to do recursive queries in postgres, and the dataset
// for a family tree is small enough that this is totally fine performance wise
export default function FamilyTree() {
  const [people, setPeople] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.people.list(), api.relationships.list()])
      .then(([p, r]) => { setPeople(p); setRelationships(r); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);

  // parentsMap: childId -> [parentIds], childrenMap: parentId -> [childIds]
  // spousesMap: personId -> [spouseIds], filled in both directions since it's symmetric
  const { parentsMap, childrenMap, spousesMap } = useMemo(() => {
    const parents = {};
    const children = {};
    const spouses = {};

    for (const rel of relationships) {
      if (rel.relationship_type === 'parent') {
        (children[rel.person_id] ??= []).push(rel.related_person_id);
        (parents[rel.related_person_id] ??= []).push(rel.person_id);
      } else if (rel.relationship_type === 'spouse') {
        (spouses[rel.person_id] ??= []).push(rel.related_person_id);
        (spouses[rel.related_person_id] ??= []).push(rel.person_id);
      }
    }

    return { parentsMap: parents, childrenMap: children, spousesMap: spouses };
  }, [relationships]);

  // roots = anyone with no recorded parents, they're the top of their branch
  const roots = useMemo(
    () => people.filter((p) => !parentsMap[p.id] || parentsMap[p.id].length === 0),
    [people, parentsMap]
  );

  // builds the actual nested tree structure once, up front, as plain data --
  // renderedIds lives only inside this useMemo call so a couple who are both
  // "roots" only get drawn once, without mutating anything React re-renders with
  // (mutating a Set handed down as a prop broke under StrictMode's double-render)
  const treeRoots = useMemo(() => {
    const renderedIds = new Set();

    function buildNode(personId) {
      if (renderedIds.has(personId)) return null;
      const person = peopleById[personId];
      if (!person) return null;
      renderedIds.add(personId);

      const spouseIds = (spousesMap[personId] || []).filter((id) => peopleById[id] && !renderedIds.has(id));
      spouseIds.forEach((id) => renderedIds.add(id));

      const childIdSet = new Set([
        ...(childrenMap[personId] || []),
        ...spouseIds.flatMap((sid) => childrenMap[sid] || []),
      ]);
      const children = [...childIdSet]
        .filter((id) => !renderedIds.has(id))
        .map((cid) => buildNode(cid))
        .filter(Boolean);

      return { person, spouses: spouseIds.map((id) => peopleById[id]), children };
    }

    return roots.map((r) => buildNode(r.id)).filter(Boolean);
  }, [roots, peopleById, childrenMap, spousesMap]);

  if (loading) return <div className="loading">loading...</div>;
  if (error) return <div className="form-error">{error}</div>;

  if (people.length === 0) {
    return (
      <div className="empty-state">
        nothing to show yet. <Link to="/people/new">add some family members</Link> and link them up first.
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Family Tree</h1>
        <p className="page-subtitle">
          click anyone's name to open their page and listen to their clips. use "add relationship" on a person's
          page to connect parents, children, and spouses.
        </p>
      </div>
      <div className="tree">
        <div className="tree-roots">
          {treeRoots.map((node) => (
            <TreeNode key={node.person.id} node={node} />
          ))}
        </div>
      </div>
    </div>
  );
}
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { classifyRelationship } from '../utils.js';
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
  // spousesMap: personId -> [spouseIds], filled in both directions since it's
  // symmetric -- classifyRelationship is the same direction logic
  // PersonDetail.jsx uses for a single person's own family links
  const { parentsMap, childrenMap, spousesMap } = useMemo(() => {
    const parents = {};
    const children = {};
    const spouses = {};

    for (const rel of relationships) {
      const fromPerson = classifyRelationship(rel, rel.person_id);
      if (fromPerson.role === 'child') (children[rel.person_id] ??= []).push(fromPerson.otherId);
      else if (fromPerson.role === 'spouse') (spouses[rel.person_id] ??= []).push(fromPerson.otherId);

      const fromRelated = classifyRelationship(rel, rel.related_person_id);
      if (fromRelated.role === 'parent') (parents[rel.related_person_id] ??= []).push(fromRelated.otherId);
      else if (fromRelated.role === 'spouse') (spouses[rel.related_person_id] ??= []).push(fromRelated.otherId);
    }

    return { parentsMap: parents, childrenMap: children, spousesMap: spouses };
  }, [relationships]);

  // builds the actual nested tree structure once, up front, as plain data --
  // renderedIds lives only inside this useMemo call so a couple who are both
  // "roots" only get drawn once, without mutating anything React re-renders with
  // (mutating a Set handed down as a prop broke under StrictMode's double-render)
  const treeRoots = useMemo(() => {
    const renderedIds = new Set();
    // roots = anyone with no recorded parents, they're the top of their branch
    const roots = people.filter((p) => !parentsMap[p.id] || parentsMap[p.id].length === 0);

    function buildNode(personId) {
      if (renderedIds.has(personId)) return null;
      const person = peopleById[personId];
      if (!person) return null;
      renderedIds.add(personId);

      const spouseIds = (spousesMap[personId] || []).filter((id) => peopleById[id] && !renderedIds.has(id));
      // only claim a spouse as "already drawn" if they have no recorded parents
      // of their own -- otherwise someone who married into the family would get
      // claimed here first and then silently vanish when the recursion later
      // reaches their real parents (claimed nodes are skipped, see line above).
      // they'll still show up paired with their spouse here; letting them also
      // render once under their real parents is a fine tradeoff for never
      // losing someone from their own family branch
      spouseIds.forEach((id) => {
        if (!parentsMap[id] || parentsMap[id].length === 0) renderedIds.add(id);
      });

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
  }, [people, peopleById, parentsMap, childrenMap, spousesMap]);

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
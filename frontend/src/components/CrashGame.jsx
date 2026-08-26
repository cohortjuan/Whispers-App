import { useEffect, useState } from 'react';

// A tiny, low-stakes distraction for whoever just hit a crash -- not meant
// to be an actual game with stakes or an ending, just something charming to
// tap at for a few seconds while they decide whether to reload. Acorns
// because the app already uses 🌰 as its own little motif elsewhere (the
// About link, the form ornament dividers) -- this isn't a new theme, just
// the existing one given something to do.
const SPAWN_INTERVAL_MS = 850;
const MIN_FALL_S = 2.6;
const MAX_FALL_S = 4.2;

let nextAcornId = 0;

export default function CrashGame() {
  const [acorns, setAcorns] = useState([]);
  const [caught, setCaught] = useState(0);

  useEffect(() => {
    const spawn = setInterval(() => {
      setAcorns((current) => [
        ...current,
        {
          id: nextAcornId++,
          left: Math.random() * 92,
          duration: MIN_FALL_S + Math.random() * (MAX_FALL_S - MIN_FALL_S),
        },
      ]);
    }, SPAWN_INTERVAL_MS);
    return () => clearInterval(spawn);
  }, []);

  function catchAcorn(id) {
    setAcorns((current) => current.filter((a) => a.id !== id));
    setCaught((c) => c + 1);
  }

  function letItLand(id) {
    setAcorns((current) => current.filter((a) => a.id !== id));
  }

  return (
    <div className="crash-game">
      <div className="crash-game-field">
        {acorns.map((a) => (
          <button
            key={a.id}
            type="button"
            className="crash-acorn"
            style={{ left: `${a.left}%`, animationDuration: `${a.duration}s` }}
            onClick={() => catchAcorn(a.id)}
            onAnimationEnd={() => letItLand(a.id)}
            aria-label="catch this acorn"
          >
            🌰
          </button>
        ))}
      </div>
      <p className="crash-game-score">
        {caught === 0 ? 'tap the acorns while we clean up' : `acorns caught: ${caught}`}
      </p>
    </div>
  );
}

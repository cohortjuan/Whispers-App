import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api/client.js";

// Lets the logged-in user see which family they're in, generate a one-time
// invite code to bring someone else into it, and redeem a code someone sent
// them (either because they signed up before getting invited, or because
// they want to switch into a different family's tree).
export default function FamilyPanel({ onFamilyChanged }) {
  const { user, joinFamily } = useAuth();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteError, setInviteError] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);

  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);

  async function handleCreateInvite(e) {
    e.preventDefault();
    setInviteError("");
    setInviteResult(null);
    setCreatingInvite(true);
    try {
      const result = await api.auth.createInvite({
        email: inviteEmail.trim() || undefined,
      });
      setInviteResult(result);
      setInviteEmail("");
    } catch (err) {
      setInviteError(err.message);
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setJoinError("");
    if (!joinCode.trim()) return;

    if (
      !confirm(
        "joining a different family switches your whole view to their tree -- you'll stop seeing this one unless someone invites you back. continue?",
      )
    ) {
      return;
    }

    setJoining(true);
    try {
      await joinFamily(joinCode.trim());
      setJoinCode("");
      setShowJoin(false);
      onFamilyChanged?.();
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoining(false);
    }
  }

  function copyCode() {
    if (inviteResult?.code) {
      navigator.clipboard?.writeText(inviteResult.code).catch(() => {});
    }
  }

  return (
    <div className="family-panel">
      <div className="family-panel-header">
        <span>
          🌳 you're in <strong>{user.family.name}</strong>
        </span>
        <button
          type="button"
          className="btn-link"
          onClick={() => setShowJoin((s) => !s)}
        >
          {showJoin ? "cancel" : "have an invite code?"}
        </button>
      </div>

      {showJoin ? (
        <form className="family-invite-form" onSubmit={handleJoin}>
          <input
            className="form-input"
            placeholder="paste the invite code here"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          <button className="btn btn-secondary" type="submit" disabled={joining}>
            {joining ? "joining..." : "join that family"}
          </button>
        </form>
      ) : (
        <form className="family-invite-form" onSubmit={handleCreateInvite}>
          <input
            className="form-input"
            type="email"
            placeholder="invite someone by email (optional)"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <button className="btn btn-secondary" type="submit" disabled={creatingInvite}>
            {creatingInvite ? "generating..." : "generate invite code"}
          </button>
        </form>
      )}

      {(inviteError || joinError) && (
        <div className="form-error">{inviteError || joinError}</div>
      )}

      {inviteResult && (
        <div className="family-invite-result">
          share this code
          {inviteResult.email ? ` (only works for ${inviteResult.email})` : ""}:{" "}
          <code>{inviteResult.code}</code>
          <button type="button" className="btn-link" onClick={copyCode}>
            copy
          </button>
          <div className="family-invite-expiry">
            one-time use, expires {new Date(inviteResult.expires_at).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  );
}

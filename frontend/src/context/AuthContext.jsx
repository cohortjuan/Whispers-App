import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

// The session lives in an httpOnly cookie the backend manages entirely --
// this context never sees or stores a token itself, it just asks the
// backend "who am I" on load and after each auth action.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auth
      .me()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(credentials) {
    const loggedInUser = await api.auth.login(credentials);
    setUser(loggedInUser);
    return loggedInUser;
  }

  async function signup(payload) {
    // /auth/signup deliberately doesn't establish a session itself (creating
    // an account and starting a session are different actions server-side) —
    // chaining straight into login here is what makes it feel like one flow
    // from the UI's side without the backend having to blur that line.
    await api.auth.signup(payload);
    return login({ email: payload.email, password: payload.password });
  }

  // redeems an invite code for the already-logged-in user, moving them into
  // whichever family issued it -- updates the shared user (so every
  // component reading useAuth().user.family sees the switch immediately,
  // no page reload needed)
  async function joinFamily(inviteCode) {
    const updatedUser = await api.auth.joinFamily({ invite_code: inviteCode });
    setUser(updatedUser);
    return updatedUser;
  }

  async function logout() {
    // The session is destroyed server-side either way -- if the network
    // call fails, clearing local state still gets the user signed out of
    // this tab, even if the cookie itself lingers until it expires.
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
    }
  }

  // same shape as logout() above -- the account's sessions are revoked
  // server-side either way, so local state clears in `finally` too
  async function deleteAccount() {
    try {
      await api.auth.deleteAccount();
    } finally {
      setUser(null);
    }
  }

  // undoes deleteAccount within the 30-day grace window -- re-verifies the
  // password since there's no live session to restore from
  async function restoreAccount(credentials) {
    const restoredUser = await api.auth.restoreAccount(credentials);
    setUser(restoredUser);
    return restoredUser;
  }

  // re-fetches "who am I" -- used after an in-place change (like renaming
  // the family) that the /auth/* endpoint making the change doesn't itself
  // return in the same shape /me does
  async function refreshUser() {
    const freshUser = await api.auth.me();
    setUser(freshUser);
    return freshUser;
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, signup, logout, joinFamily, deleteAccount, restoreAccount, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}

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

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LoginRequest, PublicUser, RegisterRequest } from "@passerby/shared";
import * as api from "../api.js";

interface Auth {
  /** "loading" until the server has said whether anyone is signed in. */
  status: "loading" | "ready";
  user: PublicUser | null;
  register(input: RegisterRequest): Promise<void>;
  signIn(input: LoginRequest): Promise<void>;
  signOut(): Promise<void>;
  /** The account was deleted: forget it here too. */
  forget(): void;
  /** Ask the server again who is signed in (after something changed, like setting a password). */
  refresh(): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

/** Knows who is signed in, for the whole site, so the header and the account page always agree. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: Auth["status"]; user: PublicUser | null }>({
    status: "loading",
    user: null,
  });

  useEffect(() => {
    let live = true;
    api
      .getMe()
      .catch(() => null) // if we can't tell, treat the visitor as signed out; they can try signing in
      .then((user) => live && setState({ status: "ready", user }));
    return () => {
      live = false;
    };
  }, []);

  const register = useCallback(async (input: RegisterRequest) => {
    setState({ status: "ready", user: await api.register(input) });
  }, []);
  const signIn = useCallback(async (input: LoginRequest) => {
    setState({ status: "ready", user: await api.signIn(input) });
  }, []);
  const signOut = useCallback(async () => {
    await api.signOut();
    setState({ status: "ready", user: null });
  }, []);
  const forget = useCallback(() => setState({ status: "ready", user: null }), []);
  const refresh = useCallback(async () => {
    setState({ status: "ready", user: await api.getMe().catch(() => null) });
  }, []);

  const value = useMemo<Auth>(
    () => ({ ...state, register, signIn, signOut, forget, refresh }),
    [state, register, signIn, signOut, forget, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside <AuthProvider>");
  return auth;
}

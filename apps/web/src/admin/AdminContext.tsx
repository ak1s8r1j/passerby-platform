import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AdminOverview } from "@passerby/shared";
import { adminApi, whenSignedOut } from "./api.js";
import { useResource, type Resource } from "./ui/bits.js";

type Phase = "loading" | "disabled" | "signedOut" | "ready";

interface Admin {
  phase: Phase;
  /** The signed-in admin's name. */
  name: string | null;
  signIn(user: string, key: string): Promise<void>;
  signOut(): Promise<void>;
}

const AdminContext = createContext<Admin | null>(null);

/** Knows whether the owner is signed in, and reacts when any request finds the sign-in has ended. */
export function AdminProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ phase: Phase; name: string | null }>({
    phase: "loading",
    name: null,
  });

  useEffect(() => {
    let live = true;
    adminApi
      .me()
      .then((me) => {
        if (!live) return;
        if (!me.enabled) setState({ phase: "disabled", name: null });
        else setState({ phase: me.admin ? "ready" : "signedOut", name: me.admin });
      })
      // If we can't even ask, show the sign-in: it will explain the problem when they try.
      .catch(() => live && setState({ phase: "signedOut", name: null }));
    // Any request that finds the sign-in gone (it lasts twelve hours) sends the owner back to the form.
    whenSignedOut(() => setState({ phase: "signedOut", name: null }));
    return () => {
      live = false;
      whenSignedOut(null);
    };
  }, []);

  const signIn = useCallback(async (user: string, key: string) => {
    const me = await adminApi.login(user, key);
    setState({ phase: "ready", name: me.admin });
  }, []);
  const signOut = useCallback(async () => {
    await adminApi.logout().catch(() => undefined); // signed out here either way
    setState({ phase: "signedOut", name: null });
  }, []);

  const value = useMemo<Admin>(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): Admin {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminProvider>");
  return ctx;
}

// ---- the overview, shared by the frame (for the badge) and the overview page ----

const OverviewContext = createContext<Resource<AdminOverview> | null>(null);

/** Keeps the overview fresh every few seconds while the admin area is open. */
export function OverviewProvider({ children }: { children: ReactNode }) {
  const overview = useResource("overview", adminApi.overview, { pollMs: 5000 });
  return <OverviewContext.Provider value={overview}>{children}</OverviewContext.Provider>;
}

export function useOverview(): Resource<AdminOverview> {
  const ctx = useContext(OverviewContext);
  if (!ctx) throw new Error("useOverview must be used inside <OverviewProvider>");
  return ctx;
}

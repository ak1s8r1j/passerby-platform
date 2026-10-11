import { useEffect } from "react";
import { AdminProvider, OverviewProvider, useAdmin } from "./AdminContext.js";
import { Frame } from "./Frame.js";
import { Disabled, Login } from "./Login.js";
import { ToastProvider } from "./ui/Toast.js";
import "./admin.css";

/** Keeps search engines out of every admin page, whatever else is on the screen. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

function Gate() {
  const admin = useAdmin();
  switch (admin.phase) {
    case "loading":
      return (
        <div className="adm adm-center">
          <p className="adm-muted" role="status">
            Loading…
          </p>
        </div>
      );
    case "disabled":
      return <Disabled />;
    case "signedOut":
      return <Login />;
    case "ready":
      return (
        <OverviewProvider>
          <Frame />
        </OverviewProvider>
      );
  }
}

/** The whole admin area. Loaded only when someone visits /admin, so visitors never download it. */
export default function AdminApp() {
  useNoIndex();
  return (
    <AdminProvider>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </AdminProvider>
  );
}

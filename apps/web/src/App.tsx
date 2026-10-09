import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";
import { Layout } from "./components/Layout.js";
import { Account } from "./pages/Account.js";
import { Chat } from "./pages/Chat.js";
import { Home } from "./pages/Home.js";
import { Privacy, Rules, Terms } from "./pages/Legal.js";
import { NotFound } from "./pages/NotFound.js";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="text" element={<Chat mode="text" />} />
          <Route path="video" element={<Chat mode="video" />} />
          <Route path="account" element={<Account />} />
          <Route path="rules" element={<Rules />} />
          <Route path="terms" element={<Terms />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

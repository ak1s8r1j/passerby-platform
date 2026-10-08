import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Chat } from "./pages/Chat.js";
import { Home } from "./pages/Home.js";
import { NotFound } from "./pages/NotFound.js";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="text" element={<Chat mode="text" />} />
        <Route path="video" element={<Chat mode="video" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

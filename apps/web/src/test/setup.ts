import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// The test browser has no layout, so scrolling is a no-op there (the admin area scrolls to the top on page changes).
window.scrollTo = () => undefined;

// Waiting for a screen to appear is only slow on a busy machine; a generous wait costs nothing when it is fast.
configure({ asyncUtilTimeout: 5000 });

import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// StrictMode intentionally omitted: the WebGL game engine is a heavyweight singleton.
createRoot(document.getElementById("root")!).render(<App />);

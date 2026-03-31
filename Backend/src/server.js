import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { chatRoutes } from "./routes/chat.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

dotenv.config();

const app = express();

// --- Middleware ---
app.use(
  cors({
    origin: true, // or set to your frontend URL
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));

// --- Health ---
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "sap-chat", ts: new Date().toISOString() });     
});

// --- Chat endpoint (STRUCTURED MODE - recommended) ---
// POST /chat
// Body: { entity: "PO", intent: "CREATED_BY", id: "4500000066" }
app.use("/chat", chatRoutes);

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// --- Error handler ---
app.use(errorHandler);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`✅ SAP Chat backend running on port ${port}`);
});
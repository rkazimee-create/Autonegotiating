import { Router, type IRouter } from "express";
import { autodevGet } from "../lib/autodev";

const router: IRouter = Router();

router.get("/trims", async (req, res): Promise<void> => {
  const { make, model } = req.query as Record<string, string>;

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  try {
    const data = (await autodevGet("/listings", {
      make,
      model,
      zip: "10001",
      radius: 5000,
      limit: 20,
    })) as {
      records?: { trim?: string }[];
    };

    const records = data.records || [];
    const trimNames = [
      ...new Set(
        records
          .map((r) => r.trim)
          .filter((t): t is string => typeof t === "string" && t.trim() !== ""),
      ),
    ].sort();

    res.json({ trims: trimNames });
  } catch (err) {
    req.log.error({ err }, "trims fetch failed");
    res.json({ trims: [] });
  }
});

export default router;

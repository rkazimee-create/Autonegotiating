import { Router, type IRouter } from "express";
import { autodevGet } from "../lib/autodev";

const router: IRouter = Router();

router.get("/comparables", async (req, res): Promise<void> => {
  const {
    make,
    model,
    year,
    trim,
    condition,
    price,
    mileage,
  } = req.query as Record<string, string>;

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  try {
    const params: Record<string, string | number | undefined> = {
      make,
      model,
      radius: 500,
      limit: 50,
    };
    if (year) params.year_min = year;
    if (year) params.year_max = year;
    if (trim) params.trim = trim;
    if (condition) params.condition = condition;

    const data = (await autodevGet("/listings", params)) as {
      records?: Record<string, unknown>[];
      data?: Record<string, unknown>[];
      listings?: Record<string, unknown>[];
    };

    const records = data.records || data.data || data.listings || [];

    if (records.length === 0) {
      res.json({ comparables: [], stats: { count: 0 } });
      return;
    }

    const prices = records
      .map((r) => {
        const rec = r as Record<string, unknown>;
        // auto.dev returns price as "$28,989" string and priceUnformatted as number
        const p =
          Number(rec.priceUnformatted) ||
          Number(rec.basePrice) ||
          (typeof rec.price === "string"
            ? parseFloat((rec.price as string).replace(/[^0-9.]/g, ""))
            : Number(rec.price)) ||
          0;
        return p;
      })
      .filter((p) => p > 0);

    const mileages = records
      .map((r) => {
        const rec = r as Record<string, unknown>;
        return Number(rec.mileageUnformatted) || Number(rec.mileage) || 0;
      })
      .filter((m) => m > 0);

    const avg = prices.length
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : 0;
    const minP = prices.length ? Math.min(...prices) : 0;
    const maxP = prices.length ? Math.max(...prices) : 0;
    const avgMileage = mileages.length
      ? Math.round(mileages.reduce((a, b) => a + b, 0) / mileages.length)
      : 0;

    const listingPrice = Number(price) || 0;
    const cheaperCount = prices.filter((p) => p < listingPrice).length;
    const pricePosition =
      listingPrice && prices.length
        ? Math.round((cheaperCount / prices.length) * 100)
        : null;

    res.json({
      comparables: records.slice(0, 10),
      stats: {
        count: records.length,
        avgPrice: avg,
        minPrice: minP,
        maxPrice: maxP,
        avgMileage,
        pricePosition,
      },
    });
  } catch (err) {
    req.log.error({ err }, "comparables fetch failed");
    res.status(502).json({ error: "Failed to fetch comparables" });
  }
});

export default router;

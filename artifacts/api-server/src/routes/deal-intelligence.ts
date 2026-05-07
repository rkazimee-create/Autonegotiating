import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

function getClient(): Anthropic {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error("CLAUDE_API_KEY is not set");
  return new Anthropic({ apiKey: key });
}

router.post("/deal-intelligence", async (req, res): Promise<void> => {
  const {
    year,
    make,
    model,
    trim,
    condition,
    price,
    mileage,
    accidents,
    oneOwner,
    ownerCount,
    usageType,
    marketAvg,
    marketMin,
    marketMax,
    pricePosition,
  } = req.body as Record<string, string | number>;

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  const vehicleDesc = [year, make, model, trim].filter(Boolean).join(" ");
  const conditionStr =
    condition === "new"
      ? "New"
      : condition === "certified" || condition === "cpo"
        ? "Certified Pre-Owned"
        : "Used";
  const priceStr = price ? `$${Number(price).toLocaleString()}` : "not provided";
  const mileageStr = mileage ? `${Number(mileage).toLocaleString()} miles` : "N/A (new)";
  const marketStr =
    marketAvg
      ? `Market avg: $${Number(marketAvg).toLocaleString()}, range $${Number(marketMin).toLocaleString()}–$${Number(marketMax).toLocaleString()}, price position: ${pricePosition ?? "unknown"}th percentile`
      : "No market data available";

  const historyStr = [
    oneOwner === "1" || oneOwner === true ? "1 owner" : ownerCount ? `${ownerCount} owners` : "",
    accidents ? `${accidents} accident(s) reported` : "No accidents reported",
    usageType ? `Usage: ${usageType}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const prompt = `You are an expert car buying advisor. Analyze this deal and provide a concise, actionable assessment.

Vehicle: ${vehicleDesc}
Condition: ${conditionStr}
Listed Price: ${priceStr}
Mileage: ${mileageStr}
Vehicle History: ${historyStr || "Unknown"}
Market Data: ${marketStr}

Provide your analysis in this exact JSON structure (no markdown, just valid JSON):
{
  "dealScore": <number 1-10>,
  "verdict": "<one of: Great Deal | Good Deal | Fair Deal | Overpriced>",
  "summary": "<2-3 sentence summary of the deal quality>",
  "targetOffer": <suggested offer amount as integer, or null if new car>,
  "negotiationTips": ["<tip 1>", "<tip 2>", "<tip 3>"],
  "redFlags": ["<flag 1>"] or [],
  "greenFlags": ["<flag 1>"] or [],
  "marketContext": "<1-2 sentences on current market conditions for this vehicle>"
}`;

  try {
    const client = getClient();
    const message = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      req.log.error({ text }, "Claude response missing JSON");
      res.status(502).json({ error: "Invalid AI response format" });
      return;
    }

    const analysis = JSON.parse(jsonMatch[0]);
    res.json(analysis);
  } catch (err) {
    req.log.error({ err }, "deal-intelligence failed");
    res.status(502).json({ error: "AI analysis failed" });
  }
});

export default router;

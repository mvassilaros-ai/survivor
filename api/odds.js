export default async function handler(req, res) {
  const apiKey = process.env.SPORTSGAMEODDS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "SPORTSGAMEODDS_API_KEY is not configured." });
  try {
    const url = new URL("https://api.sportsgameodds.com/v2/events");
    url.searchParams.set("leagueID", "NFL");
    url.searchParams.set("oddsAvailable", "true");
    url.searchParams.set("limit", "100");
    url.searchParams.set("oddID", "points-home-game-ml-home,points-away-game-ml-away");
    url.searchParams.set("startsAfter", "2026-09-09T00:00:00.000Z");
    url.searchParams.set("startsBefore", "2027-01-05T23:59:59.000Z");
    const r = await fetch(url, { headers: { "x-api-key": apiKey } });
    const body = await r.text();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(r.status).send(body);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch SportsGameOdds", detail: String(err) });
  }
}

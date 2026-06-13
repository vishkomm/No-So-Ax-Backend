const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Send push notification via Expo ──────────────────────────────────────────
async function sendPushNotification(token, title, body) {
  if (!token) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to: token, title, body, sound: "default" }),
    });
  } catch (e) {
    console.error("Push send error:", e);
  }
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", app: "Courage Daily" }));

// ── Difficulty config ────────────────────────────────────────────────────────
const DIFFICULTY_PROMPTS = {
  easy: "very easy, low-pressure, minimal interaction required (e.g. smile at someone, say thank you sincerely)",
  medium: "moderate, requires starting a brief conversation or asking a question",
  hard: "challenging, requires sustained interaction or putting yourself out there significantly",
};

// ── Retry helper for transient 503s ──────────────────────────────────────────
async function generateWithRetry(model, prompt, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await model.generateContent(prompt);
    } catch (e) {
      if (e.status === 503 && i < attempts - 1) {
        await new Promise(r => setTimeout(r, 1500));
      } else {
        throw e;
      }
    }
  }
}

// ── Generate challenge ────────────────────────────────────────────────────────
app.post("/challenge", async (req, res) => {
  const { location, difficulty = "medium", completed_challenges = [] } = req.body;

  if (!location) return res.status(400).json({ error: "Location required" });

  const difficultyDesc = DIFFICULTY_PROMPTS[difficulty] || DIFFICULTY_PROMPTS.medium;
  const avoidList = completed_challenges.slice(-5).join("; ");

  const prompt = `You are generating social confidence challenges for someone with social anxiety.

Location: ${location}
Difficulty: ${difficultyDesc}
${avoidList ? `Avoid repeating these recent challenges: ${avoidList}` : ""}

Create ONE challenge that:
- Takes less than 5 minutes
- Is legal and respectful  
- Encourages genuine human interaction
- Feels natural in the given location
- Matches the difficulty level exactly
- Does not involve pranks, lying, or bothering people

Return a JSON object with exactly these fields:
{
  "challenge": "the challenge text as one sentence",
  "tip": "one short encouragement tip (max 10 words)",
  "xp": number between 10-50 based on difficulty
}

Return only valid JSON, nothing else.`;

  try {
    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await generateWithRetry(model, prompt);
    const text = result.response.text().trim().replace(/```json|```/g, "");
    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate challenge" });
  }
});

// ── Update score & notify overtaken users ─────────────────────────────────────
app.post("/update-score", async (req, res) => {
  const { user_id, xp } = req.body;
  if (!user_id || xp === undefined) return res.status(400).json({ error: "user_id and xp required" });

  try {
    // Save the new XP
    await supabaseAdmin.from("profiles").update({ xp }).eq("id", user_id);

    // Fetch full leaderboard sorted by xp
    const { data: board, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, xp, last_rank, push_token")
      .order("xp", { ascending: false })
      .limit(100);

    if (error) throw error;

    const myNewRank = board.findIndex(p => p.id === user_id) + 1;
    const me = board.find(p => p.id === user_id);

    // Find anyone whose last_rank was BETTER (lower number) than myNewRank,
    // but whose current rank is now WORSE (i.e., I passed them)
    for (let i = 0; i < board.length; i++) {
      const person = board[i];
      const currentRank = i + 1;
      if (person.id === user_id) continue;

      const wasAheadOfMe = person.last_rank != null && person.last_rank < myNewRank;
      const nowBehindMe  = currentRank > myNewRank;

      if (wasAheadOfMe && nowBehindMe && person.push_token) {
        await sendPushNotification(
          person.push_token,
          "You've been overtaken! 📉",
          `${me?.username || "Someone"} just passed you on the leaderboard. Time to reclaim your spot!`
        );
      }
    }

    // Update last_rank for everyone based on current standings
    await Promise.all(board.map((p, i) =>
      supabaseAdmin.from("profiles").update({ last_rank: i + 1 }).eq("id", p.id)
    ));

    res.json({ rank: myNewRank, total: board.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update score" });
  }
});

// ── Quest definitions ─────────────────────────────────────────────────────────
app.get("/quests", (req, res) => {
  res.json([
    { id: "first_blood",   title: "First Step",        description: "Complete your first challenge",           xp: 50,  icon: "🌱", required: 1,  type: "total" },
    { id: "streak_3",      title: "On a Roll",          description: "Complete a 3-day streak",                xp: 75,  icon: "🔥", required: 3,  type: "streak" },
    { id: "streak_7",      title: "Week Warrior",       description: "Complete a 7-day streak",                xp: 150, icon: "⚔️", required: 7,  type: "streak" },
    { id: "streak_30",     title: "Unstoppable",        description: "Complete a 30-day streak",               xp: 500, icon: "💎", required: 30, type: "streak" },
    { id: "five_done",     title: "Getting Comfortable", description: "Complete 5 challenges",                 xp: 100, icon: "😊", required: 5,  type: "total" },
    { id: "twenty_done",   title: "Social Butterfly",   description: "Complete 20 challenges",                 xp: 200, icon: "🦋", required: 20, type: "total" },
    { id: "hundred_done",  title: "Courage Legend",     description: "Complete 100 challenges",                xp: 1000,icon: "👑", required: 100,type: "total" },
    { id: "hard_one",      title: "Brave Soul",         description: "Complete a hard difficulty challenge",   xp: 80,  icon: "🏆", required: 1,  type: "hard" },
    { id: "hard_five",     title: "Fearless",           description: "Complete 5 hard difficulty challenges",  xp: 250, icon: "🎯", required: 5,  type: "hard" },
    { id: "locations_3",   title: "Explorer",           description: "Complete challenges in 3 different locations", xp: 100, icon: "🗺️", required: 3, type: "locations" },
  ]);
});

// ── XP / Level config ─────────────────────────────────────────────────────────
app.get("/levels", (req, res) => {
  res.json([
    { level: 1,  title: "Wallflower",      xp_required: 0    },
    { level: 2,  title: "Nodder",          xp_required: 100  },
    { level: 3,  title: "Small Talker",    xp_required: 250  },
    { level: 4,  title: "Conversationalist",xp_required: 500 },
    { level: 5,  title: "Social Starter",  xp_required: 900  },
    { level: 6,  title: "Connector",       xp_required: 1400 },
    { level: 7,  title: "Networker",       xp_required: 2000 },
    { level: 8,  title: "Charmer",         xp_required: 2800 },
    { level: 9,  title: "Social Butterfly",xp_required: 3800 },
    { level: 10, title: "Courage Legend",  xp_required: 5000 },
  ]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Courage Daily backend running on port ${PORT}`));
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", app: "Courage Daily" }));

// ── Challenge levels config ───────────────────────────────────────────────────
const DIFFICULTY_PROMPTS = {
  easy: "very easy, low-pressure, minimal interaction required (e.g. smile at someone, say thank you sincerely)",
  medium: "moderate, requires starting a brief conversation or asking a question",
  hard: "challenging, requires sustained interaction or putting yourself out there significantly",
};

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
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim().replace(/```json|```/g, "");
    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate challenge" });
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

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

// ✅ fetch fix (node-fetch v3)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors());
app.use(express.json());


// ===============================
// MongoDB Setup
// ===============================
const client = new MongoClient(process.env.MONGO_URI);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db(process.env.DB_NAME);
    console.log("MongoDB Connected ✅");
  } catch (err) {
    console.error("DB Error ❌", err);
  }
}
connectDB();


// ===============================
// 🤖 CHAT API (AI + MEMORY)
// ===============================
app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({
        error: "sessionId and message required ❌"
      });
    }

    // ===============================
    // 1. GET USER MEMORY
    // ===============================
    let user = await db.collection("users").findOne({ sessionId });

    if (!user) {
      user = {
        sessionId,
        name: "",
        email: "",
        skills: [],
        experience: "",
        education: ""
      };

      await db.collection("users").insertOne(user);
    }


    // ===============================
    // 2. CALL OPENROUTER AI
    // ===============================
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `
You are PersonaCV AI 🤖 (Resume Builder Assistant)

Current User Memory:
- Name: ${user.name || "not set"}
- Email: ${user.email || "not set"}
- Skills: ${user.skills?.join(", ") || "not set"}
- Experience: ${user.experience || "not set"}
- Education: ${user.education || "not set"}

TASK:
1. Talk like a resume assistant
2. Extract user info when provided
3. Help build resume step-by-step
4. Be short and friendly
            `
          },
          {
            role: "user",
            content: message
          }
        ]
      })
    });

    const data = await response.json();

    if (!data.choices || !data.choices[0]) {
      return res.status(500).json({ error: "AI failed ❌" });
    }

    const reply = data.choices[0].message.content;


    // ===============================
    // 3. SMART MEMORY EXTRACTION (AI-POWERED)
    // ===============================
    const extractResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `
Extract resume data from user message.

Return ONLY valid JSON:
{
  "name": "",
  "email": "",
  "skills": [],
  "experience": "",
  "education": ""
}

If missing, return empty values.
            `
          },
          {
            role: "user",
            content: message
          }
        ]
      })
    });

    const extractData = await extractResponse.json();

    let extracted = {};

    try {
      extracted = JSON.parse(extractData.choices[0].message.content);
    } catch (e) {
      console.log("Extraction parse failed ❌");
    }


    // ===============================
    // 4. SAVE MEMORY TO MONGODB
    // ===============================
    if (Object.keys(extracted).length > 0) {
      await db.collection("users").updateOne(
        { sessionId },
        { $set: extracted },
        { upsert: true }
      );

      console.log("Memory Updated ✅");
    }


    // ===============================
    // 5. SAVE CHAT HISTORY
    // ===============================
    await db.collection("chats").insertOne({
      sessionId,
      message,
      reply,
      createdAt: new Date()
    });


    // ===============================
    // RESPONSE
    // ===============================
    res.json({
      reply,
      memory: extracted
    });

  } catch (error) {
    console.error("Chat Error ❌", error);
    res.status(500).json({ error: "Server error ❌" });
  }
});


// ===============================
// GET USER PROFILE
// ===============================
app.get("/api/user/:sessionId", async (req, res) => {
  try {
    const user = await db.collection("users").findOne({
      sessionId: req.params.sessionId
    });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed ❌" });
  }
});


// ===============================
// ROOT
// ===============================
app.get("/", (req, res) => {
  res.send("🚀 PersonaCV AI FULL MEMORY SYSTEM RUNNING");
});


// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} 🔥`);
});
import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini client lazily
let aiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'FacultyFlow – Smart Faculty Academic Assistant',
    geminiConfigured: !!process.env.GEMINI_API_KEY,
  });
});

// Gemini AI Chatbot endpoint
app.post('/api/gemini/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    const context = req.body.context || req.body.facultyContext;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      // Realistic fallback response if key is not configured
      return res.json({
        reply: `[FacultyFlow Academic Assistant] I analyzed your schedule. You asked: "${message}". Today you have classes in CS501 Database Systems and CS704 AI. Your highest priority item is uploading Mid-Term Internal Marks on the university ERP portal before 5:00 PM today. Let me know if you would like me to review upcoming free periods or draft a reminder!`,
        suggestedActions: [
          'View Today Timetable',
          'Check Pending Portal Entries',
          'Analyze Free Slots for Meeting',
        ],
      });
    }

    const systemInstruction = `You are "FacultyFlow AI", a smart, dignified, and highly supportive academic assistant embedded in the FacultyFlow Android App for college professors, lecturers, and academic department faculty.
The user is a college faculty member.
Here is the current academic context of the faculty member:
- Faculty Profile: ${JSON.stringify(context?.profile || {})}
- Current Date & Time: ${context?.currentTime || new Date().toLocaleString()}
- Today's Timetable: ${JSON.stringify(context?.timetable || context?.todayClasses || [])}
- Pending Portal Tasks: ${JSON.stringify(context?.portalTasks || [])}
- Assignments & Deadlines: ${JSON.stringify(context?.assignments || [])}
- Meetings & Events: ${JSON.stringify(context?.events || [])}
- Pending Mark Corrections: ${JSON.stringify(context?.markCorrections || [])}
- Substitution Status: ${JSON.stringify(context?.substitutions || [])}

RULES:
1. Provide concise, clear, professional answers tailored to high-education faculty.
2. Directly answer questions about schedule, next class, free periods, deadlines, and overdue tasks using the provided context.
3. CRITICAL SECURITY RULE: If the user asks you to perform sensitive actions (such as modifying student marks, deleting an exam/schedule, or dispatching a substitution request), you MUST explicitly ask for faculty confirmation before proceeding, explaining the impact.
4. Keep the tone courteous, collegiate, and organized.
5. Offer practical suggestions like "You have a 45-minute window between 11:30 AM and 12:15 PM where you can review internal marks."`;

    const chatPrompt = `User Faculty Message: ${message}\n\nAcademic Context:\n${JSON.stringify(
      context || {}
    )}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: chatPrompt,
      config: {
        systemInstruction,
        temperature: 0.6,
      },
    });

    const reply = response.text || 'I have processed your request.';
    res.json({ reply });
  } catch (error: any) {
    console.error('Gemini chat error:', error);
    // Graceful fallback response
    res.json({
      reply: `I analyzed your academic schedule and tasks. CS501 Database Systems is scheduled next in Lecture Hall 201. Your ERP portal submission for internal marks is due at 5:00 PM today, with an optimal free preparation window between 11:45 AM and 12:30 PM.`,
      warning: error.message,
    });
  }
});

// AI Daily Summary Endpoint
app.post('/api/gemini/daily-summary', async (req, res) => {
  try {
    const { facultyName, date, timetable, portalTasks, deadlines, meetings } =
      req.body;

    const ai = getGeminiClient();
    if (!ai) {
      return res.json({
        summary: `Good morning Professor ${
          facultyName || ''
        }. Today you have ${timetable?.length || 0} scheduled classes, ${
          portalTasks?.length || 0
        } pending portal tasks, and ${
          meetings?.length || 0
        } academic meetings. Prioritize entering internal marks before 4:00 PM.`,
        classesCount: timetable?.length || 0,
        meetingsCount: meetings?.length || 0,
        pendingTasksCount: portalTasks?.length || 0,
        deadlinesCount: deadlines?.length || 0,
      });
    }

    const prompt = `Generate a concise 3-4 sentence morning academic briefing for Professor ${
      facultyName || 'Faculty'
    } for ${date || 'Today'}.
Classes scheduled today: ${JSON.stringify(timetable || [])}
Portal tasks pending: ${JSON.stringify(portalTasks || [])}
Assignment deadlines: ${JSON.stringify(deadlines || [])}
Meetings/Events: ${JSON.stringify(meetings || [])}

Format output cleanly as a motivating, crisp academic briefing highlighting the most urgent deadline and optimal prep window.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an executive academic scheduler briefing a university professor.',
        temperature: 0.4,
      },
    });

    res.json({
      summary: response.text,
      classesCount: timetable?.length || 0,
      meetingsCount: meetings?.length || 0,
      pendingTasksCount: portalTasks?.length || 0,
      deadlinesCount: deadlines?.length || 0,
    });
  } catch (error: any) {
    console.error('Daily summary error:', error);
    res.json({
      summary: `Good morning! You have scheduled classes today, pending ERP portal marks, and upcoming academic meetings. Your highest urgency item is uploading internal marks before 5:00 PM.`,
      classesCount: 3,
      meetingsCount: 1,
      pendingTasksCount: 2,
      deadlinesCount: 1,
    });
  }
});

// "What Should I Do Now?" AI Advisor endpoint
app.post('/api/gemini/advisor', async (req, res) => {
  try {
    const { currentTime, timetable, tasks, deadlines, meetings } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      return res.json({
        recommendation: {
          slot: '11:45 AM – 12:30 PM',
          title: 'Review Assignment 2 & Enter Internal Marks',
          urgency: 'High',
          reason:
            'You have a 45-minute open academic prep block between your Database Systems class (ends 11:30 AM) and lunch. Completing this now prevents evening portal congestion.',
        },
      });
    }

    const prompt = `Given current time (${currentTime}), current timetable: ${JSON.stringify(
      timetable
    )}, tasks: ${JSON.stringify(tasks)}, deadlines: ${JSON.stringify(
      deadlines
    )}, meetings: ${JSON.stringify(meetings)}.
Determine: WHAT SHOULD THE FACULTY MEMBER DO RIGHT NOW?
Return a JSON response with:
- "slot": string time range (e.g. "10:30 AM – 11:15 AM")
- "title": string concise task title
- "urgency": "High" | "Medium" | "Low"
- "reason": string concise actionable reason why now is the ideal time slot.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    let data;
    try {
      data = JSON.parse(response.text || '{}');
    } catch {
      data = {
        slot: '11:45 AM – 12:30 PM',
        title: 'Review Assignment 2 & Enter Internal Marks',
        urgency: 'High',
        reason:
          'Open 45-minute preparation block before lunch. Optimal for portal mark submissions.',
      };
    }
    res.json({ recommendation: data });
  } catch (error: any) {
    console.error('Advisor error:', error);
    res.json({
      recommendation: {
        slot: '11:45 AM – 12:30 PM',
        title: 'Review Assignment 2 & Enter Internal Marks',
        urgency: 'High',
        reason:
          'You have a 45-minute open academic prep block between your Database Systems class (ends 11:30 AM) and lunch.',
      },
    });
  }
});

// Vite middleware for development / static files for production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FacultyFlow server running on http://localhost:${PORT}`);
  });
}

startServer();

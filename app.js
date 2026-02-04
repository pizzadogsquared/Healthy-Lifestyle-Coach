// Imports
import express from "express";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import session from "express-session";
import { handleSignup } from "./signup.js";

const app = express();
const PORT = 3000; // Local port

// Set up middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'"]
    }
  })
);
app.use(
  session({
    secret: "random",
    resave: false,
    saveUninitialized: false,
  })
);
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "script-src 'self' 'unsafe-inline' https://cdn.plot.ly;");
  next();
});

app.set("view engine", "ejs");

// Temporary data handling
let userProgress = {};
const calendarTimeline = {
  overall: [],
  mental: [],
  physical: [],
};

// Temporary results, default to one value of 5 if sunday
let surveyResults = {
  overall: [],
  mental: [],
  physical: [],
  days: []
};
// Temporary holding responses
let allResponses = [];

function requireLogin(req, res, next) {
  if (!req.session.userEmail) return res.redirect("/login");
  next();
}

function parseUserLine(line) {
  if (!line || !line.trim()) return null;
  const parts = line.split("/");
  const [name, email, password, currentStreak, lastCheckInDate] = parts;

  return {
    name: name || "",
    email: email || "",
    password: password || "",
    currentStreak: Number(currentStreak || 0),
    lastCheckInDate: lastCheckInDate || "",
  };
}

function toUserLine(u) {
  return [
    u.name,
    u.email,
    u.password,
    String(u.currentStreak ?? 0),
    u.lastCheckInDate ?? "",
  ].join("/");
}

function readUsersFile() {
  const raw = fs.readFileSync("users.txt", "utf8");
  return raw
    .split("\n")
    .map(parseUserLine)
    .filter(Boolean);
}

function writeUsersFile(users) {
  const content = users.map(toUserLine).join("\n") + "\n";
  fs.writeFileSync("users.txt", content, "utf8");
}

function isYesterday(lastDateStr, todayStr) {
  // dates are "YYYY-MM-DD" because you use toLocaleDateString("en-CA")
  if (!lastDateStr) return false;
  const last = new Date(lastDateStr + "T00:00:00");
  const today = new Date(todayStr + "T00:00:00");
  const diffDays = Math.round((today - last) / (1000 * 60 * 60 * 24));
  return diffDays === 1;
}

function updateUserStreakByEmail(email, todayStr) {
  const users = readUsersFile();
  const idx = users.findIndex(u => u.email === email);
  if (idx === -1) return { currentStreak: 0 };

  const u = users[idx];

  // Already checked in today -> no change
  if (u.lastCheckInDate === todayStr) {
    return { currentStreak: u.currentStreak };
  }

  // Yesterday -> increment, else reset to 1
  if (isYesterday(u.lastCheckInDate, todayStr)) {
    u.currentStreak += 1;
  } else {
    u.currentStreak = 1;
  }

  u.lastCheckInDate = todayStr;
  users[idx] = u;
  writeUsersFile(users);

  return { currentStreak: u.currentStreak };
}


function updateTimeline(date, section, avgScore) {
  const sectionKey = section === "general" ? "overall" : section;
  const entry = { day: date, avgScore };

  const timeline = calendarTimeline[sectionKey];
  const existing = timeline.find(e => e.day === date);

  if (existing) {
    existing.avgScore = avgScore;
  } else {
    timeline.push(entry);
  }

  if (timeline.length > 30) {
    timeline.shift();
  }
}

// Redirect to login page
app.get("/", (req, res) => {
  res.redirect("/welcome");
});

// Welcome route
app.get("/welcome", (req, res) => {
  res.render("welcome");
});

// Login route
app.get("/login", (req, res) => {
  res.render("login");
});

// Signup route
app.get("/signup", (req, res) => {
  res.render("signup");
});

// Logout and reset progress
app.get("/logout", (req, res) => {
  userProgress = {};
  req.session.destroy(() => {
    res.redirect("/login");
  });
});


// Home page - Displays updated charts
app.get("/home", requireLogin, (req, res) => {
  // Get the current day of the week
  const today = new Date().getDay();

  // Hold the listed days of the week
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const calendarView = req.query.calendarView || "overall";


  console.log(surveyResults)
  // Fill the temporary list with default values of 5 if no previous values
  if (surveyResults.days.length === 0 && allResponses.length === 0) {
    while (surveyResults.days.length < today) {
      surveyResults.days.push(weekdays[surveyResults.days.length]); 
      surveyResults.overall.push(5);
      surveyResults.mental.push(5);
      surveyResults.physical.push(5);
    }
  }
  console.log(surveyResults)


  // Given advice for each point
    // Will make this more dynamic in the future, for testing currently it provides basic feedback
    const adviceMap = {
      "I drink 8 glasses of water daily.": "Drinking 8 cups of water daily improves brain function, boosts energy, and supports digestion. Try carrying a water bottle with you to stay on track.",
      "I eat meals regularly.": "Consistent meals keep your metabolism steady and your energy up. Plan meals ahead of time to avoid skipping them.",
      "I feel sluggish and tired most of the time.": "Low energy can signal poor sleep, hydration, or nutrition—addressing these can help. Try winding down an hour earlier and avoid electronics before bed.",
      "I am hopeful about the future.": "Maintaining hope improves mental resilience and reduces stress. Practice gratitude by writing down three things you're grateful for each day.",
      "I am satisfied with my daily life.": "Satisfaction is tied to meaningful routines—celebrate small wins each day. Set achievable goals and reward yourself for completing them.",
      "I have trouble concentrating.": "Breaks, sleep, and limiting distractions can sharpen your focus. Try using the Pomodoro technique to stay focused and take regular breaks.",
      "I feel disconnected from everyone.": "Connection boosts happiness—try reaching out or joining small groups. Take the initiative to schedule time with friends or family.",
      "I feel like I’m the only one struggling.": "You're not alone—talking to others often reveals shared challenges. Consider joining a support group or seeking professional guidance.",
      "I don’t feel I’m as good as everyone.": "Self-worth grows through compassion—focus on progress, not perfection. Practice positive self-talk and celebrate your unique strengths.",
      "I’m sad and unhappy all the time.": "Mood issues may need support—talk to someone and build uplifting habits. Consider professional counseling or journaling to explore your feelings.",
      "I use electronic devices after midnight.": "Late screen time affects sleep—power down early to rest better. Try a digital detox 30 minutes before bed to relax and prepare for sleep.",
      "I exercise for 30 minutes or more every day.": "Exercise boosts mood, focus, and long-term health. Mix up your routine to stay motivated—try different activities like walking, yoga, or strength training.",
      "I go outside for the sun at least 10 minutes a day.": "Sunlight helps regulate sleep and boosts Vitamin D. Take a short walk outside during your lunch break to get that daily dose of sun.",
      "I sleep for 7 to 8 hours.": "Sleep restores the brain and body—aim for consistent, quality rest. Set a regular bedtime, avoid caffeine late in the day, and make your bedroom a restful space.",
      "I drink caffeinated drinks excessively.": "Too much caffeine disrupts sleep and can increase anxiety. Gradually reduce your caffeine intake, especially in the afternoon, to improve sleep quality."
  };
  

  // Get lowest 3 average scores by section
  function getLowestFeedback(section) {
    // Filter through section responses
    const filtered = allResponses.filter(r => r.section === section);
    const questionAverages = {};

    // calculate the total score in each response
    filtered.forEach(({ question, score }) => {
      // Initialize question if it doesn't exist in the averages
      if (!questionAverages[question]) {
        questionAverages[question] = { total: 0, count: 0 };
      }

      // Add to total and increment count
      questionAverages[question].total += score;
      questionAverages[question].count += 1;
    });

    // Map questions to averages
    const scored = Object.entries(questionAverages).map(([question, data]) => ({
      question,
      avgScore: data.total / data.count
    }));

    // Return the questions sorted and get the lowest 3 averages
    return scored
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 3)
      .map(entry => ({
        question: entry.question,
        advice: adviceMap[entry.question]
      }));
  }
  const users = readUsersFile();
  const me = users.find(u => u.email === req.session.userEmail);
  const streak = me ? me.currentStreak : 0;


  // Render the home page with the results
  res.render("home", {
    streak,
    overallData: surveyResults.overall,
    mentalData: surveyResults.mental,
    physicalData: surveyResults.physical,
    days: surveyResults.days,
    overallFeedback: getLowestFeedback("general"),
    mentalFeedback: getLowestFeedback("mental"),
    physicalFeedback: getLowestFeedback("physical"),
    calendarTimeline,
    calendarView
  });
});



// Survey route
app.get("/survey", requireLogin, (req, res) => {
  const section = req.query.section || "general";
  const today = new Date().toLocaleDateString("en-CA"); // new

  // Check if the survey was already completed today - new
  const allCompletedToday = 
    userProgress.general === today &&
    userProgress.mental === today &&
    userProgress.physical === today;

  if (allCompletedToday) {
    return res.render("survey", { section: "completed", userProgress });
  }

  // If specific section already completed today
  if (userProgress[section] === today) {
    return res.redirect("/survey-choice");
  }

  // Otherwise, render the survey page
  res.render("survey", { section, userProgress});
});

// Survey choice page
app.get("/survey-choice", requireLogin, (req, res) => {
  res.render("survey-choice", { userProgress });
});

// Handle survey submission and update charts
app.post("/submit-survey", requireLogin, (req, res) => {
  const { section } = req.body;
  const todayDate = new Date().toLocaleDateString("en-CA"); // new
  userProgress[section] = todayDate; //new 
  // userProgress[section] = true; - replaced

  // Get today's day
  const today = new Date().getDay();

  console.log("Today: ", today)
  const yesterday = today === 0 ? 6 : today - 1;
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Fill in all of the survey results with defaults of 5 if no data
  if (surveyResults.days.length === 0 && allResponses.length === 0) {
    while (surveyResults.days.length < yesterday) {
      surveyResults.days.push(weekdays[surveyResults.days.length]); 
      surveyResults.overall.push(5);
      surveyResults.mental.push(5);
      surveyResults.physical.push(5);
    }
  }

  let scores = Object.entries(req.body)
  // Filter through the questions and their advice
    .filter(([key, value]) => key.startsWith("q") && !isNaN(value))
    .map(([key, value], index) => {
      // Get the question index
      const questionIndex = parseInt(key.replace("q", "")) - 1;

      // Define the questions
      const allQuestions = {
        general: [
          "I drink 8 glasses of water daily.",
          "I eat meals regularly.",
          "I feel sluggish and tired most of the time.",
          "I am hopeful about the future.",
          "I am satisfied with my daily life."
        ],
        mental: [
          "I have trouble concentrating.",
          "I feel disconnected from everyone.",
          "I feel like I’m the only one struggling.",
          "I don’t feel I’m as good as everyone.",
          "I’m sad and unhappy all the time."
        ],
        physical: [
          "I use electronic devices after midnight.",
          "I exercise for 30 minutes or more every day.",
          "I go outside for the sun at least 10 minutes a day.",
          "I sleep for 7 to 8 hours.",
          "I drink caffeinated drinks excessively."
        ]
      };

      // Get the question
      const questionText = allQuestions[section][questionIndex];

      // Return formatted question with the score and section
      return {
        section,
        question: questionText,
        score: parseInt(value)
      };
    });

  // Save to response list
  allResponses.push(...scores);

  // Update average score per section
  let avgScore = scores.length > 0
    ? Math.round(scores.reduce((sum, item) => sum + item.score, 0) / scores.length)
    : 0;

  // Get the current day and the next day
  const currentDayIndex = surveyResults.days.length % 7;
  const nextDay = weekdays[currentDayIndex];

  // If it is Sunday and need to loop the chart back, go back to Sunday and reset the chart
  const dateKey = new Date().toLocaleDateString("en-CA");
  updateTimeline(dateKey, section, avgScore);
  if (surveyResults.days.length > 0 && surveyResults.days[surveyResults.days.length - 1] === "Saturday" && nextDay === "Sunday") {    console.log("Resetting chart for new week starting from Sunday");
    
    // Reset the chart while keeping the first Sunday entry
    surveyResults = {
        overall: [],
        mental: [avgScore],
        physical: [avgScore],
        days: []
    };

  }

  surveyResults.days.push(nextDay);

  // Push the scores to their respective sections
  if (section === "general") {
    surveyResults.overall.push(avgScore);
  } else if (section === "mental") {
    surveyResults.mental.push(avgScore);
  } else if (section === "physical") {
    surveyResults.physical.push(avgScore);
  }

  const todayStr = new Date().toLocaleDateString("en-CA");

  const completedAllToday =
  userProgress.general === todayStr &&
  userProgress.mental === todayStr &&
  userProgress.physical === todayStr;

  if (completedAllToday) {
  //update streak for the logged-in user
    updateUserStreakByEmail(req.session.userEmail, todayStr);

  return res.redirect("/survey?section=completed");
}

return res.redirect("/survey-choice");


});



// Handle user login
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  fs.readFile("users.txt", "utf8", (err, data) => {
    if (err) {
      console.log(err);
      return res.send("Error reading user data");
    }

    const users = data
      .split("\n")
      .map(parseUserLine)
      .filter(Boolean);

    const user = users.find(u => u.email === email && u.password === password);

    if (user) {
      // store login in session
      req.session.userEmail = user.email;
      req.session.userName = user.name;

      res.redirect("/home");
    } else {
      res.render("login", { error: "Incorrect credentials. Please try again." });
    }
  });
});


// Handle user signup
app.post("/signup", handleSignup);

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

//games
app.get('/games', (req, res) => {
  res.render('games'); // si usas games.ejs en views/
});

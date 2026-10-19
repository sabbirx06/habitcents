// Habitcents - A habit tracking web application
// This is the main server file that handles all the backend logic

const express = require("express"); // Web framework for Node.js
const path = require("path"); // Node.js utility for working with file paths
const bcrypt = require("bcrypt");
const session = require("express-session"); // Session management for user authentication

function createApp({ db, sessionSecret, sessionStore }) {
  if (!sessionSecret) throw new Error("SESSION_SECRET is required");
  const app = express();
  if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
  if(process.env.NODE_ENV==='production'&&!sessionStore)throw new Error('A persistent session store is required in production.');

  // Preset habits data - predefined habits users can quickly add to their tracking
  // Each habit has a name, difficulty level (1-10), and some have custom display names
  const presetHabits = {
    physical: [
      // Exercise and fitness related habits
      { name: "Walking 10,000 Steps", difficulty: 5 },
      { name: "Going to the gym", difficulty: 7 },
      { name: "Playing football", difficulty: 6 },
    ],
    spiritual: [
      // Mindfulness and spiritual habits
      { name: "Meditation", difficulty: 4 },
      { name: "Prayer", difficulty: 3 },
      { name: "Gratitude Journal", difficulty: 5 },
    ],
    healthy: [
      // Health and wellness habits
      { name: "Drinking Water", difficulty: 2 },
      { name: "Sleep Early", displayName: "Going to sleep early", difficulty: 6 }, // Shows custom display text
      { name: "Eating Healthy", difficulty: 5 },
    ],
  };

  // Middleware setup - these run on every request
  app.use(express.urlencoded({ extended: true })); // Parse form data from POST requests
  app.use(express.json()); // Parse JSON data from AJAX requests
  app.use((req,res,next)=>{
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.get('Origin')){
      try{if(new URL(req.get('Origin')).host!==req.get('host'))return res.status(403).json({error:'Cross-origin mutations are not allowed.'});}
      catch{return res.status(403).json({error:'Invalid request origin.'});}
    }
    next();
  });
  app.use(express.static(path.join(__dirname, "public"))); // Serve static files (CSS, JS, images)
  app.set("view engine", "ejs"); // Set EJS as the template engine for rendering HTML

  // Session configuration - manages user login state across requests
  app.use(
    session({
      secret: sessionSecret,
      resave: false, // Don't save session if it wasn't modified
      saveUninitialized: false, // Only create sessions when needed
      ...(sessionStore?{store:sessionStore}:{}),
      cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:7*86400000},
    }),
  );

  // Middleware function to protect routes that require login
  function requireLogin(req, res, next) {
    if (!req.session.user) {
      // If user is not logged in, redirect to login page with error message
      return res.redirect("/login?error=Please login first");
    }
    next(); // Continue to the next middleware/route handler
  }

  // Helper function for protected page routes - reduces code duplication
  function renderProtectedPage(pageName) {
    return (req, res) => {
      // Render the specified page template with the page name for navigation highlighting
      res.render(pageName, { page: pageName });
    };
  }

  // ================= PAGE ROUTES =================
  // These handle displaying different pages of the application

  app.get("/", (req, res) => {
    // Landing page - shown to visitors who aren't logged in
    res.render("index");
  });

  app.get("/login", (req, res) => {
    // Login page - if user is already logged in, redirect to dashboard
    if (req.session.user) return res.redirect("/dashboard");
    res.render("login", { query: req.query }); // Pass URL query parameters for error messages
  });

  app.get("/signup", (req, res) => {
    // Signup page - if user is already logged in, redirect to dashboard
    if (req.session.user) return res.redirect("/dashboard");
    res.render("signup", { query: req.query }); // Pass URL query parameters for error messages
  });

  app.get("/dashboard", requireLogin, (req, res) => {
    // Main dashboard - requires login, shows user overview
    res.render("dashboard", { user: req.session.user, page: "dashboard" });
  });

  app.get("/profile", requireLogin, (req,res)=>res.render("profile", {user:req.session.user,page:"profile"}));

  // Protected routes using the helper function - all require login
  app.get("/habits", requireLogin, renderProtectedPage("habits")); // Habit tracking page
  app.get("/expenses", requireLogin, renderProtectedPage("expenses")); // Expense tracking page
  app.get("/leaderboard", requireLogin, renderProtectedPage("leaderboard")); // User rankings page
  app.get("/savings", requireLogin, renderProtectedPage("savings")); // Savings goals page

  app.get("/categories", requireLogin, (req, res) => {
    return res.redirect('/habits?presets=1');
  });

  // ================= AUTHENTICATION ROUTES =================
  // These handle user registration and login

  app.post("/signup", async (req, res) => {
    const { name, email, password } = req.body;
    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim() ||
        typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
      return res.redirect('/signup?error=Invalid signup details');
    }
    try {
      const hash = await bcrypt.hash(password, 12);
      await db.query('INSERT INTO users (name,email,password) VALUES ($1,$2,$3)', [name, email, hash]);
      res.redirect('/login?success=Account created successfully');
    } catch (error) {
      res.redirect(error.code === '23505' ? '/signup?error=Email already exists' : '/signup?error=Signup failed');
    }
  });

  app.post("/login", async (req, res, next) => {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) {
      return res.redirect('/login?error=Invalid credentials');
    }
    try {
      const { rows } = await db.query('SELECT * FROM users WHERE email=$1', [email]);
      const user = rows[0];
      if (!user || !/^\$2[ab]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.password) ||
          !(await bcrypt.compare(password, user.password))) {
        return res.redirect('/login?error=Invalid credentials or password reset required');
      }
      req.session.regenerate(error => {
        if (error) return next(error);
        // Never retain the password hash in session storage.
        const { password: ignored, ...safeUser } = user;
        req.session.user = safeUser;
        req.session.save(error => error ? next(error) : res.redirect('/dashboard'));
      });
    } catch (error) { next(error); }
  });

  // Native PostgreSQL queries: values are always bound parameters, never SQL text.
  async function withHabitMutation(userId,mutate){
    const client=await db.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE',[userId]);
      const result=await mutate(client);
      await require('./lib/universal-streak').captureUniversalDay(client,userId);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  app.post('/add-habit', requireLogin, async (req, res) => {
    const { name, difficulty, category } = req.body;
    const score = Number(difficulty);
    if (!name || !Number.isInteger(score) || score < 1 || score > 10) return res.redirect('/habits');
    await withHabitMutation(req.session.user.user_id,client=>client.query('INSERT INTO habits (user_id,habit_name,difficulty_score,category) VALUES ($1,$2,$3,$4)',
      [req.session.user.user_id, name, score, category || null]));
    res.redirect('/habits');
  });

  app.get('/get-habits', requireLogin, async (req, res) => {
    const { rows } = await db.query(`SELECT h.*, CASE WHEN hl.completed_status IS TRUE THEN 1 ELSE 0 END AS completed
      FROM habits h LEFT JOIN habit_logs hl ON h.habit_id=hl.habit_id AND hl.date=CURRENT_DATE
      WHERE h.user_id=$1 AND to_jsonb(h)->>'archived_on' IS NULL
      AND (to_jsonb(h)->'schedule_days' IS NULL OR to_jsonb(h)->'schedule_days' @> to_jsonb(EXTRACT(ISODOW FROM CURRENT_DATE)::integer)) ORDER BY h.habit_id`, [req.session.user.user_id]);
    res.json(rows);
  });

  app.post('/toggle-habit', requireLogin, async (req, res) => {
    if (!/^[1-9]\d{0,18}$/.test(String(req.body.habit_id)) || BigInt(req.body.habit_id) > 9223372036854775807n) {
      return res.status(400).json({ error: 'Invalid habit ID' });
    }
    // Lock the owned parent on one checked-out connection, serializing concurrent toggles.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE',[req.session.user.user_id]);
      const owned = await client.query('SELECT h.* FROM habits h WHERE habit_id=$1 AND user_id=$2 FOR UPDATE',
        [req.body.habit_id, req.session.user.user_id]);
      if (!owned.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Habit not found' });
      }
      const habit=owned.rows[0];
      const {rows:[clock]}=await client.query('SELECT EXTRACT(ISODOW FROM CURRENT_DATE)::integer AS weekday');
      if(habit.archived_on||habit.schedule_days&&!habit.schedule_days.includes(clock.weekday)){
        await client.query('ROLLBACK');return res.status(409).json({error:'Habit is not scheduled today.'});
      }
      const removed = await client.query('DELETE FROM habit_logs WHERE habit_id=$1 AND date=CURRENT_DATE AND completed_status IS TRUE RETURNING log_id', [req.body.habit_id]);
      if (!removed.rows.length) {
        if(habit.target!=null)await client.query('INSERT INTO habit_logs(habit_id,date,completed_status,progress_amount) VALUES($1,CURRENT_DATE,true,$2) ON CONFLICT(habit_id,date) DO UPDATE SET completed_status=true,progress_amount=EXCLUDED.progress_amount',[req.body.habit_id,habit.target]);
        else await client.query('INSERT INTO habit_logs (habit_id,date,completed_status) VALUES ($1,CURRENT_DATE,true) ON CONFLICT(habit_id,date) DO UPDATE SET completed_status=true', [req.body.habit_id]);
      }
      await require('./lib/universal-streak').captureUniversalDay(client,req.session.user.user_id);
      await client.query('COMMIT');
      res.send(removed.rows.length ? 'unchecked' : 'checked');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });

  app.post('/delete-habit', requireLogin, async (req, res) => {
    if (!/^[1-9]\d{0,18}$/.test(String(req.body.habit_id)) || BigInt(req.body.habit_id) > 9223372036854775807n) {
      return res.status(400).json({ error: 'Invalid habit ID' });
    }
    // Cascading FK removes logs only after the owned parent has been selected for deletion.
    const { rows } = await withHabitMutation(req.session.user.user_id,client=>client.query('DELETE FROM habits WHERE habit_id=$1 AND user_id=$2 RETURNING habit_id',
      [req.body.habit_id, req.session.user.user_id]));
    if (!rows.length) return res.status(404).json({ error: 'Habit not found' });
    res.json({ success: true });
  });

  app.get('/reset-habits', requireLogin, async (req, res) => {
    // GET navigation must never destroy data. Use confirmed per-habit actions.
    res.redirect('/habits');
  });

  app.get('/streak', requireLogin, async (req, res) => {
    const { rows } = await db.query(`SELECT COALESCE(SUM(h.difficulty_score),0)::integer AS streak
      FROM habit_logs hl JOIN habits h ON hl.habit_id=h.habit_id
      WHERE h.user_id=$1 AND hl.date=CURRENT_DATE`, [req.session.user.user_id]);
    res.json(rows[0]);
  });

  app.post('/set-budget', requireLogin, async (req, res) => {
    let amount;try{amount=require('./lib/workspaces').money(req.body.amount,true);}catch(e){return res.status(400).json({error:e.message});}
    // Upsert avoids deleting the budget and its linked expense history.
    await db.query(`INSERT INTO budgets (user_id,total_budget,month,year)
      VALUES ($1,$2,EXTRACT(MONTH FROM CURRENT_DATE),EXTRACT(YEAR FROM CURRENT_DATE))
      ON CONFLICT (user_id,month,year) DO UPDATE SET total_budget=EXCLUDED.total_budget`,
      [req.session.user.user_id, amount]);
    res.redirect('/expenses');
  });

  app.get('/get-budget', requireLogin, async (req, res) => {
    const { rows } = await db.query(`SELECT * FROM budgets WHERE user_id=$1
      AND month=EXTRACT(MONTH FROM CURRENT_DATE) AND year=EXTRACT(YEAR FROM CURRENT_DATE)`, [req.session.user.user_id]);
    res.json(rows[0] || { total_budget: 0 });
  });

  app.get('/reset-budget', requireLogin, async (req, res) => {
    // Budget editing uses a non-destructive upsert, never navigation side effects.
    res.redirect('/expenses');
  });

  app.get('/remaining-budget', requireLogin, async (req, res) => {
    const { rows } = await db.query(`SELECT b.total_budget::double precision AS total,
      (SELECT COALESCE(SUM(amount),0)::double precision FROM expenses WHERE user_id=$1
        AND date >= date_trunc('month',CURRENT_DATE)::date
        AND date < (date_trunc('month',CURRENT_DATE)+INTERVAL '1 month')::date) AS spent
      FROM budgets b WHERE b.user_id=$1 AND b.month=EXTRACT(MONTH FROM CURRENT_DATE)
        AND b.year=EXTRACT(YEAR FROM CURRENT_DATE)`, [req.session.user.user_id]);
    if (!rows.length) return res.json({ remaining: 0, totalBudget: 0, hasBudget: false });
    res.json({ remaining: rows[0].total - rows[0].spent, totalBudget: rows[0].total, hasBudget: true });
  });

  app.post('/add-expense', requireLogin, async (req, res) => {
    const date = req.body.date === undefined ? null : req.body.date;
    if (date !== null && !require('./lib/calendar-date').validDate(date)) return res.status(400).json({error:'Choose a valid expense date.'});
    if (req.body.date === null) return res.status(400).json({error:'Choose a valid expense date.'});
    const category=require('./lib/expense-category').parseCategory(req.body.category);
    const amount = Number(req.body.amount);
    const wantsJson = req.is('application/json') || req.get('Accept')?.includes('application/json');
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!category) return res.status(400).json({error:'Choose a valid expense category.'});
    if (!name || name.length>255 || !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(String(req.body.amount)) || !Number.isFinite(amount) || amount <= 0) {
      if (wantsJson) return res.status(400).json({ error: 'Enter a description and a valid amount.' });
      return res.redirect('/expenses');
    }
    let inserted;
    try{
      const categorized = category !== 'uncategorized';
      inserted=await db.query(`INSERT INTO expenses (user_id,budget_id,date,description,amount${categorized?',category':''})
        SELECT $1,budget_id,COALESCE($4::date,CURRENT_DATE),$2,$3${categorized?',$5':''} FROM budgets WHERE user_id=$1
        AND month=EXTRACT(MONTH FROM COALESCE($4::date,CURRENT_DATE))
        AND year=EXTRACT(YEAR FROM COALESCE($4::date,CURRENT_DATE)) RETURNING expense_id,date::text AS date`,
        [req.session.user.user_id,name,amount,date,...(categorized?[category]:[])]);
    }catch(error){if(error.code==='42703')return res.status(503).json({error:'Expense category storage is not set up. Apply the expense-category migration before saving categorized entries.'});throw error;}
    if (wantsJson) {
      if (!inserted.rows.length) return res.status(409).json({ error: 'Set a budget for the selected month in Expenses before adding an expense.' });
      return res.status(201).json({ success: true, date: inserted.rows[0].date });
    }
    res.redirect('/expenses');
  });

  app.get('/get-expenses', requireLogin, async (req, res) => {
    const { rows } = await db.query(`SELECT expense_id,user_id,budget_id,date::text AS date,description,amount,${require('./lib/expense-category').categorySql} AS category FROM expenses e WHERE user_id=$1 ORDER BY date DESC, expense_id DESC`, [req.session.user.user_id]);
    res.json(rows);
  });

  app.post('/delete-expense', requireLogin, async (req, res) => {
    if(!/^[1-9]\d*$/.test(String(req.body.expense_id)))return res.status(400).json({error:'Invalid expense ID.'});
    const {rows}=await db.query('DELETE FROM expenses WHERE expense_id=$1 AND user_id=$2 RETURNING expense_id', [req.body.expense_id, req.session.user.user_id]);
    if(!rows.length)return res.status(404).json({error:'Expense not found.'});
    res.json({ success: true });
  });

  app.get('/dashboard-data', requireLogin, async (req, res) => {
    const { rows } = await db.query(`SELECT
      CURRENT_DATE::text AS "currentDate",
      EXISTS(SELECT 1 FROM budgets WHERE user_id=$1 AND month=EXTRACT(MONTH FROM CURRENT_DATE)
        AND year=EXTRACT(YEAR FROM CURRENT_DATE)) AS "hasBudget",
      (SELECT COUNT(*)::integer FROM habits h WHERE user_id=$1 AND to_jsonb(h)->>'archived_on' IS NULL AND (to_jsonb(h)->'schedule_days' IS NULL OR to_jsonb(h)->'schedule_days' @> to_jsonb(EXTRACT(ISODOW FROM CURRENT_DATE)::integer))) AS "totalHabits",
      (SELECT COUNT(*)::integer FROM habit_logs hl JOIN habits h ON hl.habit_id=h.habit_id
        WHERE h.user_id=$1 AND hl.date=CURRENT_DATE AND hl.completed_status IS TRUE AND to_jsonb(h)->>'archived_on' IS NULL AND (to_jsonb(h)->'schedule_days' IS NULL OR to_jsonb(h)->'schedule_days' @> to_jsonb(EXTRACT(ISODOW FROM CURRENT_DATE)::integer))) AS completed,
      COALESCE((SELECT total_budget FROM budgets WHERE user_id=$1
        AND month=EXTRACT(MONTH FROM CURRENT_DATE) AND year=EXTRACT(YEAR FROM CURRENT_DATE)),0)::double precision AS "totalBudget",
      (SELECT COALESCE(SUM(amount),0)::double precision FROM expenses WHERE user_id=$1
        AND date >= date_trunc('month',CURRENT_DATE)::date
        AND date < (date_trunc('month',CURRENT_DATE)+INTERVAL '1 month')::date) AS spent`, [req.session.user.user_id]);
    const { spent, ...summary } = rows[0];
    // Explicit summary contract: existence comes from the owned monthly budget row,
    // including a valid zero budget, never inferred from the monetary amount.
    res.json({ currentDate: summary.currentDate, hasBudget: summary.hasBudget,
      totalHabits: summary.totalHabits, completed: summary.completed,
      totalBudget: summary.totalBudget, remaining: summary.totalBudget - spent });
  });

  app.get('/universal-streak',requireLogin,async(req,res)=>{
    const {validDate}=require('./lib/calendar-date');
    if(req.query.date!==undefined&&!validDate(req.query.date))return res.status(400).json({error:'Choose a valid date.'});
    res.json(await require('./lib/universal-streak').readUniversalStreak(db,req.session.user.user_id,req.query.date));
  });
  // Read-only date views. Habit schedules and deleted history are not reconstructed.
  app.get('/dashboard-history', requireLogin, async(req,res)=>{
    const {validDate}=require('./lib/calendar-date');
    const {date,section}=req.query;
    if(!validDate(date) || !['habits','expenses'].includes(section))return res.status(400).json({error:'Enter a valid calendar date and section.'});
    const owner=req.session.user.user_id;
    if(section==='habits'){
      const {rows}=await db.query(`SELECT h.habit_id,h.habit_name FROM habit_logs hl JOIN habits h ON h.habit_id=hl.habit_id
        WHERE h.user_id=$1 AND hl.date=$2::date AND hl.completed_status IS TRUE ORDER BY h.habit_id`,[owner,date]);
      return res.json({date,completions:rows});
    }
    const {rows}=await db.query(`SELECT expense_id,description,amount,date::text AS date,${require('./lib/expense-category').categorySql} AS category,
      SUM(amount) OVER ()::text AS total FROM expenses e WHERE user_id=$1 AND date=$2::date ORDER BY expense_id DESC`,[owner,date]);
    res.json({date,spent:rows[0]?.total || '0.00',expenses:rows.map(({total,...expense})=>expense)});
  });
  app.get('/dashboard-activity', requireLogin, async(req,res)=>{
    const {validMonth}=require('./lib/calendar-date');const {month}=req.query;
    if(!validMonth(month))return res.status(400).json({error:'Enter a valid calendar month.'});
    const {rows}=await db.query(`SELECT date::text AS date,SUM(completions)::integer AS completions,SUM(expenses)::integer AS expenses FROM (
      SELECT hl.date,COUNT(*)::integer AS completions,0 AS expenses FROM habit_logs hl JOIN habits h ON h.habit_id=hl.habit_id
      WHERE h.user_id=$1 AND hl.completed_status IS TRUE AND hl.date>=$2::date AND hl.date<($2::date+INTERVAL '1 month') GROUP BY hl.date
      UNION ALL SELECT date,0,COUNT(*)::integer FROM expenses WHERE user_id=$1 AND date>=$2::date AND date<($2::date+INTERVAL '1 month') GROUP BY date
      ) activity GROUP BY date ORDER BY date`,[req.session.user.user_id,month+'-01']);
    res.json({month,days:rows});
  });

  app.get('/dashboard-spending',requireLogin,async(req,res)=>{
    const {validDate}=require('./lib/calendar-date'),{end}=req.query;
    if(!validDate(end))return res.status(400).json({error:'Choose a valid end date.'});
    const start=end.slice(0,7)+'-01';
    const {rows}=await db.query(`SELECT date::text AS date,SUM(amount)::text AS amount,COUNT(*)::integer AS count,SUM(SUM(amount)) OVER()::text AS total
      FROM expenses WHERE user_id=$1 AND date>=$2::date AND date<=$3::date GROUP BY date ORDER BY date`,[req.session.user.user_id,start,end]);
    res.json({range:{startDate:start,endDate:end},total:rows[0]?.total||'0.00',days:rows.map(({total,...day})=>day)});
  });
  app.get('/dashboard-breakdown',requireLogin,async(req,res)=>{
    const {validDate,validMonth}=require('./lib/calendar-date'),{date,month}=req.query;
    if((date!==undefined)===(month!==undefined)||date!==undefined&&!validDate(date)||month!==undefined&&!validMonth(month))return res.status(400).json({error:'Choose exactly one valid date or month.'});
    const start=date||month+'-01',kind=date?'day':'month';
    const {rows:bounds}=await db.query(`SELECT $1::date::text AS start,($1::date+CASE WHEN $2='day' THEN INTERVAL '1 day' ELSE INTERVAL '1 month' END-INTERVAL '1 day')::date::text AS end`,[start,kind]);
    const {rows}=await db.query(`SELECT CASE WHEN to_jsonb(e)->>'category' IN ('transport','food','subscriptions','shopping') THEN to_jsonb(e)->>'category' ELSE 'uncategorized' END AS category,SUM(amount)::text AS amount,COUNT(*)::integer AS count,SUM(SUM(amount)) OVER()::text AS total
      FROM expenses e WHERE user_id=$1 AND date>=$2::date AND date<=$3::date GROUP BY 1 ORDER BY 1`,[req.session.user.user_id,start,bounds[0].end]);
    res.json({range:{startDate:start,endDate:bounds[0].end,kind},total:rows[0]?.total||'0.00',categories:rows.map(({total,...category})=>category)});
  });
  app.get('/dashboard-continuity',requireLogin,async(req,res)=>{
    const {validDate}=require('./lib/calendar-date'),{habitId,end}=req.query;
    if(!validDate(end)||typeof habitId!=='string'||!/^\d+$/.test(habitId)||!Number.isSafeInteger(Number(habitId))||Number(habitId)<1)return res.status(400).json({error:'Choose a valid habit and end date.'});
    const {rows:habits}=await db.query('SELECT habit_id,habit_name FROM habits WHERE habit_id=$1 AND user_id=$2',[habitId,req.session.user.user_id]);
    if(!habits.length)return res.status(404).json({error:'Habit not found.'});
    const {rows:bounds}=await db.query(`SELECT GREATEST('0001-01-01'::date,date_trunc('week',$1::date)::date-175)::text AS start,CURRENT_DATE::text AS today`,[end]);
    const {rows}=await db.query(`SELECT hl.date::text AS date FROM habit_logs hl JOIN habits h ON h.habit_id=hl.habit_id
      WHERE h.user_id=$1 AND h.habit_id=$2 AND hl.completed_status IS TRUE AND hl.date>=$3::date AND hl.date<=$4::date AND hl.date<=CURRENT_DATE ORDER BY hl.date`,[req.session.user.user_id,habitId,bounds[0].start,end]);
    res.json({habit:{id:habits[0].habit_id,name:habits[0].habit_name,createdDate:null},startDate:bounds[0].start,endDate:end,currentDate:bounds[0].today,completedDates:rows.map(row=>row.date),streak:null,streakNote:'Streak unavailable: habit start dates and schedules are not recorded.'});
  });

  app.get('/get-leaderboard', requireLogin, async (req, res) => {
    const { rows } = await db.query(`SELECT u.name,u.user_id,
      COALESCE(SUM(CASE WHEN hl.habit_id IS NOT NULL THEN h.difficulty_score ELSE 0 END),0)::integer AS streak_points
      FROM users u LEFT JOIN habits h ON h.user_id=u.user_id
      LEFT JOIN habit_logs hl ON hl.habit_id=h.habit_id AND hl.date=CURRENT_DATE
      GROUP BY u.user_id,u.name ORDER BY streak_points DESC,u.user_id LIMIT 20`, []);
    res.json({ leaderboard: rows, currentUserId: req.session.user.user_id });
  });

  app.post('/add-goal', requireLogin, async (req, res) => {
    let target;try{target=require('./lib/workspaces').money(req.body.target);}catch(e){return res.status(400).json({error:e.message});}
    if(typeof req.body.name!=='string'||!req.body.name.trim()||req.body.name.trim().length>100)return res.status(400).json({error:'Enter a goal name.'});
    await db.query('INSERT INTO savings_goals (user_id,name,target_amount) VALUES ($1,$2,$3)', [req.session.user.user_id, req.body.name.trim(), target]);
    res.redirect('/savings');
  });

  app.get('/savings-data', requireLogin, async (req, res) => {
    const { rows } = await db.query("SELECT * FROM savings_goals g WHERE user_id=$1 AND COALESCE((to_jsonb(g)->>'archived')::boolean,false) IS FALSE ORDER BY goal_id", [req.session.user.user_id]);
    res.json(rows);
  });

  app.post('/add-saving', requireLogin, async (req, res) => {
    let amount;try{amount=require('./lib/workspaces').money(req.body.amount);}catch(e){return res.status(400).json({error:e.message});}
    const {rows}=await db.query("UPDATE savings_goals g SET saved_amount=COALESCE(saved_amount,0)+$1 WHERE goal_id=$2 AND user_id=$3 AND COALESCE((to_jsonb(g)->>'archived')::boolean,false) IS FALSE AND COALESCE(saved_amount,0)+$1<=99999999.99 RETURNING goal_id",
      [amount, req.body.goal_id, req.session.user.user_id]);
    if(!rows.length)return res.status(404).json({error:'Goal unavailable.'});
    res.redirect('/savings');
  });

  app.get("/logout", (req, res) => {
    // Destroy user session and redirect to login
    req.session.destroy((err) => {
      if (err) {
        return res.redirect("/dashboard");
      }
      res.redirect("/login?success=Logged out successfully");
    });
  });

  require('./lib/workspaces').registerWorkspaces(app,{db,requireLogin,presets:presetHabits});

  // Express 5 forwards async rejections here; never leak SQL or connection details.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Database error' });
  });
  return app;
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const { createPool } = require('./db');
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error('SESSION_SECRET is required');
  const db = createPool();
  const sessionStore=process.env.NODE_ENV==='production'?new (require('./lib/session-store').PostgresSessionStore)(db):undefined;
  const app = createApp({ db, sessionSecret,sessionStore });
  app.listen(process.env.PORT || 3000, () => console.log('HabitCents server started'));
}
module.exports = { createApp };

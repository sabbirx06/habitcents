const { validDate, validMonth } = require("./calendar-date");
const { parseCategory, categorySql } = require("./expense-category");
const {DAY} = require('./tracking-clock');
const HABIT_COLORS = ["lavender", "blue", "lime", "peach", "pink", "coral", "teal", "yellow", "mint", "lilac"];
const ICONS = ["check", "book", "walk", "water", "leaf", "focus", "heart", "sun", "dumbbell", "music", "food", "sleep", "code"];
function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function id(value) {
  if (!/^[1-9]\d{0,15}$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    fail("Invalid record ID.");
  return Number(value);
}
function text(value, max = 255) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail("Enter a valid name or description.");
  return value.trim();
}
function money(value, zero = false) {
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(String(value)) || (!zero && Number(value) <= 0))
    fail("Enter a valid amount with at most two decimal places.");
  return Number(value);
}
function date(value) {
  if (!validDate(value)) fail("Choose a valid calendar date.");
  return value;
}
function habitInput(body) {
  const days = body.schedule_days;
  if (
    !Array.isArray(days) ||
    !days.length ||
    days.some((d) => !Number.isInteger(d) || d < 1 || d > 7) ||
    new Set(days).size !== days.length
  )
    fail("Select at least one weekday.");
  const target = body.target === "" || body.target == null ? null : money(body.target);
  return {
    name: text(body.name),
    description: typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "",
    category: body.category ? text(body.category, 50) : null,
    icon: ICONS.includes(body.icon) ? body.icon : "check",
    color: HABIT_COLORS.includes(body.color) ? body.color : "lavender",
    days: [...days].sort(),
    target,
    unit: target ? text(body.unit, 40) : null,
  };
}
function nextPayment(current, frequency, anchor) {
  const [y, m, d] = current.split("-").map(Number),
    a = anchor.split("-").map(Number);
  let day = new Date(Date.UTC(y, m - 1, d, 12));
  if (frequency === "weekly") day.setUTCDate(day.getUTCDate() + 7);
  else {
    const year = y + (frequency === "yearly" ? 1 : 0),
      month = frequency === "yearly" ? a[1] - 1 : m;
    const end = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    day = new Date(Date.UTC(year, month, Math.min(a[2], end), 12));
  }
  return day.toISOString().slice(0, 10);
}
async function transaction(db, run) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
function registerWorkspaces(app, { db, requireLogin, presets }) {
  const route = (method, path, run) =>
    app[method]("/api/" + path, requireLogin, async (req, res) => {
      try {
        res.json(await run(req, req.session.user.user_id));
      } catch (e) {
        if (e.status) return res.status(e.status).json({ error: e.message });
        if (["42P01", "42703"].includes(e.code))
          return res
            .status(503)
            .json({
              error:
                path.startsWith('budget/additions')
                  ? "Budget additions are not available yet. You can still set the monthly budget."
                  : "This feature needs the reviewed workspace migration. Existing records are unchanged.",
              setupRequired: true,
            });
        throw e;
      }
    });
  const today = async (client) =>
    (await client.query(`SELECT ${DAY}::text AS today`)).rows[0].today;
  const lock = async (client, user) =>
    client.query("SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE", [user]);
  const capture = async (client, user) =>
    require("./universal-streak").captureUniversalDay(client, user);
  async function version(client, habit) {
    await client.query(
      `INSERT INTO habit_schedule_versions(habit_id,effective_on,schedule_days,target,unit,archived) SELECT habit_id,${DAY},schedule_days,target,unit,archived_on IS NOT NULL FROM habits WHERE habit_id=$1 ON CONFLICT(habit_id,effective_on) DO UPDATE SET schedule_days=EXCLUDED.schedule_days,target=EXCLUDED.target,unit=EXCLUDED.unit,archived=EXCLUDED.archived`,
      [habit],
    );
  }
  route("get", "habits", async (req, user) => {
    const day = await today(db);
    const { rows } = await db.query(
      `SELECT h.*,to_jsonb(h)->>'created_on' AS created_on,to_jsonb(h)->>'archived_on' AS archived_on,COALESCE(l.completed_status,false) AS completed,to_jsonb(l)->>'progress_amount' AS progress_amount,
   COALESCE(to_jsonb(h)->'schedule_days','[1,2,3,4,5,6,7]'::jsonb) @> to_jsonb(EXTRACT(ISODOW FROM ${DAY})::integer) AND to_jsonb(h)->>'archived_on' IS NULL AS due_today
   FROM habits h LEFT JOIN habit_logs l ON l.habit_id=h.habit_id AND l.date=${DAY} WHERE h.user_id=$1 ORDER BY h.habit_id`,
      [user],
    );
    let categories;
    try {
      categories = (
        await db.query("SELECT * FROM habit_categories WHERE user_id=$1 ORDER BY name", [user])
      ).rows;
    } catch (e) {
      if (e.code !== "42P01") throw e;
      categories = [...new Set(rows.map((h) => h.category).filter(Boolean))].map((name, i) => ({
        category_id: -(i + 1),
        name,
      }));
    }
    const streak = await require("./universal-streak").readUniversalStreak(db, user);
    return {
      today: day,
      habits: rows.map((h) => ({
        ...h,
        schedule_days: h.schedule_days || [1, 2, 3, 4, 5, 6, 7],
        target: h.target ?? null,
      })),
      categories,
      presets,
      streak,
    };
  });
  route("post", "habits/save", async (req, user) => {
    const h = habitInput(req.body),
      habit = req.body.habit_id ? id(req.body.habit_id) : null;
    return transaction(db, async (client) => {
      await lock(client, user);
      let rows;
      if (habit)
        ({ rows } = await client.query(
          `UPDATE habits SET habit_name=$1,description=$2,category=$3,icon=$4,color=$5,schedule_days=$6,target=$7,unit=$8 WHERE habit_id=$9 AND user_id=$10 RETURNING habit_id`,
          [
            h.name,
            h.description,
            h.category,
            h.icon,
            h.color,
            h.days,
            h.target,
            h.unit,
            habit,
            user,
          ],
        ));
      else
        ({ rows } = await client.query(
          `INSERT INTO habits(user_id,habit_name,difficulty_score,description,category,icon,color,schedule_days,target,unit,created_on) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,${DAY}) RETURNING habit_id`,
          [user, h.name, h.description, h.category, h.icon, h.color, h.days, h.target, h.unit],
        ));
      if (!rows.length) fail("Habit not found.", 404);
      const key = rows[0].habit_id;
      if (h.category)
        await client.query(
          "INSERT INTO habit_categories(user_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [user, h.category],
        );
      await version(client, key);
      // Only today's quantitative completion is reconsidered when its target changes.
      await client.query(
        `UPDATE habit_logs SET completed_status=CASE WHEN $2::numeric IS NULL THEN completed_status ELSE COALESCE(progress_amount,0)>=$2 END WHERE habit_id=$1 AND date=${DAY}`,
        [key, h.target],
      );
      await capture(client, user);
      return { success: true, habit_id: key };
    });
  });
  route("post", "habits/archive", async (req, user) =>
    transaction(db, async (client) => {
      await lock(client, user);
      if (typeof req.body.archived !== "boolean") fail("Choose an archive state.");
      const { rows } = await client.query(
        `UPDATE habits SET archived_on=CASE WHEN $3 THEN ${DAY} ELSE NULL END WHERE habit_id=$1 AND user_id=$2 RETURNING habit_id`,
        [id(req.body.habit_id), user, req.body.archived],
      );
      if (!rows.length) fail("Habit not found.", 404);
      await version(client, rows[0].habit_id);
      await capture(client, user);
      return { success: true };
    }),
  );
  route("post", "habits/streak/start", async (req, user) =>
    transaction(db, async (client) => {
      if (req.body.confirm !== true) fail("Confirm forward-only streak tracking.");
      await lock(client, user);
      const {
        rows: [existing],
      } = await client.query(
        "SELECT * FROM universal_streak_enrollments WHERE user_id=$1 FOR UPDATE",
        [user],
      );
      if (existing)
        fail(
          "An existing enrollment needs review; its historical snapshots will not be replaced.",
          409,
        );
      // Tracking SQL uses the explicit Asia/Dhaka day even if a pooler reports UTC.
      await client.query(
        `INSERT INTO universal_streak_enrollments(user_id,starts_on,empty_day_policy,day_change_policy,policies_confirmed,time_zone,capture_version) VALUES($1,${DAY},'reset','apply',true,'Asia/Dhaka',1)`,
        [user],
      );
      await capture(client, user);
      return { success: true };
    }),
  );
  route("post", "habits/progress", async (req, user) =>
    transaction(db, async (client) => {
      await lock(client, user);
      const habit = id(req.body.habit_id),
        day = date(req.body.date),
        current = await today(client);
      if (day !== current) fail("Past records are read-only. Record progress for today.");
      const {
        rows: [h],
      } = await client.query(
        `SELECT h.* FROM habits h WHERE habit_id=$1 AND user_id=$2 AND to_jsonb(h)->>'archived_on' IS NULL FOR UPDATE`,
        [habit, user],
      );
      if (!h) fail("Habit not found.", 404);
      const dow = new Date(day + "T12:00:00Z").getUTCDay() || 7;
      if (h.schedule_days && !h.schedule_days.includes(dow))
        fail("This habit is not scheduled today.");
      let progress = null,
        completed;
      if (h.target != null) {
        progress = money(req.body.progress, true);
        completed = progress >= Number(h.target);
      } else {
        if (typeof req.body.completed !== "boolean") fail("Choose a completion state.");
        completed = req.body.completed;
      }
      // Keep explicit false/partial records so unknown history is never called missed.
      if (Object.hasOwn(h, "target"))
        await client.query(
          `INSERT INTO habit_logs(habit_id,date,completed_status,progress_amount) VALUES($1,$2::date,$3,$4) ON CONFLICT(habit_id,date) DO UPDATE SET completed_status=EXCLUDED.completed_status,progress_amount=EXCLUDED.progress_amount`,
          [habit, day, completed, progress],
        );
      else
        await client.query(
          `INSERT INTO habit_logs(habit_id,date,completed_status) VALUES($1,$2::date,$3) ON CONFLICT(habit_id,date) DO UPDATE SET completed_status=EXCLUDED.completed_status`,
          [habit, day, completed],
        );
      await capture(client, user);
      return { success: true, completed, progress };
    }),
  );
  route("get", "habits/history", async (req, user) => {
    const habit = id(req.query.habitId),
      end = date(req.query.end),
      start = date(req.query.start);
    if (start > end || new Date(end + "T12:00Z") - new Date(start + "T12:00Z") > 366 * 86400000)
      fail("Choose at most one year of history.");
    const {
      rows: [h],
    } = await db.query(
      "SELECT h.*,to_jsonb(h)->>'created_on' AS created_on,to_jsonb(h)->>'archived_on' AS archived_on FROM habits h WHERE habit_id=$1 AND user_id=$2",
      [habit, user],
    );
    if (!h) fail("Habit not found.", 404);
    const { rows: records } = await db.query(
      "SELECT l.date::text,l.completed_status,to_jsonb(l)->>'progress_amount' AS progress_amount FROM habit_logs l WHERE habit_id=$1 AND date BETWEEN $2::date AND $3::date ORDER BY date",
      [habit, start.slice(0,4)+'-01-01', end],
    );
    let versions;
    try {
      versions = (
        await db.query(
          "SELECT v.*,v.effective_on::text AS effective_on FROM habit_schedule_versions v WHERE habit_id=$1 ORDER BY v.effective_on",
          [habit],
        )
      ).rows;
    } catch (e) {
      if (e.code !== "42P01") throw e;
      versions = [];
    }
    const current=await today(db);
    return { habit: h, startDate: start, endDate: end, today: current, records:records.filter(r=>r.date>=start), versions, periods:require('./habit-service').quotaHistory(versions,records,start,end,current) };
  });
  route("post", "habit-categories", async (req, user) => {
    const name = text(req.body.name, 50);
    await db.query(
      "INSERT INTO habit_categories(user_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [user, name],
    );
    return { success: true };
  });
  route("post", "habit-categories/delete", async (req, user) =>
    transaction(db, async (client) => {
      const { rows } = await client.query(
        "DELETE FROM habit_categories WHERE category_id=$1 AND user_id=$2 RETURNING name",
        [id(req.body.category_id), user],
      );
      if (!rows.length) fail("Category not found.", 404);
      await client.query("UPDATE habits SET category=NULL WHERE user_id=$1 AND category=$2", [
        user,
        rows[0].name,
      ]);
      return { success: true };
    }),
  );
  route("post", "presets/remove", async (req, user) =>
    transaction(db, async (client) => {
      await lock(client, user);
      const name = text(req.body.name);
      const { rows } = await client.query(
        "SELECT habit_id FROM habits WHERE user_id=$1 AND habit_name=$2",
        [user, name],
      );
      if (rows.length !== 1)
        fail(
          rows.length ? "Multiple matching habits: manage them individually." : "Habit not found.",
          409,
        );
      await client.query("DELETE FROM habits WHERE habit_id=$1 AND user_id=$2", [
        rows[0].habit_id,
        user,
      ]);
      await capture(client, user);
      return { success: true };
    }),
  );
  route("get", "expenses", async (req, user) => {
    if (!validMonth(req.query.month)) fail("Choose a valid month.");
    const month = req.query.month;
    const { rows: [snapshot] } = await db.query(
      `SELECT ${DAY}::text AS today,
       COALESCE((SELECT jsonb_agg(e ORDER BY date DESC,expense_id DESC) FROM (SELECT e.expense_id,e.description,e.date::text,e.amount,${categorySql} AS category,to_jsonb(e)->'recurring_id' AS recurring_id FROM expenses e WHERE user_id=$1 AND date>=$2::date AND date<($2::date+INTERVAL '1 month')) e),'[]'::jsonb) AS expenses,
       (SELECT total_budget FROM budgets WHERE user_id=$1 AND month=EXTRACT(MONTH FROM $2::date) AND year=EXTRACT(YEAR FROM $2::date)) AS budget`,
      [user, month + "-01"],
    );
    return { month, ...snapshot };
  });
  route("post", "budget", async (req, user) => {
    if (!validMonth(req.body.month)) fail("Choose a valid month.");
    const amount = money(req.body.amount, true);
    await transaction(db, async client => {
      await lock(client, user);
      await client.query(
        "INSERT INTO budgets(user_id,total_budget,month,year) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,month,year) DO UPDATE SET total_budget=EXCLUDED.total_budget",
        [user, amount, Number(req.body.month.slice(5)), Number(req.body.month.slice(0, 4))],
      );
    });
    return { success: true };
  });
  route("get", "budget/additions", async (req, user) => {
    if (!validMonth(req.query.month)) fail("Choose a valid month.");
    const {rows} = await db.query(
      `SELECT a.addition_id,a.amount,a.source,a.date::text FROM budget_additions a
       JOIN budgets b ON b.budget_id=a.budget_id AND b.user_id=a.user_id
       WHERE a.user_id=$1 AND b.month=$2 AND b.year=$3
       ORDER BY a.addition_id DESC LIMIT 20`,
      [user, Number(req.query.month.slice(5)), Number(req.query.month.slice(0,4))],
    );
    return {month:req.query.month,additions:rows};
  });
  route("post", "budget/additions", async (req, user) => {
    const month=req.body.month, amount=money(req.body.amount), source=text(req.body.source), day=date(req.body.date), key=req.body.request_key;
    if (!validMonth(month) || day.slice(0,7)!==month) fail("Choose a date within the selected budget month.");
    if (typeof key!=='string' || !/^[a-zA-Z0-9-]{16,64}$/.test(key)) fail("Invalid save request. Reopen Add money and try again.");
    return transaction(db, async client => {
      await lock(client,user);
      if(day>await today(client)) fail("Choose today or an earlier date.");
      const {rows:[existing]}=await client.query(
        `SELECT a.amount,a.source,a.date::text,b.month,b.year FROM budget_additions a
         JOIN budgets b ON b.budget_id=a.budget_id AND b.user_id=a.user_id
         WHERE a.user_id=$1 AND a.request_key=$2`,[user,key]);
      if(existing){
        if(Number(existing.amount)!==amount || existing.source!==source || existing.date!==day || existing.month!==Number(month.slice(5)) || existing.year!==Number(month.slice(0,4))) fail("This save request was already used for different details.",409);
        return {success:true};
      }
      const {rows:[budget]}=await client.query(
        `INSERT INTO budgets(user_id,total_budget,month,year) VALUES($1,$2,$3,$4)
         ON CONFLICT(user_id,month,year) DO UPDATE SET total_budget=budgets.total_budget+EXCLUDED.total_budget
         WHERE budgets.total_budget+EXCLUDED.total_budget<=99999999.99 RETURNING budget_id`,
        [user,amount,Number(month.slice(5)),Number(month.slice(0,4))]);
      if(!budget) fail("The resulting budget exceeds Tk 99,999,999.99.");
      await client.query(
        'INSERT INTO budget_additions(user_id,budget_id,amount,source,date,request_key) VALUES($1,$2,$3,$4,$5::date,$6)',
        [user,budget.budget_id,amount,source,day,key]);
      return {success:true};
    });
  });
  route("post", "expenses/save", async (req, user) =>
    transaction(db, async (client) => {
      const name = text(req.body.name),
        amount = money(req.body.amount),
        day = date(req.body.date),
        category = parseCategory(req.body.category),
        expense = req.body.expense_id ? id(req.body.expense_id) : null;
      if (!category) fail("Choose a valid category.");
      if (expense) {
        const { rows } = await client.query(
          "SELECT expense_id FROM expenses WHERE expense_id=$1 AND user_id=$2 FOR UPDATE",
          [expense, user],
        );
        if (!rows.length) fail("Expense not found.", 404);
      }
      const {
        rows: [budget],
      } = await client.query(
        "SELECT budget_id FROM budgets WHERE user_id=$1 AND month=$2 AND year=$3",
        [user, Number(day.slice(5, 7)), Number(day.slice(0, 4))],
      );
      if (!budget) fail("Set a budget for the selected month first.", 409);
      const params = [user, budget.budget_id, day, name, amount, category];
      let rows;
      if (expense)
        ({ rows } = await client.query(
          "UPDATE expenses SET budget_id=$2,date=$3::date,description=$4,amount=$5,category=$6 WHERE user_id=$1 AND expense_id=$7 RETURNING expense_id",
          [...params, expense],
        ));
      else
        ({ rows } = await client.query(
          "INSERT INTO expenses(user_id,budget_id,date,description,amount,category) VALUES($1,$2,$3::date,$4,$5,$6) RETURNING expense_id",
          params,
        ));
      return { success: true, expense_id: rows[0].expense_id };
    }),
  );
  route("get", "recurring", async (req, user) => {
    const { rows } = await db.query(
      `SELECT r.*,r.starts_on::text AS starts_on,r.next_due::text AS next_due,r.ends_on::text AS ends_on,
       payment.date::text AS last_paid_on,payment.scheduled_for::text AS last_paid_for
       FROM recurring_expenses r LEFT JOIN LATERAL (
        SELECT e.date,e.scheduled_for FROM expenses e WHERE e.user_id=r.user_id AND e.recurring_id=r.recurring_id
        ORDER BY e.scheduled_for DESC NULLS LAST,e.expense_id DESC LIMIT 1
       ) payment ON true WHERE r.user_id=$1 ORDER BY r.next_due,r.recurring_id`,
      [user],
    );
    return { today: await today(db), definitions: rows };
  });
  route("post", "recurring/save", async (req, user) => {
    const name = text(req.body.name),
      amount = money(req.body.amount),
      category = parseCategory(req.body.category),
      frequency = req.body.frequency,
      start = date(req.body.starts_on),
      end = req.body.ends_on ? date(req.body.ends_on) : null;
    if (!category || !["weekly", "monthly", "yearly"].includes(frequency) || (end && end < start))
      fail("Choose a valid category, frequency, and date range.");
    if (req.body.recurring_id) {
      const { rows } = await db.query(
        "UPDATE recurring_expenses SET name=$1,amount=$2,category=$3,frequency=$4,starts_on=$5::date,ends_on=$6::date,next_due=GREATEST(next_due,$5::date),enabled=$7 WHERE recurring_id=$8 AND user_id=$9 RETURNING recurring_id",
        [
          name,
          amount,
          category,
          frequency,
          start,
          end,
          req.body.enabled !== false,
          id(req.body.recurring_id),
          user,
        ],
      );
      if (!rows.length) fail("Recurring expense not found.", 404);
    } else
      await db.query(
        "INSERT INTO recurring_expenses(user_id,name,amount,category,frequency,starts_on,next_due,ends_on) VALUES($1,$2,$3,$4,$5,$6::date,$6::date,$7::date)",
        [user, name, amount, category, frequency, start, end],
      );
    return { success: true };
  });
  route("post", "recurring/delete", async (req, user) =>
    transaction(db, async (client) => {
      const recurringId=id(req.body.recurring_id);
      const {rows}=await client.query('SELECT recurring_id FROM recurring_expenses WHERE recurring_id=$1 AND user_id=$2 FOR UPDATE',[recurringId,user]);
      if(!rows.length)fail('Recurring expense not found.',404);
      await client.query('UPDATE expenses SET recurring_id=NULL WHERE recurring_id=$1 AND user_id=$2',[recurringId,user]);
      await client.query('DELETE FROM recurring_expenses WHERE recurring_id=$1 AND user_id=$2',[recurringId,user]);
      return {success:true};
    }),
  );
  route("post", "recurring/confirm", async (req, user) =>
    transaction(db, async (client) => {
      const {
        rows: [r],
      } = await client.query(
        "SELECT r.*,r.next_due::text AS next_due,r.starts_on::text AS starts_on,r.ends_on::text AS ends_on FROM recurring_expenses r WHERE recurring_id=$1 AND user_id=$2 FOR UPDATE",
        [id(req.body.recurring_id), user],
      );
      if (!r) fail("Recurring expense not found.", 404);
      const scheduled = date(req.body.scheduled_for),
        paid = date(req.body.date),
        current = await today(client);
      if (
        !r.enabled ||
        r.next_due !== scheduled ||
        paid > current ||
        (r.ends_on && scheduled > r.ends_on)
      )
        fail("This payment is disabled, outside its schedule, or has already been confirmed.", 409);
      const {
        rows: [budget],
      } = await client.query(
        "SELECT budget_id FROM budgets WHERE user_id=$1 AND month=$2 AND year=$3",
        [user, Number(paid.slice(5, 7)), Number(paid.slice(0, 4))],
      );
      if (!budget) fail("Set a budget for the payment month first.", 409);
      await client.query(
        "INSERT INTO expenses(user_id,budget_id,date,description,amount,category,recurring_id,scheduled_for) VALUES($1,$2,$3::date,$4,$5,$6,$7,$8::date)",
        [user, budget.budget_id, paid, r.name, r.amount, r.category, r.recurring_id, scheduled],
      );
      const next = nextPayment(scheduled, r.frequency, r.starts_on);
      await client.query(
        "UPDATE recurring_expenses SET next_due=$1::date,enabled=CASE WHEN ends_on IS NOT NULL AND $1::date>ends_on THEN false ELSE enabled END WHERE recurring_id=$2 AND user_id=$3",
        [next, r.recurring_id, user],
      );
      return { success: true };
    }),
  );
  route("get", "goals", async (req, user) => {
    const { rows } = await db.query(
      "SELECT g.*,to_jsonb(g)->>'deadline' AS deadline,COALESCE((to_jsonb(g)->>'archived')::boolean,false) AS archived FROM savings_goals g WHERE user_id=$1 ORDER BY goal_id",
      [user],
    );
    return { goals: rows };
  });
  route("post", "goals/save", async (req, user) => {
    const name = text(req.body.name, 100),
      target = money(req.body.target),
      deadline = req.body.deadline ? date(req.body.deadline) : null;
    if (req.body.goal_id) {
      const { rows } = await db.query(
        "UPDATE savings_goals SET name=$1,target_amount=$2,deadline=$3::date WHERE goal_id=$4 AND user_id=$5 RETURNING goal_id",
        [name, target, deadline, id(req.body.goal_id), user],
      );
      if (!rows.length) fail("Goal not found.", 404);
    } else
      await db.query(
        "INSERT INTO savings_goals(user_id,name,target_amount,deadline) VALUES($1,$2,$3,$4::date)",
        [user, name, target, deadline],
      );
    return { success: true };
  });
  route("post", "goals/archive", async (req, user) => {
    if (typeof req.body.archived !== "boolean") fail("Choose an archive state.");
    const { rows } = await db.query(
      "UPDATE savings_goals SET archived=$1 WHERE goal_id=$2 AND user_id=$3 RETURNING goal_id",
      [req.body.archived, id(req.body.goal_id), user],
    );
    if (!rows.length) fail("Goal not found.", 404);
    return { success: true };
  });
  route("post", "goals/contribute", async (req, user) => {
    const amount = money(req.body.amount);
    const { rows } = await db.query(
      "UPDATE savings_goals g SET saved_amount=COALESCE(saved_amount,0)+$1 WHERE goal_id=$2 AND user_id=$3 AND COALESCE((to_jsonb(g)->>'archived')::boolean,false) IS FALSE AND COALESCE(saved_amount,0)+$1<=99999999.99 RETURNING saved_amount",
      [amount, id(req.body.goal_id), user],
    );
    if (!rows.length)
      fail("Goal unavailable, archived, or amount exceeds the supported balance.", 409);
    return { success: true, saved: rows[0].saved_amount };
  });
}
module.exports = { registerWorkspaces, habitInput, nextPayment, money, DAY };

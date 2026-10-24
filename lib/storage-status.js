// Read-only capability inspection. File presence is not evidence of installation.
const requirements = {
  recurrence: {
    habits: ['recurrence','tracking'],
    habit_schedule_versions: ['recurrence','tracking'],
    universal_streak_requirements: ['schedule_days','rules'],
  },
  workspaces: {
    habits: ['description','icon','color','created_on','archived_on','schedule_days','target','unit'],
    habit_logs: ['progress_amount'],
    habit_schedule_versions: ['habit_id','effective_on','schedule_days','target','unit','archived'],
    habit_categories: ['category_id','user_id','name'],
    savings_goals: ['deadline','archived'],
    recurring_expenses: ['recurring_id','user_id','name','amount','category','frequency','starts_on','next_due','ends_on','enabled'],
    expenses: ['category','recurring_id','scheduled_for'],
  },
  universalStreak: {
    universal_streak_enrollments: ['user_id','starts_on','empty_day_policy','day_change_policy','policies_confirmed','time_zone','capture_version'],
    universal_streak_days: ['user_id','day','requirements_complete'],
    universal_streak_requirements: ['user_id','day','habit_id','completed','schedule_days'],
  },
};
async function inspectStorage(db) {
  const {rows} = await db.query('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema()');
  const installed = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
  const features = {};
  for (const [feature,tables] of Object.entries(requirements)) {
    const missing = Object.entries(tables).flatMap(([table,columns]) => columns.map(column => `${table}.${column}`)).filter(key => !installed.has(key));
    features[feature] = {ready:missing.length===0,missing};
  }
  const {rows:[clock]} = await db.query("SELECT current_setting('TimeZone') AS connection_zone,CURRENT_DATE::text AS connection_day,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date::text AS tracking_day");
  return {features,clock};
}
module.exports = {inspectStorage};

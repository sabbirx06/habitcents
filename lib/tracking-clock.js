// Explicit business day survives a pooler ignoring startup/session timezone options.
const ZONE='Asia/Dhaka';
const DAY="(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date";
async function trackingDay(db){return (await db.query(`SELECT ${DAY}::text AS today`)).rows[0].today;}
module.exports={ZONE,DAY,trackingDay};

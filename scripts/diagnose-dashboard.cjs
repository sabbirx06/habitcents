// Read-only diagnostics. Never prints connection options, credentials or user data.
require('dotenv').config({quiet:true});
const {createPool}=require('../db');
(async()=>{
 const db=createPool();let client;
 try{
  client=await db.connect();await client.query('BEGIN READ ONLY');
  const probes=[
   ['schema',`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('expenses','habits','habit_logs') ORDER BY table_name,ordinal_position`,[]],
   ['breakdown bounds',`SELECT $1::date::text AS start,($1::date+CASE WHEN $2='day' THEN INTERVAL '1 day' ELSE INTERVAL '1 month' END-INTERVAL '1 day')::date::text AS end`,['2026-10-01','month']],
   ['breakdown aggregate',`SELECT CASE WHEN to_jsonb(e)->>'category' IN ('transport','food','subscriptions','shopping') THEN to_jsonb(e)->>'category' ELSE 'uncategorized' END AS category,SUM(amount)::text AS amount,COUNT(*)::integer AS count,SUM(SUM(amount)) OVER()::text AS total FROM expenses e WHERE user_id=$1 AND date>=$2::date AND date<=$3::date GROUP BY 1 ORDER BY 1`,[-1,'2026-10-01','2026-10-31']],
   ['continuity bounds',`SELECT GREATEST('0001-01-01'::date,date_trunc('week',$1::date)::date-77)::text AS start,CURRENT_DATE::text AS today`,['2026-10-19']],
   ['continuity records',`SELECT hl.date::text AS date FROM habit_logs hl JOIN habits h ON h.habit_id=hl.habit_id WHERE h.user_id=$1 AND h.habit_id=$2 AND hl.completed_status IS TRUE AND hl.date>=$3::date AND hl.date<=$4::date AND hl.date<=CURRENT_DATE ORDER BY hl.date`,[-1,-1,'2026-08-03','2026-10-19']]
  ];
  for(const [name,sql,args] of probes){
   await client.query('SAVEPOINT probe');
   try{const result=await client.query(sql,args);console.log(JSON.stringify({probe:name,ok:true,...(name==='schema'?{columns:result.rows}:{})}));}
   catch(error){console.log(JSON.stringify({probe:name,ok:false,code:error.code,message:error.message}));await client.query('ROLLBACK TO SAVEPOINT probe');}
   await client.query('RELEASE SAVEPOINT probe');
  }
 }catch(error){console.log(JSON.stringify({probe:'connection',ok:false,code:error.code||'connection-failure'}));process.exitCode=1;}
 finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}await db.end();}
})();

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {randomUUID}=require('node:crypto');
const {registerWorkspaces}=require('../lib/workspaces');
async function fixture(run){
  const db=new PGlite();
  let server;
  try{
    await db.exec(fs.readFileSync('schema.postgres.sql','utf8'));
    await db.query("INSERT INTO users(name,email,password) VALUES('One','one@test','unused'),('Two','two@test','unused')");
    await db.query('INSERT INTO budgets(user_id,total_budget,month,year) VALUES(1,18000,1,2024)');
    await db.query("INSERT INTO expenses(user_id,budget_id,date,description,amount) VALUES(1,1,'2024-01-01','Existing expense',100)");
    await db.exec(fs.readFileSync('migrations/006-budget-additions.sql','utf8'));
    const app=express();app.use(express.json());
    registerWorkspaces(app,{
      db:{query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})},
      requireLogin(req,res,next){
        if(!req.headers['x-owner'])return res.status(401).json({error:'Login required'});
        req.session={user:{user_id:Number(req.headers['x-owner'])}};next();
      },presets:{},
    });
    app.use((error,req,res,next)=>res.status(500).json({error:'Save failed'}));
    server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.on('listening',resolve));
    const request=async(path,body,owner=1)=>{
      const response=await fetch('http://127.0.0.1:'+server.address().port+path,{
        method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(owner?{'x-owner':String(owner)}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),
      });
      return {status:response.status,body:await response.json()};
    };
    await run({db,request});
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await db.close();
  }
}
const addition=(values={})=>({month:'2024-01',amount:'5000',source:'Freelancing',date:'2024-01-15',request_key:randomUUID(),...values});
test('budget additions preserve expenses, history and owner isolation; retries are idempotent',()=>fixture(async({db,request})=>{
  const entry=addition();
  assert.equal((await request('/api/budget/additions',entry,0)).status,401);
  assert.equal((await request('/api/budget/additions',entry)).status,200);
  assert.equal((await request('/api/budget/additions',entry)).status,200);
  assert.equal((await request('/api/budget/additions',{...entry,amount:'6000'})).status,409);
  let result=await request('/api/expenses?month=2024-01');
  assert.equal(Number(result.body.budget),23000);
  assert.equal(result.body.expenses.length,1);
  assert.equal(Number(result.body.expenses[0].amount),100);
  const history=await request('/api/budget/additions?month=2024-01');
  assert.equal(history.body.additions.length,1);
  assert.equal(history.body.additions[0].source,'Freelancing');
  assert.equal((await request('/api/budget/additions?month=2024-01',null,2)).body.additions.length,0);
  assert.equal((await request('/api/budget/additions?month=2024-02')).body.additions.length,0);
  await request('/api/budget',{month:'2024-01',amount:'25000'});
  assert.equal((await request('/api/budget/additions?month=2024-01')).body.additions.length,1);
  await request('/api/budget/additions',addition({amount:'0.10'}));
  await request('/api/budget/additions',addition({amount:'0.20'}));
  assert.equal(Number((await request('/api/expenses?month=2024-01')).body.budget),25000.30);
  await request('/api/budget/additions',addition(),2);
  assert.equal(Number((await request('/api/expenses?month=2024-01',null,2)).body.budget),5000);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM expenses')).rows[0].n,1);
}));
test('invalid additions and failed history writes leave totals intact',()=>fixture(async({db,request})=>{
  for(const values of [{amount:'0'},{amount:'-1'},{amount:'1.001'},{source:' '},{date:'2024-02-01'},{date:'2999-01-01',month:'2999-01'},{request_key:'bad'}]){
    assert.equal((await request('/api/budget/additions',addition(values))).status,400);
  }
  assert.equal(Number((await request('/api/expenses?month=2024-01')).body.budget),18000);
  await request('/api/budget',{month:'2024-01',amount:'99999999.99'});
  assert.equal((await request('/api/budget/additions',addition())).status,400);
  assert.equal((await request('/api/budget/additions?month=2024-01')).body.additions.length,0);
  await request('/api/budget',{month:'2024-01',amount:'18000'});
  await db.exec("CREATE FUNCTION reject_addition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$; CREATE TRIGGER reject_addition BEFORE INSERT ON budget_additions FOR EACH ROW EXECUTE FUNCTION reject_addition();");
  assert.equal((await request('/api/budget/additions',addition())).status,500);
  assert.equal(Number((await request('/api/expenses?month=2024-01')).body.budget),18000);
  assert.equal((await request('/api/budget/additions?month=2024-01')).body.additions.length,0);
}));
test('preview additions increase the selected budget once and retain monthly history',async()=>{
  const server=require('../preview-server').createPreviewApp().listen(0,'127.0.0.1');
  await new Promise(resolve=>server.on('listening',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const read=async path=>(await fetch(base+path)).json();
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const month=today.slice(0,7),before=await read('/api/expenses?month='+month);
    const entry=addition({month,date:today,amount:'0.10'});
    for(let i=0;i<2;i++){
      const response=await fetch(base+'/api/budget/additions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entry)});
      assert.equal(response.status,200);
    }
    assert.equal(Math.round((await read('/api/expenses?month='+month)).budget*100),Math.round(before.budget*100)+10);
    assert.equal((await read('/api/budget/additions?month='+month)).additions.length,1);
    assert.equal((await read('/api/budget/additions?month=2020-01')).additions.length,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

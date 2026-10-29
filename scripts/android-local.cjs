// Isolated local Android testing: never loads .env or connects to the hosted database.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createApp}=require('../server');
const {PostgresSessionStore}=require('../lib/session-store');

async function main(){
  if(process.env.NODE_ENV==='production')throw new Error('This server is for local testing only.');
  const directory=path.resolve('.cache/android-local-db');
  fs.mkdirSync(directory,{recursive:true});
  const db=new PGlite(directory);
  await db.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
  const files=['schema.postgres.sql',...fs.readdirSync(path.resolve('migrations')).filter(name=>name.endsWith('.sql')).sort().map(name=>'migrations/'+name)];
  for(const file of files){
    if((await db.query('SELECT name FROM local_migrations WHERE name=$1',[file])).rows.length)continue;
    await db.exec(fs.readFileSync(path.resolve(file),'utf8'));
    await db.query('INSERT INTO local_migrations(name) VALUES($1)',[file]);
  }
  // PGlite has one connection; serialize transactions as pg.Pool clients would.
  let tail=Promise.resolve();
  const acquire=async()=>{const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return release;};
  const pool={
    query:async(...args)=>{const release=await acquire();try{return await db.query(...args);}finally{release();}},
    connect:async()=>{const release=await acquire();return {query:(...args)=>db.query(...args),release};}
  };
  const secretPath=path.join(directory,'session-secret');
  if(!fs.existsSync(secretPath))fs.writeFileSync(secretPath,crypto.randomBytes(32).toString('hex'));
  const app=createApp({db:pool,sessionSecret:fs.readFileSync(secretPath,'utf8'),sessionStore:new PostgresSessionStore(pool)});
  const server=app.listen(3000,'127.0.0.1',()=>console.log('Local Android server: http://127.0.0.1:3000 (separate local data; create a test account)'));
  const close=()=>server.close(async()=>{await db.close();process.exit(0);});
  process.on('SIGINT',close);process.on('SIGTERM',close);
}
main().catch(error=>{console.error(error);process.exitCode=1;});

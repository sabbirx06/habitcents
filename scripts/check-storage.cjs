// Metadata and clock only: no account reads, migrations, enrollment or writes.
require('dotenv').config({quiet:true});
const {createPool} = require('../db');
const {inspectStorage} = require('../lib/storage-status');
async function main() {
  const pool = createPool();
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    console.log(JSON.stringify(await inspectStorage(client),null,2));
    await client.query('ROLLBACK');
  } finally {
    if(client) client.release();
    await pool.end();
  }
}
main().catch(error => {
  // Do not print driver messages which may contain connection details.
  console.error(JSON.stringify({error:'Read-only storage inspection failed',code:error.code||null}));
  process.exitCode=1;
});

const { Store } = require("express-session");
class PostgresSessionStore extends Store {
  constructor(db) {
    super();
    this.db = db;
  }
  get(sid, done) {
    this.db
      .query("SELECT data FROM app_sessions WHERE sid=$1 AND expires_at>now()", [sid])
      .then((r) => done(null, r.rows[0]?.data ?? null), done);
  }
  set(sid, data, done = () => {}) {
    const expires = data.cookie?.expires
      ? new Date(data.cookie.expires)
      : new Date(Date.now() + 7 * 86400000);
    this.db
      .query(
        "INSERT INTO app_sessions(sid,data,expires_at) VALUES($1,$2::jsonb,$3) ON CONFLICT(sid) DO UPDATE SET data=EXCLUDED.data,expires_at=EXCLUDED.expires_at",
        [sid, JSON.stringify(data), expires],
      )
      .then(() => done(), done);
  }
  destroy(sid, done = () => {}) {
    this.db.query("DELETE FROM app_sessions WHERE sid=$1", [sid]).then(() => done(), done);
  }
  touch(sid, data, done = () => {}) {
    const expires = data.cookie?.expires
      ? new Date(data.cookie.expires)
      : new Date(Date.now() + 7 * 86400000);
    this.db
      .query("UPDATE app_sessions SET expires_at=$1 WHERE sid=$2", [expires, sid])
      .then(() => done(), done);
  }
}
module.exports = { PostgresSessionStore };

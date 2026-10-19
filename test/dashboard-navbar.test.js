const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ejs = require("ejs");

const root = path.resolve(__dirname, "..");

async function render(view, locals = {}) {
  return ejs.renderFile(path.join(root, "views", view), locals);
}

test("dashboard presents today's habits, budget, recent expenses, and quick expense entry", async () => {
  const html = await render("dashboard.ejs", {
    user: { name: "Amina" },
    page: "dashboard",
  });

  for (const selector of [
    'id="habit-progress"',
    'id="today-habits"',
    'id="dashboard-budget"',
    'id="recent-expenses"',
    'action="/add-expense"',
    'name="name"',
    'name="amount"',
  ]) {
    assert.ok(html.includes(selector), `expected dashboard to contain ${selector}`);
  }
  assert.match(html,/Amina/);assert.doesNotMatch(html,/Hello,/);assert.match(html,/initials-avatar[^>]*>A</);assert.match(html,/id="live-clock"/);
  assert.doesNotMatch(html, /Leaderboard|Show Expenses|Add Habits|Go to Home/);
});

test("shared navbar links to current core pages and omits removed navigation", async () => {
  const html = await render("partials/navbar.ejs", { page: "dashboard" });

  for (const href of ["/dashboard", "/habits", "/expenses", "/savings", "/profile"]) {
    assert.ok(html.includes(`href="${href}"`), `expected navbar link ${href}`);
  }
  assert.doesNotMatch(html, /Leaderboard|Categories/);
  assert.match(html, /aria-label="Primary navigation"/);
  assert.doesNotMatch(html,/href="\/logout"|nav-toggle|site-header/);
  for(const label of ["Overview","Habits","Expenses","Savings","Profile"])assert.ok(html.includes(`aria-label="${label}"`));
  assert.equal((html.match(/<svg /g)||[]).length,5);assert.match(html,/dock-tooltip/);
});

test('navbar marks exactly the current page and relies on shared assets', async()=>{
 for(const page of ['dashboard','habits','expenses','savings','profile']){
  const html=await render(page+'.ejs',{page,user:{name:'<script>unsafe</script>'}});
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.match(html,new RegExp('aria-current="page"[^>]*href="/'+page+'"'));
  assert.match(html,/src="\/js\/navigation.js"/);assert.match(html,/href="\/css\/fonts-authenticated.css"/);
  assert.doesNotMatch(html,/Bricolage|Playfair/);
  if(page==='dashboard')assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
 }
});

test('standalone visitor templates load the local font foundation',async()=>{
 for(const view of ['index','login','signup']){const html=await render(view+'.ejs',{query:{}});assert.match(html,/href="\/css\/fonts.css"/);assert.doesNotMatch(html,/Bricolage|Playfair|fonts.googleapis.com/);}
});

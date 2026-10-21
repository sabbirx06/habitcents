const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');

test('all authenticated pages render one shared banner and one heading before requests', async () => {
  for (const page of ['dashboard', 'habits', 'expenses', 'savings', 'profile']) {
    for (const name of ['', 'Alexandria Catherine Montgomery Sullivan Whitaker', '<script>unsafe</script>']) {
      const html = await ejs.renderFile(`views/${page}.ejs`, { page, user: { name } });
      assert.equal((html.match(/<header class="page-header/g) || []).length, 1);
      assert.equal((html.match(/<h1>/g) || []).length, 1);
      assert.match(html, /href="\/css\/page-header.css"/);
      assert.doesNotMatch(html, /<script>unsafe/);
      if (page !== 'dashboard') assert.match(html, /class="page-header-center"><\/div>/);
      if (page === 'profile' || page === 'dashboard') {
        assert.match(html, /class="initials-avatar"/);
        if (!name) assert.match(html, /aria-hidden="true">\?<\/span>/);
      }
      if (page === 'savings') assert.equal((html.match(/id="goal-new"/g) || []).length, 1);
      if (page === 'expenses') {
        assert.equal((html.match(/id="expense-new"/g) || []).length, 1);
        assert.match(html, /page-header-right"><button id="expense-new" class="page-header-action header-primary-action"/);
      }
    }
  }
});

test('habit banner range follows the actual heatmap dates across years and responsive week counts', async () => {
  const uri = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const source = fs.readFileSync('public/js/habits.js', 'utf8')
    .replace('"./workspace.js"', JSON.stringify(uri(fs.readFileSync('public/js/workspace.js', 'utf8'))));
  const { historyRangeLabel, heatmapDates } = await import(uri(source));
  for (const weeks of [8, 12, 20]) {
    const dates = heatmapDates('2026-01-02', weeks);
    const format = day => new Intl.DateTimeFormat('en', {day:'numeric', month:'short', year:'numeric'}).format(new Date(day + 'T12:00:00'));
    assert.equal(historyRangeLabel('2026-01-02', weeks), format(dates[0]) + ' – ' + format(dates.at(-1)));
  }
});

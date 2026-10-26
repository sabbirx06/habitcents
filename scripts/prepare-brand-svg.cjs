/* Keep logo SVGs self-contained in <img> and favicon contexts, where page fonts
   are unavailable. Embed the existing, unchanged, user-supplied OTF face. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const font = fs.readFileSync(path.join(root, 'public/fonts/NeueHaasGrotText-75Bold-Trial.otf')).toString('base64');
// Geist is used only for the user-selected dollar glyph; logo lettering stays Neue Haas.
const currencyFont = fs.readFileSync(path.join(root, 'public/fonts/geist-700.ttf')).toString('base64');
const style = `<style>@font-face{font-family:'Neue Haas Grotesk Text';src:url('data:font/otf;base64,${font}') format('opentype');font-style:normal;font-weight:700}@font-face{font-family:'HabitCents Currency';src:url('data:font/ttf;base64,${currencyFont}') format('truetype');font-style:normal;font-weight:700}text{font-family:'Neue Haas Grotesk Text';font-synthesis:none}.currency-symbol{font-family:'HabitCents Currency'}</style>`;
for (const name of ['habitcents-full-wordmark', 'habitcents-icon-h-transparent', 'habitcents-icon-h-light']) {
  const file = path.join(root, 'public/logo', name + '.svg');
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace(/\s*<style>[\s\S]*?<\/style>/g, '')
    .replace(/font-family="Instrument Sans, sans-serif"/g, 'font-family="Neue Haas Grotesk Text"')
    .replace(/\s*<path\b[^>]*class="currency-strike"[^>]*\/>/g, '')
    .replace(/<text\b([^>]*)>(?:\$|S)<\/text>/g, (_, attributes) => {
      const baseline = name === 'habitcents-full-wordmark' ? 453 : 493;
      const positioned = attributes.replace(/ class="currency-symbol"/g, '').replace(/ y="[^"]*"/, ` y="${baseline}"`);
      return '<text' + positioned + ' class="currency-symbol">$</text>';
    })
    .replace(/<desc>[\s\S]*?<\/desc>/, '<desc>HabitCents vector artwork with embedded Neue Haas Grotesk Text Bold lettering and the Geist Bold dollar glyph.</desc>\n  ' + style);
  fs.writeFileSync(file, source);
  console.log(name + ': embedded Neue Haas Grotesk Text Bold');
}

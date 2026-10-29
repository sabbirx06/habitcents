const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

test('Android exports use authenticated URLs instead of unsupported blob downloads',async()=>{
  let ready,click,assigned;
  const element={addEventListener(){},dataset:{},textContent:''};
  const button={dataset:{export:'json'},addEventListener(event,handler){click=handler;}};
  const document={addEventListener(event,handler){ready=handler;},querySelector(){return element;},querySelectorAll(){return [button];}};
  vm.runInNewContext(fs.readFileSync('public/js/profile.js','utf8'),{document,navigator:{userAgent:'Android HabitCentsAndroid/1.0'},window:{location:{assign(url){assigned=url;}}},fetch(){throw new Error('Native export must not create a blob');}});
  ready();await click();assert.equal(assigned,'/profile/export/json');
});

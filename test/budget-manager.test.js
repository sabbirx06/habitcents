const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {randomUUID}=require('node:crypto');
// Exercises the real dialog's form handlers without a browser or live account.
function fixture(){
  class Element{
    constructor(tag,attrs={},...children){this.tag=tag;this.attrs=attrs;this.children=children.flat(Infinity).filter(x=>x!=null);this.value=String(attrs.value??'');this.disabled=false;this.isConnected=true;this.listeners={};this.classList={contains:()=>false};}
    append(...children){this.children.push(...children.flat(Infinity));}
    replaceChildren(...children){this.children=children.flat(Infinity);}
    get textContent(){return this.children.map(c=>c instanceof Element?c.textContent:String(c)).join('');}
    set textContent(value){this.children=[String(value)];}
    addEventListener(type,run){this.listeners[type]=run;}
    querySelectorAll(selector){return this.children.flatMap(child=>{
      if(!(child instanceof Element))return [];
      const matches=selector.startsWith('[name=')?child.attrs.name===selector.match(/"([^"]+)"/)[1]:child.tag===selector;
      return [...(matches?[child]:[]),...child.querySelectorAll(selector)];
    });}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    reportValidity(){return true;}
    reset(){for(const input of this.querySelectorAll('input'))input.value=String(input.attrs.value??'');}
  }
  const node=(tag,attrs={},...children)=>new Element(tag,attrs,...children);
  const field=(label,name,type,value,attrs={})=>node('label',{},label,node('input',{name,type,value,...attrs}));
  const requests=[],dialogs=[],entries=[];let total=18000,failNext=false,hold=null;
  const context={
    node,field,calendarField:(label,name,value,attrs)=>field(label,name,'date',value,attrs),
    button:(label,run)=>{const b=node('button',{},label);b.addEventListener('click',run);return b;},
    modal:(title,content)=>{dialogs.push({title,content});return {classList:{add(){},contains:()=>false}};},
    formData:form=>Object.fromEntries(form.querySelectorAll('input').map(i=>[i.attrs.name,i.value])),
    status:(target,message)=>{target.textContent=message;},money:value=>'Tk '+Number(value).toFixed(2),displayDate:()=> 'Oct 2026',
    month:'2026-10',data:{month:'2026-10',today:'2026-10-27',budget:18000},localDay:()=> '2026-10-27',monthDays:()=>['2026-10-01','2026-10-31'],
    crypto:{randomUUID},notifyChange(){},loadExpenses:async()=>{context.data.budget=total;},
    api:async(url,body)=>{
      requests.push({url,body});
      if(!body)return {month:'2026-10',additions:[...entries]};
      if(hold)await hold;
      if(failNext){failNext=false;throw Error('Connection interrupted');}
      if(url==='/api/budget')total=Number(body.amount);
      else {total=(Math.round(total*100)+Math.round(Number(body.amount)*100))/100;entries.push(body);}
      return {success:true};
    },
  };
  const source=fs.readFileSync('public/js/expenses.js','utf8');
  vm.runInNewContext(source.slice(source.indexOf('function manageBudget()'),source.indexOf('function renderBudget('))+'\nmanageBudget();',context);
  const content=dialogs[0].content,[edit,add]=content.querySelectorAll('form');
  const submit=form=>form.listeners.submit({preventDefault(){}});
  return {context,content,dialogs,requests,edit,add,submit,fail(){failNext=true;},hold(promise){hold=promise;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('budget dialog shows Edit budget above Add money and saves both forms in place',async()=>{
  const ui=fixture();await settle();
  assert.deepEqual(ui.content.querySelectorAll('h3').map(h=>h.textContent),['Edit budget','Add money']);
  assert.equal(ui.content.querySelector('time').textContent,'Oct 2026');
  assert.equal(ui.content.querySelector('time').attrs.datetime,'2026-10');
  assert.doesNotMatch(ui.content.textContent,/Recent additions|Set the total|Budget for/);
  assert.equal(ui.requests.length,0);
  assert.equal(ui.edit.querySelector('[name="amount"]').value,'18000');
  ui.edit.querySelector('[name="amount"]').value='19000';
  await ui.submit(ui.edit);
  assert.equal(ui.context.data.budget,19000);
  ui.add.querySelector('[name="amount"]').value='5000';
  ui.add.querySelector('[name="source"]').value='Freelancing';
  await ui.submit(ui.add);await settle();
  assert.equal(ui.context.data.budget,24000);
  assert.equal(Number(ui.edit.querySelector('[name="amount"]').value),24000);
  assert.equal(ui.add.querySelector('[name="amount"]').value,'');
  assert.equal(ui.dialogs.length,1);
  assert.match(ui.content.textContent,/Money added\./);
});
test('budget forms block concurrent saves and preserve the request key on retry',async()=>{
  const ui=fixture();await settle();
  ui.add.querySelector('[name="amount"]').value='500';
  ui.add.querySelector('[name="source"]').value='Freelancing';
  let release;ui.hold(new Promise(resolve=>{release=resolve;}));
  const first=ui.submit(ui.add);
  await ui.submit(ui.edit);
  assert.equal(ui.requests.filter(r=>r.body).length,1);
  ui.fail();release();await first;
  await ui.submit(ui.add);
  const saves=ui.requests.filter(r=>r.body);
  assert.equal(saves.length,2);
  assert.equal(saves[0].body.request_key,saves[1].body.request_key);
  assert.equal(ui.context.data.budget,18500);
  ui.add.querySelector('[name="amount"]').value='100';
  ui.add.querySelector('[name="source"]').value='Another job';
  await ui.submit(ui.add);
  assert.notEqual(ui.requests.filter(r=>r.body).at(-1).body.request_key,saves[1].body.request_key);
});

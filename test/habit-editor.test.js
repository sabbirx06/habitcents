const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
// Small DOM harness: exercises the real form's change/input/save callbacks, not rendering.
function editorFixture(today){
 class Element{
  constructor(tag,attrs={},children=[]){this.tag=tag;this.attrs={...attrs};this.children=children.flat(Infinity).filter(x=>x!=null);this.value=String(attrs.value??'');this._checked=Object.hasOwn(attrs,'checked');this.disabled=false;this.hidden=false;this.listeners={};this.style={setProperty(){}};this.classList={add(){}};}
  get checked(){return this._checked;}set checked(value){this._checked=value;if(value&&this.attrs.type==='radio'&&form)for(const input of form.querySelectorAll('[name="'+this.attrs.name+'"]'))if(input!==this)input._checked=false;}
  append(...children){this.children.push(...children.flat(Infinity));}prepend(...children){this.children.unshift(...children);}replaceChildren(...children){this.children=children;}
  get textContent(){return this.children.map(c=>typeof c==='string'||typeof c==='number'?c:c.textContent).join('');}
  set textContent(value){this.children=[String(value)];}
  addEventListener(name,run){(this.listeners[name]||=[]).push(run);}dispatchEvent(event){for(const run of this.listeners[event.type]||[])run(event);}
  matches(selector){
   if(selector.startsWith('.'))return (this.attrs.class||'').split(' ').includes(selector.slice(1));
   const tag=selector.match(/^[a-z]+/)?.[0];if(tag&&tag!==this.tag)return false;
   for(const match of selector.matchAll(/\[(name|value)=['"]?([^\]'"]+)['"]?\]/g))if(String(match[1]==='value'?this.value:this.attrs[match[1]])!==match[2])return false;
   return !selector.endsWith(':checked')||this.checked;
  }
  querySelectorAll(selector){const choices=selector.split(','),all=[];for(const child of this.children)if(child instanceof Element){if(choices.some(s=>child.matches(s.trim())))all.push(child);all.push(...child.querySelectorAll(selector));}return all;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 }
 const node=(tag,attrs={},...children)=>new Element(tag,attrs,children);
 const field=(label,name,type,value,attrs={})=>node('label',{},node('span',{class:'workspace-label'},label),node('input',{name,type,value,...attrs}));
 const choiceField=(label,name,choices,value)=>node('fieldset',{},node('legend',{},label),choices.map(([key,title])=>node('label',{},node('input',{name,type:'radio',value:key,...(key===value?{checked:''}:{})}),title)));
 const selectField=(label,name,options,value)=>node('label',{},node('span',{},label),node('select',{name,value}));
 let form,save;const requests=[];
 const context={HabitRecurrence:require('../public/js/recurrence'),HabitIcons:{tile:()=>node('span',{})},node,field,choiceField,selectField,
  durationField:(value,name)=>node('div',{},field('Minutes',name,'number',value)),
  button:(label,run)=>node('button',{onclick:run},label),disclosure:(_,children)=>node('div',{},children),
  editor:(_,children,run)=>{form=node('form',{},children);save=run;return {form};},
  api:async(url,body)=>{requests.push({url,body});return {};},notifyChange(){},Event:class{constructor(type){this.type=type;}},document:{},
 };
 let source=fs.readFileSync('public/js/habits.js','utf8').replace(/^import\s*\{[\s\S]*?\}\s*from\s*"\.\/workspace.js";/,'').replace(/export /g,'');
 source+='\nloadHabits=async()=>{};globalThis.openEditor=habitEditor;globalThis.setEditorState=value=>state=value;';
 vm.runInNewContext(source,context);context.setEditorState({today,categories:[],recurrenceReady:true});
 const select=(name,value)=>{form.querySelectorAll('[name="'+name+'"]').forEach(input=>{if(input.attrs.type==='radio')input.checked=input.value===value;else input.value=String(value);});form.dispatchEvent({type:'change'});};
 return {open:h=>context.openEditor(h),select,get form(){return form;},requests,submit:async()=>{const values={};for(const input of form.querySelectorAll('input,select'))if(!input.disabled&&(!['radio','checkbox'].includes(input.attrs.type)||input.checked))values[input.attrs.name]=input.value;await save(values,form);}};
}
test('habit editor selects concrete quota activation defaults and persists independent tracking/recurrence',async()=>{
 const ui=editorFixture('2026-10-24');ui.open({});ui.select('name','Gym');ui.select('tracking','count');ui.select('target','3');ui.select('unit','visits');ui.select('repeat','weekly');
 assert.equal(ui.form.querySelector('[name=start_choice]:checked').value,'next');assert.match(ui.form.textContent,/2026-10-26/);assert.match(ui.form.textContent,/2026-11-01/);
 ui.select('start_choice','this');assert.match(ui.form.textContent,/not prorated/);await ui.submit();
 const body=ui.requests[0].body;assert.equal(body.tracking,'count');assert.equal(body.target,'3');assert.equal(body.unit,'visits');assert.equal(body.recurrence.frequency,'weekly');assert.equal(body.recurrence.mode,'quota');assert.equal(body.start_choice,'this');
 const first=editorFixture('2026-10-26');first.open({});first.select('repeat','weekly');assert.equal(first.form.querySelector('[name=start_choice]:checked').value,'this');
});
test('habit editor preserves minutes and selected weekdays and displays pending quota edits',async()=>{
 const ui=editorFixture('2026-10-24');ui.open({habit_id:9,habit_name:'Read',target:20,unit:'minutes',tracking:'measure',schedule_days:[1,3],recurrence:{frequency:'weekdays',mode:'scheduled'}});await ui.submit();
 assert.equal(ui.requests[0].body.target,'20');assert.equal(ui.requests[0].body.unit,'minutes');assert.deepEqual(Array.from(ui.requests[0].body.schedule_days),[1,3]);
 const old={habit_id:10,habit_name:'Gym',tracking:'count',target:3,unit:'visits',recurrence:{frequency:'weekly',mode:'quota'},pending:{effective_on:'2026-10-26',target:5,unit:'visits',tracking:'count',schedule_days:[1,2,3,4,5,6,7],recurrence:{frequency:'weekly',mode:'quota'}}};
 ui.open(old);assert.match(ui.form.textContent,/current period’s rule and progress stay unchanged/);assert.equal(ui.form.querySelector('[name=target]').value,'5');assert.equal(old.target,3);
});

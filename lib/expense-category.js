const categories=['transport','food','subscriptions','shopping','uncategorized'];
function parseCategory(value){if(value===undefined||value===null||value==='')return 'uncategorized';return typeof value==='string'&&categories.includes(value)?value:null;}
// JSON extraction also works before the optional category column migration.
const categorySql="CASE WHEN to_jsonb(e)->>'category' IN ('transport','food','subscriptions','shopping') THEN to_jsonb(e)->>'category' ELSE 'uncategorized' END";
module.exports={categories,parseCategory,categorySql};

// Strict calendar validation; DATE values are never converted through UTC timestamps.
function validDate(value) {
 if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const [year,month,day]=value.split('-').map(Number);
 if(year<1)return false;
 const d=new Date(0);d.setFullYear(year,month-1,day);d.setHours(12,0,0,0);
 return d.getFullYear()===year && d.getMonth()===month-1 && d.getDate()===day;
}
function validMonth(value){return typeof value==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0,4))>=1;}
module.exports={validDate,validMonth};

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Range {
  constructor(sheet,row,col,rows=1,cols=1){Object.assign(this,{sheet,row,col,rows,cols});}
  getValues(){return Array.from({length:this.rows},(_,ri)=>Array.from({length:this.cols},(_,ci)=>this.sheet.values.get((this.row+ri)+','+(this.col+ci))??''));}
  getDisplayValues(){return this.getValues().map(r=>r.map(v=>String(v)));}
  setValues(data){data.forEach((r,ri)=>r.forEach((v,ci)=>this.setValue(v,ri,ci)));return this;}
  setValue(value,ri=0,ci=0){const key=(this.row+ri)+','+(this.col+ci);if(this.sheet.failCell===key){this.sheet.failCell=null;throw new Error('simulated write interruption');}this.sheet.values.set(key,value);this.sheet.formulas.delete((this.row+ri)+','+(this.col+ci));return this;}
  getFormula(){return this.sheet.formulas.get(this.row+','+this.col)||'';}
  setFormula(formula){this.sheet.formulas.set(this.row+','+this.col,formula);this.sheet.values.set(this.row+','+this.col,'');return this;}
}
class Sheet {
  constructor(name,max=120){this.name=name;this.max=max;this.values=new Map();this.formulas=new Map();this.hidden=false;}
  getLastRow(){let last=0;for(const key of this.values.keys()){const row=Number(key.split(',')[0]);if(this.values.get(key)!==''&&this.values.get(key)!==null)last=Math.max(last,row);}return last;}
  getMaxRows(){return this.max;}
  insertRowsAfter(after,count){this.max+=count;}
  getRange(row,col,rows=1,cols=1){return new Range(this,row,col,rows,cols);}
  hideSheet(){this.hidden=true;}
}
class Book {
  constructor(){this.sheets=new Map([['PC1',new Sheet('PC1')],['SSI. V2',new Sheet('SSI. V2')],['SSI',new Sheet('SSI')],['Dash board',new Sheet('Dash board')]]);this.sheets.get('PC1').getRange(2,2).setFormula('=SUM(B4:B4)');this.sheets.get('PC1').getRange(2,4).setFormula('=SUM(D4:D4)');this.sheets.get('Dash board').getRange(3,2).setFormula('=SUM(B9:B9)');}
  getSheetByName(name){return this.sheets.get(name)||null;}
  insertSheet(name){const sh=new Sheet(name);this.sheets.set(name,sh);return sh;}
}
const book=new Book(), context={console,Map,Set,Date,Math,Number,String,Array,JSON,Error,
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  SpreadsheetApp:{openById:()=>book},
  ContentService:{MimeType:{JSON:'application/json'},createTextOutput:s=>({text:s,setMimeType(){return this;}})}
};
vm.runInNewContext(fs.readFileSync('scripts/Code.gs','utf8').replace('CHANGE_ME_TO_A_LONG_RANDOM_TOKEN','TEST_TOKEN'),context);
function post(payload){return JSON.parse(context.doPost({postData:{contents:JSON.stringify({token:'TEST_TOKEN',...payload})}}).text);}

let r=post({baseline:true,events:[{id:'old-buy',kind:'buy',ticker:'PC1',date:'2025-01-01',qty:4,price:12}]});
assert.equal(r.ok,true);assert.equal(r.added,0);assert.equal(r.skipped,1);
assert.equal(book.getSheetByName('PC1').getRange(4,1).getValues()[0][0],'','baseline wrote old stock data');
r=post({baseline:true,events:[{id:'old-buy',kind:'buy',ticker:'PC1',date:'2025-01-01',qty:4,price:12}]});
assert.equal(r.skipped,1,'baseline retry must remain idempotent');

r=post({events:[{id:'new-pc1',kind:'buy',ticker:'PC1',date:'2026-10-31',qty:2,price:30}]});
assert.equal(r.added,1);assert.equal(book.getSheetByName('PC1').getRange(4,2).getValues()[0][0],2);
assert.equal(book.getSheetByName('PC1').getRange(4,4).getFormula(),'=B4*C4');
assert.equal(book.getSheetByName('PC1').getRange(2,4).getFormula(),'=SUM(D4:D4)','existing P/L totals formula changed');
r=post({events:[{id:'new-pc1',kind:'buy',ticker:'PC1',date:'2026-10-31',qty:2,price:30}]});
assert.equal(r.added,0);assert.equal(r.skipped,1);assert.equal(book.getSheetByName('PC1').getRange(4,2).getValues()[0][0],2);
book.getSheetByName('PC1').failCell='5,1';
r=post({events:[{id:'interrupted',kind:'buy',ticker:'PC1',date:'2026-10-31',qty:5,price:31},{id:'after-pending',kind:'buy',ticker:'PC1',date:'2026-10-31',qty:6,price:32}]});
assert.equal(r.added,1);assert.equal(r.errors.length,1);
assert.equal(book.getSheetByName('PC1').getRange(5,2).getValues()[0][0],'');
assert.equal(book.getSheetByName('PC1').getRange(6,2).getValues()[0][0],6,'pending reservation reused by later event');
r=post({events:[{id:'interrupted',kind:'buy',ticker:'PC1',date:'2026-10-31',qty:5,price:31}]});
assert.equal(r.added,1);assert.equal(book.getSheetByName('PC1').getRange(5,2).getValues()[0][0],5);
assert.equal(book.getSheetByName('PC1').getRange(6,2).getValues()[0][0],6);

r=post({events:[{id:'new-ssi',kind:'buy',ticker:'SSI',date:'2026-10-31',qty:3,price:21}]});
assert.equal(r.added,1);assert.equal(book.getSheetByName('SSI. V2').getRange(4,2).getValues()[0][0],3);
assert.equal(book.getSheetByName('SSI').getRange(4,2).getValues()[0][0],'');

r=post({events:[{id:'old-cash',kind:'deposit',date:'2026-04-09',amount:1000}]});
assert.equal(r.added,0);assert.equal(r.errors.length,1);
r=post({events:[{id:'new-cash',kind:'withdraw',date:'2026-04-10',amount:500}]});
assert.equal(r.added,1);assert.equal(book.getSheetByName('Dash board').getRange(9,3).getValues()[0][0],500);
r=post({events:[{id:'bad-ticker',kind:'buy',ticker:'FPT',date:'2026-10-31',qty:1,price:1}]});
assert.equal(r.errors.length,1);assert.equal(book.getSheetByName('PC1').getRange(5,2).getValues()[0][0],'');

console.log('Apps Script sync tests passed (baseline, retry IDs, ticker scope/mapping, cutoff, formulas).');

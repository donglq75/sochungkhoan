const SPREADSHEET_ID = '1HjOSX7PgHFJ3FgrWuoqGSue-TMEkJa3EuOsJUFlwvQI';
const SYNC_TOKEN = 'CHANGE_ME_TO_A_LONG_RANDOM_TOKEN';
const CASH_START_DATE = '2026-04-10';
const STOCK_SHEETS = { PC1: 'PC1', SSI: 'SSI. V2' };

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ok:false, message:'Đang có một lượt đồng bộ khác. Thử lại sau.'});
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!SYNC_TOKEN || SYNC_TOKEN.indexOf('CHANGE_ME') === 0 || payload.token !== SYNC_TOKEN)
      return json_({ok:false, message:'Mã bảo mật không đúng hoặc chưa được cấu hình.'});
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const log = getLog_(ss);
    const known = readKnownEvents_(log), reservedRows = new Map();
    known.forEach(v => { if (v.status === 'pending' && v.sheet) reservedRows.set(v.sheet, Math.max(reservedRows.get(v.sheet) || 0, v.row || 0)); });
    const events = Array.isArray(payload.events) ? payload.events : [];
    const baseline = payload.baseline === true;
    let added = 0, skipped = 0;
    const errors = [];

    events.forEach(ev => {
      try {
        if (!ev || !ev.id || !ev.kind) throw new Error('Sự kiện thiếu mã hoặc loại giao dịch');
        const id = String(ev.id);
        const prior = known.get(id);
        if (prior && prior.status !== 'pending') { skipped++; return; }

        const plan = buildPlan_(ss, ev, prior, reservedRows);
        if (baseline && !prior) {
          const logRow = appendLog_(log, id, ev, 'baseline', '', '');
          known.set(id, {status:'baseline', row:logRow});
          skipped++;
          return;
        }
        reservedRows.set(plan.sheet, Math.max(reservedRows.get(plan.sheet) || 0, plan.row));

        let logRow;
        if (prior) logRow = prior.logRow;
        else {
          logRow = appendLog_(log, id, ev, 'pending', plan.sheet, plan.row);
          known.set(id, {status:'pending', sheet:plan.sheet, row:plan.row, logRow:logRow});
        }
        writePlan_(ss, plan);
        log.getRange(logRow,6,1,3).setValues([['done',plan.sheet,plan.row]]);
        known.set(id, {status:'done', sheet:plan.sheet, row:plan.row, logRow:logRow});
        added++;
      } catch (err) {
        errors.push((ev && ev.ticker ? ev.ticker + ': ' : '') + (err.message || String(err)));
      }
    });
    return json_({ok:true, baseline:baseline, added:added, skipped:skipped, errors:errors});
  } catch (err) {
    return json_({ok:false, message:err.message || String(err)});
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json_({ok:true, message:'SoChungKhoan sync endpoint is ready.'});
}

function getLog_(ss) {
  let sh = ss.getSheetByName('_AppSync');
  if (!sh) {
    sh = ss.insertSheet('_AppSync');
    sh.getRange(1,1,1,8).setValues([['event_id','synced_at','kind','ticker','date','status','target_sheet','target_row']]);
    sh.hideSheet();
  } else {
    sh.getRange(1,1,1,8).setValues([['event_id','synced_at','kind','ticker','date','status','target_sheet','target_row']]);
  }
  return sh;
}

function readKnownEvents_(log) {
  const last = log.getLastRow(), known = new Map();
  if (last <= 1) return known;
  log.getRange(2,1,last-1,8).getValues().forEach((r,i) => {
    if (r[0]) known.set(String(r[0]), {
      status: String(r[5] || 'done'),
      sheet: String(r[6] || ''),
      row: Number(r[7] || 0),
      logRow: i + 2
    });
  });
  return known;
}

function appendLog_(log, id, ev, status, sheet, row) {
  const target = log.getLastRow() + 1;
  if (target > log.getMaxRows()) log.insertRowsAfter(log.getMaxRows(), target - log.getMaxRows());
  log.getRange(target,1,1,8).setValues([[
    id, new Date(), ev.kind, ev.ticker || '', ev.date || '', status, sheet || '', row || ''
  ]]);
  return target;
}

function buildPlan_(ss, ev, prior, reservedRows) {
  const kinds = ['buy','sell','div','bonus','deposit','withdraw'];
  if (!kinds.includes(ev.kind)) throw new Error('Loại sự kiện không hỗ trợ: ' + ev.kind);
  const date = parseDate_(ev.date);
  if (ev.kind === 'deposit' || ev.kind === 'withdraw') {
    if (String(ev.date) < CASH_START_DATE) throw new Error('Chỉ nhận nạp/rút từ ngày 10/04/2026');
    const sh = ss.getSheetByName('Dash board');
    if (!sh) throw new Error('Không tìm thấy sheet Dash board');
    const sheet = 'Dash board';
    if (prior && prior.sheet && prior.sheet !== sheet) throw new Error('Không khớp đích retry');
    const row = prior && prior.status === 'pending' ? prior.row : nextDataRow_(sh,9,[1,2,3,4],reservedRows,sheet);
    const amount = Number(ev.amount || 0);
    if (!(amount > 0)) throw new Error('Số tiền nạp/rút phải lớn hơn 0');
    return {kind:'cash',sheet,row,date,kindEvent:ev.kind,amount};
  }

  const ticker = sheetTicker_(ev.ticker);
  const sh = ss.getSheetByName(ticker);
  if (!sh) throw new Error('Không tìm thấy sheet "' + ticker + '".');
  if (prior && prior.sheet && prior.sheet !== ticker) throw new Error('Không khớp đích retry');
  const row = prior && prior.status === 'pending' ? prior.row : nextDataRow_(sh,4,[1,2,3,5,6,7,9],reservedRows,ticker);
  const qty = Number(ev.qty || 0), price = Number(ev.price || 0), updates = [];
  updates.push({col:1,value:date});
  if (ev.kind === 'buy') {
    if (!(qty > 0) || !(price > 0)) throw new Error('Lệnh mua thiếu số lượng hoặc giá');
    updates.push({col:2,value:qty},{col:3,value:price},{col:4,formula:'=B'+row+'*C'+row});
  } else if (ev.kind === 'sell') {
    if (!(qty > 0) || !(price > 0)) throw new Error('Lệnh bán thiếu số lượng hoặc giá');
    updates.push({col:5,value:qty},{col:6,value:price},{col:7,formula:'=E'+row+'*F'+row},
      {col:8,formula:'=((SUM($B$4:B'+row+')-SUM($E$4:E'+row+'))*F'+row+'+SUM($G$4:G'+row+')-SUM($D$4:D'+row+'))*1000'});
  } else if (ev.kind === 'div') {
    if (!(price > 0)) throw new Error('Cổ tức tiền phải lớn hơn 0');
    updates.push({col:7,value:price},{col:9,value:'ct bằng tiền'});
  } else {
    if (!(qty > 0)) throw new Error('Số cổ phiếu thưởng phải lớn hơn 0');
    updates.push({col:2,value:qty},{col:3,value:0},{col:4,formula:'=B'+row+'*C'+row},{col:9,value:'CP thưởng'});
  }
  return {kind:'stock',sheet:ticker,row,date,updates};
}

function sheetTicker_(value) {
  const ticker = String(value || '').trim().toUpperCase().replace(/\s+/g,' ');
  if (ticker === 'PC1') return STOCK_SHEETS.PC1;
  if (ticker === 'SSI' || ticker === 'SSI. V2' || ticker === 'SSI V2') return STOCK_SHEETS.SSI;
  throw new Error('Ứng dụng chỉ đồng bộ mã PC1 và SSI');
}

function writePlan_(ss, plan) {
  const sh = ss.getSheetByName(plan.sheet);
  if (!sh) throw new Error('Không tìm thấy sheet đích "' + plan.sheet + '"');
  if (plan.row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), plan.row - sh.getMaxRows());
  if (plan.kind === 'stock') {
    plan.updates.forEach(u => {
      const cell = sh.getRange(plan.row,u.col);
      if (u.formula) cell.setFormula(u.formula); else cell.setValue(u.value);
    });
    extendStockTotals_(sh, plan.row);
  } else {
    sh.getRange(plan.row,1,1,4).setValues([[
      plan.date, plan.kindEvent === 'deposit' ? plan.amount : '',
      plan.kindEvent === 'withdraw' ? plan.amount : '', 'App'
    ]]);
    extendCashTotals_(sh, plan.row);
  }
}

function extendStockTotals_(sh, row) {
  [2,4,5,7].forEach(col => {
    const cell = sh.getRange(2,col), formula = cell.getFormula();
    const m = formula.match(/^=SUM\(([A-Z]+4):([A-Z]+)(\d+)\)$/i);
    if (m && row > Number(m[3])) cell.setFormula('=SUM(' + m[1] + '4:' + m[2] + row + ')');
  });
}

function extendCashTotals_(sh, row) {
  [2,3].forEach(col => {
    const cell = sh.getRange(3,col), formula = cell.getFormula();
    const m = formula.match(/^=SUM\(([A-Z]+9):([A-Z]+)(\d+)\)$/i);
    if (m && row > Number(m[3])) cell.setFormula('=SUM(' + m[1] + '9:' + m[2] + row + ')');
  });
}

function nextDataRow_(sh, first, columns, reservedRows, sheetName) {
  return Math.max(lastDataRow_(sh,first,columns) + 1, (reservedRows.get(sheetName) || 0) + 1);
}

function lastDataRow_(sh, first, columns) {
  const max = sh.getMaxRows();
  const width = Math.max.apply(null, columns);
  const range = sh.getRange(first,1,max-first+1,width);
  const vals = range.getValues();
  const formulas = range.getFormulas();
  let last = first - 1;
  vals.forEach((r,i) => {
    if (columns.some(c => !formulas[i][c-1] && r[c-1] !== '' && r[c-1] !== null))
      last = first + i;
  });
  return last;
}

function parseDate_(value) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Ngày giao dịch không hợp lệ');
  const [y,m,d] = s.split('-').map(Number), check = new Date(Date.UTC(y,m-1,d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m-1 || check.getUTCDate() !== d)
    throw new Error('Ngày giao dịch không hợp lệ');
  return new Date(y,m-1,d);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

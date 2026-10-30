const SPREADSHEET_ID = '1HjOSX7PgHFJ3FgrWuoqGSue-TMEkJa3EuOsJUFlwvQI';
const SYNC_TOKEN = 'CHANGE_ME_TO_A_LONG_RANDOM_TOKEN';

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ok:false, message:'Đang có một lượt đồng bộ khác. Thử lại sau.'});
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!SYNC_TOKEN || SYNC_TOKEN.indexOf('CHANGE_ME') === 0 || payload.token !== SYNC_TOKEN)
      return json_({ok:false, message:'Mã bảo mật không đúng hoặc chưa được cấu hình.'});
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const log = getLog_(ss);
    const lastLog = log.getLastRow();
    const known = new Set(lastLog > 1 ? log.getRange(2,1,lastLog-1,1).getDisplayValues().flat() : []);
    const events = Array.isArray(payload.events) ? payload.events : [];
    let added = 0, skipped = 0;
    const errors = [];
    events.forEach(ev => {
      try {
        if (!ev || !ev.id || !ev.kind) throw new Error('Sự kiện thiếu mã hoặc loại giao dịch');
        if (known.has(String(ev.id))) { skipped++; return; }
        if (['buy','sell','div','bonus'].includes(ev.kind)) appendStock_(ss, ev);
        else if (ev.kind === 'deposit' || ev.kind === 'withdraw') appendCash_(ss, ev);
        else throw new Error('Loại sự kiện không hỗ trợ: ' + ev.kind);
        log.appendRow([String(ev.id), new Date(), ev.kind, ev.ticker || '', ev.date || '']);
        known.add(String(ev.id));
        added++;
      } catch (err) {
        errors.push((ev && ev.ticker ? ev.ticker + ': ' : '') + (err.message || String(err)));
      }
    });
    return json_({ok:true, added:added, skipped:skipped, errors:errors});
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
    sh.getRange(1,1,1,5).setValues([['event_id','synced_at','kind','ticker','date']]);
    sh.hideSheet();
  }
  return sh;
}

function appendStock_(ss, ev) {
  const ticker = String(ev.ticker || '').trim().toUpperCase();
  if (!/^[A-Z0-9.]{1,12}$/.test(ticker)) throw new Error('Mã cổ phiếu không hợp lệ');
  const sh = ss.getSheetByName(ticker);
  if (!sh) throw new Error('Không tìm thấy sheet "' + ticker + '". Hãy tạo sheet theo mã trước khi đồng bộ.');
  const row = lastDataRow_(sh, 4, [1,2,3,5,6,7,9]) + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows());
  const date = parseDate_(ev.date);
  const qty = Number(ev.qty || 0), price = Number(ev.price || 0);
  const values = [date, '', '', '', '', '', '', '', ''];
  if (ev.kind === 'buy') {
    if (!(qty > 0) || !(price > 0)) throw new Error('Lệnh mua thiếu số lượng hoặc giá');
    values[1] = qty; values[2] = price; values[3] = '=B' + row + '*C' + row;
  } else if (ev.kind === 'sell') {
    if (!(qty > 0) || !(price > 0)) throw new Error('Lệnh bán thiếu số lượng hoặc giá');
    values[4] = qty; values[5] = price; values[6] = '=E' + row + '*F' + row;
    values[7] = '=((SUM($B$4:B' + row + ')-SUM($E$4:E' + row + '))*F' + row + '+SUM($G$4:G' + row + ')-SUM($D$4:D' + row + '))*1000';
  } else if (ev.kind === 'div') {
    if (!(price > 0)) throw new Error('Cổ tức tiền phải lớn hơn 0');
    values[6] = price; values[8] = 'ct bằng tiền';
  } else if (ev.kind === 'bonus') {
    if (!(qty > 0)) throw new Error('Số cổ phiếu thưởng phải lớn hơn 0');
    values[1] = qty; values[2] = 0; values[3] = '=B' + row + '*C' + row; values[8] = 'CP thưởng';
  }
  sh.getRange(row,1,1,9).setValues([values]);
  extendStockTotals_(sh, row);
}

function extendStockTotals_(sh, row) {
  [2,4,5,7].forEach(col => {
    const cell = sh.getRange(2,col), formula = cell.getFormula();
    const m = formula.match(/^=SUM\(([A-Z]+4):([A-Z]+)(\d+)\)$/i);
    if (m && row > Number(m[3])) cell.setFormula('=SUM(' + m[1] + '4:' + m[2] + row + ')');
  });
}

function appendCash_(ss, ev) {
  const sh = ss.getSheetByName('Dash board');
  if (!sh) throw new Error('Không tìm thấy sheet Dash board');
  const row = lastDataRow_(sh, 9, [1,2,3,4]) + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows());
  const date = parseDate_(ev.date), amount = Number(ev.amount || 0);
  if (!(amount > 0)) throw new Error('Số tiền nạp/rút phải lớn hơn 0');
  sh.getRange(row,1,1,4).setValues([[date, ev.kind === 'deposit' ? amount : '', ev.kind === 'withdraw' ? amount : '', 'App']]);
  [2,3].forEach(col => {
    const cell = sh.getRange(3,col), formula = cell.getFormula();
    const m = formula.match(/^=SUM\(([A-Z]+9):([A-Z]+)(\d+)\)$/i);
    if (m && row > Number(m[3])) cell.setFormula('=SUM(' + m[1] + '9:' + m[2] + row + ')');
  });
}

function lastDataRow_(sh, first, columns) {
  const max = sh.getMaxRows();
  const vals = sh.getRange(first,1,max-first+1,Math.max.apply(null,columns)).getValues();
  let last = first - 1;
  vals.forEach((r,i) => {
    if (columns.some(c => r[c-1] !== '' && r[c-1] !== null)) last = first + i;
  });
  return last;
}

function parseDate_(value) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Ngày giao dịch không hợp lệ');
  return new Date(s + 'T00:00:00');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

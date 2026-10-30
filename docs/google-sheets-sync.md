# Google Sheets sync setup

The Android app sends only recorded transactions and cash deposits/withdrawals. The in-app daily P/L metric is never sent to Google Sheets.

## One-time setup

1. Open the Google Sheet with ID `1HjOSX7PgHFJ3FgrWuoqGSue-TMEkJa3EuOsJUFlwvQI` using the Google account that owns it.
2. Open **Extensions → Apps Script**.
3. Replace the editor contents with `Code.gs` from this repository.
4. Change `SYNC_TOKEN` to a long random value of your own. Do not share it.
5. Save, then choose **Deploy → New deployment → Web app**.
6. Set **Execute as: Me** and **Who has access: Anyone**, then deploy and approve Google's permission prompt.
7. Copy the Web app URL ending in `/exec`.
8. In SoChungKhoan, open **Google Sheets**, paste the URL and the same token, save, then tap **Đồng bộ ngay**.

The endpoint checks the token before writing. Use a private token, and do not publish it in screenshots or messages.

## What gets written

- Buy and sell events go to the existing tab named after the ticker.
- Cash dividends are written to column G with the note `ct bằng tiền`.
- Bonus shares are written as zero-cost buy quantity with the note `CP thưởng`.
- Deposits and withdrawals go to the `Dash board` tab, in the transaction area beginning at row 9.
- A hidden `_AppSync` tab records event IDs so repeated syncs do not duplicate rows.
- Summary SUM formulas are extended only when a new row passes their current end row. Existing P/L formula logic is not rewritten.

If the app reports that a ticker tab is missing, create a tab with the exact ticker name first, using the same column layout as the other stock tabs.

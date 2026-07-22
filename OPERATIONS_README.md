# RISING 6台運用メモ

既存の `jag.html` の抽選ロジック・スロット表示は変更せず、外側に運用ページと管理APIを追加しています。

## 本番方針

Vercel + Supabase で運用します。

- 通常プレイ中の台データ: 1分ごとにSupabaseへ上書き保存
- 終了時データ: 終了ボタンを押した瞬間の最新データを即時保存
- パスワード発行/使用: 即時保存
- 管理リセット/強制終了/設定変更: 即時保存
- 管理画面/台選びページ: 1分ごとに再読込
- Realtime/SSEは使わず、ポーリングで負荷を抑える

## Supabase準備

SupabaseのSQL Editorで `supabase_schema.sql` を実行してください。

VercelのEnvironment Variablesに以下を設定します。

```bash
SUPABASE_URL="https://xxxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="Supabase service role key"
ADMIN_PASSWORD="任意の管理パス"
GOOGLE_SHEETS_WEBHOOK_URL="https://script.google.com/macros/s/xxxx/exec"
```

`GOOGLE_SHEETS_WEBHOOK_URL` は未設定でも動きます。その場合、終了履歴はSupabaseの `session_results` に保存されます。

## Vercelで開くページ

- 管理画面: `https://あなたのドメイン/admin.html`
- お客様入口: `https://あなたのドメイン/play.html?machine=1`
- 台選びページ: `https://あなたのドメイン/machines.html`
- スロット本体: `https://あなたのドメイン/jag.html?machine=1`

台ごとの入口は `machine=1` から `machine=6` までです。

## ローカル確認

```bash
node server.js
```

開くページ:

- 管理画面: `http://localhost:8787/admin.html`
- お客様入口: `http://localhost:8787/play.html?machine=1`
- 台選びページ: `http://localhost:8787/machines.html`

ローカル確認では `data/admin-state.json` と `data/session-results.jsonl` に保存されます。

## 請求用差枚

終了データには台の累計とは別に、開始から終了までのその人分だけを計算した項目が入ります。

- `playerProfit`: その人の差枚pt。請求判断の基準
- `playerTotalFee`: その人が投入したpt
- `playerTotalPaid`: その人に払い出されたpt
- `playerSpins`: その人の回転数
- `playerBigCount` / `playerRegCount`: その人のBB/RB回数

スプレッドシート管理では `playerProfit` を請求用の差枚として使ってください。

## Apps Script例

```js
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('results') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('results');
  const data = JSON.parse(e.postData.contents);
  sheet.appendRow([
    data.endedAt,
    data.machineId,
    data.playerName,
    data.setting,
    data.totalSpins,
    data.bigCount,
    data.regCount,
    data.grapeCount,
    data.totalFee,
    data.totalPaid,
    data.profit,
    data.playerProfit,
    data.playerTotalFee,
    data.playerTotalPaid,
    data.playerSpins,
    data.playerBigCount,
    data.playerRegCount
  ]);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
```

## 注意

- 管理画面と台選びページの表示は最大1分遅れます。
- 終了時・パスワード使用・リセット・設定変更は即時保存です。
- お客様が終了した台は、管理リセットまで使用不可になります。
- スランプグラフは管理リセットまで保持されます。

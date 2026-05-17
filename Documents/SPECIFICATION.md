# 白い悪魔スロット 仕様書

## 概要

白い悪魔スロットは、`index.html` を台画面、`admin.html` を管理画面、`server.js` をローカル同期サーバーとして構成するブラウザ向けスロットです。基本UIとビジュアルは白い悪魔デザインを維持し、スロットの抽選ロジックと演出仕様は GitHub 版 `ntriziinfo/whitedevil` の `gorai.html` 由来の新仕様を反映しています。

## 実行方法

- スタンドアロン表示: `index.html`
- ローカルサーバー表示: `node server.js`
- 台画面: `http://localhost:8787/?machine=台1`
- 管理画面: `http://localhost:8787/admin.html`

## 台画面

- 上部タブは表示しません。
- KVとページ背景は `assets/backgrounds/bg_fire_ice.png` を使用します。
- リール枠、DEVIL DATA、データカウンター、BONUS INFO は白い悪魔UIの素材と配置を維持します。
- BET / STOP / AUTO は素材ボタンを絶対配置で重ね、台枠のボタン位置に合わせます。
- プレミア動画、BAR3動画、継続バトル導入はリール窓の範囲にクリップし、BET / STOP / AUTO ボタン帯に被せません。

## スロット仕様

- 1回転ごとに `3pt` を差し引きます。従来のBET即ST開始ではなく、通常・高確を回してBONUS確定を目指します。
- 通常時は `NORMAL_CEILING_GAMES = 300G` の天井を持ちます。
- 高確は `HIGH_MODE_GAMES = 30G` です。スイカ、チェリー、ベル、砂時計などを契機に移行抽選します。
- BONUS確定後は次BETで7揃いを表示し、その後にSTへ突入します。
- ST中は1SET `settings.stSpins` Gを消化し、終了後は4Gの継続バトルへ移行します。
- 継続バトル終了時に勝利していれば次SETへ進み、敗北時は「STバトルが終了しました。」の結果画面を表示します。
- BIGはデビルゾーン5Gへ入ります。
- REGはSETストック+1です。
- BAR3は全設定共通の1/8192プレミアフラグで、SET+5と継続率80%以上への昇格です。
- 固定払い出しは `ROLE_PAYOUTS` で管理します。主な値は、BIG/REG/BAR3/砂時計/ベル `15pt`、リプレイ/スイカ `3pt`、チェリー系 `5pt` です。
- 差枚履歴は `stats.slumpHistory` に最大800点まで保存します。
- 設定別目標機械割は、設定1=80%、設定2=90%、設定3=97%、設定4=101%、設定5=110%、設定6=120%です。

## 通常・高確・BONUS状態

- `normalState` が通常時の状態を保持します。
  - `mode`: `normal` または `high`
  - `highRemain`: 高確残りG
  - `sinceBonus`: BONUS間ゲーム数
  - `bonusPending`: BONUS確定後、7揃い待ちかどうか
  - `bonusSource`: BONUS確定契機
- `drawNormalResult()` は通常・高確中の役抽選を担当します。
- `resolveNormalOutcome()` は天井、直撃、高確移行、BONUS確定、7揃い待ちを解決します。
- `applyNormalResult()` は通常時の払い出し、役カウント、高確残り、BONUS確定表示、ST突入表示を更新します。

## 演出仕様

- BIGプレミア演出は `assets/puremia.mp4` を使用します。
- BAR3成立時のレバーオン演出は `assets/bar3_lever_on.mp4` を使用します。
- BELL成立時はST/バトル/デビルゾーン中のみ、停止前に `assets/zako1.mp4`、各STOP時に `assets/zako1-2.mp4` をリール内で再生します。通常・高確中はボタン帯に被らないよう動画を出しません。
- pt払い出しが発生した場合は `assets/payout.wav` を再生します。
- 継続バトル中は `assets/battle_bgm.wav` をループ再生します。バトルBGMは通常BGM/BAR専用BGMより優先し、次SET・終了・初期化時に停止します。
- 継続バトル導入は `assets/battle/battle.png`、`assets/battle/round_*.png`、`assets/battle/character_*.png` を使用します。
- 終了結果画面背景は `assets/result/aozora.jpg` を使用します。
- リプレイ図柄は `assets/replay.png` を使用します。
- 音声素材は `assets/voice/*.wav` を使用します。
- BGM/効果音/動画音声は内部スケールを通して出力します。初期値はBGM `0.22`、効果音 `0.32` です。

## 管理画面

- `server.js` のSSE/APIを通じて複数台の状態をリアルタイム確認できます。
- 各台の設定更新、個別リセット、全台リセット、デバッグ用の直撃操作に対応します。
- 台画面は `machine` クエリで台IDを指定します。
- 管理画面の台カードには通常・高確・BONUS確定状態、BIG/REG/総回転数/砂時計/ベル/リプレイ/スイカ/チェリー/損益を表示します。
- デバッグ出目指定には `REPLAY` を含みます。
- 1回転コストは現在 `3pt` 固定で、管理画面では読み取り専用です。

## 既知の制約

- `file://` 表示でも本体は動作しますが、管理画面とのリアルタイム同期を使う場合は `node server.js` でHTTP表示してください。
- ローカル作業フォルダは単体Gitではなくホームディレクトリ配下の作業物です。GitHub PR用のコミットは `ntriziinfo/whitedevil` のクローン側に同期して作成します。

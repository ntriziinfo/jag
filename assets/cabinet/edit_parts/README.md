# RISING cabinet edit parts

このフォルダは、筐体画像を編集しやすいように分解したPNG置き場です。

## そのまま編集しやすい分解パーツ

- `00_full_reference.png` - 全体の参照画像
- `01_top_lamp_full.png` - 上部ランプ一式
- `02_big_chance_panel_full.png` - BIG CHANCE / 777パネル
- `03_rising_logo_bridge_full.png` - RISINGロゴ橋とスピーカー
- `04_reel_panel_back_full.png` - リール周り背面
- `05_reel_front_frame_overlay.png` - リール前面枠。リール窓は透明
- `06_control_deck_full.png` - レバー、停止ボタン周り
- `07_lower_panel_full.png` - 下部RISINGパネル
- `08_bottom_base_full.png` - 最下部ベース
- `09_start_lever_cutout.png` - スタートレバー可動部品
- `10_stop_button_red_cutout.png` - 停止ボタン赤
- `11_stop_button_blue_cutout.png` - 停止ボタン青
- `12_rising_chance_lamp.png` - RISING CHANCEランプ
- `13_reel_window_guide.png` - リール窓位置ガイド

## いまHTMLが使っている実装用パーツ

プレビューに直接反映される筐体レイヤーは、ひとつ上の `assets/cabinet/parts` にあります。

- `rising_part_top.png`
- `rising_part_reel_back.png`
- `rising_part_reel_front.png`
- `rising_part_controls.png`
- `rising_part_lower.png`

編集した画像をプレビューへ反映したい場合は、同じサイズで上の実装用パーツに置き換えるのが一番早いです。

## 位置情報

`parts_manifest.json` に元画像基準の切り出し座標を入れています。

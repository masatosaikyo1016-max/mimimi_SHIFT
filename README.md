# シフト調整・自動編成アプリ（Hoa Hoa / guu table / GALLERY）

**Hoa Hoa** / **guu table** / **GALLERY** の3部門に対応した、月間シフト調整・カレンダー集計アプリです。

## 主な機能・仕様

1. **部門別の営業時間・ラストオーダー表示に対応**
   - **「Hoa Hoa」**：`10:00〜23:00`（`L.O 21:00`）
   - **「guu table」**：`10:00〜23:00`（`L.O 21:30`）
   - **「GALLERY」**：`10:00〜19:00`

2. **3つの勤務先と「GALLERY」4名＆10:00〜19:00制限ルール**
   - 配属先は **「Hoa Hoa」**、**「guu table」**、**「GALLERY」** の計3つです。
   - **「GALLERY」** の勤務は **塩沢・内山・岡村・大塚** の4名のみ、かつ **10:00〜19:00** の間のみ割り当て可能です。
   - 上記4名以外の名前、または19:00以降のシフトは、自動的に「Hoa Hoa」または「guu table」の人数が少ない方へ振り分けられます。

3. **同日2枠（GALLERY → Hoa Hoa などのヘルプ出勤）対応**
   - 同じ日付でも時間帯が重なっていなければ、**1日に2つまで** シフトを指定できます（例：第1シフト `GALLERY 10:00-17:00` ＋ 第2シフト `Hoa Hoa 17:00-22:00`）。

4. **遅番不足時の「岡村・内山・塩沢」22:00までの自動調整ルール**
   - 4名（岡村・塩沢・大塚・内山）以外のスタッフ入力があり、かつ店舗（Hoa Hoa / guu table）の遅番が不足している日は、**その日にすでに希望を出している「岡村・内山・塩沢」** の3名のうち誰かを自動的に **22:00まで** の店舗出勤に調整します（※希望日以外の勝手なシフト追加は行いません。また大塚は遅番22:00調整の対象外です）。

5. **複数日一括選択時の「日にちごとの時間変更」対応**
   - 「複数日・曜日一括」タブでカレンダーから複数の日付を選択した際、選んだ日にちごとに開始・終了時間を個別に変更して一括登録できます。

6. **専用URL（トークン付きURL）限定アクセス＆全員リアルタイム共有**
   - URLの末尾に秘密のトークン（`?key=hhgt_8x9k2m4p7w3q`）が付いている専用URLを知っている人のみ画面を開ける仕組みです。
   - トークンなしのURLに直接アクセスした場合は「🔒 専用URL限定ページ」というロック画面が表示され、中身は閲覧・入力できません。
   - 画面右上の **「🔗 LINE共有URLをコピー」** ボタンを押すだけで、LINEに貼り付けられる招待用URLをコピーできます。

---

## PCの電源を切っても24時間使えるようにネット上へ無料公開する手順（Render.com の例）

このフォルダには、全員の入力したシフトをサーバー上で共有保存できる [server.js](file:///c:/Users/super%20prime/Documents/antigravity/friendly-shannon/server.js)、[package.json](file:///c:/Users/super%20prime/Documents/antigravity/friendly-shannon/package.json)、[render.yaml](file:///c:/Users/super%20prime/Documents/antigravity/friendly-shannon/render.yaml) が同梱されています。

1. **GitHub にこのフォルダをアップロード（Push）する**
   - GitHubで非公開（Private）または公開リポジトリを作成し、このフォルダ内のファイルをアップロードします。
2. **Render.com（無料クラウドサーバー）と連携する**
   - [Render.com](https://render.com/) に無料ログインし、**「New +」→「Web Service」** を選びます。
   - 手順1のGitHubリポジトリを選択します。
   - 起動コマンド（Start Command）に `node server.js`、プランに **Free（無料）** を選んで **「Create Web Service」** を押します。
3. **LINEに専用URLを共有する**
   - 数分で `https://〇〇〇.onrender.com` というURLが発行されます。
   - 末尾に `?key=hhgt_8x9k2m4p7w3q` を付けた以下の形式のURL（または画面右上の「🔗 LINE共有URLをコピー」でコピーしたURL）をLINEグループ等に貼って共有してください：
     `https://〇〇〇.onrender.com/?key=hhgt_8x9k2m4p7w3q`

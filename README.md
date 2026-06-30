# 送迎管理 本番再作成版 v76

v69以降で壊れた追加・編集処理を使わず、画面・スクリプト・GASを確認し、最初から整理して作り直した版です。

## 構成

```text
index.html
assets/css/app.css
assets/js/app.js
gas/Code.gs
docs/
```

## 重要

GitHubへは `index.html` と `assets/` を必ず上書きしてください。
Apps Scriptは `gas/Code.gs` を貼り替えてください。

## データ方式

年度JSON管理です。

```text
送迎管理データ_JSON/
  system.json
  masters.json
  holidays.json
  fiscal-2026.json
  backups/
```

## 確認済み

- JavaScript構文チェック
- index.html / CSS / JS / GAS の構成確認
- v70〜v75の後付け競合処理を不使用
- 追加・編集ポップアップを1本化
- PC / スマホ共通イベント処理

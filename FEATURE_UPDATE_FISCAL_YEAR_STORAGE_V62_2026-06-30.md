# v62 年度JSON管理

- 月別JSON中心の読み込みをやめ、年度JSONを中心に管理します。
- 起動時に `fiscal-YYYY.json` を1回読み込みます。
- 月切替は画面内データで行うため、毎月Driveへ読みに行きません。
- 既存の月別JSONから年度データを作成できます。
- 保存は年度JSONへまとめて保存します。

## Google Drive構成

```text
送迎管理データ_JSON/
  system.json
  masters.json
  fiscal-2026.json
  fiscal-2027.json
  backups/
```

## 注意

v62からはGAS側も更新してください。`gas/Code.gs` をApps Scriptへ貼り替え、`APP_TOKEN` を現在のトークンに合わせてください。

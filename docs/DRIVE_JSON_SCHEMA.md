# Drive JSON Schema v62

## 年度管理

```text
送迎管理データ_JSON/
  system.json
  masters.json
  fiscal-2026.json
  fiscal-2027.json
  holidays.json
  backups/
```

## fiscal-YYYY.json

```json
{
  "fiscalYear": 2026,
  "meta": { "version": 1 },
  "months": {
    "2026-04": {
      "schedules": [],
      "trips": [],
      "changes": [],
      "logs": []
    },
    "2026-05": {
      "schedules": [],
      "trips": [],
      "changes": [],
      "logs": []
    }
  },
  "masters": {},
  "holidays": {},
  "config": {}
}
```

月ごとの作成は今まで通りですが、保存先は年度JSON内の `months[YYYY-MM]` です。

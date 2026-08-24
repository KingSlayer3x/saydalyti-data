# saydalyti-data — بيانات الصيدليات المناوبة

Public data repository for the صيدليتي (Saydalyti) app.
This data is public information (duty schedules are posted publicly). No secrets live here.

## Structure

```
cities.json                      # list of supported cities
schedules/{cityId}/{YYYY-MM}.json  # one file per city per month
```

## Schedule file format

```json
{
  "city": "dreikish",
  "month": "2026-09",
  "updatedAt": "2026-08-24T00:00:00Z",
  "days": {
    "01": [ { "nameAr": "...", "district": "...", "address": "...", "phone": "..." } ],
    "02": [ ... ]
  }
}
```

- `days` keys are zero-padded day-of-month strings ("01" … "31").
- A day may have multiple pharmacies on duty.
- Updated monthly via the local `extract.ts` tool (Ollama vision extraction + human review).

## Consumed by the app via

- Primary: `https://raw.githubusercontent.com/{USER}/saydalyti-data/main/...`
- Mirror:  `https://cdn.jsdelivr.net/gh/{USER}/saydalyti-data@main/...`

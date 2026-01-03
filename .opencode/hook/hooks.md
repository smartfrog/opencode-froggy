---
hooks:
  - event: session.idle
    conditions: [hasCodeChange]
    actions:
      - bash: "npm run test"
---

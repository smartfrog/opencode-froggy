---
hooks:
  - event: session.idle
    condition: isMainSession
    actions:
      - command: simplify-changes
---

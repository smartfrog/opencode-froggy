---
hooks:
  - event: session.idle
    condition: hasCodeChange
    actions:
      - command: simplify-changes
---

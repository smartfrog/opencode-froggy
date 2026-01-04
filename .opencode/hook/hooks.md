---
hooks:
  - event: session.idle
    conditions: [hasCodeChange, isMainSession]
    actions:
      - command: /simplify-code
      - bash: "npm run test"
---

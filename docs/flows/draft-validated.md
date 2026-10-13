# A draft decided by a person

```mermaid
sequenceDiagram
  participant P as Person
  participant C as Copilot
  participant A as App (/mcp)
  participant V as View ui://kete/review
  P->>C: "Affecte Yao au chantier Biasa du 3 au 14"
  C->>A: assignments_assign (level 3)
  A-->>C: a draft and its review
  C->>V: shows the view in the conversation
  P->>V: corrects, validates
  V->>A: kete_draft_validate (the view only)
  A->>A: assign, journaled: Mme Lawson, through "view" — refused if Yao is not authorised
  A-->>V: validated
```

Level 4 is decided at `/verification/$draftId`, with its confirmation; that address is always the
way back from a copilot.

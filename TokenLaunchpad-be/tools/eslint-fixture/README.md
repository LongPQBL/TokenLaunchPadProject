# ESLint fixture

`bad.tsx.txt` is not linted by default. CI renames it to `.tsx`, runs ESLint on it, and requires a
non-zero exit: it proves the `dangerouslySetInnerHTML` ban is actually wired up, rather than silently
dropped by a config change.

# Coding Standards

## TypeScript
- Usa `const` per default, `let` solo se la variabile viene riassegnata; mai `var`
- Tipizza sempre i parametri e il return type delle funzioni
- Evita `any` — usa `unknown` se il tipo è incerto
- Usa `type` per alias semplici, `interface` per oggetti estendibili
- Niente `!` (non-null assertion) — gestisci sempre il caso null/undefined

## Style
- Indentazione a 2 spazi
- Single quotes per le stringhe
- Trailing commas in array e oggetti multi-riga
- Lunghezza massima riga: 100 caratteri

## Funzioni
- Funzioni pure quando possibile (no side effects nascosti)
- Max 20 righe per funzione — se è più lunga, spezza
- Nomi descrittivi: `validateEmail` non `check` o `doStuff`
- Un solo livello di astrazione per funzione
- Arrow functions per callback ed espressioni brevi

## Error Handling
- Mai ingoiare errori con `catch {}` vuoto
- Usa errori tipizzati con messaggi chiari
- Valida sempre gli input alle boundary (API, CLI, form)
- Usa early return per ridurre il nesting

## Naming
- camelCase per variabili e funzioni
- PascalCase per classi e tipi
- SCREAMING_SNAKE_CASE per costanti globali
- Nomi in inglese

## Testing
- Ogni funzione pubblica deve avere almeno un test happy path e uno edge case
- Testa i boundary: stringa vuota, null, valori estremi
- Nomi test descrittivi: `it('returns false for email without @', ...)`

## Code Quality
- Niente codice commentato — usa git per la storia
- Niente magic numbers — estrai costanti con nome
- Importa solo ciò che usi
- Ordine import: node built-in → third party → internal

## Security
- Mai committare segreti, API key o credenziali
- Valida e sanitizza i path prima di operazioni I/O
- Usa query parametrizzate per qualsiasi data store

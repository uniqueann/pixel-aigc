# Email Assistant & Billing

Email Assistant provides Summarize, Reply, Polish, and Fix Grammar workflows in both Single and CSV Batch modes using platform-managed AI models.

## Models & Credit Pricing

| Model | Recommended Use | Per Successful Run |
|---|---|---|
| DeepSeek Flash | Chinese emails & Chinese batches | 1 credit |
| DeepSeek V4 Pro | Upgraded reasoning option | 3 credits |
| Gemini 3.8 Flash | English & European languages / batches | 3 credits |

Credits are reserved on submit, settled once a complete result is saved, and refunded on failure or timeout. Regenerating creates a new billed task; browsing history, editing existing text, copying, and exporting CSV cost nothing. Purchased and bonus credits both apply, and you can save your default model in **Settings → Personalization**.

## Single Email Mode

Paste your email text, select operation, target language, and model, verify credit cost, and generate. Maximum source length is 10,000 characters and guidance up to 1,000 characters (very long inputs may truncate cleanly).

Supported output languages include Chinese, English, Japanese, French, German, Spanish, Portuguese, and Italian. DeepSeek Flash is recommended for Chinese; Gemini 3.8 Flash is recommended for English and European languages (your manual model selection always takes priority).

## Batch CSV Mode

1. Download the 4-column template (`Source Email`, `Instructions`, `Settings`, `Language` — Chinese CSV headers are also accepted automatically).
2. Upload a UTF-8 CSV file (up to 50 rows and 5 MB), review any row validation errors, and confirm effective settings.
3. Pick one unified model for the batch, review estimated total credits and balance, and start running (locked once started). For mixed languages, pick a capable model or split batches.
4. Rows run sequentially (up to 60/hour) and pause cleanly on low balance, service issues, or price changes so you can top up and resume.
5. Export CSV anytime to save results, statuses, error details, models, and credits charged.

## Recovery & Retention

Batches stay in the current tab session (safe when switching Single / Batch tabs, paused on refresh/navigation). Submitted jobs continue on the server and appear in 7-day history — check recovery before re-submitting uncertain requests.

Email drafts and revisions are retained for **7 days** (deleting a task does not refund completed runs — export important copy promptly). Credit ledger records are kept permanently.

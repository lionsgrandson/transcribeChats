# ChatGPT import repair

Study Library and Conversation Audit accept the full ChatGPT second-pass response.

Import order:
1. Save the raw ChatGPT response locally.
2. Try direct structured parsing and normalization in the browser.
3. If the response is malformed, send it to the local Ollama worker for structural repair into the exact app schema.
4. Apply the repaired structured result while preserving compatible study progress IDs.
5. Keep the original ChatGPT response available in the ChatGPT tab even if repair fails.

The clipboard action pastes and applies in one step, and the UI shows repair progress while Ollama is working.

# TranscribeChats | ₪45 Subscription Unit Economics and Production Release Plan

**Prepared:** 2026-10-12. **Status:** planning model, not proof that billing or production is live.  
**Currency:** ILS, with USD at **₪3.0780 per $1** (Bank of Israel representative rate on 2026-10-12). The actual settlement rate may differ.

## 1. Executive decision

**Recommended entry tier: ₪45/month including up to 20 audio hours per subscriber per billing period**, assuming the pricing includes applicable sales tax/VAT. Summaries and transcript corrections should not be metered separately for the included hours; record actual inferred minutes to prevent abuse. Use transparent upgrades/top-ups rather than degrading transcription quality or truncating long files. Suggested (not approved) higher tier: **₪89/month with up to 60 hours**. Additional hour packs must be validated against real usage and transaction fees. **Do not activate charging until a payment merchant is approved, webhooks are verified, legal pages are approved and entitlements are enforced server-side.**

**Do not build a paid SLA around a shared free Gemini project.** The free tier is project-wide and also shared with StudentTranscribe if both apps use the same project. A single heavy customer or a burst of small requests can exhaust the quota. Increasing the user-facing token cap or retry frequency does not increase the provider quota. Automatic retries provide eventual recovery only while the job remains valid and free-tier capacity returns. For paid customers, purchase predictable capacity at low per-token pricing and use the free quota as opportunistic savings, never as a guaranteed production capacity. Verify the account-level limits at https://aistudio.google.com/rate-limit .

**Quality first:** retain the full transcript, preserve timestamps and speakers, do not deliberately drop words to fit a quota, do not claim Whisper supports true speaker diarization, handle Hebrew/English, benchmark long recordings, and test summary factuality. A 120,000-character single-summary request and 3,072-output-token cap are currently engineering safeguards, **not** a promise that every length has adequate summarization quality. Full-length audio needs durable transcription storage and chunk-safe resumable processing beyond the current 8 MiB hosted audio endpoint.

## 2. Verified provider rates and modeled usage

| Component | Provider list price / quoted inclusion | Source |
| --- | --- | --- |
| Speech to text | Cloudflare `@cf/openai/whisper-large-v3-turbo`: **$0.000513 per audio minute** | https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/ |
| AI summary | Gemini **3.5 Flash-Lite** Standard paid: **$0.30 per 1M input tokens**, **$2.50 per 1M output tokens**; free tier shown as free of charge, subject to limits, and may be used to improve Google's products | https://ai.google.dev/gemini-api/docs/pricing |
| Gemini quotas | RPM, TPM, RPD and model/project-level availability are dynamic. The exact free quota for **this account is unknown** and must not be invented. | https://ai.google.dev/gemini-api/docs/rate-limits |
| Workers runtime | Cloudflare Workers Paid minimum **$5/account/month** (if paid plan is required and not already held); other usage charges can apply | https://developers.cloudflare.com/workers/platform/pricing/ |
| Cloudflare Workers AI | **10,000 Neurons/day** included. Excess usage on eligible paid plans billed using model-specific conversion; daily free allocation is not a commitment to unlimited free inference | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| Durable Objects | SQLite-backed Durable Object usage has included requests/storage and metered overages; alarms are billed as operations | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| Billing | Paddle public standard checkout rate **5% + $0.50 per transaction**, subject to merchant agreement and possible special rules for low-value transactions | https://www.paddle.com/pricing |
| Tax | **18% VAT** is modeled only for a VAT-inclusive Israeli consumer transaction. The actual supplier/merchant-of-record treatment, tax registration and customer location require accountant and provider validation | https://www.paddle.com/help/sell/tax/which-countries-does-paddle-charge-sales-tax-or-vat-for |

The following audio token workload is **an assumption, not a production benchmark**: per hour of audio, 15,000 Gemini summary **input** tokens and 2,000 **output** tokens (including multiple summaries per recording). Actual usage can be higher for long transcripts, multiple models, retries, multilingual content, revisions and other tasks. **Measure actual provider token usage and recording minutes** before publishing an inclusive-hour commitment.

Assumed cost per fully utilized audio hour:

```text
Whisper: 60 minutes × $0.000513 = $0.030780
Gemini input: 15,000 / 1,000,000 × $0.30 = $0.004500
Gemini output: 2,000 / 1,000,000 × $2.50 = $0.005000
Estimated AI cost: $0.040280/hour = ₪0.123982/hour
```

| Included audio hours actually used/month | AI cost USD (estimate) | AI cost ILS (estimate) |
| ---: | ---: | ---: |
| 2 | $0.0806 | ₪0.25 |
| 10 | $0.4028 | ₪1.24 |
| 20 | $0.8056 | ₪2.48 |
| 40 | $1.6112 | ₪4.96 |
| 60 | $2.4168 | ₪7.44 |

These amounts exclude all fixed hosting, storage, email, payment processing, taxes, customer support, recording retries, fraud, chargebacks, CRM/Supabase services, any additional AI validation pass, currency spread and refunds. Cloudflare Workers AI is a **separate** cost from Gemini, even when Gemini is free.

## 3. ₪45 monthly order economics

*Gross charge to subscriber* = **₪45.00**. If VAT-inclusive and tax at 18%, modeled tax share = `45 × 18 / 118 = ₪6.86`; ex-tax proceeds = **₪38.14**. This is only a tax scenario, not an assessment of the owner's registration or a guarantee of withholding at checkout.

*Paddle-style processor fee estimate* = `45 × 5% + $0.50 × 3.078 = ₪3.79`, before any special foreign-currency, tax-base, FX, low-ticket or additional charges. Confirm fee treatment in the signed merchant agreement.

| Per subscriber / month | 2-hour customer | 10-hour customer | 20-hour customer |
| --- | ---: | ---: | ---: |
| Gross customer price | ₪45.00 | ₪45.00 | ₪45.00 |
| Illustrative tax deducted | (₪6.86) | (₪6.86) | (₪6.86) |
| Estimated payment fee | (₪3.79) | (₪3.79) | (₪3.79) |
| Estimated AI cost | (₪0.25) | (₪1.24) | (₪2.48) |
| **Illustrative contribution before shared overhead, support, CAC and income tax** | **₪34.10** | **₪33.11** | **₪31.87** |

**Important:** The table above is **contribution margin, not net profit or cash in hand**. It assumes an accepted merchant-of-record account, 100% collection, no refund and constant FX. Do not quote it as an audited margin.

### Subscriber scenarios, every user consumes the full 20h

| Paying customers | Gross recurring sales (MRR) | VAT scenario | Payment fees | Estimated AI usage | Illustrative margin BEFORE fixed/marketing/support/tax |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | ₪2,250 | ₪343.22 | ₪189.45 | ₪123.99 | ₪1,593.34 |
| 100 | ₪4,500 | ₪686.44 | ₪378.90 | ₪247.96 | ₪3,186.70 |
| 500 | ₪22,500 | ₪3,432.20 | ₪1,894.50 | ₪1,239.82 | ₪15,933.48 |
| 1,000 | ₪45,000 | ₪6,864.41 | ₪3,789.00 | ₪2,479.63 | ₪31,866.96 |

An initial **$5/month** Cloudflare base fee alone is **₪15.39/month** at the quoted FX, before any overages. More important growth costs are likely acquisition, churn, support and infrastructure for long-recording storage/processing; none are measured yet.

### CAC and retention sensitivity

If illustrative 20-hour contribution is ₪31.87/month before overhead, then **₪100 customer-acquisition cost** takes **3.14 paid months** of that contribution to recover if there is no churn, refunds or support burden. At 3% monthly churn the naive expected duration `1 / 0.03` is 33.3 months; at 10% it is 10 months, but these are theoretical averages, not forecasts. Track activation, paid conversion, net revenue retention, MRR, cancellation reason, real per-user audio hours and actual unit costs weekly. Target CAC payback within **3 months** as an operating hypothesis to test, not a verified benchmark.

## 4. Scalability and quota bottleneck

Revenue grows linearly with subscribers, but a shared free-tier account does not automatically grow its RPM/TPM/RPD. Formula for daily summary throughput:

```text
Maximum daily jobs = min(
  remaining provider requests/day,
  sustainable requests/minute × minutes/day,
  available input tokens/day ÷ mean input tokens/job,
  application admission/processing capacity
)
```

For example, **hypothetical only**, at 100 summary requests/day across the shared Google project, 200 customers submitting one summary/day creates a 100-job daily deficit, even if speech-to-text capacity is unlimited. Daily backlog would compound. Do not advertise 100/day as a verified Google limit. With 1 summary per minute per user and an unknown daily project limit, the current per-user throttle alone is **not** sufficient for scale. Add a **project-global concurrency and daily token budget** when billing is activated. The 20h/user plan is an economic and fair-use control, not a substitute for global capacity management.

**Quality and privacy:** Standard Gemini free-tier usage may be used to improve the provider's products; review Google terms, data retention and consent before processing other people's private conversations. Paid processing and the applicable provider data-use terms are preferable for commercial audio with consent requirements. Never leak API keys to the browser.

## 5. Limits and plan enforcement architecture (not yet live)

1. Choose merchant/payment provider supported for an Israeli seller, complete KYC, merchant agreement, verified merchant of record/VAT treatment and legal policy review.
2. Price **₪45/month**, 20 audio hours included, with optional higher tier. State exact cancellation/refund and renewal terms. Do not market free or unlimited audio when recording length, storage or API constraints prevent it.
3. Store **server-verified subscriptions** (provider subscription ID, status, period boundaries, plan, hours included). Confirm provider webhooks with signature verification, replay protection and idempotent event processing. Client-displayed status is not authorization.
4. At upload admission, reserve audio minutes **transactionally** against a durable per-user billing-period ledger. Verify real audio duration server-side; do not trust a `duration` sent from the browser. Prevent concurrent upload overspending, replay and duplicate processing. Reconcile and refund unused reserved minutes after failure; charge only processing time according to explicit terms. Store cost usage for monitoring.
5. Choose a commercial-grade queue plus temporary R2 storage for large files. Prevent audio loss across browser closing and worker timeouts. The **current hosted 8 MiB single-request Whisper endpoint does not deliver that**.
6. Monitor Gemini input/output tokens, requests and failures, Workers AI audio minutes/neurons, object storage and egress, queue retries, payment fees, and total realized contribution margin. Enforce separate global cost ceilings; alert before approaching configured budgets.
7. Deploy staging, run real E2E recordings in both languages, account isolation, auth, billing webhook fixtures, rate-limit exhaustion, failed payment, cancellation, retry, refund, 20-hour rollover behavior, quotas and microphone/mobile tests.
8. Only publish prices and accept payments after the live workflow is verified end-to-end. **Billing has not been provisioned or verified in TranscribeChats.**

## 6. Quota-aware background retry implementation in the normal app

Implemented source design:
- Authenticated `POST /v1/analyze` with an `Idempotency-Key` submits a summary job to `GEMINI_JOBS`, a SQLite-backed Cloudflare Durable Object; `GET /v1/analyze/{jobId}` polls verified-user status.
- The audio and completed transcript stay in the original client IndexedDB. The Worker queues summary **text only**. The server keeps pending summary text up to **72 hours**, then discards it; completed results remain available for **24 hours** before expiry.
- `429` or transient upstream failures schedule a Durable Object alarm with provider `Retry-After` / retry metadata when available, otherwise exponential backoff. The queue stops after **12 attempts** or **72 hours** and reports failure. Neither a reset estimate nor an eventual completion is guaranteed.
- A saved job ID and status in the transcript detail view allow resumption after page reload. The browser displays an estimated next attempt, which is distinct from a guaranteed finish time.
- Gemini is only invoked with the API key kept as a Worker secret. A model cap of **3,072 output tokens** and a 120,000-character transcript cap prevent unbounded single-request costs. Requests above that need a more capable chunked workflow; they are rejected, **not silently truncated**.
- During a 429 on **initial submission** before the server accepts the job, the browser retries when the app is reopened or stays open. Once accepted, the Durable Object schedules retries independently of browser state.
- ChatGPT export remains user-initiated: copy text locally and open ChatGPT; the app does not automatically send private content.
- Hosted Cloudflare Whisper `429` capacity and daily-neuron errors return retry guidance. The browser retains the audio in IndexedDB and schedules bounded automatic retries when the app is open or reopened; the estimated wait appears in the transcript view. This is **not** a server-side audio queue and cannot finish with every client offline. Non-quota or repeated failures remain recoverable by manual retry.


### Required deployment steps

Run on the authenticated owner machine, on the normal app repo:

```powershell
git pull origin main
npm ci
npm run check
node --test cloudflare/transcribe-worker.node.mjs
npx wrangler secret put GEMINI_API_KEY --config wrangler.transcribe.jsonc
PUBLISH-CLOUDFLARE.cmd
```

The correct **same StudentTranscribe Gemini key must be entered as a new secret for this Worker**. Cloudflare does not provide the existing secret value to GitHub. Do **not** paste secret values into commit history. Verify Cloudflare plan eligibility for Durable Objects, Workers AI allowance, required deployed Supabase credentials, origin restrictions and rollback strategy. The publish script currently deploys Worker before Pages and is **not a full atomic release/rollback**. Before a paid launch, implement signed entitlement checks, verified subscriptions, tested real payments, R2 audio queue, global budget enforcement and production monitoring. Their absence is a **deployment blocker for commercial production**, even if the optional Gemini summary feature itself works.

### Live readiness status

- [x] GitHub source includes idempotent Gemini Durable Object queue, bounded retries and resumable polling.
- [x] Normal-app transcript page includes queued status and estimated retry countdown.
- [x] Existing Whisper transcription and manual ChatGPT export flows remain in source.
- [ ] CI passing on latest commit independently confirmed.
- [ ] New Durable Object migration and Worker secret deployed and tested live.
- [ ] End-to-end Hebrew/English Gemini and speech-to-text testing with real accounts.
- [ ] Global provider quota budget and concurrency controls verified.
- [ ] Verified paid subscriptions, transactional hour ledger, webhooks and billing provider.
- [ ] Durable long-audio queue and separate temporary-media retention policy.
- [ ] Production launch with user-visible availability and rollback confirmed.

**Conclusion:** ₪45/month can be viable with appropriately metered 20 audio hours and high-quality transcription, but free Gemini quotas and an unfinished payment/billing backend are not commercial-grade scaling controls. No claims of a live paid rollout should be made without resolving these gates.

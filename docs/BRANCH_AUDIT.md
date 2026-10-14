# Branch reconciliation — 2026-10-14

Baseline: `ca82ed3` (latest remote main at integration start). Every remote branch was fetched and compared by ancestry, commit history and affected files. Unique commit counts do not imply missing features: several branches were previously squashed. The dispositions below describe the final behavior, including features subsequently hidden.

Recovery tags retain every original branch head. After review, history-only merge parents retain the reconciled commits without applying obsolete implementations over newer fixes. No shared history is rewritten.

## dev/gpu-transcription-task-controls

- Original head: `9eaa79fd9bcd716a19fbc08b811b4bbe36e8f4c1`
- Recovery tag: `archive/unification-20261014/dev/gpu-transcription-task-controls`
- Commits unique by ancestry at baseline: 0
- Disposition: GPU/task controls are already in main. Preserve and regression-test atomic bulk changes; restore navigation and CRM access.

## feat/full-learning-course

- Original head: `4fa0311e04a24bd97c3394ac6b8cc63c0919b875`
- Recovery tag: `archive/unification-20261014/feat/full-learning-course`
- Commits unique by ancestry at baseline: 2
- Disposition: Superseded by main de5714f and b35f374. Retain full lessons, mastery and review; restore Study Library navigation.

<details><summary>Original unique commits</summary>

- `4fa0311 Turn study packs into full learning courses`
- `1bbfeef Generate self contained full study courses`

</details>

## feat/interactive-quizzes-links

- Original head: `06f2677b290cfb16ba620ef69df279d6441cbe22`
- Recovery tag: `archive/unification-20261014/feat/interactive-quizzes-links`
- Commits unique by ancestry at baseline: 6
- Disposition: Superseded by main b35f374. Retain interactive questions and learning links; load their styles and route.

<details><summary>Original unique commits</summary>

- `06f2677 Fix interactive answer lint errors`
- `ae9040b Load interactive study styles`
- `82c7faf Style interactive study answers and learning links`
- `5e4bc44 Make quiz and test answers interactive`
- `f8d2980 Generate fully interactive quiz and test questions`
- `4ebcd26 Add interactive study question and resource tools`

</details>

## feature/sales-intelligence

- Original head: `dd00db987a71cb08f337aa310c47d8804f90fc32`
- Recovery tag: `archive/unification-20261014/feature/sales-intelligence`
- Commits unique by ancestry at baseline: 10
- Disposition: Superseded by main 5bad4d7. Worker/store retained; dedicated Sales workspace restores access and keeps inferred insights separate from tasks.

<details><summary>Original unique commits</summary>

- `dd00db9 Document sales intelligence workflow`
- `5142180 Bump TranscribeChats to 0.12.0`
- `6342354 Bump TranscribeChats to 0.12.0`
- `657fc55 Test sales intelligence evidence rules`
- `a55c3d9 Style sales intelligence cards`
- `1ed1262 Add sales intelligence meeting view`
- `212b216 Persist sales intelligence separately`
- `1403f47 Add sales intelligence worker client`
- `9c0f4b1 Expose sales intelligence worker endpoint`
- `ec99ec4 Add evidence-backed sales intelligence engine`

</details>

## feature/study-social-audit

- Original head: `f79dc1a35e3707ac914fd4e1e8af1259ccc281f0`
- Recovery tag: `archive/unification-20261014/feature/study-social-audit`
- Commits unique by ancestry at baseline: 23
- Disposition: Superseded by main 5bbbb25 and later course fixes. Restore both workspaces; retain newer schemas, normalization and progress. Old publishing scripts and runner workflow superseded by guarded local release.

<details><summary>Original unique commits</summary>

- `f79dc1a Align CRM workspace test with project-aware reference`
- `fe9707d Re-run CI after lint fix`
- `f58c313 Fix study path lint error`
- `45b1f62 Add build and Python syntax CI`
- `5c24912 Add Cloudflare Pages publish command`
- `0997f20 Add one-click local learning launcher`
- `ffc6b5c Load study progress styles`
- `b258fcb Style study mastery tracking`
- `63d755a Track mastery across study topics tasks and tests`
- `76c8ca7 Track study mastery and review progress`
- `f5a3202 Load learning workspace styles`
- `3eabdb2 Style learning and conversation audit workspaces`
- `2f91953 Add learning workspaces to navigation`
- `291740f Route study library and conversation audit workspaces`
- `44640e4 Add conversation social audit workspace`
- `2e02699 Add study library workspace`
- `8e36cdb Allow transcription jobs without default CRM analysis`
- `090c589 Expose study and social audit Ollama endpoints`
- `8676a1b Add local Ollama study and social audit generation`
- `3b739bb Add structured study and social audit schemas`
- `af23bad Add Ollama study and social audit clients`
- `10a3828 Add local study and social audit storage`
- `7103e18 Add study and social audit domain models`

</details>

## feature/transcription-only-cloudflare

- Original head: `41bbb15d1d17bd39d0bf3364b587edec0d1c8853`
- Recovery tag: `archive/unification-20261014/feature/transcription-only-cloudflare`
- Commits unique by ancestry at baseline: 0
- Disposition: Merged by #13. Keep authenticated Whisper, limits and retry protections. Intentionally reject transcription-only navigation restriction; restore the complete shared frontend.

## feature/video-chatgpt-import

- Original head: `a122d1150a2b702952041c1c1a8597bb70583e70`
- Recovery tag: `archive/unification-20261014/feature/video-chatgpt-import`
- Commits unique by ancestry at baseline: 5
- Disposition: Superseded by main 9a5cca7. Preserve local video upload, pasted replies and source media. Hosted uploads use supported audio formats; no localhost calls.

<details><summary>Original unique commits</summary>

- `a122d11 Style video selection and ChatGPT import panel`
- `2320841 Add ChatGPT paste-back to conversation audits`
- `582f6e2 Add explicit video upload and ChatGPT paste-back to Study`
- `6fbe2b3 Track ChatGPT-refined learning outputs`
- `2cae769 Add ChatGPT result parsers and return contracts`

</details>

## feature/youtube-study-import

- Original head: `052c14658b6eaaf37aa02077664b4a520abdd279`
- Recovery tag: `archive/unification-20261014/feature/youtube-study-import`
- Commits unique by ancestry at baseline: 10
- Disposition: Superseded by main 33d8fb5. Retain captions/yt-dlp/Whisper fallback locally; hosted users can paste captions and import structured results.

<details><summary>Original unique commits</summary>

- `052c146 Remove temporary YouTube verification notes`
- `97b5374 Document YouTube importer verification cases`
- `2756d52 Style YouTube study import helper`
- `e069d93 Prefer requested YouTube caption language before fallback`
- `24c26de Add YouTube link import to Study Library`
- `f5c96b5 Add YouTube transcript client service`
- `b8fe6a3 Expose YouTube transcript import endpoint`
- `b37c61f Add YouTube import API schemas`
- `31d0438 Add yt-dlp dependency for YouTube study imports`
- `59bad18 Add local YouTube transcript importer`

</details>

## fix/chatgpt-audit-import-normalization

- Original head: `131540e725f5c85752ed03143a5a12f3b1d53eb9`
- Recovery tag: `archive/unification-20261014/fix/chatgpt-audit-import-normalization`
- Commits unique by ancestry at baseline: 2
- Disposition: Superseded by main 11737c3 and later normalization. Keep flexible field mapping and regression tests.

<details><summary>Original unique commits</summary>

- `131540e Add regression test for flexible ChatGPT audit imports`
- `1900931 Normalize ChatGPT conversation audit imports`

</details>

## fix/chatgpt-freeform-paste

- Original head: `7722432b0b96ec7290fd827e1b52a5a9349078d9`
- Recovery tag: `archive/unification-20261014/fix/chatgpt-freeform-paste`
- Commits unique by ancestry at baseline: 3
- Disposition: Superseded by main 9a89544. Keep raw pasted replies even when structured parsing fails.

<details><summary>Original unique commits</summary>

- `7722432 Always save ChatGPT audit responses`
- `e7fdd9c Always save ChatGPT study responses`
- `0e83f44 Store raw ChatGPT refinement output`

</details>

## fix/chatgpt-local-repair

- Original head: `9bf7fd2f868d1caf68ed0a481618f1c1e569d68e`
- Recovery tag: `archive/unification-20261014/fix/chatgpt-local-repair`
- Commits unique by ancestry at baseline: 11
- Disposition: Superseded by main e97b978. Keep local Ollama repair and raw-response recovery. Hosted mode reports local repair unavailable without making localhost requests.

<details><summary>Original unique commits</summary>

- `9bf7fd2 Document ChatGPT import repair flow`
- `d5696ff Remove temporary marker`
- `46753b7 Temporary marker`
- `702e61e Add study import normalization regression test`
- `e4a6221 Fix ChatGPT prompt template syntax`
- `891b332 Repair and visibly apply pasted ChatGPT audit responses`
- `f9d59e3 Repair and visibly apply pasted ChatGPT study responses`
- `257e952 Normalize and repair ChatGPT study imports`
- `09f86e0 Expose ChatGPT repair endpoints`
- `dd39405 Add local Ollama repair for ChatGPT imports`
- `74b2b86 Add ChatGPT repair request schema`

</details>

## master

- Original head: `aa41e17c034e7bc764d51e4bf3bd41a454b2e08b`
- Recovery tag: `archive/unification-20261014/master`
- Commits unique by ancestry at baseline: 0
- Disposition: Desktop/GPU foundation is an ancestor of main. Retain CUDA, offline media, Ollama and transcription jobs; restore hidden UI through shared modules.

## ux/task-visibility-overhaul-20261014

- Original head: `43e6d475e9bd4629b724c32af157a5d5a3bd7b40`
- Recovery tag: `archive/unification-20261014/ux/task-visibility-overhaul-20261014`
- Commits unique by ancestry at baseline: 1
- Disposition: Squashed in #14 (5689749). Preserve task cards, filters, selection and status colors.

<details><summary>Original unique commits</summary>

- `43e6d47 Improve transcript task visual hierarchy`

</details>

## ux/transcription-detail-colors-20261014

- Original head: `cc8dd39e553f5612d8cb4f9d76139655e5afc8c5`
- Recovery tag: `archive/unification-20261014/ux/transcription-detail-colors-20261014`
- Commits unique by ancestry at baseline: 2
- Disposition: Squashed in #15 (ca82ed3). Exact scoped detail changes retained, with shared palette and restored meeting panel.

<details><summary>Original unique commits</summary>

- `cc8dd39 Add blue purple teal visual hierarchy to transcription details`
- `95a5eb2 Scope colorful transcription detail layout styles`

</details>


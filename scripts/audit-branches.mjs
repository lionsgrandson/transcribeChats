import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const dispositions = {
  master: 'Desktop/GPU foundation is an ancestor of main. Retain CUDA, offline media, Ollama and transcription jobs; restore hidden UI through shared modules.',
  'dev/gpu-transcription-task-controls': 'GPU/task controls are already in main. Preserve and regression-test atomic bulk changes; restore navigation and CRM access.',
  'feat/full-learning-course': 'Superseded by main de5714f and b35f374. Retain full lessons, mastery and review; restore Study Library navigation.',
  'feat/interactive-quizzes-links': 'Superseded by main b35f374. Retain interactive questions and learning links; load their styles and route.',
  'feature/sales-intelligence': 'Superseded by main 5bad4d7. Worker/store retained; dedicated Sales workspace restores access and keeps inferred insights separate from tasks.',
  'feature/study-social-audit': 'Superseded by main 5bbbb25 and later course fixes. Restore both workspaces; retain newer schemas, normalization and progress. Old publishing scripts and runner workflow superseded by guarded local release.',
  'feature/transcription-only-cloudflare': 'Merged by #13. Keep authenticated Whisper, limits and retry protections. Intentionally reject transcription-only navigation restriction; restore the complete shared frontend.',
  'feature/video-chatgpt-import': 'Superseded by main 9a5cca7. Preserve local video upload, pasted replies and source media. Hosted uploads use supported audio formats; no localhost calls.',
  'feature/youtube-study-import': 'Superseded by main 33d8fb5. Retain captions/yt-dlp/Whisper fallback locally; hosted users can paste captions and import structured results.',
  'fix/chatgpt-audit-import-normalization': 'Superseded by main 11737c3 and later normalization. Keep flexible field mapping and regression tests.',
  'fix/chatgpt-freeform-paste': 'Superseded by main 9a89544. Keep raw pasted replies even when structured parsing fails.',
  'fix/chatgpt-local-repair': 'Superseded by main e97b978. Keep local Ollama repair and raw-response recovery. Hosted mode reports local repair unavailable without making localhost requests.',
  'ux/task-visibility-overhaul-20261014': 'Squashed in #14 (5689749). Preserve task cards, filters, selection and status colors.',
  'ux/transcription-detail-colors-20261014': 'Squashed in #15 (ca82ed3). Exact scoped detail changes retained, with shared palette and restored meeting panel.'
};
const branches = git('for-each-ref', '--format=%(refname:short) %(symref)', 'refs/remotes/origin').split('\n').filter((line) => !line.includes('refs/')).map((line) => line.trim()).filter((name) => name !== 'origin/main');
const rows = branches.map((branch) => {
  const name = branch.replace(/^origin\//, '');
  if (!dispositions[name]) throw new Error('Unreconciled branch: ' + name);
  const sha = git('rev-parse', branch);
  const commits = git('log', '--format=%h %s', `origin/main..${branch}`);
  const base = git('merge-base', 'origin/main', branch);
  const changed = git('diff', '--name-only', `${base}..${branch}`).split('\n').filter(Boolean);
  return { name, sha, recoveryTag: 'archive/unification-20261014/' + name, uniqueCommits: commits ? commits.split('\n') : [], changed, disposition: dispositions[name] };
});
writeFileSync('docs/BRANCH_AUDIT.md', '# Branch reconciliation — 2026-10-14\n\nBaseline: `ca82ed3` (latest remote main at integration start). Every remote branch was fetched and compared by ancestry, commit history and affected files. Unique commit counts do not imply missing features: several branches were previously squashed. The dispositions below describe the final behavior, including features subsequently hidden.\n\nRecovery tags retain every original branch head. After review, history-only merge parents retain the reconciled commits without applying obsolete implementations over newer fixes. No shared history is rewritten.\n\n' + rows.map((row) => `## ${row.name}\n\n- Original head: \`${row.sha}\`\n- Recovery tag: \`${row.recoveryTag}\`\n- Commits unique by ancestry at baseline: ${row.uniqueCommits.length}\n- Disposition: ${row.disposition}\n\n` + (row.uniqueCommits.length ? '<details><summary>Original unique commits</summary>\n\n' + row.uniqueCommits.map((line) => '- `' + line + '`').join('\n') + '\n\n</details>\n\n' : '')).join(''));
writeFileSync('.audit/branch-audit.json', JSON.stringify(rows, null, 2));
console.log(`Reconciled ${rows.length} non-main remote branches; original heads and recovery tag names recorded.`);

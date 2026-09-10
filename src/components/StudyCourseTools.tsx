import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { StudyEntry, StudyQuestion } from '../domain/learning';
import '../study-interactive.css';
import { Button, Card } from './ui';

interface InteractiveQuestionSetProps {
  entry: StudyEntry;
  questions: StudyQuestion[];
  mode: 'quiz' | 'test';
  onMark: (questionId: string, result: 'correct' | 'incorrect') => Promise<void>;
  onRebuild: () => void;
}

function normalizeAnswer(value: string): string {
  return value.trim().replace(/^([A-D]|\d+)[).:-]\s*/i, '').replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isCorrectChoice(question: StudyQuestion, choice: string): boolean {
  const answer = normalizeAnswer(question.answer);
  const candidate = normalizeAnswer(choice);
  if (candidate === answer) return true;

  const letterMatch = question.answer.trim().match(/^([A-D])(?:[).:-]|\s|$)/i);
  if (letterMatch) {
    const index = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    return question.choices[index] === choice;
  }
  return false;
}

export function InteractiveQuestionSet({ entry, questions, mode, onMark, onRebuild }: InteractiveQuestionSetProps) {
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<string[]>([]);

  const correct = questions.filter((question) => entry.questionResults[question.id] === 'correct').length;
  const answered = questions.filter((question) => Boolean(entry.questionResults[question.id])).length;

  if (!questions.length) {
    return <Card><h3>No {mode} questions were generated</h3><p>This course is incomplete. Rebuild it from the saved transcript to generate a full interactive {mode}.</p><Button onClick={onRebuild}>Rebuild full course</Button></Card>;
  }

  const choose = async (question: StudyQuestion, choice: string) => {
    if (entry.questionResults[question.id]) return;
    setSelectedChoices((current) => ({ ...current, [question.id]: choice }));
    const result = isCorrectChoice(question, choice) ? 'correct' : 'incorrect';
    await onMark(question.id, result);
  };

  const reveal = (questionId: string) => setRevealed((current) => current.includes(questionId) ? current : [...current, questionId]);

  return <div className="question-list">
    <Card>
      <h3>{mode === 'quiz' ? 'Interactive knowledge checkpoint' : 'Interactive final test'}</h3>
      <p>{mode === 'quiz'
        ? 'Choose an answer for each question. You get immediate feedback, and anything you miss is added to Review.'
        : 'Treat this like a real exam. Choose an answer for each question without opening Learn. Missed questions go straight to Review.'}</p>
      <strong>Score: {correct} correct · {answered} answered · {questions.length} total</strong>
    </Card>

    {questions.map((question, index) => {
      const result = entry.questionResults[question.id];
      const selected = selectedChoices[question.id];
      const multipleChoice = question.choices.length > 0;
      const answerRevealed = revealed.includes(question.id);

      return <Card key={question.id} className={`question-card ${result ? `result-${result}` : ''}`}>
        <div className="study-card-status">
          <small>Question {index + 1} · {question.difficulty} · {question.topicId}</small>
          {result && <strong>{result === 'correct' ? 'Correct' : 'Incorrect · added to Review'}</strong>}
        </div>
        <h3>{question.prompt}</h3>

        {multipleChoice ? <div className="interactive-answer-grid">
          {question.choices.map((choice, choiceIndex) => {
            const chosen = selected === choice;
            const correctChoice = Boolean(result) && isCorrectChoice(question, choice);
            const wrongChoice = Boolean(result) && chosen && !correctChoice;
            const stateClass = correctChoice ? 'is-correct' : wrongChoice ? 'is-incorrect' : chosen ? 'is-selected' : '';
            return <button
              type="button"
              key={`${question.id}-${choiceIndex}`}
              className={`interactive-answer ${stateClass}`}
              disabled={Boolean(result)}
              onClick={() => void choose(question, choice)}
            >
              <span>{String.fromCharCode(65 + choiceIndex)}</span>
              <strong>{choice}</strong>
            </button>;
          })}
        </div> : <div className="legacy-question-note">
          <p>This older question is not multiple choice. New and rebuilt courses generate clickable quiz and test questions.</p>
          {!answerRevealed ? <Button variant="secondary" onClick={() => reveal(question.id)}>Show answer</Button> : <div className="answer-block">
            <strong>Answer</strong><p style={{ whiteSpace: 'pre-line' }}>{question.answer}</p>
            <strong>Why</strong><p style={{ whiteSpace: 'pre-line' }}>{question.explanation}</p>
            <div className="self-grade"><button onClick={() => void onMark(question.id, 'correct')}>I got it</button><button onClick={() => void onMark(question.id, 'incorrect')}>Needs review</button></div>
          </div>}
        </div>}

        {multipleChoice && result && <div className={`interactive-feedback ${result === 'correct' ? 'is-correct' : 'is-incorrect'}`}>
          <strong>{result === 'correct' ? 'Yes, that is correct.' : 'No, that is not correct.'}</strong>
          {result === 'incorrect' && <p><strong>Correct answer:</strong> {question.answer}</p>}
          <p>{question.explanation}</p>
        </div>}
      </Card>;
    })}
  </div>;
}

interface TopicLearningLinksProps {
  courseTitle: string;
  topicTitle: string;
}

export function TopicLearningLinks({ courseTitle, topicTitle }: TopicLearningLinksProps) {
  const links = useMemo(() => {
    const combined = `${courseTitle} ${topicTitle}`.trim();
    const webQuery = encodeURIComponent(combined);
    const youtubeQuery = encodeURIComponent(`${combined} tutorial explained`);
    const wikiQuery = encodeURIComponent(topicTitle);
    const programming = /typescript|javascript|react|node|html|css|web|api|programming|code|python|java|sql|git/i.test(combined);

    return [
      { label: 'Search the web', href: `https://www.google.com/search?q=${webQuery}` },
      { label: 'Find video lessons', href: `https://www.youtube.com/results?search_query=${youtubeQuery}` },
      programming
        ? { label: 'Search MDN / docs', href: `https://developer.mozilla.org/en-US/search?q=${wikiQuery}` }
        : { label: 'Search Wikipedia', href: `https://en.wikipedia.org/w/index.php?search=${wikiQuery}` }
    ];
  }, [courseTitle, topicTitle]);

  return <div className="study-resource-links">
    <strong>Learn more externally</strong>
    <div>{links.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer"><ExternalLink size={14} />{link.label}</a>)}</div>
    <small>These open topic searches rather than invented article URLs, so the links stay valid even when the source lesson changes.</small>
  </div>;
}

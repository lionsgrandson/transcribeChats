import { describe, expect, it } from 'vitest';
import { parseSocialAuditChatGptResult, parseStudyChatGptResult } from './learning';

describe('ChatGPT study import', () => {
  it('normalizes common ChatGPT study variations before validation', () => {
    const result = parseStudyChatGptResult(JSON.stringify({
      title: 'TypeScript lesson',
      suggestedPath: ['TypeScript', 'Generics'],
      overview: 'A focused lesson.',
      learningObjectives: ['Explain generic relationships.'],
      topics: [{
        id: 'generics',
        title: 'Generics',
        summary: 'Generics preserve relationships.',
        keyPoints: ['T can connect input and output types.'],
        examples: ['function first<T>(items: T[]): T | undefined'],
        commonMistakes: ['Replacing T with any.'],
        prerequisites: ['functions']
      }],
      flashcards: [{
        id: 'generic-card',
        topicId: 'generics',
        front: 'Why use T?',
        back: 'To preserve a type relationship.',
        difficulty: 'hard'
      }],
      quiz: [{
        id: 'q1',
        topicId: 'generics',
        type: 'multiple-choice',
        prompt: 'What does T preserve?',
        choices: ['A relationship', 'Runtime validation'],
        answer: 'A relationship',
        explanation: 'The generic connects type positions.',
        difficulty: 'medium'
      }],
      test: [{
        id: 't1',
        topicId: 'generics',
        type: 'code_reasoning',
        prompt: 'Explain why first<T> is safer than any.',
        choices: ['This should be removed for non-MCQ questions'],
        answer: 'It preserves the element type.',
        explanation: 'The return type follows the input element type.',
        difficulty: 'advanced'
      }],
      tasks: [{
        id: 'task1',
        topicId: 'generics',
        title: 'Build a helper',
        instructions: ['Write a generic helper.', 'Test it with two types.'],
        successCriteria: ['No any is used.', 'Both calls infer correctly.'],
        difficulty: 'hard'
      }],
      reviewScheduleDays: [1, 3, 7, 14]
    }));

    expect(result.quiz[0].type).toBe('multiple_choice');
    expect(result.test[0].type).toBe('code');
    expect(result.test[0].choices).toEqual([]);
    expect(result.test[0].difficulty).toBe('hard');
    expect(result.tasks[0].instruction).toBe('Write a generic helper.\nTest it with two types.');
    expect(result.tasks[0].successCriteria).toBe('No any is used.\nBoth calls infer correctly.');
    expect(result.reviewScheduleDays).toEqual([1, 3, 7, 14]);
  });
});

describe('ChatGPT conversation audit import', () => {
  it('normalizes common ChatGPT field variations before validation', () => {
    const result = parseSocialAuditChatGptResult(JSON.stringify({
      title: 'Conversation review',
      summary: 'A useful summary.',
      emotional: [
        {
          observation: 'The speaker moved quickly into reassurance.',
          evidence: 'I promise I am not upset.',
          analysis: 'Reassurance was used to lower tension.',
          alternatives: 'It may also have been simple clarification.',
          confidence: '80%'
        }
      ],
      logical: [
        {
          finding: 'One assumption was left unstated.',
          evidence: ['We already know that.'],
          explanation: 'The conclusion depends on shared context.',
          confidence: 'high'
        }
      ],
      social: [
        {
          behavior: 'Direct question',
          quote: 'What do you actually want?',
          meaning: 'The speaker asked for clarity instead of guessing.'
        }
      ],
      habitsAndPatterns: [
        {
          pattern: 'Fast problem solving',
          evidence: 'Several replies immediately proposed solutions.',
          meaning: 'The speaker tends to move quickly from emotion to action.'
        }
      ],
      possibleBlindSpots: [
        {
          blindSpot: 'Timing of advice',
          evidence: ['The other person was still explaining.'],
          explanation: 'Advice may have arrived before the other person finished.'
        }
      ],
      strengths: [
        { strength: 'Directness', evidence: 'Questions were explicit.' },
        { strength: 'Repair attempts' }
      ],
      socialNormsWorthLearning: [
        {
          norm: 'Acknowledge before solving',
          why: 'It signals that the other person was heard.',
          example: 'I get why that was frustrating. Want ideas?'
        }
      ],
      lessons: [
        { lesson: 'Ask whether the person wants listening or solutions.' }
      ],
      reflectionQuestions: [
        { question: 'Did I answer the emotion or only the problem?' }
      ],
      experiments: [
        {
          experiment: 'One-beat pause',
          instruction: 'Wait one beat before offering a solution.',
          notice: 'Whether the other person adds more context.'
        }
      ],
      uncertaintyNotes: [
        { note: 'Tone and body language are not available in text.' }
      ]
    }));

    expect(result.emotional[0]).toMatchObject({
      title: 'The speaker moved quickly into reassurance.',
      evidence: ['I promise I am not upset.'],
      interpretation: 'Reassurance was used to lower tension.',
      alternatives: ['It may also have been simple clarification.'],
      confidence: 0.8
    });
    expect(result.logical[0].confidence).toBe(0.85);
    expect(result.social[0].interpretation).toBe('The speaker asked for clarity instead of guessing.');
    expect(result.habitsAndPatterns[0].evidence).toEqual(['Several replies immediately proposed solutions.']);
    expect(result.possibleBlindSpots[0].title).toBe('Timing of advice');
    expect(result.strengths[0]).toContain('Directness');
    expect(result.socialNormsWorthLearning[0].whyItMatters).toBe('It signals that the other person was heard.');
    expect(result.lessons).toEqual(['Ask whether the person wants listening or solutions.']);
    expect(result.reflectionQuestions).toEqual(['Did I answer the emotion or only the problem?']);
    expect(result.experiments[0]).toEqual({
      title: 'One-beat pause',
      action: 'Wait one beat before offering a solution.',
      whatToNotice: 'Whether the other person adds more context.'
    });
    expect(result.uncertaintyNotes).toEqual(['Tone and body language are not available in text.']);
  });
});

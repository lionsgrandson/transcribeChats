import { describe, expect, it } from 'vitest';
import { parseSocialAuditChatGptResult } from './learning';

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

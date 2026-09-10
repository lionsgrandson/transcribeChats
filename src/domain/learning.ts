export type LearningDifficulty = 'easy' | 'medium' | 'hard';

export interface StudyTopic {
  id: string;
  title: string;
  parentId?: string | null;
  summary: string;
  keyPoints: string[];
  examples: string[];
  commonMistakes: string[];
  prerequisites: string[];
}

export interface StudyFlashcard {
  id: string;
  topicId: string;
  front: string;
  back: string;
  difficulty: LearningDifficulty;
}

export interface StudyQuestion {
  id: string;
  topicId: string;
  type: 'multiple_choice' | 'short_answer' | 'explain' | 'code';
  prompt: string;
  choices: string[];
  answer: string;
  explanation: string;
  difficulty: LearningDifficulty;
}

export interface StudyTask {
  id: string;
  topicId: string;
  title: string;
  instruction: string;
  successCriteria: string;
  difficulty: LearningDifficulty;
}

export interface StudyAnalysis {
  title: string;
  suggestedPath: string[];
  overview: string;
  learningObjectives: string[];
  topics: StudyTopic[];
  flashcards: StudyFlashcard[];
  quiz: StudyQuestion[];
  test: StudyQuestion[];
  tasks: StudyTask[];
  reviewScheduleDays: number[];
}

export interface StudyEntry {
  id: string;
  title: string;
  path: string[];
  sourceName: string;
  transcript: string;
  analysis: StudyAnalysis;
  masteredTopicIds: string[];
  completedTaskIds: string[];
  questionResults: Record<string, 'correct' | 'incorrect'>;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt?: string;
  chatGptRefinedAt?: string;
}

export interface SocialAuditObservation {
  title: string;
  evidence: string[];
  interpretation: string;
  alternatives: string[];
  confidence: number;
}

export interface SocialAuditAnalysis {
  title: string;
  summary: string;
  emotional: SocialAuditObservation[];
  logical: SocialAuditObservation[];
  social: SocialAuditObservation[];
  habitsAndPatterns: SocialAuditObservation[];
  possibleBlindSpots: SocialAuditObservation[];
  strengths: string[];
  socialNormsWorthLearning: Array<{ norm: string; whyItMatters: string; example: string }>;
  lessons: string[];
  reflectionQuestions: string[];
  experiments: Array<{ title: string; action: string; whatToNotice: string }>;
  uncertaintyNotes: string[];
}

export interface SocialAuditEntry {
  id: string;
  title: string;
  sourceName: string;
  transcript?: string;
  analysis: SocialAuditAnalysis;
  createdAt: string;
  updatedAt: string;
  chatGptRefinedAt?: string;
}

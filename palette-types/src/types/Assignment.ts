/**
 * Defines an Assignment object within the Palette context.
 */

/**
 * Canvas grading types:
 * - "points": Raw point values
 * - "percent": Percentage (0-100)
 * - "letter_grade": Letter grades (A, B, C, D, F)
 * - "gpa_scale": GPA scale (0-4.0)
 * - "pass_fail": Pass/Fail only
 * - "not_graded": Not graded
 */
export type GradingType = "points" | "percent" | "letter_grade" | "gpa_scale" | "pass_fail" | "not_graded";

export interface Assignment {
  id: number;
  name: string;
  description: string;
  dueDate: string;
  pointsPossible: number;
  gradingType: GradingType; // Canvas grading type
  rubricId: number | undefined; // associated rubric
  quizId?: number; // if this assignment is a Classic Quiz
  isNewQuiz?: boolean; // if this assignment is a New Quiz (Quizzes.Next)
  createdAt: string;
}

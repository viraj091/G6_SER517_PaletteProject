/**
 * Represents a criterion within a grading rubric or as a collection of template criteria.
 */

import { Rating } from "./Rating";

/**
 * Criterion use range mode:
 * - false (default): Use discrete rating options (dropdown selection)
 * - true: Use free-form range input (any value from 0 to pointsPossible)
 */
export interface Criteria {
  id: string;
  description: string;
  longDescription: string;
  pointsGraded?: number;
  ratings: Rating[];
  pointsPossible: number;
  scores: number[];
  template?: string; // placeholder
  templateTitle?: string;
  key: string;
  updatePoints: () => void;
  isGroupCriterion: boolean;
  useRange?: boolean; // true = free-form range input, false/undefined = discrete ratings
}

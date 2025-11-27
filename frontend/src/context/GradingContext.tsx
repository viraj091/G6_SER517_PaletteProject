import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useContext,
  useEffect,
  useState,
  useMemo,
} from "react";
import type {
  PaletteGradedSubmission,
  Rubric,
  Submission,
} from "palette-types";
import { useCourse, useAssignment } from "@/context";

type GradingContextType = {
  gradedSubmissionCache: SavedGrades;
  setGradedSubmissionCache: Dispatch<SetStateAction<SavedGrades>>;
  updateScore: (
    submissionId: number,
    criterionId: string,
    points: number,
  ) => void;
  updateComment: (submissionId: number, text: string) => void;
  updateGroupComment: (text: string) => void;
  initializeGradingCache: (
    submissions: Submission[],
    rubric: Rubric,
    mode: "restore" | "canvas",
  ) => void;
};

export type SavedGrades = Record<number, PaletteGradedSubmission>;

const GradingContext = createContext<GradingContextType | undefined>(undefined);

export const useGradingContext = () => {
  const context = useContext(GradingContext);
  if (!context) {
    throw new Error("useGradingContext must be used within a GradingProvider");
  }
  return context;
};

export const GradingProvider = ({ children }: { children: ReactNode }) => {
  const { activeCourse } = useCourse();
  const { activeAssignment } = useAssignment();

  // Create assignment-specific localStorage key using useMemo
  const localStorageKey = useMemo(() => {
    if (!activeCourse?.id || !activeAssignment?.id) return "gradedSubmissionCache";
    return `gradedSubmissionCache_${activeCourse.id}_${activeAssignment.id}`;
  }, [activeCourse?.id, activeAssignment?.id]);

  // track all in progress grades
  const [gradedSubmissionCache, setGradedSubmissionCache] =
    useState<SavedGrades>({});

  // Load from localStorage when key changes
  useEffect(() => {
    const stored = localStorage.getItem(localStorageKey);
    if (stored) {
      try {
        setGradedSubmissionCache(JSON.parse(stored) as SavedGrades);
      } catch (error) {
        console.error("Error parsing localStorage:", error);
        setGradedSubmissionCache({});
      }
    } else {
      setGradedSubmissionCache({});
    }
  }, [localStorageKey]);

  // persist in-progress grades to local storage whenever they change
  useEffect(() => {
    localStorage.setItem(
      localStorageKey,
      JSON.stringify(gradedSubmissionCache),
    );
  }, [gradedSubmissionCache, localStorageKey]);

  // update a criterion rating for a target submission
  const updateScore = (
    submissionId: number,
    criterionId: string,
    points: number,
  ) => {
    setGradedSubmissionCache((prevCache) => {
      const prevSubmission = prevCache[submissionId];
      if (!prevSubmission) return prevCache; // nothing to update

      return {
        ...prevCache,
        [submissionId]: {
          ...prevSubmission,
          rubric_assessment: {
            ...prevSubmission.rubric_assessment,
            [criterionId]: {
              ...prevSubmission.rubric_assessment[criterionId],
              points,
            },
          },
        },
      };
    });
  };

  // update an individual submission comment
  const updateComment = (submissionId: number, text: string) => {
    setGradedSubmissionCache((prevCache) => {
      const prevSubmission = prevCache[submissionId];
      if (!prevSubmission) return prevCache; // nothing to change

      return {
        ...prevCache,
        [submissionId]: {
          ...prevSubmission,
          individual_comment: text
            ? {
                text_comment: text,
                group_comment: false,
              }
            : undefined,
        },
      };
    });
  };

  // Sets the group comment field of the first element in the grading cache. Canvas will automatically apply it to
  // all other group members.
  const updateGroupComment = (text: string) => {
    setGradedSubmissionCache((prev) => {
      const firstKey = Object.keys(prev)[0];
      if (!firstKey) return prev;

      const submission = prev[Number(firstKey)];

      return {
        ...prev,
        [firstKey]: {
          ...submission,
          group_comment: {
            text_comment: text,
            group_comment: true,
            sent: false, // reset `sent` flag when editing
          },
        },
      };
    });
  };

  const initializeGradingCache = (
    submissions: Submission[],
    rubric: Rubric,
    mode: "restore" | "canvas",
  ) => {
    console.log(`🎯 initializeGradingCache called with mode: ${mode}`);
    console.log(`🎯 Number of submissions: ${submissions.length}`);
    console.log(`🎯 Number of rubric criteria: ${rubric.criteria.length}`);

    const localCacheRaw = localStorage.getItem(localStorageKey);
    const localCache = localCacheRaw
      ? (JSON.parse(localCacheRaw) as SavedGrades)
      : {};

    console.log(`🎯 LocalCache has ${Object.keys(localCache).length} submissions`);
    console.log(`🎯 LocalCache keys:`, Object.keys(localCache));
    console.log(`🎯 React state cache has ${Object.keys(gradedSubmissionCache).length} submissions`);
    console.log(`🎯 React state cache keys:`, Object.keys(gradedSubmissionCache));

    // Check if we already have data in the current React state for these submissions
    // We need to check if the data actually has POINTS values, not just empty rubric_assessment objects
    const submissionIds = submissions.map(s => s.id);
    console.log(`🎯 Looking for submission IDs:`, submissionIds);

    const hasActualGradedDataInState = submissionIds.some(id => {
      const cached = gradedSubmissionCache[id];
      console.log(`🎯 Checking submission ${id} in state:`, !!cached, cached?.rubric_assessment ? Object.keys(cached.rubric_assessment) : 'no rubric_assessment');
      if (!cached?.rubric_assessment) return false;
      // Check if any criterion has an actual points value (not empty string)
      const hasPoints = Object.values(cached.rubric_assessment).some(
        criterion => criterion.points !== "" && criterion.points !== undefined
      );
      console.log(`🎯 Submission ${id} has points: ${hasPoints}`);
      return hasPoints;
    });

    console.log(`🎯 Has actual graded data in state: ${hasActualGradedDataInState}`);
    if (hasActualGradedDataInState) {
      // Log the actual points values for debugging
      submissionIds.forEach(id => {
        const cached = gradedSubmissionCache[id];
        if (cached?.rubric_assessment) {
          const points = Object.entries(cached.rubric_assessment).map(([k, v]) => `${k}: ${v.points}`);
          console.log(`🎯 Submission ${id} points:`, points);
        }
      });
    }

    // In restore mode, first check React state, then localStorage
    if (mode === "restore") {
      // If React state already has actual graded data for these submissions, use it directly
      if (hasActualGradedDataInState) {
        console.log(`🎯 Restore mode: Already have actual graded data in React state, skipping`);
        return;
      }

      // Check if localStorage has valid data with actual points values for these submissions
      const hasLocalCacheForSubmissions = submissionIds.some(id => {
        const cached = localCache[id] || localCache[String(id)];
        if (!cached?.rubric_assessment) return false;
        return Object.values(cached.rubric_assessment).some(
          criterion => criterion.points !== "" && criterion.points !== undefined
        );
      });

      if (hasLocalCacheForSubmissions) {
        console.log(`🎯 Restore mode: Using localStorage cache directly`);
        setGradedSubmissionCache((prev) => ({
          ...prev,
          ...localCache,
        }));
        return;
      }
    }

    // In canvas mode, if we already have actual graded data in state, don't overwrite it
    if (mode === "canvas" && hasActualGradedDataInState) {
      console.log(`🎯 Skipping canvas mode - already have actual graded data in state`);
      return;
    }

    const newCache: Record<number, PaletteGradedSubmission> = {};

    // Log localCache keys for debugging
    if (mode === "restore") {
      console.log(`🎯 LocalCache keys:`, Object.keys(localCache));
      console.log(`🎯 Submission IDs we're looking for:`, submissions.map(s => s.id));
    }

    submissions.forEach((submission) => {
      // Try both number and string keys since JSON parsing may convert them
      const saved = mode === "restore"
        ? (localCache[submission.id] || localCache[String(submission.id)])
        : undefined;
      const canvas = submission.rubricAssessment;

      console.log(`🎯 Submission ${submission.id}:`);
      console.log(`   - Has saved data: ${!!saved}`);
      console.log(`   - Has rubricAssessment: ${!!canvas}`);
      if (saved?.rubric_assessment) {
        console.log(`   - Saved rubric_assessment keys:`, Object.keys(saved.rubric_assessment));
      }
      if (canvas) {
        console.log(`   - Canvas rubricAssessment keys:`, Object.keys(canvas));
      }

      const rubric_assessment: PaletteGradedSubmission["rubric_assessment"] =
        {};

      rubric.criteria.forEach((criterion) => {
        const criterionKey = criterion.key || criterion.id;
        const savedCriterion = saved?.rubric_assessment?.[criterionKey];
        const canvasData = canvas?.[criterionKey];

        rubric_assessment[criterionKey] = {
          points: savedCriterion?.points ?? canvasData?.points ?? "",
          rating_id: savedCriterion?.rating_id ?? canvasData?.rating_id ?? "",
          comments: savedCriterion?.comments ?? "",
        };
      });

      newCache[submission.id] = {
        submission_id: submission.id,
        user: submission.user,
        individual_comment: saved?.individual_comment ?? undefined,
        group_comment: saved?.group_comment ?? undefined,
        rubric_assessment,
      };
    });

    setGradedSubmissionCache((prev) => ({
      ...prev,
      ...newCache,
    }));
  };

  return (
    <GradingContext.Provider
      value={{
        gradedSubmissionCache,
        setGradedSubmissionCache,
        updateScore,
        updateComment,
        updateGroupComment,
        initializeGradingCache,
      }}
    >
      {children}
    </GradingContext.Provider>
  );
};

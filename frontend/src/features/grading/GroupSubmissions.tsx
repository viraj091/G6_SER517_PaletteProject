import { PaletteAPIResponse, Submission } from "palette-types";

import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { PaletteActionButton, ProgressBar } from "@/components";
import { SavedGrades, useAssignment, useChoiceDialog, useCourse, useRubric } from "@/context";
import { ProjectGradingView } from "./projectGradingComponents/ProjectGradingView.tsx";
import { QuizGradingView } from "./quizGradingComponents/QuizGradingView.tsx";
import { useGradingContext } from "@/context/GradingContext.tsx";
import { calculateCanvasGroupAverage, calculateGroupAverage } from "@/utils";
import { cn } from "@/lib/utils.ts";

interface GroupSubmissionsProps {
  groupName: string;
  progress: number;
  submissions: Submission[];
  fetchSubmissions: () => Promise<void>;
}

export function GroupSubmissions({
  groupName,
  progress,
  submissions,
  fetchSubmissions,
}: GroupSubmissionsProps) {
  const [isGradingViewOpen, setGradingViewOpen] = useState(false);
  const [groupAverageScore, setGroupAverageScore] = useState(() => {
    if (submissions.length === 0) return 0;
    return calculateCanvasGroupAverage(submissions);
  });

  const { activeRubric } = useRubric();
  const { activeCourse } = useCourse();
  const { activeAssignment } = useAssignment();
  const { gradedSubmissionCache, setGradedSubmissionCache } = useGradingContext();
  const [hasSavedDrafts, setHasSavedDrafts] = useState(false);

  // Create assignment-specific localStorage key
  const getLocalStorageKey = () => {
    if (!activeCourse?.id || !activeAssignment?.id) return "gradedSubmissionCache";
    return `gradedSubmissionCache_${activeCourse.id}_${activeAssignment.id}`;
  };

  // track submission IDs for easy lookups
  const submissionIds = useMemo(
    () => submissions.map((s) => s.id),
    [submissions],
  );

  const [initMode, setInitMode] = useState<"none" | "canvas" | "restore">(
    "none",
  );
  const [hasChosenInitMode, setHasChosenInitMode] = useState(false);
  const { openDialog, closeDialog } = useChoiceDialog();

  const openGradingViewWithMode = useCallback((mode: "canvas" | "restore") => {
    // Use flushSync to force synchronous state updates before opening the view
    flushSync(() => {
      setInitMode(mode);
      setHasChosenInitMode(true);
    });
    // Now open the view with the mode already set
    setGradingViewOpen(true);
  }, []);

  // Check if there are saved drafts in the database
  useEffect(() => {
    const checkSavedDrafts = async () => {
      if (!activeCourse?.id || !activeAssignment?.id) return;

      try {
        const response = await fetch(
          `http://localhost:3000/api/courses/${activeCourse.id}/assignments/${activeAssignment.id}/draft-grades`
        );
        const result = await response.json() as PaletteAPIResponse<SavedGrades>;
        setHasSavedDrafts(result.success && result.data !== null);
      } catch (error) {
        console.error("Error checking saved drafts:", error);
        setHasSavedDrafts(false);
      }
    };

    void checkSavedDrafts();
  }, [activeCourse?.id, activeAssignment?.id]);

  const handleDiscardAndLoadCanvas = useCallback(async () => {
    console.log("🔄 Button clicked: Discard & Load Canvas Grades");
    localStorage.removeItem("gradedSubmissionCache");
    setGradedSubmissionCache({});
    closeDialog();

    console.log("🔄 Fetching submissions from Canvas...");
    await fetchSubmissions();
    console.log("✅ Submissions fetched, opening grading view");

    // Open view with canvas mode - all in one call
    openGradingViewWithMode("canvas");
    console.log("🔄 Opened grading view with canvas mode");
  }, [setGradedSubmissionCache, closeDialog, fetchSubmissions, openGradingViewWithMode]);

  const toggleGradingView = () => {
    // Allow quiz grading without a rubric (Classic Quizzes have quizId, New Quizzes have isNewQuiz)
    const isQuiz = (activeAssignment?.quizId !== undefined && activeAssignment?.quizId !== null) ||
                   activeAssignment?.isNewQuiz === true;

    console.log('🔍 Quiz detection:', {
      activeAssignment,
      quizId: activeAssignment?.quizId,
      isNewQuiz: activeAssignment?.isNewQuiz,
      isQuiz,
      hasRubric: !(!activeRubric || !activeRubric.id || !activeRubric.criteria || activeRubric.criteria.length === 0)
    });

    if (!isQuiz && (!activeRubric || !activeRubric.id || !activeRubric.criteria || activeRubric.criteria.length === 0)) {
      openDialog({
        title: "No Rubric Found",
        message: "This assignment does not have a rubric for grading. Please create a rubric first and try again.",
        excludeCancel: true,
        buttons: [
          {
            label: "OK",
            color: "BLUE",
            action: () => closeDialog(),
            autoFocus: true,
          },
        ],
      });
      return;
    }

    const stored = localStorage.getItem(getLocalStorageKey());
    const parsedCache = stored ? (JSON.parse(stored) as SavedGrades) : {};
    const hasUnsavedGrades = submissionIds.some(
      (id) => parsedCache[id] !== undefined,
    );

    // Only show restore dialog if user hasn't already made a choice in this session
    if ((hasUnsavedGrades || hasSavedDrafts) && !hasChosenInitMode) {
      const isSaved = hasSavedDrafts;
      openDialog({
        title: isSaved ? "Saved Grades Detected" : "Unsaved Grades Detected",
        message: isSaved
          ? "You have saved draft grades in the local database. What would you like to do?"
          : "You have unsaved local draft grades. What would you like to do?",
        excludeCancel: true,
        buttons: [
          {
            label: "Restore Local Drafts",
            color: "GREEN",
            action: async () => {
              closeDialog();
              // If we have saved drafts in DB, load them first
              if (isSaved && activeCourse?.id && activeAssignment?.id) {
                try {
                  const response = await fetch(
                    `http://localhost:3000/api/courses/${activeCourse.id}/assignments/${activeAssignment.id}/draft-grades`
                  );
                  const result = await response.json() as PaletteAPIResponse<SavedGrades>;
                  if (result.success && result.data) {
                    // Set localStorage FIRST so initializeGradingCache can read it
                    localStorage.setItem(getLocalStorageKey(), JSON.stringify(result.data));
                    // Then update React state
                    setGradedSubmissionCache(result.data);
                    console.log("✅ Restored draft grades from database:", Object.keys(result.data).length, "submissions");
                  }
                } catch (error) {
                  console.error("Error loading saved drafts:", error);
                }
              }
              // Small delay to ensure localStorage is written before grading view reads it
              await new Promise(resolve => setTimeout(resolve, 50));
              openGradingViewWithMode("restore");
            },
            autoFocus: true,
          },
          {
            label: "Discard & Load Canvas Grades",
            color: "YELLOW",
            action: handleDiscardAndLoadCanvas,
            autoFocus: false,
          },
        ],
      });
    } else {
      // If already chosen or no unsaved grades, just open with the last mode (or canvas as default)
      if (initMode === "none") {
        // If we have saved drafts or unsaved grades in cache, use restore mode
        const hasGradesInCache = submissionIds.some((id) => gradedSubmissionCache[id] !== undefined);
        if (hasSavedDrafts || hasGradesInCache) {
          openGradingViewWithMode("restore");
        } else {
          openGradingViewWithMode("canvas");
        }
      } else {
        setGradingViewOpen(true);
      }
    }
  };

  useEffect(() => {
    // update group avg score whenever cache changes
    if (Object.values(gradedSubmissionCache).length !== 0) {
      setGroupAverageScore(
        calculateGroupAverage(gradedSubmissionCache, submissionIds),
      );
    } else {
      // use average score from Canvas submissions
      setGroupAverageScore(calculateCanvasGroupAverage(submissions));
    }
  }, [gradedSubmissionCache]);

  // Check if there are local draft grades (not yet submitted to Canvas)
  const hasDraftGrades = submissionIds.some((id) => {
    const cached = gradedSubmissionCache[id];
    if (!cached?.rubric_assessment) return false;
    // Check if any criterion has actual points
    return Object.values(cached.rubric_assessment).some(
      (entry) => entry && (typeof entry.points === 'number' || (typeof entry.points === 'string' && entry.points !== ''))
    );
  });

  // Check if grades exist on Canvas (workflow_state is "graded" and has rubric assessment)
  const isGradedOnCanvas = submissions.every(
    (submission) =>
      submission.workflow_state === "graded" &&
      submission.rubricAssessment &&
      Object.values(submission.rubricAssessment).some(
        (entry) => entry && typeof entry.points === 'number' && entry.points >= 0
      )
  );

  // Check if any submissions have been submitted
  const hasSubmissions = submissions.some(
    (submission) =>
      submission.workflow_state === "submitted" ||
      submission.workflow_state === "graded" ||
      submission.submitted_at !== null,
  );

  // Determine the status to show
  const getStatusLabel = () => {
    if (isGradedOnCanvas && !hasDraftGrades) {
      return { text: "✓ Graded", color: "text-green-400" };
    }
    if (hasDraftGrades) {
      return { text: "In Progress", color: "text-yellow-300" };
    }
    return null;
  };

  const statusLabel = getStatusLabel();

  return (
    <div className="w-full">
      {/* Status labels above the card */}
      <div className="flex justify-between items-center mb-1 min-h-[20px]">
        {statusLabel ? (
          <span className={`text-xs ${statusLabel.color} italic`}>
            {statusLabel.text}
          </span>
        ) : (
          <span />
        )}
        {!hasSubmissions && (
          <span className="text-xs text-orange-400 italic bg-gray-800 px-2 py-1 rounded border border-orange-400/30">
            ⏳ Awaiting Submission
          </span>
        )}
      </div>
      <div
        className={cn(
          "flex flex-col gap-2 p-4 border-2 rounded-2xl",
          "border-gray-500 shadow-xl bg-gray-900",
          "border-opacity-35",
        )}
      >
        {/* Group Header */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-bold">{groupName}</h1>
          <PaletteActionButton
            color="BLUE"
            title="Grade"
            onClick={toggleGradingView}
          />
        </div>
        <div>
          <ProgressBar value={progress} />
        </div>
        <div className={"text-center"}>
          Average Score: {`${groupAverageScore.toFixed(2)}`}
        </div>
      </div>

      {/* Conditionally render QuizGradingView for quizzes or ProjectGradingView for rubric-based assignments */}
      {(activeAssignment?.quizId || activeAssignment?.isNewQuiz) ? (
        <QuizGradingView
          isOpen={isGradingViewOpen}
          groupName={groupName}
          submissions={submissions}
          onClose={() => {
            setInitMode("none");
            setGradingViewOpen(false);
          }}
        />
      ) : (
        <ProjectGradingView
          isOpen={isGradingViewOpen}
          initMode={initMode}
          groupName={groupName}
          submissions={submissions}
          onClose={() => {
            setInitMode("none");
            setGradingViewOpen(false);
          }}
        />
      )}
    </div>
  );
}

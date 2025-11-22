import {
  GroupedSubmissions,
  PaletteAPIResponse,
  PaletteGradedSubmission,
  Rubric,
  Submission,
} from "palette-types";
import { AssignmentData, GroupSubmissions } from "@/features";
import { Dispatch, SetStateAction, useMemo, useState } from "react";
import { Dialog, PaletteActionButton } from "@/components";
import {
  SavedGrades,
  useAssignment,
  useChoiceDialog,
  useCourse,
  useGradingContext,
  useRubric,
} from "@/context";
import { cn } from "@/lib/utils.ts";
import { RubricForm } from "@/features/rubricBuilder/RubricForm.tsx";
import { useFetch, useRubricBuilder } from "@/hooks";
import { calcMaxPoints } from "@/utils";

type SubmissionDashboardProps = {
  submissions: GroupedSubmissions;
  fetchSubmissions: () => Promise<void>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  builderOpen: boolean;
  setBuilderOpen: Dispatch<SetStateAction<boolean>>;
};

export function SubmissionsDashboard({
  submissions,
  fetchSubmissions,
  setLoading,
  builderOpen,
  setBuilderOpen,
}: SubmissionDashboardProps) {
  const { activeCourse } = useCourse();
  const { activeAssignment } = useAssignment();
  const { activeRubric, setActiveRubric } = useRubric();
  const { openDialog, closeDialog } = useChoiceDialog();
  const { putRubric } = useRubricBuilder();
  const { gradedSubmissionCache, setGradedSubmissionCache } =
    useGradingContext();

  const BASE_URL = "http://localhost:3000/api";
  const GRADING_ENDPOINT = `/courses/${activeCourse?.id}/assignments/${activeAssignment?.id}/submissions/`;

  const [tempGrades, setTempGrades] = useState<
    Record<number, PaletteGradedSubmission>
  >({});
  const [oldRubric, setOldRubric] = useState<Rubric>(activeRubric);

  // Draft grades API hooks
  const draftGradesUrl = `/courses/${activeCourse?.id}/assignments/${activeAssignment?.id}/draft-grades`;
  const { fetchData: getDraftGrades } = useFetch(draftGradesUrl);
  const { fetchData: saveDraftGrades } = useFetch(draftGradesUrl, {
    method: "POST",
    body: JSON.stringify({ grades: gradedSubmissionCache }),
  });
  const { fetchData: deleteDraftGrades } = useFetch(draftGradesUrl, {
    method: "DELETE",
  });

  // opens the rubric builder in hot swap mode
  const modifyRubric = () => {
    setTempGrades(gradedSubmissionCache); // store the current grades
    setOldRubric(activeRubric); // store prev rubric
    setBuilderOpen(true);
  };

  // gets called from the modal rubric builder in hot swap mode

  // todo: write up technical challenge
  const getUpdatedRubric = async () => {
    try {
      const response = await putRubric();
      if (response.success) {
        const newRubric = response.data as Rubric;
        // ensure new criteria have unique key for react and all required fields
        const updatedRubric = {
          ...newRubric,
          criteria: newRubric.criteria.map((c) => ({
            ...c,
            pointsPossible: calcMaxPoints(c.ratings),
            isGroupCriterion: c.isGroupCriterion ?? true,
            key: c.key || crypto.randomUUID(),
            ratings: c.ratings.map((r) => {
              return {
                ...r,
                key: r.key || crypto.randomUUID(),
              };
            }),
          })),
        };

        setActiveRubric(updatedRubric);
        mapExistingGrades(updatedRubric);
        setBuilderOpen(false);
        // Clear localStorage to remove stale grades with old rubric IDs
        localStorage.removeItem("gradedSubmissionCache");
        setGradedSubmissionCache({});
        // Fetch fresh submissions from Canvas to get any new grades
        await fetchSubmissions();
      }
    } catch (error) {
      console.error("Error updating the rubric", error);
    }
  };

  const mapExistingGrades = (newRubric: Rubric) => {
    if (!oldRubric) return;

    console.log("got new rubric", newRubric);
    const updatedGrades: Record<number, PaletteGradedSubmission> = {};

    Object.entries(tempGrades).forEach(([id, submission]) => {
      const oldAssessment = submission.rubric_assessment || {};
      const newAssessment: PaletteGradedSubmission["rubric_assessment"] = {};

      newRubric.criteria.forEach((newCriterion) => {
        // match by description
        const matchingOldCriterion = oldRubric.criteria.find(
          (old) => old.description === newCriterion.description,
        );

        if (matchingOldCriterion) {
          const oldCriterionId = matchingOldCriterion.id;
          const oldGrade = oldAssessment[oldCriterionId];

          console.log("old grade:", oldGrade);
          if (oldGrade) {
            newAssessment[newCriterion.id] = {
              points: oldGrade.points,
              rating_id: oldGrade.rating_id,
              comments: oldGrade.comments,
            };
          }
        }
      });

      updatedGrades[Number(id)] = {
        ...submission,
        rubric_assessment: newAssessment,
      };
    });

    setGradedSubmissionCache(updatedGrades);
  };

  /**
   * Submit all graded submissions in the cache
   */
  const submitGrades = async () => {
    setLoading(true);

    let successCount = 0;
    let failCount = 0;

    for (const gradedSubmission of Object.values(gradedSubmissionCache)) {
      if (gradedSubmission.user?.id) {
        try {
          const response = await fetch(
            `${BASE_URL}${GRADING_ENDPOINT}${gradedSubmission.user.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(gradedSubmission),
            },
          );

          if (response.ok) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          console.error("Error submitting grade:", error);
          failCount++;
        }
      }
    }

    await fetchSubmissions(); // refresh submissions
    setLoading(false);
    setGradedSubmissionCache({}); // clear submission cache
    localStorage.removeItem("gradedSubmissionCache"); // clear local storage

    // Show success/failure dialog
    openDialog({
      excludeCancel: true,
      title: failCount === 0 ? "Success!" : "Submission Complete",
      message:
        failCount === 0
          ? `Successfully submitted ${successCount} grade${successCount === 1 ? "" : "s"} to Canvas!`
          : `Submitted ${successCount} grade${successCount === 1 ? "" : "s"} successfully. ${failCount} submission${failCount === 1 ? "" : "s"} failed.`,
      buttons: [
        {
          autoFocus: true,
          label: "OK",
          action: () => closeDialog(),
        },
      ],
    });
  };

  const handleClickSubmitGrades = () => {
    openDialog({
      title: "Submit Grades to Canvas?",
      message: "Clicking yes will post grades to Canvas.",
      excludeCancel: true,
      buttons: [
        {
          label: "Send them!",
          action: () => {
            closeDialog();
            void submitGrades();
          },
          autoFocus: true,
        },
        {
          label: "Cancel",
          action: () => closeDialog(),
          autoFocus: false,
          color: "RED",
        },
      ],
    });
  };

  // Save grades locally to database (for offline work)
  const handleSaveGradesLocally = async () => {
    if (Object.keys(gradedSubmissionCache).length === 0) {
      openDialog({
        title: "No Grades to Save",
        message: "There are no grades in progress to save locally.",
        excludeCancel: true,
        buttons: [
          {
            autoFocus: true,
            label: "OK",
            action: () => closeDialog(),
          },
        ],
      });
      return;
    }

    setLoading(true);
    try {
      // Build a criterion key-to-description map from the current rubric
      const criterionDescriptions: Record<string, string> = {};
      activeRubric?.criteria.forEach(c => {
        const key = c.key || c.id;
        criterionDescriptions[key] = c.description;
      });

      const response = await fetch(
        `${BASE_URL}${draftGradesUrl}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grades: gradedSubmissionCache,
            rubricKey: activeRubric?.key,
            criterionDescriptions, // Save descriptions to allow remapping later
          }),
        }
      );
      const result = await response.json();

      if (result.success) {
        openDialog({
          title: "Grades Saved Locally",
          message: "Your draft grades have been saved to the local database. You can restore them later even when offline.",
          excludeCancel: true,
          buttons: [
            {
              autoFocus: true,
              label: "OK",
              action: () => closeDialog(),
            },
          ],
        });
      } else {
        throw new Error(result.error || "Failed to save grades");
      }
    } catch (error) {
      console.error("Error saving grades locally:", error);
      openDialog({
        title: "Error",
        message: "Failed to save grades locally. Please try again.",
        excludeCancel: true,
        buttons: [
          {
            autoFocus: true,
            label: "OK",
            action: () => closeDialog(),
          },
        ],
      });
    } finally {
      setLoading(false);
    }
  };

  // Restore grades from local database
  const handleRestoreLocalDrafts = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}${draftGradesUrl}`);
      const result = await response.json() as PaletteAPIResponse<SavedGrades> & {
        criterionDescriptions?: Record<string, string>;
        rubricKey?: string;
      };

      if (result.success && result.data) {
        let gradesToRestore = result.data;
        const savedCriterionDescriptions = result.criterionDescriptions || {};

        // Check if we need to remap criterion keys (rubric may have changed)
        if (activeRubric && Object.keys(savedCriterionDescriptions).length > 0) {
          // Build a description-to-newKey map from current rubric
          const descriptionToNewKey: Record<string, string> = {};
          activeRubric.criteria.forEach(c => {
            const key = c.key || c.id;
            descriptionToNewKey[c.description] = key;
          });

          // Build old-key to new-key mapping based on descriptions
          const keyMapping: Record<string, string> = {};
          Object.entries(savedCriterionDescriptions).forEach(([oldKey, description]) => {
            const newKey = descriptionToNewKey[description];
            if (newKey && newKey !== oldKey) {
              keyMapping[oldKey] = newKey;
              console.log(`🔄 Remapping criterion "${description}": ${oldKey} → ${newKey}`);
            }
          });

          // If we have key mappings, remap the grades
          if (Object.keys(keyMapping).length > 0) {
            console.log(`🔄 Remapping ${Object.keys(keyMapping).length} criterion keys`);
            gradesToRestore = {};

            Object.entries(result.data).forEach(([submissionId, submission]) => {
              const newRubricAssessment: typeof submission.rubric_assessment = {};

              Object.entries(submission.rubric_assessment || {}).forEach(([oldCriterionKey, assessment]) => {
                const newKey = keyMapping[oldCriterionKey] || oldCriterionKey;
                newRubricAssessment[newKey] = assessment;
              });

              gradesToRestore[Number(submissionId)] = {
                ...submission,
                rubric_assessment: newRubricAssessment,
              };
            });
          }
        }

        setGradedSubmissionCache(gradesToRestore);
        // Also sync to localStorage for the grading view
        localStorage.setItem("gradedSubmissionCache", JSON.stringify(gradesToRestore));

        openDialog({
          title: "Drafts Restored",
          message: "Your local draft grades have been restored. You can continue grading from where you left off.",
          excludeCancel: true,
          buttons: [
            {
              autoFocus: true,
              label: "OK",
              action: () => closeDialog(),
            },
          ],
        });
      } else if (result.success && !result.data) {
        openDialog({
          title: "No Drafts Found",
          message: "No saved draft grades were found for this assignment.",
          excludeCancel: true,
          buttons: [
            {
              autoFocus: true,
              label: "OK",
              action: () => closeDialog(),
            },
          ],
        });
      } else {
        throw new Error(result.error || "Failed to restore grades");
      }
    } catch (error) {
      console.error("Error restoring local drafts:", error);
      openDialog({
        title: "Error",
        message: "Failed to restore local drafts. Please try again.",
        excludeCancel: true,
        buttons: [
          {
            autoFocus: true,
            label: "OK",
            action: () => closeDialog(),
          },
        ],
      });
    } finally {
      setLoading(false);
    }
  };

  const isGraded = (submission: Submission) => {
    if (!submission) return false; // skip empty entries

    // First check local cache (in-progress grades)
    const localGrade = gradedSubmissionCache[submission.id];
    if (localGrade?.rubric_assessment) {
      const localEntries = Object.values(localGrade.rubric_assessment);
      if (localEntries.length > 0) {
        const hasLocalGrades = localEntries.some(
          (entry) => entry && (typeof entry.points === 'number' || (typeof entry.points === 'string' && entry.points !== ''))
        );
        if (hasLocalGrades) return true;
      }
    }

    // Fall back to Canvas data
    const rubric = submission.rubricAssessment;
    if (!rubric) return false;

    // Check that rubric has at least one entry and all entries have valid points
    const entries = Object.values(rubric);
    if (entries.length === 0) return false;

    return entries.every(
      (entry) => entry && typeof entry.points === 'number' && entry.points >= 0 && !Number.isNaN(entry.points),
    );
  };

  return (
    <div className={"grid justify-start"}>
      <div className={"grid gap-2 mb-4 p-4"}>
        <h1 className={"text-5xl font-bold"}>Submission Dashboard</h1>
        <AssignmentData modifyRubric={() => void modifyRubric()} />
        <div className={"flex gap-2 flex-wrap"}>
          <PaletteActionButton
            color={"GREEN"}
            title={"Submit Grades to Canvas"}
            onClick={() => handleClickSubmitGrades()}
          />
          <PaletteActionButton
            color={"BLUE"}
            title={"Save Grades Locally"}
            onClick={() => void handleSaveGradesLocally()}
          />
          <PaletteActionButton
            color={"YELLOW"}
            title={"Restore Local Drafts"}
            onClick={() => void handleRestoreLocalDrafts()}
          />
        </div>
      </div>

      <div
        className={cn(
          "grid gap-4 px-8 max-w-screen-lg",
          "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
        )}
      >
        {Object.entries(submissions).map(([groupName, groupSubmissions]) => {
          const progress = useMemo(() => {
            if (!groupSubmissions || groupSubmissions.length === 0) return 0;
            const gradedCount = groupSubmissions.filter(isGraded).length;
            return Math.floor((gradedCount / groupSubmissions.length) * 100);
          }, [groupSubmissions, gradedSubmissionCache]);
          return (
            <GroupSubmissions
              key={groupName}
              groupName={groupName}
              progress={progress}
              submissions={groupSubmissions}
              fetchSubmissions={fetchSubmissions}
            />
          );
        })}
      </div>

      <Dialog
        isOpen={builderOpen}
        onClose={() => setBuilderOpen(false)}
        title={"Hot Swap Criteria"}
      >
        <div className={"container relative"}>
          <RubricForm
            hotSwapActive={true}
            getUpdatedRubric={getUpdatedRubric}
          />
        </div>
      </Dialog>
    </div>
  );
}

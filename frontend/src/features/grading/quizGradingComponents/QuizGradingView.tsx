/**
 * Quiz grading view for manual grade adjustments on quizzes.
 * Shows quiz questions, student answers, and allows grade adjustments.
 */

import { Submission } from "palette-types";
import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import { PaletteActionButton } from "@/components";
import { useAssignment, useCourse } from "@/context";

type QuizGradingViewProps = {
  groupName: string;
  submissions: Submission[];
  isOpen: boolean;
  onClose: () => void;
};

export function QuizGradingView({
  groupName,
  submissions,
  isOpen,
  onClose,
}: QuizGradingViewProps) {
  const { activeCourse } = useCourse();
  const { activeAssignment } = useAssignment();

  // Track score and comment for each submission
  const [grades, setGrades] = useState<Record<number, { score: number; comment: string }>>(() => {
    const initial: Record<number, { score: number; comment: string }> = {};
    submissions.forEach(sub => {
      initial[sub.id] = {
        score: sub.score || 0,
        comment: ""
      };
    });
    return initial;
  });

  // Track per-question scores and comments for each submission
  const [questionGrades, setQuestionGrades] = useState<Record<number, Record<number, { score: number; comment: string }>>>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<Record<number, 'pending' | 'success' | 'error'>>({});
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [quizSubmissions, setQuizSubmissions] = useState<Record<number, any>>({});
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  // Fetch quiz questions when component opens
  useEffect(() => {
    if (isOpen && activeCourse?.id && activeAssignment?.quizId) {
      fetchQuizQuestions();
    }
  }, [isOpen, activeCourse?.id, activeAssignment?.quizId]);

  const fetchQuizQuestions = async () => {
    if (!activeCourse?.id || !activeAssignment?.quizId) return;

    setLoadingQuestions(true);
    try {
      const response = await fetch(
        `http://localhost:3000/api/courses/${activeCourse.id}/quizzes/${activeAssignment.quizId}/questions`
      );
      const result = await response.json();

      if (result.success) {
        setQuizQuestions(result.data);

        // Initialize question grades for each submission
        const initialQuestionGrades: Record<number, Record<number, { score: number; comment: string }>> = {};
        submissions.forEach(sub => {
          initialQuestionGrades[sub.id] = {};
          result.data.forEach((question: any) => {
            initialQuestionGrades[sub.id][question.id] = {
              score: 0,
              comment: ""
            };
          });
        });
        setQuestionGrades(initialQuestionGrades);

        // Fetch quiz submissions for each student
        for (const submission of submissions) {
          fetchQuizSubmission(submission.id);
        }
      }
    } catch (error) {
      console.error('Error fetching quiz questions:', error);
    } finally {
      setLoadingQuestions(false);
    }
  };

  const fetchQuizSubmission = async (submissionId: number) => {
    if (!activeCourse?.id || !activeAssignment?.quizId) return;

    try {
      const response = await fetch(
        `http://localhost:3000/api/courses/${activeCourse.id}/quizzes/${activeAssignment.quizId}/submissions/${submissionId}`
      );
      const result = await response.json();

      if (result.success) {
        setQuizSubmissions(prev => ({
          ...prev,
          [submissionId]: result.data
        }));

        // Populate question grades from the quiz submission data
        if (result.data?.submission_data) {
          console.log('📊 Quiz submission data received:', result.data);
          console.log('📊 Submission data array:', result.data.submission_data);

          setQuestionGrades(prevGrades => {
            const updated = { ...prevGrades };

            result.data.submission_data.forEach((answer: any) => {
              console.log('📝 Processing answer:', answer);
              if (answer.question_id && updated[submissionId]?.[answer.question_id]) {
                // Update the score if it exists in the submission data
                const score = answer.points !== undefined ? answer.points :
                             answer.score !== undefined ? answer.score : 0;

                console.log(`✅ Setting score ${score} for question ${answer.question_id}`);

                updated[submissionId][answer.question_id] = {
                  ...updated[submissionId][answer.question_id],
                  score: score
                };
              } else {
                console.log(`⚠️  Skipping answer - question_id: ${answer.question_id}, exists in state: ${!!updated[submissionId]?.[answer.question_id]}`);
              }
            });

            // Recalculate total score after populating individual question scores
            const totalScore = Object.values(updated[submissionId] || {}).reduce(
              (sum, q) => sum + (q.score || 0),
              0
            );

            // Update the overall grade score
            setGrades(prevGrades => ({
              ...prevGrades,
              [submissionId]: { ...prevGrades[submissionId], score: totalScore }
            }));

            return updated;
          });
        }
      }
    } catch (error) {
      console.error('Error fetching quiz submission:', error);
    }
  };

  if (!isOpen) {
    return null;
  }

  const handleScoreChange = (submissionId: number, newScore: string) => {
    const score = parseFloat(newScore) || 0;
    setGrades(prev => ({
      ...prev,
      [submissionId]: { ...prev[submissionId], score }
    }));
  };

  const handleCommentChange = (submissionId: number, comment: string) => {
    setGrades(prev => ({
      ...prev,
      [submissionId]: { ...prev[submissionId], comment }
    }));
  };

  const handleQuestionScoreChange = (submissionId: number, questionId: number, newScore: string) => {
    const score = parseFloat(newScore) || 0;
    setQuestionGrades(prev => {
      const updated = {
        ...prev,
        [submissionId]: {
          ...prev[submissionId],
          [questionId]: { ...prev[submissionId]?.[questionId], score }
        }
      };

      // Auto-calculate total score from all question scores
      const totalScore = Object.values(updated[submissionId] || {}).reduce(
        (sum, q) => sum + (q.score || 0),
        0
      );

      // Update the overall grade score
      setGrades(prevGrades => ({
        ...prevGrades,
        [submissionId]: { ...prevGrades[submissionId], score: totalScore }
      }));

      return updated;
    });
  };

  const handleQuestionCommentChange = (submissionId: number, questionId: number, comment: string) => {
    setQuestionGrades(prev => ({
      ...prev,
      [submissionId]: {
        ...prev[submissionId],
        [questionId]: { ...prev[submissionId]?.[questionId], comment }
      }
    }));
  };

  const handleSubmitGrade = async (submission: Submission) => {
    if (!activeCourse?.id || !activeAssignment?.id) return;

    const grade = grades[submission.id];
    const submissionQuestionGrades = questionGrades[submission.id] || {};
    setSubmitStatus(prev => ({ ...prev, [submission.id]: 'pending' }));

    // Build comprehensive comment from question-level feedback
    let fullComment = '';

    // Add question-level feedback if there are any question comments
    const questionComments = quizQuestions
      .map((question, index) => {
        const qGrade = submissionQuestionGrades[question.id];
        if (qGrade?.comment) {
          return `Q${index + 1} (${qGrade.score}/${question.points_possible} pts): ${qGrade.comment}`;
        }
        return null;
      })
      .filter(c => c !== null);

    if (questionComments.length > 0) {
      fullComment = 'Question Feedback:\n' + questionComments.join('\n');
    }

    // Add overall comment if provided
    if (grade.comment) {
      if (fullComment) {
        fullComment += '\n\nOverall Comment:\n' + grade.comment;
      } else {
        fullComment = grade.comment;
      }
    }

    try {
      const response = await fetch(
        `http://localhost:3000/api/courses/${activeCourse.id}/assignments/${activeAssignment.id}/submissions/${submission.id}/simple-grade`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            score: grade.score,
            comment: fullComment || undefined,
            userId: submission.user_id
          })
        }
      );

      const result = await response.json();

      if (result.success) {
        setSubmitStatus(prev => ({ ...prev, [submission.id]: 'success' }));
        console.log(`✅ Grade submitted for ${submission.user?.name}`);
      } else {
        setSubmitStatus(prev => ({ ...prev, [submission.id]: 'error' }));
        console.error(`❌ Failed to submit grade:`, result.error);
      }
    } catch (error) {
      setSubmitStatus(prev => ({ ...prev, [submission.id]: 'error' }));
      console.error('Error submitting grade:', error);
    }
  };

  const handleSubmitAll = async () => {
    setSubmitting(true);
    for (const submission of submissions) {
      await handleSubmitGrade(submission);
    }
    setSubmitting(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-11/12 max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gray-700 px-6 py-4 border-b border-gray-600">
          <h2 className="text-2xl font-bold text-white">
            Quiz Grading: {groupName}
          </h2>
          <p className="text-gray-300 text-sm mt-1">
            {activeAssignment?.name}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {submissions.map(submission => {
              const grade = grades[submission.id];
              const status = submitStatus[submission.id];

              return (
                <div
                  key={submission.id}
                  className="bg-gray-700 rounded-lg p-4 border border-gray-600"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-semibold text-white">
                        {submission.user?.name || `User ${submission.user_id}`}
                      </h3>
                      <p className="text-sm text-gray-400">
                        Current Canvas Score: {submission.score !== undefined && submission.score !== null ? submission.score : 'Not graded'}
                        {activeAssignment?.pointsPossible ? ` / ${activeAssignment.pointsPossible}` : ''}
                      </p>
                    </div>
                    {status && (
                      <div className={`px-3 py-1 rounded text-sm font-medium ${
                        status === 'success' ? 'bg-green-600 text-white' :
                        status === 'error' ? 'bg-red-600 text-white' :
                        'bg-yellow-600 text-white'
                      }`}>
                        {status === 'success' ? 'Submitted' :
                         status === 'error' ? 'Failed' :
                         'Submitting...'}
                      </div>
                    )}
                  </div>

                  {/* Quiz Questions and Answers */}
                  {loadingQuestions ? (
                    <div className="my-4 text-center text-gray-400">
                      Loading quiz questions...
                    </div>
                  ) : quizQuestions.length > 0 ? (
                    <div className="my-4 space-y-3 max-h-96 overflow-y-auto bg-gray-600 rounded-lg p-4">
                      <h4 className="text-md font-semibold text-white mb-2">Quiz Questions & Grading</h4>
                      {quizQuestions.map((question, index) => {
                        const studentAnswer = quizSubmissions[submission.id]?.submission_data?.find(
                          (answer: any) => answer.question_id === question.id
                        );
                        const questionGrade = questionGrades[submission.id]?.[question.id] || { score: 0, comment: '' };

                        return (
                          <div key={question.id} className="bg-gray-700 p-3 rounded space-y-2">
                            <div className="flex justify-between items-start">
                              <p className="text-sm text-gray-300 flex-1">
                                <span className="font-semibold">Q{index + 1}:</span> {question.question_name || question.question_text?.replace(/<[^>]+>/g, '')}
                              </p>
                              <span className="text-xs text-gray-400 ml-2">
                                Max: {question.points_possible} pts
                              </span>
                            </div>
                            {studentAnswer && (
                              <p className="text-sm text-gray-400 ml-4">
                                <span className="font-semibold">Answer:</span> {studentAnswer.text || studentAnswer.answer || 'No answer'}
                              </p>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                              <div>
                                <label className="block text-xs font-medium text-gray-300 mb-1">
                                  Score
                                </label>
                                <input
                                  type="number"
                                  value={questionGrade.score}
                                  onChange={(e) => handleQuestionScoreChange(submission.id, question.id, e.target.value)}
                                  min={0}
                                  max={question.points_possible}
                                  step={0.1}
                                  className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-500 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-300 mb-1">
                                  Comment (Optional)
                                </label>
                                <input
                                  type="text"
                                  value={questionGrade.comment}
                                  onChange={(e) => handleQuestionCommentChange(submission.id, question.id, e.target.value)}
                                  placeholder="Add feedback..."
                                  className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-500 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Total Score (Auto-calculated)
                      </label>
                      <input
                        type="number"
                        value={grade.score}
                        readOnly
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-500 rounded text-white cursor-not-allowed opacity-75"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Comment (Optional)
                      </label>
                      <textarea
                        value={grade.comment}
                        onChange={(e) => handleCommentChange(submission.id, e.target.value)}
                        rows={2}
                        placeholder="Add a comment..."
                        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <PaletteActionButton
                      title="Submit Grade"
                      color="BLUE"
                      onClick={() => handleSubmitGrade(submission)}
                      disabled={status === 'pending'}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-700 px-6 py-4 border-t border-gray-600 flex justify-between items-center">
          <PaletteActionButton
            title="Close"
            color="GRAY"
            onClick={onClose}
          />
          <PaletteActionButton
            title="Submit All Grades"
            color="GREEN"
            onClick={handleSubmitAll}
            disabled={submitting}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

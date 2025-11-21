import { Criteria, Rubric, Template } from "palette-types";
import { useTemplatesContext } from "@/features/templatesPage/TemplateContext";
import React, {
  MouseEvent as ReactMouseEvent,
  useEffect,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import CriteriaCard from "@/features/rubricBuilder/CriteriaCard";
import { createCriterion } from "@/utils";
import { ChoiceDialog, Dialog } from "@/components";
import AllTags from "@/features/templatesPage/AllTags";
import { useChoiceDialog } from "@/context/DialogContext.tsx";
import { useLocalStorage } from "@/hooks";
import { useSettings } from "@/context";

interface TemplateBuilderProps {
  document: Template | Rubric;
  setDocument: (document: Template | Rubric) => void;
  onSubmit: () => void;
}

export const TemplateBuilder = ({
  document,
  setDocument,
  onSubmit,
}: TemplateBuilderProps) => {
  const {
    editingTemplate,
    setEditingTemplate,
    viewingTemplate,
    handleUpdateTemplate,
    viewOrEdit,
    templates,
    setAddingTagFromBuilder,
    setHasUnsavedChanges,
  } = useTemplatesContext();

  // tracks which criterion card is displaying the detailed view (limited to one at a time)
  const [activeCriterionIndex, setActiveCriterionIndex] = useState(-1);
  const [showDialog, setShowDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [localTemplate, setLocalTemplate] = useLocalStorage(
    "localTemplate",
    document,
  );

  const { openDialog, closeDialog } = useChoiceDialog();

  useEffect(() => {
    console.log("localTemplate", localTemplate);
  }, []);

  const handleDocumentTitleChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    e.preventDefault();

    const newTitle = e.target.value;
    const updatedTemplate = {
      ...document,
      title: newTitle,
    } as Template;
    setDocument(updatedTemplate);
    setHasUnsavedChanges(true);
    setLocalTemplate(updatedTemplate);
  };

  // update criterion at given index
  const handleUpdateCriterion = (index: number, criterion: Criteria) => {
    if (!editingTemplate) return;
    const newCriteria = [...editingTemplate.criteria];
    newCriteria[index] = criterion;
    const updatedTemplate = {
      ...editingTemplate,
      criteria: newCriteria,
      points: newCriteria.reduce(
        (acc, criterion) => acc + criterion.pointsPossible,
        0,
      ),
    };

    setEditingTemplate(updatedTemplate as Template);
    handleUpdateTemplate(index, updatedTemplate as Template);
    setLocalTemplate(updatedTemplate);
  };

  const handleRemoveCriterion = (index: number, criterion: Criteria) => {
    if (!document) return;

    const deleteTemplateCriterion = () => {
      const newCriteria = [...(editingTemplate?.criteria || [])];
      newCriteria.splice(index, 1);

      const updatedTemplate = { ...editingTemplate, criteria: newCriteria };
      updatedTemplate.points = updatedTemplate.criteria.reduce(
        (acc, criterion) => acc + criterion.pointsPossible,
        0,
      );
      // console.log("updatedTemplate points", updatedTemplate.points);
      setEditingTemplate(updatedTemplate as Template);
      handleUpdateTemplate(index, updatedTemplate as Template);
      setHasUnsavedChanges(true);
      setLocalTemplate(updatedTemplate as Template);
    };
    openDialog({
      title: "Confirm Criterion Removal",
      message: `Are you sure you want to remove ${criterion.description}? This action is (currently) not reversible.`,
      buttons: [
        {
          autoFocus: true,
          label: "Destroy it!",
          action: () => {
            deleteTemplateCriterion();
            closeDialog();
          },
        },
      ],
      excludeCancel: false,
    });
  };

  const renderCriteriaCards = () => {
    if (!document) return;

    return (
      <SortableContext
        items={document.criteria.map((criterion) => criterion.key)}
        strategy={verticalListSortingStrategy}
      >
        <AnimatePresence>
          {document.criteria.map((criterion, index) => (
            <motion.div
              key={criterion.key}
              initial={{
                opacity: 0,
                y: 50,
              }} // Starting state (entry animation)
              animate={{
                opacity: 1,
                y: 0,
              }} // Animate to this state when in the DOM
              exit={{ opacity: 0, x: 50 }} // Ending state (exit animation)
              transition={{ duration: 0.3 }} // Controls the duration of the animations
              className="my-1"
            >
              <CriteriaCard
                index={index}
                activeCriterionIndex={activeCriterionIndex}
                criterion={criterion}
                handleCriteriaUpdate={handleUpdateCriterion}
                removeCriterion={handleRemoveCriterion}
                setActiveCriterionIndex={setActiveCriterionIndex}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </SortableContext>
    );
  };

  const { settings } = useSettings();

  const handleAddCriteria = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!document) return;
    const newCriterion = createCriterion(settings);
    newCriterion.template = document.key;
    const newCriteria = [...document.criteria, newCriterion];

    const updatedTemplate = {
      ...document,
      criteria: newCriteria,
      points: newCriteria.reduce(
        (acc, criterion) => acc + criterion.pointsPossible,
        0,
      ),
    };
    setEditingTemplate(updatedTemplate as Template);
    setActiveCriterionIndex(newCriteria.length - 1);
    setHasUnsavedChanges(true);
    setLocalTemplate(updatedTemplate);
    setDocument(updatedTemplate);
  };

  const submitDocument = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();

    if (document?.title.trim() === "") {
      openDialog({
        title: "Invalid Template",
        message: "Please enter a title for your template before saving.",
        buttons: [
          {
            autoFocus: true,
            action: () => closeDialog(),
            label: "Got It",
          },
        ],
      });
      return;
    }

    if (document?.criteria.length === 0) {
      openDialog({
        title: "Invalid Template",
        message: "Please add at least one criterion before saving.",
        buttons: [
          {
            autoFocus: true,
            action: () => closeDialog(),
            label: "Got It",
          },
        ],
      });
      return;
    }

    const isDuplicateName = templates.some(
      (t) =>
        t.title.toLowerCase() === document?.title.toLowerCase() &&
        t.key !== document?.key,
    );
    if (isDuplicateName) {
      openDialog({
        title: "Duplicate Template Name Detected",
        message:
          "A template with this name already exists. Please choose a different name.",
        buttons: [
          {
            autoFocus: true,
            action: () => closeDialog(),
            label: "Got It",
          },
        ],
      });
      return;
    }

    onSubmit();
  };

  return (
    <>
      <div className="flex justify-center items-center w-full bg-gray-900 rounded-lg">
        <form
          className="flex flex-col w-full p-4 sm:p-6 gap-4 bg-gray-800 shadow-lg rounded-lg"
          onSubmit={(event) => event.preventDefault()}
        >
          {viewOrEdit === "edit" ? (
            <div className="mb-4 p-4 bg-blue-900 bg-opacity-30 border-2 border-blue-500 rounded-lg">
              <label className="block text-blue-300 font-bold mb-2 text-sm uppercase tracking-wide">
                Template Title *
              </label>
              <input
                type="text"
                value={editingTemplate?.title}
                required={true}
                onChange={(e) => handleDocumentTitleChange(e)}
                className="rounded p-3 hover:bg-gray-200 focus:bg-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none text-gray-800 w-full text-xl font-semibold"
                placeholder="Enter template title..."
                autoFocus
              />
              <p className="text-blue-200 text-xs mt-1">
                Give your template a unique, descriptive name
              </p>
            </div>
          ) : (
            <h1 className="font-extrabold text-3xl sm:text-4xl mb-2 text-center">
              {viewingTemplate?.title}
            </h1>
          )}
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-extrabold bg-green-600 text-black py-1 px-3 rounded-lg">
              {editingTemplate?.points}{" "}
              {editingTemplate?.points === 1 ? "Point" : "Points"}
            </h2>
            <div className="flex gap-2">
              <button
                className="transition-all ease-in-out duration-300 bg-blue-600 text-white font-bold rounded-lg py-1 px-3
                         hover:bg-blue-700 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500"
                onClick={() => {
                  setShowDialog(true);
                  setAddingTagFromBuilder(true);
                }}
              >
                Tags
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 max-h-[50vh] min-h-[30vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-500 scrollbar-track-gray-800">
            {renderCriteriaCards()}
          </div>

          {viewOrEdit === "edit" && (
            <>
              <button
                className="transition-all ease-in-out duration-300 bg-blue-600 text-white font-bold rounded-lg py-2 px-4 mt-2
                         hover:bg-blue-700 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500"
                onClick={handleAddCriteria}
                type={"button"}
              >
                Add Criteria
              </button>
              <div className="grid gap-2 mt-3">
                <button
                  className="transition-all ease-in-out duration-300 bg-gray-600 text-white font-bold rounded-lg py-2 px-4
                           hover:bg-gray-700 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-500"
                  onClick={() => setShowImportDialog(true)}
                  type={"button"}
                >
                  Import from Existing Template
                </button>
                <button
                  className="transition-all ease-in-out duration-300 bg-green-600 text-white font-bold rounded-lg py-2 px-4
                           hover:bg-green-700 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500"
                  onClick={(event) => submitDocument(event)}
                  type={"button"}
                >
                  Save Template
                </button>
              </div>
            </>
          )}
        </form>

        <ChoiceDialog />

        <Dialog
          isOpen={showDialog}
          onClose={() => setShowDialog(false)}
          title={"Tag Management"}
          children={
            <AllTags
              onSave={() => {
                setShowDialog(false);
                console.log("showDialog", showDialog);
              }}
            />
          }
        />

        {/* Import from Existing Template Dialog */}
        <Dialog
          isOpen={showImportDialog}
          onClose={() => setShowImportDialog(false)}
          title={"Import Criteria from Existing Template"}
        >
          <div className="flex flex-col gap-3 max-h-96 overflow-y-auto p-2">
            <p className="text-gray-300 text-sm mb-2">
              Select a template to import all its criteria into the current template.
            </p>
            {templates.filter(t => t.key !== (document as Template).key).length === 0 ? (
              <p className="text-gray-400 text-center py-4">No other templates available to import from.</p>
            ) : (
              templates
                .filter(t => t.key !== (document as Template).key)
                .map((t) => (
                  <button
                    key={t.key}
                    className="text-left border border-gray-600 rounded-lg p-3 hover:bg-gray-600 hover:border-blue-500 transition-all"
                    onClick={() => {
                      // Import criteria from selected template
                      const currentCriteria = (document as Template).criteria || [];
                      const newCriteria = t.criteria.filter(
                        (newC) => !currentCriteria.some((existingC) => existingC.key === newC.key)
                      );
                      if (newCriteria.length > 0) {
                        setDocument({
                          ...document,
                          criteria: [...currentCriteria, ...newCriteria],
                        });
                        setHasUnsavedChanges(true);
                      }
                      setShowImportDialog(false);
                    }}
                  >
                    <p className="font-semibold text-white">{t.title}</p>
                    <p className="text-xs text-gray-400">
                      {t.criteria.length} {t.criteria.length === 1 ? "criterion" : "criteria"} • {t.points} points
                    </p>
                  </button>
                ))
            )}
          </div>
        </Dialog>
      </div>
    </>
  );
};

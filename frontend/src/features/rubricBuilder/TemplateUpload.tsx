import React, { useEffect, useState } from "react";
import { Criteria, Template } from "palette-types";
import { useFetch, useTemplate } from "@/hooks";
import { useChoiceDialog, useRubric } from "@/context";

interface TemplateUploadProps {
  closeImportCard: () => void; // callback to close the template import card
}

const TemplateUpload: React.FC<TemplateUploadProps> = ({
  closeImportCard,
}: TemplateUploadProps) => {
  const [templates, setTemplates] = useState<Template[]>([]);

  const { fetchData: getAllTemplates } = useFetch("/templates", {
    method: "GET",
  });

  useEffect(() => {
    console.log("useEffect in template upload");
    (async () => {
      const response = await getAllTemplates();
      if (response.success) {
        setTemplates(response.data as Template[]);
      }
    })().catch((error) => {
      console.error("Failed to fetch templates:", error);
    });
  }, []);

  const handleImportTemplate = (template: Template) => {
    console.log("import template", template.title);
    onTemplateSelected(template);
    closeImportCard();
  };

  const { setUpdatingTemplate, setImportingTemplate } = useTemplate();
  const { openDialog } = useChoiceDialog();
  const { activeRubric, setActiveRubric } = useRubric();

  const onTemplateSelected = (template: Template) => {
    const updatedTemplate = {
      ...template,
      usageCount: template.usageCount + 1,
      lastUsed: new Date().toISOString(),
    };

    setUpdatingTemplate(updatedTemplate);
    if (!activeRubric) return;

    const currentCriteria = activeRubric.criteria;
    const newCriteria = template.criteria;

    if (newCriteria.length === 0) {
      openDialog({
        title: "No Criteria Detected",
        message: "This template has no criteria",
        buttons: [],
      });
      return;
    }

    // Split into unique and duplicate criteria
    const { unique, duplicates } = newCriteria.reduce(
      (acc, newCriterion) => {
        const isDuplicate = currentCriteria.some(
          (existingCriterion) =>
            existingCriterion.key.trim().toLowerCase() ===
            newCriterion.key.trim().toLowerCase(),
        );

        if (isDuplicate) {
          acc.duplicates.push(newCriterion);
        } else {
          acc.unique.push(newCriterion);
        }

        return acc;
      },
      { unique: [] as Criteria[], duplicates: [] as Criteria[] },
    );

    // Log information about duplicates if any were found
    if (duplicates.length > 0) {
      const duplicateDescriptions = duplicates
        .map((criterion) => criterion.description)
        .join(", ");

      openDialog({
        title: "Duplicate Criteria Detected",
        message: `Looks like you already imported this one. Duplicate criteria: ${duplicateDescriptions}`,
        buttons: [],
      });
      return;
    }

    setActiveRubric({
      ...activeRubric,
      criteria: [...currentCriteria, ...unique],
    });
    setImportingTemplate(updatedTemplate);
  };

  return (
    <div className="flex flex-col h-full w-full items-center justify-center p-4">
      <div className="bg-blue-900 bg-opacity-30 border-2 border-blue-500 rounded-lg p-4 mb-4 w-full">
        <h3 className="text-blue-300 font-bold mb-2 flex items-center gap-2">
          <i className="fas fa-info-circle" />
          Import Entire Template
        </h3>
        <p className="text-blue-200 text-sm">
          Select a template below to import <strong>all criteria</strong> from that template into your rubric at once.
          This is useful for quickly building rubrics from pre-made templates.
        </p>
        <p className="text-blue-200 text-xs mt-2 italic">
          💡 Tip: For adding individual criteria, use the criterion editor instead.
        </p>
      </div>
      <div className="overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800 w-full max-h-96">
        {templates.length === 0 ? (
          <p className="text-gray-400 text-center p-4">
            No templates available. Create templates from the Templates page first!
          </p>
        ) : (
          templates.map((t, tKey) => {
            return (
              <div
                key={tKey}
                onClick={() => handleImportTemplate(t)}
                className="text-center border border-gray-600 rounded-lg p-3 mb-2 hover:bg-gray-600 hover:border-blue-500 w-full cursor-pointer transition-all"
              >
                <p className="font-semibold">{t.title}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {t.criteria.length} {t.criteria.length === 1 ? "criterion" : "criteria"} • {t.points} points
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TemplateUpload;

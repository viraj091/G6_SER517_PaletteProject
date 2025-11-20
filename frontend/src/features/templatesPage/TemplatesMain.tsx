/**
 * Rubric Builder view.
 */

import { ReactElement, useEffect, useState } from "react";
import { ChoiceDialog, Dialog, MainPageTemplate } from "@/components";
import { TemplateProvider, useTemplatesContext } from "./TemplateContext.tsx";
import TemplatesWindow from "./TemplatesWindow.tsx";
import TemplateSearch from "./TemplateSearch.tsx";
import AddTemplateTag from "./AddTemplateTag.tsx";
import { TemplateBuilder } from "@/features/templatesPage/TemplateBuilder.tsx";
import { Template } from "palette-types";
import { useChoiceDialog } from "@/context/DialogContext.tsx";
import TemplateCharts from "./TemplateCharts.tsx";

export default function TemplatesMain(): ReactElement {
  return (
    <TemplateProvider>
      <TemplatesMainContent />
    </TemplateProvider>
  );
}

function TemplatesMainContent(): ReactElement {
  const {
    templates,
    searchQuery,
    setSearchQuery,
    showSuggestions,
    setShowSuggestions,
    handleCreateTemplate,
    handleSubmitNewTemplate,
    setIsNewTemplate,
    setShowBulkActions,
    editingTemplate,
    setEditingTemplate,
    hasUnsavedChanges,
    showMetrics,
  } = useTemplatesContext();

  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const { openDialog, closeDialog } = useChoiceDialog();

  useEffect(() => {
    // console.log("editingTemplate in TemplatesMain", editingTemplate);
    setEditingTemplate(editingTemplate as Template);
  }, [templateDialogOpen]);

  useEffect(() => {
    console.log("setting localTemplate to null");
    localStorage.setItem("localTemplate", JSON.stringify(null));
  }, []);

  const handleCloseModal = () => {
    if (hasUnsavedChanges) {
      openDialog({
        title: "Lose unsaved changes? Template main",
        message:
          "Are you sure you want to leave without saving your changes? Your changes will be lost.",
        excludeCancel: false,
        buttons: [
          {
            label: "Yes",
            action: () => {
              closeDialog();
              setTemplateDialogOpen(false);
            },
            autoFocus: true,
          },
        ],
      });
    } else {
      setTemplateDialogOpen(false);
    }
  };

  const handleCreateNewTemplate = () => {
    setTemplateDialogOpen(true);
    handleCreateTemplate();
  };

  const handleTemplateSubmit = () => {
    handleSubmitNewTemplate();
    setIsNewTemplate(false);
    setShowBulkActions(false);
    setTemplateDialogOpen(false);
  };

  // Update renderUserTemplates to use the new search component
  const renderTemplatesContent = () => {
    if (!templates) return;

    return (
      <div className="mt-0 p-10 gap-6 w-full">
        <div className="flex justify-between items-center mb-4">
          <p className="text-white text-2xl font-bold text-center">
            View, Edit, and Create templates here!
          </p>
        </div>

        {/* Help Section */}
        <div className="bg-gradient-to-r from-blue-900 to-blue-800 border-2 border-blue-500 rounded-lg p-4 mb-6 shadow-lg">
          <div className="flex items-start gap-3">
            <i className="fas fa-lightbulb text-yellow-400 text-2xl mt-1" />
            <div className="w-full">
              <h3 className="text-blue-100 font-bold text-lg mb-2">What are Templates?</h3>
              <p className="text-blue-200 text-sm mb-2">
                Templates are reusable collections of grading criteria that you can import into rubrics.
                Create a template once and use it across multiple assignments!
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                <div className="bg-blue-950 bg-opacity-50 rounded p-2">
                  <p className="text-blue-100 font-semibold text-xs mb-1">📝 Create Template</p>
                  <p className="text-blue-300 text-xs">Click "Create Template" below to build a new reusable template</p>
                </div>
                <div className="bg-blue-950 bg-opacity-50 rounded p-2">
                  <p className="text-blue-100 font-semibold text-xs mb-1">✏️ Edit Template</p>
                  <p className="text-blue-300 text-xs">Click a template to expand, then click "Edit" to modify it</p>
                </div>
                <div className="bg-blue-950 bg-opacity-50 rounded p-2">
                  <p className="text-blue-100 font-semibold text-xs mb-1">🔖 Tag Templates</p>
                  <p className="text-blue-300 text-xs">Organize templates with tags for easy filtering</p>
                </div>
                <div className="bg-blue-950 bg-opacity-50 rounded p-2">
                  <p className="text-blue-100 font-semibold text-xs mb-1">📤 Use in Rubrics</p>
                  <p className="text-blue-300 text-xs">In Rubric Builder, click "Templates" to import criteria</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <TemplateSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          showSuggestions={showSuggestions}
          setShowSuggestions={setShowSuggestions}
          onSearch={setSearchQuery}
        />
        <p className="text-gray-400 text-sm mb-2">
          Only tags with templates are shown here. Click gear icon to see all
          tags!
        </p>
        {/* Add tag filters */}
        <AddTemplateTag />

        {/* Templates Container */}
        <TemplatesWindow />

        {/* Bar Charts */}
        {showMetrics && <TemplateCharts />}
      </div>
    );
  };

  const renderNoTemplates = () => {
    return (
      <div className="mt-0 p-10 gap-6 w-full">
        <p className="text-white text-2xl font-bold mb-4 text-center">
          View, Edit, and Create templates here!
        </p>

        {/* Getting Started Guide */}
        <div className="bg-gradient-to-br from-blue-900 to-purple-900 border-2 border-blue-500 rounded-lg p-6 mb-6 shadow-xl max-w-3xl mx-auto">
          <div className="text-center mb-4">
            <i className="fas fa-rocket text-yellow-400 text-4xl mb-2" />
            <h2 className="text-white text-2xl font-bold">Welcome to Templates!</h2>
            <p className="text-blue-200 mt-2">
              No templates yet. Let's create your first one!
            </p>
          </div>

          <div className="bg-blue-950 bg-opacity-50 rounded-lg p-4 mb-4">
            <h3 className="text-blue-100 font-bold mb-2">📚 What are Templates?</h3>
            <p className="text-blue-200 text-sm">
              Templates are collections of reusable grading criteria. Instead of recreating the same
              criteria for every assignment, create a template once and import it into any rubric!
            </p>
          </div>

          <div className="bg-blue-950 bg-opacity-50 rounded-lg p-4">
            <h3 className="text-blue-100 font-bold mb-2">🚀 Getting Started:</h3>
            <ol className="text-blue-200 text-sm space-y-2 list-decimal list-inside">
              <li>Click <strong>"Create Template"</strong> below</li>
              <li>Give your template a descriptive title</li>
              <li>Add grading criteria with point values and descriptions</li>
              <li>Save it! Now you can reuse it in any rubric via the Rubric Builder</li>
            </ol>
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    return (
      <div className="min-h-screen pt-16">
        {templates && templates.length > 0
          ? renderTemplatesContent()
          : renderNoTemplates()}

        <div className="mx-10 rounded-lg flex flex-row">
          <button
            onClick={() => void handleCreateNewTemplate()}
            className="bg-blue-500 text-white font-bold mb-6 rounded-lg py-2 px-4 mr-4 hover:bg-blue-700 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Create Template
          </button>
        </div>

        <Dialog
          isOpen={templateDialogOpen}
          onClose={handleCloseModal}
          title={""}
          children={
            <TemplateBuilder
              document={editingTemplate as Template}
              setDocument={(template) =>
                setEditingTemplate(template as Template)
              }
              onSubmit={handleTemplateSubmit}
            />
          }
        />
        {/* ModalChoiceDialog */}
        <ChoiceDialog />
      </div>
    );
  };

  return <MainPageTemplate children={renderContent()} />;
}

import React from "react";
import { PaletteActionButton } from "../buttons/PaletteActionButton.tsx";
import { useChoiceDialog } from "../../context/DialogContext.tsx";

export const ChoiceDialog = () => {
  const { isOpen, closeDialog, dialogConfig } = useChoiceDialog();
  if (!isOpen || !dialogConfig) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 p-4">
      <div className="bg-gradient-to-br from-gray-800 via-gray-900 to-gray-700 rounded-xl shadow-2xl p-8 w-full max-w-lg border-2 border-gray-600">
        {/* Title */}
        <div className="mb-6">
          <h2 className="text-center text-2xl font-bold text-white">
            {dialogConfig.title}
          </h2>
        </div>

        {/* Message */}
        <div className="mb-8 flex justify-center">
          <p className="text-gray-300 text-center text-lg leading-relaxed">{dialogConfig.message}</p>
        </div>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          {dialogConfig.buttons.map((button, index) => (
            <PaletteActionButton
              color={button.color ?? "BLUE"}
              key={index}
              onClick={button.action}
              title={button.label}
              autoFocus={index === 0} // autofocus the first option
            />
          ))}
          {dialogConfig.excludeCancel ? (
            ""
          ) : (
            <PaletteActionButton
              color={"GRAY"}
              onClick={closeDialog}
              title={"Cancel"}
            />
          )}
        </div>
      </div>
    </div>
  );
};
